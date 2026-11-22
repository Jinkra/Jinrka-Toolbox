import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import logo from '../assets/icon.png';
import wechatPromotion from '../assets/wechat-promotion.png';
import { version } from '../package.json';
import './styles.css';
import { button, check, el, field, icon, iconButton, input, makeStatus, readableSize, select, task } from './ui.js';
import { developerTools } from './tools/developer.js';
import { textTools } from './tools/text.js';
import { mediaTools } from './tools/media.js';
import { fileTools } from './tools/files.js';
import { efficiencyTools } from './tools/efficiency.js';
import { extraTools } from './tools/catalog.js';
import { aiTools } from './tools/ai.js';

const groups = [
  { id: 'developer', title: '开发工具', icon: 'CodeXml', tools: developerTools },
  { id: 'text', title: '文本工具', icon: 'AlignLeft', tools: textTools },
  { id: 'media', title: '媒体工具', icon: 'Image', tools: mediaTools },
  { id: 'files', title: '文件工具', icon: 'Files', tools: fileTools },
  { id: 'efficiency', title: '效率工具', icon: 'Timer', tools: efficiencyTools },
  { id: 'ai', title: 'AI 工具', icon: 'Sparkles', tools: aiTools },
].map((group) => ({ ...group, tools: [...group.tools, ...(extraTools[group.id] ?? [])] }));
const tools = groups.flatMap((group) => group.tools.map((tool) => ({ ...tool, group })));
const byId = new Map(tools.map((tool) => [tool.id, tool]));
const featured = ['video', 'json', 'image', 'pdf'];
const state = { route: 'home', tool: null, back: null, query: '', mode: 'simple', pinned: false, shortcut: false, ready: false, update: null };
const defaults = { mode: 'simple', density: 'normal', motion: true, autoCheck: true, close: 'tray' };
const preferenceKey = 'jinkra.preferences';
function readPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey)) ?? {};
    return {
      mode: stored.mode === 'pro' ? 'pro' : 'simple',
      density: stored.density === 'compact' ? 'compact' : 'normal',
      motion: stored.motion !== false, autoCheck: stored.autoCheck !== false,
      close: stored.close === 'quit' ? 'quit' : 'tray',
    };
  } catch {
    return { ...defaults };
  }
}
const preferences = readPreferences();

function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value.filter((id) => byId.has(id)) : [];
  } catch {
    return [];
  }
}

const favorites = new Set(readList('jinkra.favorites'));
let recents = readList('jinkra.recents');
const root = document.getElementById('app');
const boot = root.querySelector('.initial-boot');
const content = el('main', { id: 'main-content', class: 'content' });
const navigation = el('nav', { class: 'navigation', 'aria-label': '工具导航' });
const search = input({ type: 'search', placeholder: '搜索工具、操作或格式', 'aria-label': '搜索工具', autocomplete: 'off', spellcheck: 'false' });
const clear = iconButton('X', '清除搜索', () => { setQuery(''); search.focus(); });
const keycap = el('kbd', {}, 'Ctrl K');
const frame = el('div', { class: `app-frame${globalThis.desktop ? ' is-desktop' : ''}` });
const windowBar = el('header', { class: 'window-bar' });
const workspace = el('div', { class: 'workspace' });
const dialog = el('dialog', { class: 'about' });
const settingsDialog = el('dialog', { class: 'about settings-dialog' });
const modeToast = el('div', { class: 'mode-toast', role: 'status', 'aria-live': 'polite', hidden: true });
let modeToastTimeout;

function creatorLink(text) {
  return el('a', { href: 'https://jinkra.slatt.cn/', target: '_blank', rel: 'noopener noreferrer', onclick: (event) => {
    if (!globalThis.desktop) return;
    event.preventDefault();
    void desktop.openCreator();
  } }, text);
}

function brand() {
  return el('button', { type: 'button', class: 'brand', onclick: () => { if (state.ready) navigate('home'); }, 'aria-label': 'Jinkra 工具箱首页' },
    el('img', { class: 'brand-icon', src: logo, alt: '', width: 27, height: 27 }),
    el('span', {}, el('strong', {}, 'Jinkra'), el('span', { class: 'brand-label' }, '工具箱')));
}

