import { actions, area, box, button, check, copyButton, el, field, fileInput, icon, input, isPro, makeStatus, pro, proPanel, row, select, task } from '../ui.js';

const windowsOnly = (name) => box(el('p', { class: 'hint' }, `请在 Windows 安装版中使用${name}。`));

/* ---------- 图片文字识别 ---------- */

async function imageBytes(file) {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('无法读取这张图片，请换成 PNG、JPG 或 WebP。'); });
  const scale = Math.min(1, 6000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

function ocrTool() {
  if (!globalThis.desktop) return windowsOnly('文字识别');
  const status = makeStatus();
  const files = fileInput('image');
  const language = select([['', '跟随系统语言']]);
  const [mergeLabel, merge] = check('合并为一段（去掉换行）');
  const preview = el('div', { class: 'ocr-preview' }, el('div', { class: 'ocr-placeholder' }, icon('ScanText', 30), el('span', {}, '选择图片，或先截图再点「识别剪贴板」')));
  const result = area('识别出的文字会显示在这里，可直接修改。');
  result.classList.add('ocr-result');
  const info = el('p', { class: 'hint' });
  let lines = [];

  const show = () => {
    const joiner = isPro() && merge.checked ? (/[㐀-鿿]/u.test(lines.join('')) ? '' : ' ') : '\n';
    result.value = lines.join(joiner);
  };
  const display = (data, source) => {
    lines = data.lines;
    show();
    info.textContent = lines.length ? `${data.language} · ${lines.length} 行 · ${Array.from(lines.join('')).length} 字` : '';
    status.set(lines.length ? '识别完成。' : '没有识别到文字。可换一张更清晰、文字更大的图片。', lines.length ? 'success' : '');
    if (source) preview.replaceChildren(el('img', { src: source, alt: '待识别图片' }));
  };
  const fromFile = task(status, async () => {
    const [file] = await files.readFiles();
    if (!file) throw new Error('请先选择图片。');
    const url = URL.createObjectURL(file);
    preview.replaceChildren(el('img', { src: url, alt: '待识别图片', onload: () => URL.revokeObjectURL(url) }));
    display(await desktop.ocrImage(await imageBytes(file), language.value));
  }, '正在识别文字…');
  const fromClipboard = task(status, async () => {
    const data = await desktop.ocrClipboard(language.value);
    display(data, data.preview);
  }, '正在识别剪贴板图片…');
  files.node.addEventListener('change', () => { void fromFile(); });
  merge.addEventListener('change', show);
  void desktop.ocrLanguages().then((list) => {
    language.append(...list.map(({ tag, name }) => el('option', { value: tag }, name)));
    if (!list.length) status.set('Windows 中没有安装文字识别语言。请在「设置 → 时间和语言 → 语言」中为中文安装“光学字符识别”。', 'error');
  }).catch(() => {});

  const panel = box(
    el('p', { class: 'hint' }, '使用 Windows 自带的识别引擎，图片不会上传。截图后（Win + Shift + S）可直接识别剪贴板。'),
    row(field('识别语言', language)), files.node,
    actions(button('识别剪贴板截图', fromClipboard, 'primary', 'ClipboardPaste'), button('重新识别所选图片', fromFile, 'secondary', 'ScanText')),
    proPanel(mergeLabel), status.node,
    el('div', { class: 'editor-grid' }, field('图片', preview), field('识别结果', result)),
    actions(copyButton(() => result.value, status), info));
  panel.addEventListener('tool-mode-changed', show);
  return panel;
}

/* ---------- Hosts 编辑与 DNS ---------- */

const hostsLine = /^\s*([0-9a-fA-F.:%]+)\s+(\S.*?)\s*(?:#.*)?$/u;
const ipPattern = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+:[0-9a-fA-F:.%]*)$/u;
const domainPattern = /^(?=.{1,253}$)[A-Za-z0-9*_](?:[A-Za-z0-9\-_.]*[A-Za-z0-9])?$/u;

function hostsTool() {
  if (!globalThis.desktop) return windowsOnly(' hosts 编辑');
  const status = makeStatus();
  const editor = area('正在读取 hosts…');
  editor.classList.add('hosts-editor');
  const summary = el('p', { class: 'hint' });
  const ip = input({ value: '127.0.0.1', placeholder: 'IP 地址', spellcheck: 'false' });
  const domain = input({ placeholder: '例如 example.com', spellcheck: 'false' });
  let saved = '';
  let hasBackup = false;

  const count = () => {
    const active = editor.value.split(/\r?\n/u).filter((line) => !line.trim().startsWith('#') && hostsLine.test(line)).length;
    const dirty = editor.value.replace(/\r\n/gu, '\n').trimEnd() !== saved.replace(/\r\n/gu, '\n').trimEnd();
    summary.replaceChildren(`${active} 条生效规则`, dirty ? el('span', { class: 'badge-warn' }, '未保存') : '');
  };
  const load = task(status, async () => {
    const data = await desktop.hostsRead();
    saved = data.text;
    hasBackup = data.backup;
    editor.value = data.text;
    restore.disabled = !hasBackup;
    count();
    status.set(`已读取 ${data.path}`);
  }, '正在读取 hosts…');
  const save = task(status, async () => {
    await desktop.hostsSave(editor.value);
    saved = editor.value;
    hasBackup = true;
    restore.disabled = false;
    count();
    status.set('已保存并刷新 DNS 缓存，新规则立即生效。', 'success');
  }, '正在保存，请在弹出的窗口中允许管理员权限…');
  const restore = button('恢复修改前的备份', task(status, async () => {
    const data = await desktop.hostsRestore();
    if (!data) { status.set(''); return; }
    saved = data.text;
    editor.value = data.text;
    count();
    status.set('已恢复备份。', 'success');
  }, '正在恢复…'), 'quiet', 'RefreshCw');
  restore.disabled = true;
  const add = task(status, async () => {
    const address = ip.value.trim();
    const names = domain.value.trim().split(/\s+/u).filter(Boolean);
    if (!ipPattern.test(address)) throw new Error('请输入有效的 IP 地址。');
    if (!names.length || !names.every((name) => domainPattern.test(name))) throw new Error('请输入有效的域名。');
    const lines = editor.value.replace(/\s+$/u, '');
    editor.value = `${lines}${lines ? '\n' : ''}${address}\t${names.join(' ')}\n`;
    domain.value = '';
    count();
    editor.scrollTop = editor.scrollHeight;
    status.set('已添加到末尾，点「保存并生效」写入系统。', 'success');
  });
  domain.addEventListener('keydown', (event) => { if (event.key === 'Enter') void add(); });
  editor.addEventListener('input', count);
  void load();

  return box(
    el('p', { class: 'hint' }, '修改 Windows hosts，把域名指向指定 IP。保存需要管理员确认，第一次保存时会自动备份原文件。行首加 # 可停用该行。'),
    el('div', { class: 'hosts-add' }, field('IP 地址', ip), field('域名（多个用空格分隔）', domain), button('添加一行', add, 'secondary', 'Check')),
    field('hosts 内容', editor), summary,
    actions(button('保存并生效', save, 'primary', 'Save'), button('重新读取', load, 'secondary', 'RefreshCw'),
      button('仅刷新 DNS 缓存', task(status, async () => {
        await desktop.dnsFlush();
        status.set('DNS 缓存已刷新。', 'success');
      }, '正在刷新 DNS 缓存…'), 'secondary', 'Zap'), pro(restore)),
    status.node);
}

/* ---------- 端口占用 ---------- */

function portsTool() {
  if (!globalThis.desktop) return windowsOnly('端口查询');
  const status = makeStatus();
  const query = input({ type: 'search', placeholder: '输入端口号或程序名，例如 8080、node', spellcheck: 'false' });
  const [allLabel, all] = check('同时列出已建立的连接');
  const body = el('tbody');
  const table = el('div', { class: 'data-table' }, el('table', {},
    el('thead', {}, el('tr', {}, ['协议', '本地地址', '端口', '程序', 'PID', ''].map((label) => el('th', {}, label)))), body));
  const summary = el('p', { class: 'hint' });
  let rows = [];

  const kill = (item) => task(status, async () => {
    const result = await desktop.processKill(item.pid);
    if (!result) { status.set(''); return; }
    status.set(`已结束「${result.name}」。`, 'success');
    await refresh();
  }, `正在结束 ${item.name}…`);

  function draw() {
    const terms = query.value.trim().toLowerCase();
    const exact = /^\d+$/u.test(terms);
    const shown = rows.filter((item) => !terms || (exact ? String(item.port) === terms || String(item.pid) === terms
      : `${item.name} ${item.path} ${item.address}`.toLowerCase().includes(terms)));
    body.replaceChildren(...shown.slice(0, 400).map((item) => el('tr', {},
      el('td', {}, el('span', { class: `proto proto-${item.protocol.toLowerCase()}` }, item.protocol)),
      el('td', { class: 'mono' }, item.listening ? item.address : `${item.address} → ${item.remote}`),
      el('td', { class: 'mono strong' }, String(item.port)),
      el('td', { title: item.path || item.name }, el('strong', {}, item.name), item.path && el('small', {}, item.path)),
      el('td', { class: 'mono' }, String(item.pid)),
      el('td', {}, item.pid > 4 && button('结束', kill(item), 'quiet', 'CircleX')))));
    if (!shown.length) body.append(el('tr', {}, el('td', { colspan: 6, class: 'empty-cell' }, terms ? `没有找到与「${query.value.trim()}」相关的占用。` : '没有数据。')));
    const programs = new Set(shown.map((item) => item.pid)).size;
    summary.textContent = `${shown.length} 条记录 · ${programs} 个程序${shown.length > 400 ? ' · 仅显示前 400 条，请输入关键词筛选' : ''}`;
  }
  async function refresh() {
    rows = await desktop.portsList(isPro() && all.checked);
    draw();
  }
  const load = task(status, async () => { await refresh(); status.set(''); }, '正在读取端口占用…');
  query.addEventListener('input', draw);
  all.addEventListener('change', () => { void load(); });
  void load();
  const panel = box(
    el('p', { class: 'hint' }, '查看哪个程序占用了端口，可直接结束该程序。Windows 关键系统进程会被保护，不能结束。'),
    el('div', { class: 'port-toolbar' }, el('div', { class: 'searchbox inline-search' }, icon('Search', 16), query),
      button('刷新', load, 'secondary', 'RefreshCw')),
    proPanel(allLabel), status.node, summary, table);
  panel.addEventListener('tool-mode-changed', () => { void load(); });
  return panel;
}

/* ---------- Ping ---------- */

function pingTool() {
  if (!globalThis.desktop) return windowsOnly(' Ping 测试');
  const status = makeStatus();
  const host = input({ value: 'www.baidu.com', placeholder: '域名或 IP', spellcheck: 'false' });
  const count = select([['4', '4 次'], ['10', '10 次'], ['20', '20 次'], ['50', '50 次'], ['100', '100 次']]);
  const mode = select([['icmp', 'ICMP（标准 Ping）'], ['tcp', 'TCP 端口连接']]);
  const port = input({ type: 'number', value: 443, min: 1, max: 65535 });
  const portField = field('端口', port);
  const log = el('pre', { class: 'output ping-log', 'aria-live': 'polite' }, '结果会逐条显示在这里。');
  const stats = el('dl', { class: 'stat-grid' });
  const start = button('开始测试', null, 'primary', 'Activity');
  const stop = button('停止', () => { void desktop.networkCancel(); }, 'secondary', 'CircleX');
  stop.hidden = true;
  const syncMode = () => { portField.hidden = mode.value !== 'tcp'; };
  mode.addEventListener('change', syncMode);
  syncMode();
  const tile = (label, value, tone = '') => el('div', { class: tone }, el('dt', {}, label), el('dd', {}, value));

  start.addEventListener('click', task(status, async () => {
    log.textContent = '';
    stats.replaceChildren();
    start.hidden = true;
    stop.hidden = false;
    const target = host.value.trim();
    const unsubscribe = desktop.onNetworkProgress(({ kind, item }) => {
      if (kind !== 'ping') return;
      log.append(el('span', { class: item.ok ? '' : 'bad' }, item.ok
        ? `#${item.seq}  来自 ${item.address}  时间 ${item.time} ms${item.ttl ? `  TTL ${item.ttl}` : ''}\n`
        : `#${item.seq}  ${item.message}\n`));
      log.scrollTop = log.scrollHeight;
    });
    try {
      const result = await desktop.networkPing({ host: target, count: Number(count.value), mode: mode.value, port: Number(port.value) });
      const loss = result.sent ? Math.round((result.sent - result.received) * 100 / result.sent) : 100;
      const ms = (value) => value == null ? '—' : `${value} ms`;
      stats.replaceChildren(tile('平均延迟', ms(result.average), 'primary'), tile('丢包率', `${loss}%`, loss ? 'bad' : 'good'),
        tile('最短 / 最长', result.min == null ? '—' : `${result.min} / ${result.max} ms`), tile('抖动', ms(result.jitter)),
        tile('发送 / 接收', `${result.sent} / ${result.received}`));
      status.set(result.cancelled ? '已停止。' : result.received ? `${target} 测试完成。` : `${target} 无响应。部分服务器会屏蔽 Ping，可改用 TCP 端口连接。`,
        result.received ? 'success' : 'error');
    } finally {
      unsubscribe();
      start.hidden = false;
      stop.hidden = true;
    }
  }, '正在测试…'));
  host.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !start.hidden) start.click(); });

  const presets = ['www.baidu.com', 'www.qq.com', '223.5.5.5', '8.8.8.8', 'github.com'].map((name) =>
    button(name, () => { host.value = name; }, 'quiet'));
  return box(
    row(field('目标地址', host), field('测试方式', mode), portField, field('次数', count)),
    el('div', { class: 'chip-row' }, el('span', { class: 'hint' }, '常用：'), presets),
    actions(start, stop), status.node, stats, log);
}

