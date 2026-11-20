import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import logo from '../assets/icon.png';
import { version } from '../package.json';
import './styles.css';
import { button, el, icon, iconButton, input, makeStatus, task } from './ui.js';
import { developerTools } from './tools/developer.js';
import { textTools } from './tools/text.js';
import { mediaTools } from './tools/media.js';
import { fileTools } from './tools/files.js';
import { efficiencyTools } from './tools/efficiency.js';
import { extraTools } from './tools/catalog.js';

const groups = [
  { id: 'developer', title: '开发工具', icon: 'CodeXml', tools: developerTools },
  { id: 'text', title: '文本工具', icon: 'AlignLeft', tools: textTools },
  { id: 'media', title: '媒体工具', icon: 'Image', tools: mediaTools },
  { id: 'files', title: '文件工具', icon: 'Files', tools: fileTools },
  { id: 'efficiency', title: '效率工具', icon: 'Timer', tools: efficiencyTools },
].map((group) => ({ ...group, tools: [...group.tools, ...(extraTools[group.id] ?? [])] }));
const tools = groups.flatMap((group) => group.tools.map((tool) => ({ ...tool, group })));
const byId = new Map(tools.map((tool) => [tool.id, tool]));
const featured = ['video', 'json', 'image', 'pdf'];
const state = { route: 'home', tool: null, back: null, query: '', mode: 'simple', pinned: false, shortcut: false, ready: false };

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
const content = el('main', { id: 'main-content', class: 'content' });
const navigation = el('nav', { class: 'navigation', 'aria-label': '工具导航' });
const search = input({ type: 'search', placeholder: '搜索工具、操作或格式', 'aria-label': '搜索工具', autocomplete: 'off', spellcheck: 'false' });
const clear = iconButton('X', '清除搜索', () => { setQuery(''); search.focus(); });
const keycap = el('kbd', {}, 'Ctrl K');
const frame = el('div', { class: `app-frame${globalThis.desktop ? ' is-desktop' : ''}` });
const windowBar = el('header', { class: 'window-bar' });
const workspace = el('div', { class: 'workspace' });
const dialog = el('dialog', { class: 'about' });

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

function welcome() {
  return el('section', { class: 'hero' },
    el('div', { class: 'hero-copy' },
      el('div', { class: 'hero-tag' }, icon('ShieldCheck', 15), '离线工作台'),
      el('h1', { tabindex: '-1' }, '工具工作台'),
      el('p', {}, `${tools.length} 个本地工具，涵盖开发、文本、媒体、文件和日常效率。`),
      button('查找工具', () => { search.focus(); search.select(); }, 'primary', 'Search')),
    el('aside', { class: 'hero-deck', 'aria-label': '快捷入口' },
      el('header', {}, el('strong', {}, '快捷入口'), el('span', {}, icon('Layers3', 16))),
      featured.map((id) => quickCard(byId.get(id)))),
  );
}

function home() {
  return [
    welcome(),
    recents.length > 0 && section('最近使用', el('div', { class: 'quick-grid' }, recents.slice(0, 4).map((id) => quickCard(byId.get(id)))),
      button('查看全部', () => navigate('recent'), 'quiet', 'ArrowRight')),
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
  state.mode = mode;
  document.documentElement.dataset.experience = mode;
  simple.setAttribute('aria-pressed', String(mode === 'simple'));
  professional.setAttribute('aria-pressed', String(mode === 'pro'));
  content.querySelector('.surface')?.dispatchEvent(new Event('tool-mode-changed'));
}
setMode('simple');

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
      globalThis.desktop && [el('dt', {}, '退出程序'), el('dd', {}, '关闭窗口会收起到系统托盘。使用托盘菜单退出程序。')]),
    globalThis.desktop && button('收起到托盘', async () => { dialog.close(); await desktop.windowHide(); }, 'secondary'),
  );
  dialog.showModal();
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
  if (state.ready && !dialog.open && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    search.focus();
    search.select();
  }
});

const topControls = el('div', { class: 'header-controls', hidden: true },
  el('div', { class: 'searchbox' }, icon('Search', 16), search, keycap, clear),
  modeSwitcher, globalThis.desktop && pin, iconButton('CircleHelp', '桌面快捷方式', openAbout));
windowBar.append(brand(), topControls);
workspace.append(el('aside', { class: 'sidebar' }, navigation, el('footer', { class: 'sidebar-footer' },
  el('div', { class: 'offline-status' }, el('i'), el('span', {}, '本地运行')),
  el('span', { class: 'sidebar-version' }, `v${version}`))), content);
workspace.hidden = true;
frame.append(windowBar, workspace, dialog);
root.append(frame);

function enter() {
  frame.querySelector('.gateway')?.remove();
  state.ready = true;
  topControls.hidden = false;
  workspace.hidden = false;
  syncSearch();
  render();
  if (globalThis.desktop) void desktop.windowState().then((desktopState) => {
    state.pinned = desktopState.pinned;
    state.shortcut = desktopState.shortcutRegistered;
    paintPin();
  }).catch(() => {});
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
  frame.querySelector('.gateway').replaceWith(el('div', { class: 'gateway page-enter' },
    el('section', { class: 'gateway-card' }, el('img', { class: 'launch-logo', src: logo, alt: '' }),
      el('p', { class: 'gateway-version' }, `JINKRA / ${version}`),
      el('h1', {}, '激活工具箱'), el('p', {}, '输入激活码以解锁当前版本。每次更新后需重新激活。'), form)));
  code.focus();
}

async function start() {
  const boot = el('div', { class: 'gateway' }, el('section', { class: 'boot-content', role: 'status' },
    el('img', { class: 'launch-logo boot-logo', src: logo, alt: '' }),
    el('h1', {}, 'Jinkra'), el('p', {}, '正在启动工作台'), el('div', { class: 'boot-progress' })));
  frame.append(boot);
  try {
    const [activation] = await Promise.all([
      globalThis.desktop ? desktop.activationState() : { active: true },
      new Promise((resolve) => setTimeout(resolve, 820)),
    ]);
    if (activation.active) enter();
    else lock();
  } catch {
    boot.replaceChildren(el('section', { class: 'gateway-card' }, el('h1', {}, '无法启动'),
      el('p', {}, '无法读取本地激活状态。'), button('重新加载', () => location.reload(), 'primary')));
  }
}
void start();
