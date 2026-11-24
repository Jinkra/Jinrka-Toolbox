const { app, clipboard, dialog, nativeImage, net } = require('electron');
const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const dns = require('node:dns/promises');
const { readFile, unlink, writeFile } = require('node:fs/promises');
const { Socket } = require('node:net');
const path = require('node:path');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const powershell = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const hostsFile = path.join(system, 'drivers', 'etc', 'hosts');
const hostsBackup = `${hostsFile}.jinkra.bak`;
const literal = (value) => "'" + String(value).replace(/'/g, "''") + "'";
const encoded = (value) => Buffer.from(
  "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; " + value,
  'utf16le').toString('base64');
const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(script)];
const temp = (extension) => path.join(app.getPath('temp'), `jinkra-${randomUUID()}.${extension}`);

async function ps(script, timeout = 60_000) {
  const { stdout } = await execute(powershell, psArgs(script), { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
  return stdout;
}

// Runs a script with an administrator token; Windows shows the UAC prompt.
async function elevated(script) {
  await ps(`$p = Start-Process -FilePath ${literal(powershell)} -ArgumentList @(${psArgs(script).map(literal).join(',')}) -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`, 180_000);
}

/* ---------- OCR：使用 Windows 内置识别引擎，完全离线 ---------- */

const winrt = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Await($operation, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation)); [void]$task.Wait(-1); $task.Result }
`;
const ocrMax = 10_000;
const cjk = '[\\u3000-\\u303f\\u3400-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]';
const cjkSpace = new RegExp(`(?<=${cjk})\\s+(?=${cjk})`, 'gu');
const languageTag = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u;

async function ocrLanguages() {
  const output = await ps(`${winrt}
    @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { @{ tag = $_.LanguageTag; name = $_.DisplayName } }) | ConvertTo-Json -Compress`);
  const parsed = JSON.parse(output.trim() || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function recognizeFile(file, language) {
  if (language && !languageTag.test(language)) throw new Error('识别语言无效。');
  const engine = language
    ? `[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new(${literal(language)}))`
    : '[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()';
  let output;
  try {
    output = await ps(`${winrt}
      $engine = ${engine}
      if (!$engine) { exit 3 }
      $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync(${literal(file)})) ([Windows.Storage.StorageFile])
      $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      try {
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      } finally { $stream.Dispose() }
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      @{ language = $engine.RecognizerLanguage.DisplayName; lines = @($result.Lines | ForEach-Object { $_.Text }) } | ConvertTo-Json -Compress`, 90_000);
  } catch (error) {
    if (error.code === 3) throw new Error('Windows 中没有可用的识别语言。请在「设置 → 时间和语言 → 语言」中为中文或英文安装“光学字符识别”功能。');
    if (error.code === 'ENOENT') throw new Error('无法调用 Windows PowerShell。');
    throw new Error('文字识别失败，请换一张清晰的图片再试。');
  }
  const data = JSON.parse(output.trim());
  const lines = (Array.isArray(data.lines) ? data.lines : [data.lines]).filter(Boolean).map((line) => String(line).replace(cjkSpace, ''));
  return { language: data.language, lines, text: lines.join('\r\n') };
}

async function recognizeImage(image, language) {
  if (image.isEmpty()) throw new Error('无法读取这张图片。');
  let { width, height } = image.getSize();
  if (width < 40 || height < 12) throw new Error('图片太小，无法识别文字。');
  // Small screenshots recognise noticeably better after upscaling.
  const scale = Math.min(ocrMax / Math.max(width, height), Math.max(width, height) < 900 ? 2 : 1);
  if (scale !== 1) {
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
    image = image.resize({ width, height, quality: 'best' });
  }
  const file = temp('png');
  try {
    await writeFile(file, image.toPNG());
    return await recognizeFile(file, language);
  } finally {
    await unlink(file).catch(() => {});
  }
}

async function ocrBytes(bytes, language) {
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength > 80 * 1024 * 1024) throw new Error('图片数据无效或过大。');
  return recognizeImage(nativeImage.createFromBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)), language);
}

async function ocrClipboard(language) {
  const image = clipboard.readImage();
  if (image.isEmpty()) throw new Error('剪贴板里没有图片。可先按 Win + Shift + S 截图。');
  const result = await recognizeImage(image, language);
  const { width } = image.getSize();
  const preview = width > 1400 ? image.resize({ width: 1400, quality: 'good' }) : image;
  return { ...result, preview: preview.toDataURL() };
}

/* ---------- Hosts 与 DNS ---------- */

async function hostsRead() {
  const buffer = await readFile(hostsFile).catch((error) => {
    if (error.code === 'ENOENT') return Buffer.alloc(0);
    throw new Error('无法读取 hosts 文件。');
  });
  const text = buffer.toString('utf8').replace(/^\uFEFF/u, '');
  const backup = await readFile(hostsBackup).then(() => true, () => false);
  return { text, path: hostsFile, backup };
}

let savingHosts = false;
async function hostsSave(text) {
  if (typeof text !== 'string' || text.length > 2_000_000 || text.includes('\0')) throw new Error('hosts 内容无效。');
  if (savingHosts) throw new Error('正在保存 hosts。');
  savingHosts = true;
  const content = text.replace(/\r\n|\r|\n/gu, '\r\n').replace(/(?:\r\n)*$/u, '\r\n');
  const draft = temp('txt');
  try {
    await writeFile(draft, content, 'utf8');
    await elevated(`
      $hosts = ${literal(hostsFile)}
      $backup = ${literal(hostsBackup)}
      if ((Test-Path -LiteralPath $hosts) -and !(Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $hosts -Destination $backup }
      if (Test-Path -LiteralPath $hosts) { $item = Get-Item -LiteralPath $hosts; if ($item.IsReadOnly) { $item.IsReadOnly = $false } }
      [IO.File]::WriteAllText($hosts, [IO.File]::ReadAllText(${literal(draft)}, [Text.Encoding]::UTF8), (New-Object Text.UTF8Encoding $false))
      & (Join-Path $env:SystemRoot 'System32\\ipconfig.exe') /flushdns | Out-Null`).catch(() => {
      throw new Error('hosts 未保存。请在弹出的窗口中允许管理员权限；若仍失败，可能被安全软件拦截。');
    });
    const saved = (await readFile(hostsFile)).toString('utf8').replace(/^\uFEFF/u, '');
    if (saved !== content) throw new Error('hosts 写入后校验不一致，可能被安全软件还原。');
    return { saved: true };
  } finally {
    savingHosts = false;
    await unlink(draft).catch(() => {});
  }
}

async function hostsRestore(window) {
  const backup = await readFile(hostsBackup).catch(() => null);
  if (!backup) throw new Error('还没有备份。第一次保存 hosts 时会自动备份原文件。');
  const { response } = await dialog.showMessageBox(window, {
    type: 'warning', title: '恢复 hosts', message: '用第一次修改前的备份覆盖当前 hosts？',
    detail: hostsBackup, buttons: ['取消', '恢复备份'], cancelId: 0, defaultId: 0, noLink: true,
  });
  if (response !== 1) return null;
  await hostsSave(backup.toString('utf8').replace(/^\uFEFF/u, ''));
  return hostsRead();
}

async function dnsFlush() {
  await execute(path.join(system, 'ipconfig.exe'), ['/flushdns'], { windowsHide: true, timeout: 20_000 })
    .catch(() => { throw new Error('DNS 缓存刷新失败。'); });
  return true;
}

/* ---------- 端口占用 ---------- */

async function processTable() {
  const output = await ps(`@(Get-Process | ForEach-Object { @{ id = $_.Id; name = $_.ProcessName; path = $_.Path } }) | ConvertTo-Json -Compress`).catch(() => '[]');
  const list = JSON.parse(output.trim() || '[]');
  return new Map((Array.isArray(list) ? list : [list]).map((item) => [item.id, item]));
}

function splitAddress(value) {
  const index = value.lastIndexOf(':');
  return { address: value.slice(0, index).replace(/^\[|\]$/gu, ''), port: Number(value.slice(index + 1)) };
}

async function portsList(includeConnections = false) {
  const [{ stdout }, processes] = await Promise.all([
    execute(path.join(system, 'NETSTAT.EXE'), ['-ano'], { windowsHide: true, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }),
    processTable(),
  ]);
  const rows = [];
  const seen = new Set();
  for (const line of stdout.split(/\r?\n/u)) {
    const match = line.match(/^\s*(TCP|UDP)\s+(\S+)\s+(\S+)\s+(?:(\S+)\s+)?(\d+)\s*$/u);
    if (!match) continue;
    const [, protocol, local, remote, state, pidText] = match;
    const listening = protocol === 'UDP' || /^(?:0\.0\.0\.0|\[::\]):0$/u.test(remote);
    if (!listening && !includeConnections) continue;
    const pid = Number(pidText);
    const { address, port } = splitAddress(local);
    const key = `${protocol}|${address}|${port}|${pid}|${listening ? '' : remote}`;
    if (!Number.isInteger(port) || seen.has(key)) continue;
    seen.add(key);
    const info = processes.get(pid);
    rows.push({
      protocol, address, port, pid, listening, remote: listening ? '' : remote, state: listening ? '监听' : state ?? '',
      name: pid === 0 ? '系统空闲进程' : pid === 4 ? 'System' : info?.name ?? '未知', path: info?.path ?? '',
    });
  }
  return rows.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
}

const protectedProcesses = new Set(['system', 'idle', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost',
  'fontdrvhost', 'dwm', 'registry', 'memory compression', 'secure system', 'lsaiso', 'sihost', 'explorer', 'msmpeng']);

async function processKill(window, pid) {
  if (!Number.isInteger(pid) || pid <= 4) throw new Error('不能结束这个系统进程。');
  if (pid === process.pid || pid === process.ppid) throw new Error('不能结束小金工具箱自身。');
  const info = (await processTable()).get(pid);
  if (!info) throw new Error('进程已经退出。');
  if (protectedProcesses.has(String(info.name).toLowerCase())) throw new Error(`「${info.name}」是 Windows 关键进程，结束后可能导致系统异常，已阻止。`);
  const { response } = await dialog.showMessageBox(window, {
    type: 'warning', title: '结束进程', message: `结束「${info.name}」（PID ${pid}）？`,
    detail: `${info.path || ''}\n该程序中未保存的内容会丢失。`.trim(),
    buttons: ['取消', '结束进程'], cancelId: 0, defaultId: 0, noLink: true,
  });
  if (response !== 1) return null;
  try {
    process.kill(pid);
  } catch (error) {
    if (error.code === 'ESRCH') return { name: info.name, elevated: false };
    if (error.code !== 'EPERM') throw new Error('无法结束这个进程。');
    await elevated(`Stop-Process -Id ${pid} -Force`).catch(() => {
      throw new Error('结束进程需要管理员权限，操作已取消。');
    });
    return { name: info.name, elevated: true };
  }
  return { name: info.name, elevated: false };
}

/* ---------- Ping 与网络测速 ---------- */

const hostPattern = /^(?=.{1,253}$)(?!-)[A-Za-z0-9.\-:[\]%_]+$/u;
let job;

function startJob() {
  if (job) throw new Error('已有网络测试正在运行。');
  job = new AbortController();
  return job;
}

const pingStates = {
  TimedOut: '请求超时', DestinationHostUnreachable: '目标主机不可达', DestinationNetworkUnreachable: '目标网络不可达',
  DestinationPortUnreachable: '目标端口不可达', TtlExpired: 'TTL 过期', BadDestination: '目标地址无效', DestinationUnreachable: '目标不可达',
};

function icmpPing(host, count, emit, signal) {
  const script = `
    $ping = New-Object System.Net.NetworkInformation.Ping
    for ($i = 1; $i -le ${count}; $i++) {
      $started = [DateTime]::UtcNow
      try {
        $reply = $ping.Send(${literal(host)}, 2000)
        @{ seq = $i; status = [string]$reply.Status; time = $reply.RoundtripTime; address = [string]$reply.Address; ttl = $(if ($reply.Options) { $reply.Options.Ttl } else { 0 }) } | ConvertTo-Json -Compress
      } catch {
        @{ seq = $i; status = 'Error'; message = $_.Exception.InnerException.Message } | ConvertTo-Json -Compress
        if ($i -eq 1) { break }
      }
      [Console]::Out.Flush()
      $wait = 1000 - ([DateTime]::UtcNow - $started).TotalMilliseconds
      if ($i -lt ${count} -and $wait -gt 0) { Start-Sleep -Milliseconds $wait }
    }`;
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, psArgs(script), { windowsHide: true });
    const results = [];
    let buffer = '';
    signal.addEventListener('abort', () => child.kill(), { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim().startsWith('{')) continue;
        const data = JSON.parse(line);
        const ok = data.status === 'Success';
        const item = { seq: data.seq, ok, time: ok ? data.time : null, ttl: data.ttl, address: data.address,
          message: ok ? '' : data.status === 'Error' ? '无法解析主机名或地址' : pingStates[data.status] ?? data.status };
        results.push(item);
        emit({ kind: 'ping', item });
      }
    });
    child.on('error', () => reject(new Error('无法调用 Windows PowerShell。')));
    child.on('close', () => resolve(results));
  });
}

async function tcpPing(host, port, count, emit, signal) {
  let address;
  try {
    ({ address } = await dns.lookup(host));
  } catch {
    emit({ kind: 'ping', item: { seq: 1, ok: false, message: '无法解析主机名' } });
    return [{ seq: 1, ok: false }];
  }
  const results = [];
  for (let seq = 1; seq <= count && !signal.aborted; seq++) {
    const started = performance.now();
    const item = await new Promise((resolve) => {
      const socket = new Socket();
      const done = (ok, message = '') => {
        socket.destroy();
        resolve({ seq, ok, address, time: ok ? Math.round(performance.now() - started) : null, message });
      };
      socket.setTimeout(3000, () => done(false, '连接超时'));
      socket.once('error', (error) => done(false, error.code === 'ECONNREFUSED' ? '端口拒绝连接' : '连接失败'));
      socket.connect(port, address, () => done(true));
    });
    results.push(item);
    emit({ kind: 'ping', item });
    const wait = 1000 - (performance.now() - started);
    if (seq < count && wait > 0 && !signal.aborted) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return results;
}

async function ping(options, emit) {
  const host = String(options?.host ?? '').trim();
  const count = Number(options?.count);
  const port = Number(options?.port);
  if (!hostPattern.test(host)) throw new Error('请输入有效的域名或 IP 地址。');
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('次数需在 1 到 100 之间。');
  if (options.mode === 'tcp' && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('端口需在 1 到 65535 之间。');
  const { signal } = startJob();
  try {
    const results = options.mode === 'tcp' ? await tcpPing(host, port, count, emit, signal) : await icmpPing(host, count, emit, signal);
    const times = results.filter((item) => item.ok).map((item) => item.time);
    return {
      sent: results.length, received: times.length, cancelled: signal.aborted,
      min: times.length ? Math.min(...times) : null, max: times.length ? Math.max(...times) : null,
      average: times.length ? Math.round(times.reduce((sum, time) => sum + time, 0) / times.length) : null,
      jitter: times.length > 1 ? Math.round(times.slice(1).reduce((sum, time, index) => sum + Math.abs(time - times[index]), 0) / (times.length - 1)) : null,
    };
  } finally {
    job = undefined;
  }
}

const speedHost = 'https://speed.cloudflare.com';

async function measureLatency(signal) {
  const times = [];
  for (let index = 0; index < 6 && !signal.aborted; index++) {
    const started = performance.now();
    const response = await net.fetch(`${speedHost}/__down?bytes=0&r=${Math.random()}`, { signal, cache: 'no-store' });
    await response.arrayBuffer();
    if (index > 0) times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return times.length ? Math.round(times[Math.floor(times.length / 2)]) : null;
}

async function measureDownload(signal, emit) {
  const limit = 10_000;
  const started = performance.now();
  const stop = new AbortController();
  const abort = () => stop.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, limit);
  let received = 0;
  const ticker = setInterval(() => {
    const seconds = (performance.now() - started) / 1000;
    emit({ kind: 'speed', stage: 'download', mbps: received * 8 / seconds / 1e6, ratio: Math.min(1, seconds * 1000 / limit) });
  }, 250);
  const stream = async () => {
    while (!stop.signal.aborted) {
      const response = await net.fetch(`${speedHost}/__down?bytes=50000000&r=${Math.random()}`, { signal: stop.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('测速服务器暂时不可用。');
      for await (const chunk of response.body) received += chunk.byteLength;
    }
  };
  try {
    await Promise.all(Array.from({ length: 4 }, () => stream().catch((error) => {
      if (!stop.signal.aborted) throw error;
    })));
  } finally {
    clearTimeout(timer);
    clearInterval(ticker);
    signal.removeEventListener('abort', abort);
  }
  return received * 8 / ((performance.now() - started) / 1000) / 1e6;
}

async function upload(size, signal) {
  const response = await net.fetch(`${speedHost}/__up`, { method: 'POST', body: new Uint8Array(size), signal, cache: 'no-store' });
  if (!response.ok) throw new Error('测速服务器暂时不可用。');
  await response.arrayBuffer();
}

async function measureUpload(signal, emit) {
  const limit = 8000;
  // A small warm-up request opens the connection so the handshake is not counted.
  await upload(200_000, signal);
  const started = performance.now();
  let sent = 0;
  const worker = async () => {
    let size = 1_000_000;
    while (!signal.aborted && performance.now() - started < limit) {
      const begin = performance.now();
      await upload(size, signal);
      sent += size;
      const seconds = (performance.now() - started) / 1000;
      emit({ kind: 'speed', stage: 'upload', mbps: sent * 8 / seconds / 1e6, ratio: Math.min(1, seconds * 1000 / limit) });
      // Grow each payload so a request lasts about two seconds.
      size = Math.min(25_000_000, Math.max(500_000, Math.round(size * 2000 / Math.max(1, performance.now() - begin))));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return sent * 8 / ((performance.now() - started) / 1000) / 1e6;
}

async function speedTest(emit) {
  const { signal } = startJob();
  try {
    emit({ kind: 'speed', stage: 'latency' });
    const latency = await measureLatency(signal);
    emit({ kind: 'speed', stage: 'latency', latency });
    const download = await measureDownload(signal, emit);
    if (signal.aborted) return null;
    const upload = await measureUpload(signal, emit);
    return signal.aborted ? null : { latency, download, upload, server: 'Cloudflare' };
  } catch (error) {
    if (signal.aborted) return null;
    throw new Error(error.message?.startsWith('测速') ? error.message : '无法连接测速服务器，请检查网络或代理设置。');
  } finally {
    job = undefined;
  }
}

const networkCancel = () => job?.abort();

module.exports = {
  ocrLanguages, ocrBytes, ocrClipboard, hostsRead, hostsSave, hostsRestore, dnsFlush,
  portsList, processKill, ping, speedTest, networkCancel,
};