function navigationButton(id, label, symbol, count) {
  const active = !state.query && (state.tool ? state.tool.group.id === id : state.route === id);
  return el('button', { type: 'button', class: `nav-item${active ? ' active' : ''}`,
    'aria-current': active ? 'page' : null, 'aria-label': label, title: label, onclick: () => navigate(id),
  }, icon(symbol, 17), el('span', { class: 'nav-label' }, label), count != null && el('span', { class: 'nav-count' }, String(count)));
}

function renderNavigation() {
  navigation.replaceChildren(
    el('div', { class: 'nav-section' }, el('p', { class: 'nav-heading' }, '工作区'),
      navigationButton('home', '工具总览', 'Grid2X2'),
      navigationButton('favorites', '我的收藏', 'Star'),
      navigationButton('recent', '最近使用', 'Clock3')),
    el('div', { class: 'nav-section categories' }, el('p', { class: 'nav-heading' }, '工具分类'),
      groups.map((group) => navigationButton(group.id, group.title, group.icon, group.tools.length))),
  );
}

function syncSearch() {
  if (search.value !== state.query) search.value = state.query;
  clear.hidden = !state.query;
  keycap.hidden = Boolean(state.query);
}

function navigate(id) {
  state.route = id;
  state.tool = null;
  state.query = '';
  syncSearch();
  render();
}

function setQuery(query) {
  if (query.trim()) state.tool = null;
  const animate = !state.query.trim() && Boolean(query.trim());
  state.query = query;
  syncSearch();
  render(animate);
}

function openTool(tool) {
  state.back = { route: state.route, query: state.query };
  state.query = '';
  state.tool = tool;
  recents = [tool.id, ...recents.filter((id) => id !== tool.id)].slice(0, 16);
  localStorage.setItem('jinkra.recents', JSON.stringify(recents));
  syncSearch();
  render();
  content.querySelector('h1')?.focus();
}

function back() {
  if (!state.back) return navigate('home');
  state.tool = null;
  state.route = state.back.route;
  state.query = state.back.query;
  syncSearch();
  render();
  (state.query ? search : content.querySelector('h1'))?.focus();
}

function favoriteButton(tool) {
  const active = favorites.has(tool.id);
  const control = iconButton('Star', active ? `取消收藏 ${tool.name}` : `收藏 ${tool.name}`, (event) => {
    if (favorites.has(tool.id)) favorites.delete(tool.id);
    else favorites.add(tool.id);
    localStorage.setItem('jinkra.favorites', JSON.stringify([...favorites]));
    if (state.route === 'favorites' && !state.tool && !state.query) render(false);
    else {
      const replacement = favoriteButton(tool);
      event.currentTarget.replaceWith(replacement);
      replacement.focus();
    }
  });
  control.classList.add('favorite-button');
  control.classList.toggle('starred', active);
  control.setAttribute('aria-pressed', String(active));
  return control;
}

function toolIcon(tool, size = 21) {
  return el('span', { class: `tool-icon tone-${tool.group.id}` }, icon(tool.icon, size));
}

function card(tool) {
  return el('article', { class: 'tool-card' },
    el('button', { type: 'button', class: 'card-open', onclick: () => openTool(tool), 'aria-label': tool.name },
      toolIcon(tool), el('h3', {}, tool.name), el('p', {}, tool.description),
      el('span', { class: 'card-arrow' }, icon('ArrowRight', 15))),
    favoriteButton(tool));
}

function quickCard(tool) {
  return el('button', { type: 'button', class: 'quick-card', onclick: () => openTool(tool), 'aria-label': `快速打开 ${tool.name}` },
    toolIcon(tool, 18), el('span', { class: 'quick-text' }, el('strong', {}, tool.name), el('span', {}, tool.group.title)),
    icon('ArrowRight', 15));
}

function section(title, body, side) {
  return el('section', { class: 'tool-section' },
    el('div', { class: 'section-header' }, el('h2', {}, title), side), body);
}

function cards(selected) {
  return el('div', { class: 'card-grid' }, selected.map(card));
}

function title(name, description) {
  return el('header', { class: 'page-intro' }, el('h1', { tabindex: '-1' }, name), el('p', {}, description));
}

