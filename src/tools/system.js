import { actions, box, button, el, field, makeStatus, readableSize, select, task } from '../ui.js';
import { maintenanceTools } from './maintenance.js';

const size = (bytes) => bytes >= 2 ** 30 ? `${(bytes / 2 ** 30).toFixed(2)} GiB` : readableSize(bytes);
const metric = (label, value) => el('div', {}, el('dt', {}, label), el('dd', {}, value));

function memoryTool() {
  if (!globalThis.desktop) return box(el('p', { class: 'hint' }, '请在 Windows 安装版中使用内存释放。'));
  const status = makeStatus();
  const results = el('dl', { class: 'metrics' });
  const progress = el('progress', { max: 100, hidden: true, 'aria-label': '物理内存占用率' });

  function draw(current, previous) {
    const used = current.total - current.free;
    progress.value = 100 * used / current.total;
    progress.hidden = false;
    results.replaceChildren(metric('物理内存', size(current.total)), metric('已用内存', size(used)),
      metric('可用内存', size(current.free)), ...(previous ? [metric('释放前可用内存', size(previous.free))] : []));
  }

  const refresh = task(status, async () => {
    draw((await desktop.systemInfo()).memory);
    status.set('');
  }, '正在读取内存状态…');
  const release = button('一键释放内存', task(status, async () => {
    const { before, after, count } = await desktop.systemTrimMemory();
    draw(after, before);
    const change = after.free - before.free;
    status.set(`已处理 ${count} 个进程，可用内存${change >= 0 ? '增加' : '减少'} ${size(Math.abs(change))}。`, 'success');
  }, '正在释放进程工作集…'), 'primary', 'MemoryStick');
  void refresh();
  return box(el('p', { class: 'hint' }, '对当前 Windows 会话中可访问的进程做工作集整理。应用再次访问这部分内存时，Windows 会重新载入。'),
    actions(release, button('刷新状态', refresh, 'secondary', 'RefreshCw')), status.node, progress, results);
}

function diskCleanup() {
  if (!globalThis.desktop) return box(el('p', { class: 'hint' }, '请在 Windows 安装版中使用系统盘清理。'));
  const status = makeStatus();
  const report = el('dl', { class: 'metrics' });
  const keep = select([[3, '3 天'], [7, '7 天'], [14, '14 天'], [30, '30 天']]);
  keep.value = '7';
  let scan;
  const cleanup = button('清理扫描结果', task(status, async () => {
    const result = await desktop.systemCleanScan(scan?.id);
    if (!result) { status.set('已取消清理。'); return; }
    scan = undefined;
    cleanup.disabled = true;
    report.replaceChildren(metric('已删除', `${result.removed} 个文件`), metric('释放空间', size(result.released)),
      metric('已跳过', `${result.skipped} 个文件`));
    status.set('清理完成。', 'success');
  }, '正在处理扫描结果…'), 'primary', 'HardDrive');
  cleanup.disabled = true;

  function reset() {
    scan = undefined;
    cleanup.disabled = true;
    report.replaceChildren();
  }

  const scanButton = button('扫描可清理文件', task(status, async () => {
    reset();
    keep.disabled = true;
    try {
      scan = await desktop.systemScanCleanup(Number(keep.value));
      report.replaceChildren(...scan.categories.map(({ name, count, bytes }) => metric(name, `${count} 个 · ${size(bytes)}`)),
        metric('预计释放', size(scan.bytes)));
      cleanup.disabled = !scan.count;
      status.set(scan.limited ? `${scan.drive} 已扫描到文件数上限，可清理本次结果。`
        : scan.count ? `${scan.drive} 找到 ${scan.count} 个可清理文件。` : `${scan.drive} 没有符合条件的文件。`);
    } finally { keep.disabled = false; }
  }, '正在扫描系统盘…'), 'secondary', 'ScanLine');
  keep.addEventListener('change', () => { reset(); status.set('请重新扫描。'); });
  const windows = button('Windows 存储设置', task(status, async () => {
    await desktop.systemStorageSettings();
    status.set('');
  }), 'quiet', 'ExternalLink');
  return box(el('p', { class: 'hint' }, '扫描系统盘中的用户临时文件和 DirectX 着色器缓存。清理前会显示预计大小，并等待你确认。'),
    field('保留最近创建或修改的文件', keep), actions(scanButton, cleanup, windows), status.node, report);
}

function systemOverview() {
  if (!globalThis.desktop) return box(el('p', { class: 'hint' }, '请在 Windows 安装版中查看系统信息。'));
  const status = makeStatus();
  const list = el('dl', { class: 'metrics' });
  const refresh = task(status, async () => {
    const info = await desktop.systemInfo();
    list.replaceChildren(metric('Windows 版本', `${info.version} · ${info.arch}`),
      metric('处理器', `${info.cpu} · ${info.threads} 个逻辑核心`),
      metric('运行时间', `${Math.floor(info.uptime / 3600)} 小时 ${Math.floor(info.uptime / 60) % 60} 分钟`),
      metric('内存', `${size(info.memory.free)} 可用 / ${size(info.memory.total)}`),
      metric(`系统盘 ${info.drive}`, info.disk ? `${size(info.disk.free)} 可用 / ${size(info.disk.total)}` : '暂时无法读取'));
    status.set('');
  }, '正在读取系统信息…');
  void refresh();
  return box(actions(button('刷新系统信息', refresh, 'secondary', 'RefreshCw')), status.node, list);
}

export const systemTools = [
  { id: 'system-memory', name: '内存释放', icon: 'MemoryStick', description: '查看物理内存并整理当前会话进程的工作集。', keywords: 'RAM 内存清理 PCL2', render: memoryTool },
  { id: 'system-cleanup', name: '系统盘清理', icon: 'HardDrive', description: '扫描并清理旧临时文件和 DirectX 缓存。', keywords: 'C盘 垃圾清理 存储', render: diskCleanup },
  { id: 'system-overview', name: '系统信息', icon: 'Monitor', description: '查看 Windows、CPU、内存和系统盘容量。', keywords: 'Windows CPU 磁盘 硬件', render: systemOverview },
  ...maintenanceTools,
];
