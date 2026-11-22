import { actions, box, button, el, input, makeStatus, select, task } from '../ui.js';

const catalog = 'anbeime/skill';
const labels = { codex: 'Codex', claude: 'Claude Code', legacy: 'Codex（旧目录）' };
const pageSize = 24;
const skillName = (repo, folder) => folder.split('/').pop() || repo.split('/')[1];

export function skillLibrary() {
  const status = makeStatus();
  const syncStatus = makeStatus();
  const search = input({ type: 'search', placeholder: '搜索名称或说明', 'aria-label': '搜索 Skill' });
  const agent = select([['codex', '安装到 Codex'], ['claude', '安装到 Claude Code']]);
  agent.setAttribute('aria-label', 'Skill 安装平台');
  const list = el('div', { class: 'skill-list' });
  const pagination = actions();
  const context = el('div', { class: 'skill-context' });
  const views = { bundled: '合集技能', repos: 'GitHub 收录', local: '已安装' };
  const tabs = new Map();
  let view = 'bundled';
  let currentRepo;
  let repoSkills = [];
  let catalogData;
  let local = [];
  let shown = pageSize;
  let pendingSync = false;
  let busy = false;

  function source(repo, folder) {
    const suffix = folder ? '/tree/HEAD/' + folder.split('/').map(encodeURIComponent).join('/') : '';
    return el('a', { class: 'skill-source', href: 'https://github.com/' + repo + suffix,
      target: '_blank', rel: 'noopener noreferrer', onclick: (event) => {
        if (globalThis.desktop) {
          event.preventDefault();
          void task(status, async () => {
            await desktop.aiRepo(repo, folder);
            status.set('');
          })();
        }
      } }, '查看来源');
  }

  function row(title, description, details, controls) {
    return el('article', { class: 'skill-row' }, el('div', { class: 'skill-details' },
      el('h3', {}, title), description && el('p', {}, description),
      details && el('p', { class: 'skill-meta' }, details)), actions(...controls));
  }

  function onlineRow(repo, folder) {
    const name = skillName(repo, folder);
    const target = agent.value;
    const exists = local.some((item) => item.agent === target && item.name.toLowerCase() === name.toLowerCase());
    const install = button(exists ? '已安装' : '一键安装', task(status, async () => {
      busy = true;
      draw();
      try {
        await desktop.aiInstallSkill(repo, folder, target);
        local = await desktop.aiInstalledSkills();
        status.set(name + ' 已安装到 ' + labels[target] + '。新开对话即可使用。', 'success');
      } finally {
        busy = false;
        draw();
      }
    }, '正在下载 ' + name + '…'), 'primary', exists ? 'Check' : 'Download');
    install.disabled = busy || exists;
    install.setAttribute('aria-label', (exists ? '已安装 ' : '安装 ') + name);
    return row(name, null, folder || repo, [source(repo, folder), install]);
  }

  function repoRow(item) {
    const inspect = button('查看技能', task(status, async () => {
      busy = true;
      inspect.disabled = true;
      try {
        const folders = await desktop.aiInspectSkills(item.repo);
        setView('repos', item, folders);
        status.set('');
      } finally {
        busy = false;
        draw();
      }
    }, '正在读取 ' + item.repo + '…'), 'secondary', 'ChevronRight');
    inspect.disabled = busy;
    return row(item.repo, item.description, item.updated?.slice(0, 10), [source(item.repo), inspect]);
  }

  function localRow(item) {
    const uninstall = button('卸载', task(status, async () => {
      busy = true;
      draw();
      try {
        await desktop.aiUninstallSkill(item.agent, item.name);
        local = await desktop.aiInstalledSkills();
        status.set(item.name + ' 已移到回收站。', 'success');
      } finally {
        busy = false;
        draw();
      }
    }, '正在卸载 ' + item.name + '…'), 'secondary');
    uninstall.disabled = busy;
    uninstall.setAttribute('aria-label', '卸载 ' + item.name);
    return row(item.name, labels[item.agent] + (item.linked ? ' · 链接' : ''), item.file, [uninstall]);
  }

  function draw() {
    for (const [key, tab] of tabs) {
      tab.setAttribute('aria-pressed', String(view === key));
      tab.textContent = views[key] + (key === 'local' ? ' ' + local.length : '');
    }
    agent.hidden = view === 'local';
    localButton.hidden = view !== 'local';
    const term = search.value.trim().toLowerCase();
    let match;
    let render;
    let empty;
    if (view === 'local') {
      match = local.filter((item) => (item.name + ' ' + labels[item.agent]).toLowerCase().includes(term));
      render = localRow;
      empty = '没有检测到已安装的 Skill。';
    } else if (view === 'bundled' || currentRepo) {
      const repo = currentRepo?.repo ?? catalog;
      match = (currentRepo ? repoSkills : catalogData?.bundled ?? []).filter((folder) => (folder || repo).toLowerCase().includes(term));
      render = (folder) => onlineRow(repo, folder);
      empty = pendingSync ? '正在读取合集技能…' : '暂无可显示的 Skill。';
    } else {
      match = (catalogData?.repos ?? []).filter((item) => (item.repo + ' ' + item.description).toLowerCase().includes(term));
      render = repoRow;
      empty = pendingSync ? '正在读取 GitHub 目录…' : '暂无可显示的仓库。';
    }
    context.replaceChildren(currentRepo ? actions(button('返回目录', () => setView('repos'), 'quiet', 'ArrowLeft'),
      el('strong', {}, currentRepo.repo)) : '');
    list.replaceChildren(...match.slice(0, shown).map(render));
    if (!match.length) list.append(el('p', { class: 'hint' }, term ? '没有匹配的结果。' : empty));
    const more = button('显示更多', () => { shown += pageSize; draw(); }, 'secondary');
    pagination.replaceChildren(...(match.length ? [el('span', { class: 'hint' }, '显示 ' + Math.min(match.length, shown) + ' / ' + match.length), more] : []));
    more.hidden = match.length <= shown;
  }

  function setView(next, repo, folders = []) {
    view = next;
    currentRepo = repo;
    repoSkills = folders;
    search.value = '';
    shown = pageSize;
    draw();
    if (view === 'local') void refreshLocal();
  }

  const refreshLocal = task(status, async () => {
    local = await desktop.aiInstalledSkills();
    status.set('');
    draw();
  }, '正在扫描本地 Skill…');
  async function syncCatalog(force) {
    pendingSync = true;
    refreshButton.disabled = true;
    draw();
    try {
      catalogData = await desktop.aiSkills(force);
      showSync();
    } finally {
      pendingSync = false;
      refreshButton.disabled = false;
      draw();
    }
  }

  function showSync() {
    const state = { ready: '已同步', cached: '显示上次同步的目录', partial: '已同步可连接的目录' };
    syncStatus.set(catalogData.state === 'offline' ? '暂时无法连接 GitHub，正在显示内置合集。'
      : state[catalogData.state] + ' · ' + new Date(catalogData.fetchedAt).toLocaleString('zh-CN'));
  }

  if (!globalThis.desktop) return box(el('p', { class: 'hint' }, '请在 Windows 便携版中同步及管理 Skill。'), source(catalog));
  for (const key of Object.keys(views)) tabs.set(key, button(views[key], () => setView(key), 'quiet'));
  search.addEventListener('input', () => { shown = pageSize; draw(); });
  agent.addEventListener('change', draw);
  const refreshButton = button('同步目录', task(syncStatus, () => syncCatalog(true), '正在同步 GitHub…'), 'secondary', 'RefreshCw');
  const localButton = button('扫描本地', refreshLocal, 'quiet', 'RefreshCw');
  const start = task(syncStatus, () => syncCatalog(false), '正在同步 GitHub…');
  void start();
  void refreshLocal();

  return box(el('section', { class: 'ai-section' },
    el('div', { class: 'skill-toolbar' }, el('div', { class: 'skill-details' }, el('h2', {}, 'anbeime/skill'),
      el('p', {}, '同步合集和 GitHub 收录，查看来源后安装到所选平台。')),
      actions(source(catalog), refreshButton)),
    syncStatus.node,
    el('div', { class: 'skill-toolbar' }, el('div', { class: 'skill-tabs', role: 'group', 'aria-label': 'Skill 目录' }, ...tabs.values()),
      actions(search, agent, localButton)),
    context, status.node, list, pagination,
  ));
}