function home() {
  return [
    el('header', { class: 'home-hero' },
      el('div', { class: 'home-hero-copy' },
        el('div', { class: 'hero-meta' }, icon('Grid2X2', 14), 'Windows 便携版'),
        el('h1', { tabindex: '-1' }, 'Jinkra 工具箱'),
        el('div', { class: 'hero-facts' }, el('span', {}, `版本 ${version}`), el('span', {}, `${tools.length} 个工具`)),
        button('查找工具', () => { search.focus(); search.select(); }, 'secondary', 'Search')),
      el('div', { class: 'hero-portrait' }, el('div', { class: 'hero-orbit' },
        el('img', { src: logo, alt: 'Jinkra 头像' })),
        el('span', { class: 'hero-mark code' }, icon('CodeXml', 19)),
        el('span', { class: 'hero-mark media' }, icon('Image', 19)),
        el('span', { class: 'hero-mark files' }, icon('FileText', 17)))),
    el('section', { class: 'launchpad' },
      el('header', {}, el('h2', {}, recents.length ? '最近使用' : '常用工具'),
        recents.length > 0 && button('查看全部', () => navigate('recent'), 'quiet', 'ArrowRight')),
      el('div', { class: 'quick-grid' }, (recents.length ? recents : featured).slice(0, 4).map((id) => quickCard(byId.get(id))))),
    section('按分类浏览', el('div', { class: 'category-grid' }, groups.map((group) =>
      el('button', { type: 'button', class: 'category-card', onclick: () => navigate(group.id) },
        toolIcon({ group, icon: group.icon }, 20), el('strong', {}, group.title), el('span', {}, `${group.tools.length} 个工具`))))),
    section('所有工具', cards(tools)),
  ];
}

