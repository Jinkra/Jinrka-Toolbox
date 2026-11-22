const { app } = require('electron');
const { randomUUID } = require('node:crypto');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { withOutput } = require('./files.cjs');

const levels = new Set(['normal', 'persistent', 'strong']);

function createSchedule(notify, changed) {
  let clock;
  let started = false;
  let records;
  let tail = Promise.resolve();
  const file = () => path.join(app.getPath('userData'), 'schedule.json');

  async function load() {
    if (records) return;
    try {
      const saved = JSON.parse(await readFile(file(), 'utf8'));
      if (!Array.isArray(saved) || !saved.every((item) => typeof item?.id === 'string' &&
          typeof item.title === 'string' && typeof item.notes === 'string' && Number.isFinite(item.at) &&
          levels.has(item.level) && (item.deliveredAt === null || Number.isFinite(item.deliveredAt)))) {
        throw new Error('日程文件格式无效。');
      }
      records = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('无法读取本地日程文件。');
      records = [];
    }
  }

  async function save(next) {
    await withOutput(file(), (temporary) => writeFile(temporary, JSON.stringify(next)));
    records = next;
  }

  function serial(work) {
    const next = tail.then(async () => { await load(); return work(); });
    tail = next.catch(() => {});
    return next;
  }

  function arm() {
    clearTimeout(clock);
    if (!started) return;
    const next = records.reduce((nearest, item) => item.deliveredAt === null ? Math.min(nearest, item.at) : nearest, Infinity);
    if (Number.isFinite(next)) clock = setTimeout(wake, Math.min(60_000, Math.max(0, next - Date.now())));
  }

  function wake() {
    if (!started) return;
    void serial(async () => {
      const now = Date.now();
      const due = records.filter((item) => item.deliveredAt === null && item.at <= now).sort((a, b) => a.at - b.at);
      if (!due.length) { arm(); return; }
      const ids = new Set(due.map((item) => item.id));
      await save(records.map((item) => ids.has(item.id) ? { ...item, deliveredAt: now } : item));
      arm();
      for (const item of due) notify(item);
      changed();
    }).catch((error) => {
      console.error('日程提醒', error.message);
      clearTimeout(clock);
      if (started) clock = setTimeout(wake, 60_000);
    });
  }

  return {
    start() { if (!started) { started = true; wake(); } },
    wake,
    stop() { started = false; clearTimeout(clock); },
    list: () => serial(() => records),
    save: (input) => serial(async () => {
      const title = typeof input?.title === 'string' ? input.title.trim() : '';
      const notes = typeof input?.notes === 'string' ? input.notes.trim() : '';
      if (!title || title.length > 90 || notes.length > 500 || !levels.has(input?.level)) throw new Error('请填写有效的标题、备注和通知等级。');
      if (!Number.isSafeInteger(input.at) || input.at <= Date.now() || input.at > 253402300799999) throw new Error('请选择未来的提醒时间。');
      const editing = input.id != null;
      if (editing && !records.some((item) => item.id === input.id)) throw new Error('找不到要编辑的日程。');
      if (!editing && records.length >= 500) throw new Error('日程已达上限，请移除不需要的历史记录。');
      const item = { id: editing ? input.id : randomUUID(), title, notes, at: input.at, level: input.level, deliveredAt: null };
      await save([...records.filter((entry) => entry.id !== item.id), item]);
      arm();
    }),
    remove: (id) => serial(async () => {
      if (typeof id !== 'string' || !records.some((item) => item.id === id)) throw new Error('找不到要移除的日程。');
      await save(records.filter((item) => item.id !== id));
      arm();
    }),
    test(level) {
      if (!levels.has(level)) throw new Error('通知等级无效。');
      notify({ id: randomUUID(), title: '日程通知测试', notes: '这是一条测试通知。', at: Date.now(), level });
    },
  };
}

module.exports = { createSchedule };
