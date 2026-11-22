import { actions, area, box, button, el, field, input, makeStatus, select, task } from '../ui.js';

const levels = [
  ['normal', '普通 · Windows 通知'],
  ['persistent', '持续 · 手动关闭的系统通知'],
  ['strong', '强力 · 打开工具箱并弹窗'],
];
const labels = new Map(levels);
const localDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false });
const motionEnabled = () => document.documentElement.dataset.motion !== 'off' &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches;

function animate(node, frames, duration = 180, fill = 'none') {
  if (!motionEnabled() || !node.isConnected) return Promise.resolve();
  return node.animate(frames, { duration, easing: 'ease-out', fill }).finished.catch(() => {});
}

const enterFrames = [{ opacity: .35, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }];

function dateInput(time) {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function schedulePage() {
  if (!globalThis.desktop) return box(el('p', { class: 'hint' }, '请在 Windows 安装版中使用日程提醒。'));
  const status = makeStatus();
  const title = input({ required: true, maxlength: 90, placeholder: '例如：提交周报' });
  const notes = area('准备事项或补充说明');
  notes.maxLength = 500;
  notes.rows = 3;
  const at = input({ type: 'datetime-local', required: true });
  const level = select(levels);
  const pending = el('div', { class: 'schedule-items' });
  const history = el('div', { class: 'schedule-items' });
  const formTitle = el('h2', {}, '新建日程');
  const submit = el('button', { type: 'submit', class: 'button primary' }, '保存日程');
  const cancel = button('取消编辑', () => { reset(); void animate(form, enterFrames); }, 'quiet');
  const entryData = new WeakMap();
  let editing;
  let reading = 0;

  function reset() {
    editing = undefined;
    formTitle.textContent = '新建日程';
    submit.textContent = '保存日程';
    cancel.hidden = true;
    title.value = '';
    notes.value = '';
    at.value = dateInput(Date.now() + 10 * 60_000);
    level.value = 'normal';
  }

  function edit(item) {
    editing = item.id;
    formTitle.textContent = '编辑日程';
    title.value = item.title;
    notes.value = item.notes;
    at.value = dateInput(item.at > Date.now() ? item.at : Date.now() + 10 * 60_000);
    level.value = item.level;
    cancel.hidden = false;
    title.focus({ preventScroll: true });
    title.scrollIntoView({ block: 'nearest', behavior: motionEnabled() ? 'smooth' : 'auto' });
    void animate(form, enterFrames);
  }

  function row(item) {
    const entry = el('article', { class: 'schedule-entry' },
      el('div', { class: 'schedule-entry-main' }, el('time', { datetime: new Date(item.at).toISOString() }, localDate.format(item.at)),
        el('h3', {}, item.title), item.notes && el('p', { class: 'schedule-note' }, item.notes),
        el('p', { class: 'hint' }, labels.get(item.level), item.deliveredAt &&
          ` · ${localDate.format(item.deliveredAt)} 提醒`)),
      actions(button(item.deliveredAt ? '重新安排' : '编辑', () => edit(item), 'secondary'),
        button('移除', task(status, async () => {
          await desktop.scheduleRemove(item.id);
          if (editing === item.id) reset();
          entry.classList.add('schedule-leaving');
          await animate(entry, [
            { opacity: 1, height: `${entry.getBoundingClientRect().height}px`, marginBottom: '0px' },
            { opacity: 0, height: '0px', marginBottom: '-12px', paddingBlock: '0px',
              borderTopWidth: '0px', borderBottomWidth: '0px', transform: 'translateX(8px)' },
          ], 190, 'forwards');
          await refresh();
          confirmChange('已移除日程。');
        }), 'quiet')));
    entryData.set(entry, item);
    return entry;
  }

  function reconcile(list, items, empty) {
    const current = new Map([...list.children].filter((node) => entryData.has(node))
      .map((node) => [entryData.get(node).id, node]));
    const changed = [];
    const nodes = items.map((item) => {
      const existing = current.get(item.id);
      const previous = existing && entryData.get(existing);
      if (previous && ['title', 'notes', 'at', 'level', 'deliveredAt'].every((key) => previous[key] === item[key])) return existing;
      const next = row(item);
      changed.push(next);
      return next;
    });
    if (!nodes.length) {
      if (list.firstChild?.textContent !== empty) list.replaceChildren(el('p', { class: 'hint' }, empty));
      return;
    }
    const retained = new Set(nodes);
    for (const node of [...list.children]) if (!retained.has(node)) node.remove();
    for (const [index, node] of nodes.entries()) {
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] ?? null);
    }
    for (const node of changed) void animate(node, enterFrames);
  }

  function confirmChange(message) {
    status.set(message, 'success');
    void animate(status.node, enterFrames);
  }

  async function refresh() {
    const request = ++reading;
    const items = await desktop.scheduleList();
    if (request !== reading) return;
    const future = items.filter((item) => item.deliveredAt === null).sort((a, b) => a.at - b.at);
    const past = items.filter((item) => item.deliveredAt !== null).sort((a, b) => b.deliveredAt - a.deliveredAt);
    reconcile(pending, future, '暂无待提醒日程。');
    reconcile(history, past, '暂无提醒记录。');
  }

  const load = task(status, async () => { await refresh(); status.set(''); }, '正在读取本地日程…');
  const save = task(status, async () => {
    submit.disabled = true;
    try {
      await desktop.scheduleSave({ id: editing, title: title.value, notes: notes.value,
        at: new Date(at.value).getTime(), level: level.value });
      reset();
      await refresh();
      confirmChange('日程已保存。');
    } finally { submit.disabled = false; }
  }, '正在保存日程…');
  const form = el('form', { class: 'schedule-form', onsubmit: (event) => { event.preventDefault(); void save(); } },
    formTitle, field('标题', title), field('提醒时间', at), field('通知等级', level), field('备注', notes), actions(submit, cancel));
  const body = el('div', { class: 'schedule-tool' },
    el('p', { class: 'hint' }, '提醒由工具箱后台发送。可收起到托盘，休眠或退出期间到期的日程会在恢复运行后补发。'),
    status.node, el('div', { class: 'schedule-grid' },
      box(form, button('测试通知', task(status, async () => {
        await desktop.scheduleTest(level.value);
        status.set('已触发测试通知。', 'success');
      }), 'quiet', 'CalendarClock')),
      box(el('h2', {}, '待提醒'), pending, el('h2', {}, '已提醒'), history)));
  body.addEventListener('schedule-changed', () => { void refresh().catch(() => {}); });
  reset();
  void load();
  return body;
}

export const agenda = { id: 'schedule', name: '日程表', icon: 'CalendarClock',
  description: '安排日期和时间，在 Windows 托盘后台按通知等级提醒。',
  keywords: '日历 提醒 日程计划 通知 事项', render: schedulePage };