function library() {
  if (state.query.trim()) {
    const terms = state.query.trim().toLocaleLowerCase().split(/\s+/u);
    const found = tools.filter((tool) => {
      const searchable = `${tool.name} ${tool.keywords} ${tool.description} ${tool.group.title}`.toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
    return [title('搜索结果', `“${state.query.trim()}” · ${found.length} 个匹配`), found.length ? cards(found)
      : el('div', { class: 'empty' }, icon('Search', 25), '试试工具名、操作或格式，例如「压缩」「PDF」。')];
  }
  if (state.route === 'home') return home();
  if (state.route === 'favorites' || state.route === 'recent') {
    const favoritePage = state.route === 'favorites';
    const selected = (favoritePage ? [...favorites] : recents).map((id) => byId.get(id));
    return [title(favoritePage ? '我的收藏' : '最近使用', `${selected.length} 个工具`), selected.length ? cards(selected)
      : el('div', { class: 'empty' }, icon(favoritePage ? 'Star' : 'Clock3', 26), favoritePage ? '点击工具旁的星标即可收藏。' : '打开工具后，它会出现在这里。')];
  }
  const group = groups.find((item) => item.id === state.route);
  return [title(group.title, `${group.tools.length} 个工具`), cards(group.tools.map((tool) => byId.get(tool.id)))];
}

function toolPage(tool) {
  return [
    el('div', { class: 'back-row' }, button('返回', back, 'quiet', 'ArrowLeft'),
      icon('ChevronRight', 13), el('span', {}, tool.group.title)),
    el('header', { class: 'tool-intro' }, toolIcon(tool, 26),
      el('div', {}, el('h1', { tabindex: '-1' }, tool.name), el('p', {}, tool.description)),
      favoriteButton(tool)),
    tool.render(),
  ];
}

function render(animate = true) {
  if (!state.ready) return;
  renderNavigation();
  const children = state.tool ? toolPage(state.tool) : library();
  content.replaceChildren(el('div', { class: animate ? 'page page-enter' : 'page' }, children));
  content.scrollTop = 0;
}

const simple = button('简单版', () => setMode('simple'), 'quiet');
const professional = button('专业版', () => setMode('pro'), 'quiet');
const modeSwitcher = el('div', { class: 'mode-switch', role: 'group', 'aria-label': '工具模式' }, simple, professional);
function setMode(mode) {
  const changed = state.mode !== mode;
  state.mode = mode;
  document.documentElement.dataset.experience = mode;
  simple.setAttribute('aria-pressed', String(mode === 'simple'));
  professional.setAttribute('aria-pressed', String(mode === 'pro'));
  content.querySelector('.surface')?.dispatchEvent(new Event('tool-mode-changed'));
  if (state.ready && changed) {
    clearTimeout(modeToastTimeout);
    modeToast.hidden = false;
    modeToast.replaceChildren(icon('Check', 15), `已切换为${mode === 'simple' ? '简单版' : '专业版'}`);
    modeToastTimeout = setTimeout(() => { modeToast.hidden = true; }, 2300);
  }
}
setMode(preferences.mode);

function applyPreferences() {
  document.documentElement.dataset.density = preferences.density;
  document.documentElement.dataset.motion = preferences.motion ? 'on' : 'off';
  if (state.ready && globalThis.desktop) void desktop.windowCloseBehavior(preferences.close).catch(() => {});
}
applyPreferences();

const pin = iconButton('Pin', '窗口置顶', async () => {
  state.pinned = await desktop.windowPin();
  paintPin();
});
function paintPin() {
  pin.setAttribute('aria-pressed', String(state.pinned));
  pin.title = state.pinned ? '取消窗口置顶' : '窗口置顶';
  pin.setAttribute('aria-label', pin.title);
}

function openAbout() {
  dialog.replaceChildren(
    el('div', { class: 'dialog-title' }, el('h2', {}, '桌面快捷方式'), iconButton('X', '关闭', () => dialog.close())),
    el('dl', {}, el('dt', {}, '搜索工具'), el('dd', {}, el('kbd', {}, 'Ctrl + K')),
      globalThis.desktop && [el('dt', {}, '从任意应用打开工具箱'),
        el('dd', {}, state.shortcut ? el('kbd', {}, 'Ctrl + Alt + J') : '快捷键不可用')],
      el('dt', {}, '工具模式'), el('dd', {}, '右上角切换简单版和专业版，当前工具的输入会保留。'),
      globalThis.desktop && [el('dt', {}, '关闭窗口'), el('dd', {}, preferences.close === 'quit' ? '直接退出程序。' : '收起到系统托盘。使用托盘菜单可退出程序。')]),
    globalThis.desktop && button('收起到托盘', async () => { dialog.close(); await desktop.windowHide(); }, 'secondary'),
  );
  dialog.showModal();
}

function openSettings() {
  const mode = select([['simple', '简单版'], ['pro', '专业版']]);
  mode.value = preferences.mode;
  const density = select([['normal', '标准'], ['compact', '紧凑']]);
  density.value = preferences.density;
  const [motionLabel, motion] = check('播放启动和切换动画', preferences.motion);
  const [autoLabel, auto] = check('启动后自动检查更新', preferences.autoCheck);
  const close = select([['tray', '收起到系统托盘'], ['quit', '直接退出软件']]);
  close.value = preferences.close;
  const set = (key, value) => {
    preferences[key] = value;
    localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    applyPreferences();
    if (key === 'mode') setMode(value);
    if (key === 'autoCheck' && value && globalThis.desktop) void desktop.checkUpdate().then(showUpdateResult).catch(() => {});
  };
  for (const [key, control] of [['mode', mode], ['density', density], ['motion', motion], ['autoCheck', auto], ['close', close]]) {
    control.addEventListener('change', () => set(key, control.type === 'checkbox' ? control.checked : control.value));
  }
  const preferencesGroup = (title, ...children) => el('section', { class: 'settings-group' }, el('h3', {}, title), children);
  settingsDialog.replaceChildren(
    el('div', { class: 'dialog-title' }, el('h2', {}, '设置'), iconButton('X', '关闭设置', () => settingsDialog.close())),
    preferencesGroup('界面与工具', el('div', { class: 'settings-fields' }, field('默认工具模式', mode), field('布局密度', density)), motionLabel),
    globalThis.desktop && preferencesGroup('桌面行为', field('关闭窗口时', close),
      button('查看快捷方式', () => { settingsDialog.close(); openAbout(); }, 'quiet', 'CircleHelp')),
    globalThis.desktop && preferencesGroup('软件更新',
      el('div', { class: 'settings-update' }, el('p', { class: 'hint' }, `当前版本 ${version}`),
        button('检查更新', () => { settingsDialog.close(); openUpdate(false); }, 'secondary', 'ArrowDownUp')), autoLabel),
  );
  settingsDialog.showModal();
}

search.addEventListener('input', () => setQuery(search.value));
search.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && state.query.trim()) content.querySelector('.card-open')?.click();
  if (event.key === 'Escape') {
    setQuery('');
    search.blur();
  }
});
document.addEventListener('keydown', (event) => {
  if (state.ready && !document.querySelector('dialog[open]') && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    search.focus();
    search.select();
  }
});

