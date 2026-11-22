import { actions, area, box, button, el, field, makeStatus, nativeFiles, select, task } from '../ui.js';

const windowsOnly = () => box(el('p', { class: 'hint' }, '请在 Windows 安装版中打开此工具。'));

function arrowTool() {
  if (!globalThis.desktop) return windowsOnly();
  const status = makeStatus();
  const state = el('p', { class: 'hint' });
  const labels = { default: '当前使用 Windows 默认箭头。', hidden: '已设置隐藏快捷方式箭头。', custom: '检测到其他工具设置的快捷方式图标覆盖。' };
  const refresh = task(status, async () => { state.textContent = labels[await desktop.systemArrowStatus()] ?? '暂时无法识别箭头设置。'; status.set(''); });
  const change = (show) => task(status, async () => {
    const result = await desktop.systemChangeArrow(show);
    state.textContent = labels[result] ?? '';
    status.set(result === 'custom' ? '仍有其他箭头覆盖。可先恢复默认，再重新隐藏。'
      : '设置已保存，重新登录 Windows 后检查桌面图标。', result === 'custom' ? 'error' : 'success');
  }, '正在等待 Windows 管理员授权…');
  void refresh();
  return box(el('p', { class: 'hint' }, '通过 Windows 图标覆盖设置隐藏小箭头。操作需要管理员确认，适用于此电脑的快捷方式。'),
    state, actions(button('隐藏小箭头', change(false), 'primary', 'Link2'),
      button('恢复默认箭头', change(true), 'secondary', 'RefreshCw'), button('刷新状态', refresh, 'quiet')), status.node);
}

function runtimeRow(item, status, afterInstall) {
  const install = button('安装', task(status, async () => {
    install.disabled = true;
    try {
      const result = await desktop.systemInstallRuntime(item.key);
      await afterInstall();
      status.set(result.alreadyCurrent ? 'WinGet 报告此组件已是最新版本。' : `${item.title} 安装完成。`, 'success');
    } finally { install.disabled = false; }
  }, `正在安装 ${item.title}…`), 'primary', 'Download');
  install.setAttribute('aria-label', `安装 ${item.title}`);
  return el('article', { class: 'skill-row' },
    el('div', { class: 'skill-details' }, el('h3', {}, item.title),
      el('p', {}, item.installed ? '已检测到运行文件' : item.id ?? '推荐的官方组件')),
    actions(!item.installed && !item.manual && install, button(item.manual ? '获取官方安装包' : '官方来源', task(status, async () => {
      await desktop.systemRuntimeDocs(item.key);
      status.set('');
    }), 'quiet', 'ExternalLink')));
}

function runtimeTool() {
  if (!globalThis.desktop) return windowsOnly();
  const status = makeStatus();
  const items = el('div', { class: 'skill-list' });
  async function refresh() {
    const checked = await desktop.systemRuntimeStatus();
    items.replaceChildren(...checked.map((item) => runtimeRow(item, status, refresh)));
  }
  const scan = task(status, async () => { await refresh(); status.set('检查完成。', 'success'); }, '正在查找运行文件…');
  void scan();
  return box(el('p', { class: 'hint' }, '检查常用 Windows 运行文件。Visual C++ 和 .NET 通过 WinGet 安装，旧版 DirectX 组件提供 Microsoft 下载入口。'),
    actions(button('重新检查', scan, 'secondary', 'RefreshCw')), status.node, items);
}

function dllTool() {
  if (!globalThis.desktop) return windowsOnly();
  const status = makeStatus();
  const file = nativeFiles('executable', false, status);
  const text = area('例如：由于找不到 VCRUNTIME140.dll，无法继续执行代码。');
  text.maxLength = 2500;
  const arch = select([['x64', 'x64 · 64 位'], ['x86', 'x86 · 32 位']]);
  const summary = el('p', { class: 'hint' });
  const repairs = el('div', { class: 'skill-list' });
  const results = el('pre', { class: 'output', hidden: true, 'aria-label': 'DLL 检查结果' });
  async function scan() {
    const report = await desktop.systemInspectDll(file.selection?.id, text.value, arch.value);
    const packages = new Map();
    let missing = 0;
    results.hidden = false;
    results.textContent = report.libraries.map(({ name, state, location, packageKey, packageTitle, manual }) => {
      if (state === 'api') return `Windows API 映射 · ${name}`;
      if (state === 'found') return `已找到 · ${name}\n    ${location}`;
      missing++;
      if (packageKey) packages.set(packageKey, { key: packageKey, title: packageTitle, manual });
      return `常用路径未找到 · ${name}${packageTitle ? ` → ${packageTitle}` : ''}`;
    }).join('\n') || '此程序没有可检查的静态导入。';
    summary.textContent = `${report.executable ?? '手动检查'} · ${report.architecture} · ${missing} 项未在常用路径找到`;
    repairs.replaceChildren(...[...packages.values()].map((item) => runtimeRow(item, status, scan)));
  }
  const check = task(status, async () => { await scan(); status.set('检查完成。', 'success'); }, '正在读取 DLL 导入与文件位置…');
  return box(el('p', { class: 'hint' }, '可以选择一个 EXE 扫描静态导入，也可以粘贴错误提示。私有插件、动态加载和并行程序集的依赖可能由应用自行管理。'),
    file.node, actions(button('清除选中的程序', file.clear, 'quiet')),
    field('错误提示或 DLL 文件名', text), field('手动检查的程序架构', arch, '选择 EXE 时自动读取架构。'),
    actions(button('检查 DLL', check, 'primary', 'ScanLine')), status.node, summary, repairs, results);
}

function sfcTool() {
  if (!globalThis.desktop) return windowsOnly();
  const status = makeStatus();
  return box(el('p', { class: 'hint' }, '打开 Windows 系统文件检查窗口，扫描并修复受保护的系统文件。需要管理员确认，可在命令窗口查看进度。'),
    actions(button('打开 SFC 检查窗口', task(status, async () => {
      await desktop.systemSfc();
      status.set('已打开检查窗口。', 'success');
    }, '正在等待 Windows 管理员授权…'), 'primary', 'ShieldCheck')), status.node);
}

export const maintenanceTools = [
  { id: 'shortcut-arrow', name: '快捷方式小箭头', icon: 'Link2', description: '隐藏 Windows 快捷方式小箭头，或恢复默认箭头。', keywords: '桌面 图标 小箭头 快捷方式', render: arrowTool },
  { id: 'system-dll', name: 'DLL 缺失检查', icon: 'ScanLine', description: '检查 EXE 的 DLL 导入项，安装可匹配的官方组件。', keywords: '缺少 DLL VCRUNTIME MSVCP D3DX 错误', render: dllTool },
  { id: 'system-runtime', name: '运行库检查与安装', icon: 'Download', description: '检查 Visual C++、.NET Desktop Runtime 和 DirectX 旧版组件。', keywords: '运行库 软件包 运行时 VC .NET DirectX', render: runtimeTool },
  { id: 'system-sfc', name: 'Windows 系统文件修复', icon: 'ShieldCheck', description: '从 Windows 打开 SFC 检查与修复窗口。', keywords: '系统文件 修复 缺失 DLL SFC Windows', render: sfcTool },
];