/* ---------- 网络测速 ---------- */

function speedTool() {
  if (!globalThis.desktop) return windowsOnly('网络测速');
  const status = makeStatus();
  const value = (unit) => {
    const number = el('strong', {}, '—');
    return { number, node: el('dd', {}, number, el('span', {}, unit)) };
  };
  const latency = value('ms');
  const download = value('Mbps');
  const upload = value('Mbps');
  const card = (label, symbol, item) => el('div', { class: 'speed-tile' }, el('dt', {}, icon(symbol, 15), label), item.node);
  const progress = el('progress', { max: 100, value: 0, hidden: true, 'aria-label': '测速进度' });
  const start = button('开始测速', null, 'primary', 'Gauge');
  const stop = button('停止', () => { void desktop.networkCancel(); }, 'secondary', 'CircleX');
  stop.hidden = true;
  const format = (mbps) => mbps >= 100 ? mbps.toFixed(0) : mbps.toFixed(1);
  const tiles = el('dl', { class: 'speed-grid' }, card('延迟', 'Activity', latency), card('下载', 'Download', download), card('上传', 'ArrowDownUp', upload));

  start.addEventListener('click', task(status, async () => {
    for (const item of [latency, download, upload]) { item.number.textContent = '—'; item.node.parentElement.classList.remove('active'); }
    progress.hidden = false;
    progress.value = 0;
    start.hidden = true;
    stop.hidden = false;
    const unsubscribe = desktop.onNetworkProgress(({ kind, stage, mbps, ratio, latency: ms }) => {
      if (kind !== 'speed') return;
      const target = { download, upload, latency }[stage];
      for (const item of [latency, download, upload]) item.node.parentElement.classList.toggle('active', item === target);
      if (stage === 'latency') {
        if (ms != null) latency.number.textContent = ms;
        else status.set('正在测量延迟…');
        progress.value = 4;
        return;
      }
      target.number.textContent = format(mbps);
      progress.value = stage === 'download' ? 5 + ratio * 55 : 60 + ratio * 40;
      status.set(stage === 'download' ? '正在测试下载速度…' : '正在测试上传速度…');
    });
    try {
      const result = await desktop.networkSpeed();
      if (!result) { status.set('已停止测速。'); return; }
      latency.number.textContent = result.latency ?? '—';
      download.number.textContent = format(result.download);
      upload.number.textContent = format(result.upload);
      progress.value = 100;
      const mbs = (mbps) => `${(mbps / 8).toFixed(1)} MB/s`;
      status.set(`测速完成：下载约 ${mbs(result.download)}，上传约 ${mbs(result.upload)}。`, 'success');
    } finally {
      unsubscribe();
      for (const item of [latency, download, upload]) item.node.parentElement.classList.remove('active');
      start.hidden = false;
      stop.hidden = true;
    }
  }, '正在连接测速服务器…'));

  return box(
    el('p', { class: 'hint' }, '通过 Cloudflare 测速节点测量延迟、下载和上传速度，约需 20 秒。测速会消耗一定流量，使用代理时结果反映代理线路。'),
    tiles, progress, actions(start, stop), status.node);
}

export const ocrTools = [
  { id: 'ocr', name: '图片文字识别', icon: 'ScanText', keywords: 'OCR 截图 提取文字 识字 图片转文字', description: '离线识别图片或截图中的文字，可直接复制。', render: ocrTool },
];

export const networkTools = [
  { id: 'hosts', name: 'Hosts 编辑', icon: 'Globe', keywords: 'hosts 域名 解析 DNS 刷新 flushdns 屏蔽', description: '编辑 hosts 并刷新 DNS 缓存，修改立即生效。', render: hostsTool },
  { id: 'ports', name: '端口占用查询', icon: 'Plug', keywords: '端口 占用 netstat 进程 PID 结束进程 kill', description: '查看端口被哪个程序占用，并可结束进程。', render: portsTool },
  { id: 'ping', name: 'Ping 测试', icon: 'Activity', keywords: 'ping 延迟 丢包 TCP 网络 连通', description: '测试到网站或 IP 的延迟、丢包和抖动。', render: pingTool },
  { id: 'speedtest', name: '网络测速', icon: 'Gauge', keywords: '测速 网速 带宽 下载 上传 speedtest', description: '测量当前网络的延迟、下载和上传速度。', render: speedTool },
];