const topControls = el('div', { class: 'header-controls', hidden: true },
  el('div', { class: 'searchbox' }, icon('Search', 16), search, keycap, clear),
  modeSwitcher, globalThis.desktop && pin, iconButton('Settings2', '设置', openSettings));
windowBar.append(brand(), topControls);
const updateButton = button('发现新版', () => openUpdate(true), 'secondary', 'ArrowDownUp');
updateButton.classList.add('update-button');
updateButton.hidden = true;
const versionLabel = el(globalThis.desktop ? 'button' : 'span', {
  class: 'sidebar-version', type: globalThis.desktop ? 'button' : null,
  title: globalThis.desktop ? '检查更新' : null, onclick: globalThis.desktop ? () => openUpdate(false) : null,
}, `版本号：${version}`);
const copyright = el('p', { class: 'app-copyright' },
  '© 2026 Jinkra . All Rights Reserved. | Made by ', creatorLink('Jinkra'));
workspace.append(el('aside', { class: 'sidebar' }, navigation, el('footer', { class: 'sidebar-footer' }, updateButton,
  el('div', { class: 'version-line' }, versionLabel, el('span', { class: 'activated-label' }, '已激活')), copyright)), content);
workspace.hidden = true;
frame.append(windowBar, workspace, dialog, settingsDialog, modeToast);
boot.classList.remove('initial-boot');
frame.append(boot);
root.append(frame);

const updateDialog = el('dialog', { class: 'about update-dialog' });
frame.append(updateDialog);

function showUpdateResult(update) {
  state.update = update;
  updateButton.hidden = !update;
  updateButton.lastChild.textContent = update ? `更新至 ${update.version}` : '发现新版';
}

function openUpdate(known, message = '') {
  if (updateDialog.open) return;
  const status = makeStatus();
  const progress = el('progress', { max: 100, hidden: true, 'aria-label': '下载进度' });
  const downloadInfo = el('div', { class: 'download-info', hidden: true },
    el('span', { class: 'download-size' }), el('span', { class: 'download-speed' }));
  const close = iconButton('X', '关闭更新提示', () => updateDialog.close());
  const updateBody = el('div', { class: 'update-body' });
  const draw = (update) => {
    updateBody.replaceChildren(...(update
      ? [el('p', {}, `当前版本 ${version}，最新版本 ${update.version}。`),
        el('p', { class: 'hint' }, update.canInstall ? '更新后会重新打开软件，首次使用新版本需要重新激活。' : '请用便携 EXE 打开工具箱进行更新。'),
        update.canInstall && button('下载并更新', task(status, async (event) => {
          const action = event.currentTarget;
          action.disabled = true;
          close.disabled = true;
          progress.hidden = false;
          downloadInfo.hidden = true;
          progress.removeAttribute('value');
          updateDialog.oncancel = (cancel) => cancel.preventDefault();
          const unsubscribe = desktop.onUpdateProgress(({ stage, received, total, speed }) => {
            downloadInfo.hidden = false;
            downloadInfo.children[0].textContent = total ? `${readableSize(received)} / ${readableSize(total)}` : `已下载 ${readableSize(received)}`;
            downloadInfo.children[1].textContent = stage === 'download' ? `${readableSize(speed)}/秒` : '';
            const percent = total ? Math.min(100, Math.floor(received * 100 / total)) : null;
            if (percent !== null) progress.value = percent;
            status.set(stage === 'verify' ? '下载完成，正在校验 SHA-256…' : stage === 'restart' ? '校验通过，正在重新启动…'
              : percent === null ? '正在下载新版…' : `下载进度 ${percent}%`);
          });
          try {
            await desktop.installUpdate();
          } catch (error) {
            action.disabled = false;
            close.disabled = false;
            updateDialog.oncancel = null;
            progress.hidden = true;
            throw error;
          } finally {
            unsubscribe();
          }
        }, '正在连接 GitHub…'), 'primary', 'ArrowDownUp')].filter(Boolean)
      : [el('p', {}, `当前已是最新版本 ${version}。`)]));
  };
  updateDialog.replaceChildren(el('div', { class: 'dialog-title' }, el('h2', {}, '软件更新'), close), updateBody, progress, downloadInfo, status.node);
  updateDialog.showModal();
  if (message) status.set(message, 'error');
  else if (known && state.update) draw(state.update);
  else {
    status.set('正在查询最新版本...');
    void desktop.checkUpdate().then((update) => {
      showUpdateResult(update);
      if (status.node.isConnected) { status.set(''); draw(update); }
    }).catch(() => status.set('暂时无法连接 GitHub，请稍后再试。', 'error'));
  }
}

