const { app } = require('electron');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const { lstat, mkdtemp, readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');

const { version } = require('../package.json');
const repo = '/Jinkra/Jinrka-Toolbox';
const homepage = 'https://github.com' + repo;
const allowedHosts = ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
const stableTag = /^v(\d{1,7})\.(\d{1,7})\.(\d{1,7})$/u;
const maxBytes = 650 * 1024 * 1024;
let latest;
let checking;
let downloading = false;
const errorFile = () => path.join(app.getPath('userData'), 'update-error.txt');

function newer(tag) {
  const candidate = tag.match(stableTag);
  const existing = ('v' + version).match(stableTag);
  if (!candidate || !existing) return false;
  for (let position = 1; position <= 3; position++) {
    const delta = Number(candidate[position]) - Number(existing[position]);
    if (delta) return delta > 0;
  }
  return false;
}

async function request(url, signal, redirectLimit = 4) {
  for (let remaining = redirectLimit; remaining >= 0; remaining--) {
    const destination = new URL(url);
    if (destination.protocol !== 'https:' || destination.username || destination.password ||
        destination.port || !allowedHosts.includes(destination.hostname)) throw new Error('更新下载地址无效。');
    const response = await fetch(destination, { signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) break;
    url = new URL(location, destination).href;
  }
  throw new Error('无法访问更新下载地址。');
}

async function readLatest() {
  const initial = await fetch(homepage + '/releases/latest', {
    redirect: 'manual', signal: AbortSignal.timeout(9000),
  });
  const location = initial.headers.get('location');
  await initial.body?.cancel();
  if (!location && initial.status === 404) return null;
  if (!location) throw new Error('暂时无法查询 GitHub 版本。');
  const target = new URL(location, homepage);
  const prefix = repo + '/releases/tag/';
  if (target.origin !== 'https://github.com') throw new Error('GitHub 版本地址无效。');
  if (target.pathname.toLowerCase() === (repo + '/releases').toLowerCase()) return null;
  if (!target.pathname.toLowerCase().startsWith(prefix.toLowerCase())) throw new Error('GitHub 版本地址无效。');
  const tag = target.pathname.slice(prefix.length);
  if (!newer(tag)) return null;
  const filename = `Jinkra-Toolbox-${tag.slice(1)}-x64.exe`;
  const assets = `${homepage}/releases/download/${tag}`;
  const verify = await request(`${assets}/${filename}.sha256`, AbortSignal.timeout(12000));
  if (!verify.ok) {
    await verify.body?.cancel();
    throw new Error('新版发布包暂不可用。');
  }
  const reader = verify.body.getReader();
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString('ascii');
      if (text.length > 256) throw new Error('新版校验文件无效。');
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const match = text.trim().match(/^([a-f\d]{64})\s+\*?([^\r\n]+)$/iu);
  if (!match || match[2] !== filename) throw new Error('新版 SHA-256 校验文件无效。');
  return { version: tag.slice(1), digest: match[1].toLowerCase(), url: `${assets}/${filename}` };
}

async function checkUpdate() {
  checking ??= readLatest().then((result) => {
    latest = result;
    return result;
  }).finally(() => { checking = undefined; });
  const result = await checking;
  return result ? { version: result.version, canInstall: Boolean(process.env.PORTABLE_EXECUTABLE_FILE) } : null;
}

async function getUpdateError() {
  const file = errorFile();
  try {
    const error = await readFile(file, 'utf8');
    await rm(file, { force: true });
    return error;
  } catch {
    return '';
  }
}

async function installUpdate(report) {
  if (downloading) throw new Error('正在下载更新。');
  const update = latest;
  const target = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!update || !target || !path.isAbsolute(target) || path.extname(target).toLowerCase() !== '.exe') {
    throw new Error('请在便携 EXE 中检查更新。');
  }
  downloading = true;
  let folder;
  let handedOff = false;
  try {
    if (!(await lstat(target)).isFile()) throw new Error('无法定位当前运行的便携 EXE。');
    folder = await mkdtemp(path.join(path.dirname(target), '.jinkra-update-'));
    const staged = path.join(folder, 'update.exe');
    const response = await request(update.url, AbortSignal.timeout(600_000));
    if (!response.ok || !response.body) throw new Error('GitHub 下载失败，请稍后重试。');
    const total = Number(response.headers.get('content-length')) || 0;
    const hash = createHash('sha256');
    let size = 0;
    let speed = 0;
    let sampleBytes = 0;
    let sampleTime = performance.now();
    report({ stage: 'download', received: 0, total, speed: 0 });
    await pipeline(response.body, new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) return callback(new Error('更新包尺寸无效。'));
        hash.update(chunk);
        const now = performance.now();
        if (now - sampleTime >= 330) {
          const rate = (size - sampleBytes) * 1000 / (now - sampleTime);
          speed = speed ? .65 * speed + .35 * rate : rate;
          sampleBytes = size;
          sampleTime = now;
          report({ stage: 'download', received: size, total, speed });
        }
        callback(null, chunk);
      },
    }), createWriteStream(staged, { flags: 'wx' }));
    report({ stage: 'verify', received: size, total: total || size, speed: 0 });
    if (size < 4096 || (total && total !== size) || hash.digest('hex') !== update.digest) {
      throw new Error('更新文件损坏，SHA-256 校验未通过。');
    }
    const worker = app.isPackaged ? path.join(process.resourcesPath, 'jinkra-updater.exe')
      : path.resolve(__dirname, '../vendor/updater/jinkra-updater.exe');
    const ready = path.join(folder, 'ready');
    const helper = spawn(worker, [], {
      detached: true, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, JINKRA_UPDATE_TARGET: target, JINKRA_UPDATE_STAGED: staged, JINKRA_UPDATE_ERROR: errorFile(),
        JINKRA_UPDATE_READY: ready, JINKRA_UPDATE_PARENT: String(process.pid) },
    });
    let helperError;
    helper.once('error', (error) => { helperError = error; });
    let waiting = true;
    for (let retries = 0; retries < 35; retries++) {
      if (await lstat(ready).then(() => true, () => false)) { waiting = false; break; }
      if (helperError || helper.exitCode !== null) break;
      await delay(200);
    }
    if (waiting) {
      helper.kill();
      throw new Error('无法启动 Windows 更新组件，请从 GitHub 重新下载便携版。');
    }
    helper.unref();
    handedOff = true;
    report({ stage: 'restart', received: size, total: size, speed: 0 });
    setTimeout(() => app.quit(), 450);
  } finally {
    if (!handedOff && folder) await rm(folder, { recursive: true, force: true });
    if (!handedOff) downloading = false;
  }
}

module.exports = { checkUpdate, getUpdateError, installUpdate };