function reveal(next) {
  const previous = frame.querySelector('.gateway:not(.gateway-leaving)');
  next.hidden = false;
  if (!preferences.motion || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    previous?.remove();
    return;
  }
  const options = { duration: 240, easing: 'ease-in-out', fill: 'both' };
  void next.animate([{ opacity: 0 }, { opacity: 1 }], options).finished.catch(() => {});
  if (previous) {
    previous.classList.add('gateway-leaving');
    previous.inert = true;
    void previous.animate([{ opacity: 1 }, { opacity: 0 }], options).finished
      .catch(() => {}).finally(() => previous.remove());
  }
}

function enter() {
  state.ready = true;
  applyPreferences();
  topControls.hidden = false;
  syncSearch();
  render();
  reveal(workspace);
  if (globalThis.desktop) void desktop.windowState().then((desktopState) => {
    state.pinned = desktopState.pinned;
    state.shortcut = desktopState.shortcutRegistered;
    paintPin();
  }).catch(() => {});
  if (globalThis.desktop) {
    void desktop.updateError().then((message) => { if (message) openUpdate(false, message); }).catch(() => {});
    if (preferences.autoCheck) void desktop.checkUpdate().then(showUpdateResult).catch(() => {});
  }
}

function lock() {
  const code = input({ type: 'password', maxlength: 128, required: true, placeholder: '输入激活码', 'aria-label': '激活码' });
  const status = makeStatus();
  const submit = el('button', { type: 'submit', class: 'button primary' }, '激活并进入', icon('ArrowRight', 16));
  const form = el('form', { class: 'activation-form' }, code, submit, status.node);
  const activate = task(status, async () => {
    submit.disabled = true;
    try {
      await desktop.activate(code.value);
      enter();
    } finally {
      submit.disabled = false;
    }
  }, '正在验证…');
  form.addEventListener('submit', (event) => { event.preventDefault(); void activate(event); });
  const activation = el('div', { class: 'gateway' },
    el('section', { class: 'gateway-card activation-card' },
      el('div', { class: 'gateway-brand' }, el('img', { class: 'launch-logo', src: logo, alt: '' }),
        el('strong', {}, 'Jinkra'), el('p', { class: 'gateway-version' }, `版本号：${version}`)),
      el('div', { class: 'gateway-content' }, el('h1', {}, '激活工具箱'),
        el('p', {}, '输入激活码后即可使用当前版本。'), form,
        el('div', { class: 'activation-guide' },
          el('p', {}, '微信搜索', el('strong', {}, '「都拓文化」'), '或扫描二维码关注公众号，获取激活码。'),
          el('img', { src: wechatPromotion, alt: '都拓文化微信公众号二维码', width: 1710, height: 624 })))));
  reveal(activation);
  frame.append(activation);
  code.focus();
}

async function start() {
  try {
    const activation = globalThis.desktop ? await desktop.activationState() : { active: true };
    if (activation.active) enter();
    else lock();
  } catch {
    boot.replaceChildren(el('section', { class: 'gateway-card' }, el('h1', {}, '无法启动'),
      el('p', {}, '无法读取本地激活状态。'), button('重新加载', () => location.reload(), 'primary')));
  }
}
void start();
