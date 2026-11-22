const { app } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { withOutput } = require('./files.cjs');

const han = /\p{Script=Han}/u;
let cache;
let saving;
let saveTimer;
let pauseUntil = 0;
const cacheFile = () => path.join(app.getPath('userData'), 'skill-translation.json');

function translations() {
  cache ??= readFile(cacheFile(), 'utf8').then(JSON.parse)
    .then((items) => new Map(Array.isArray(items) ? items.slice(-1000) : [])).catch(() => new Map());
  return cache;
}

function save(items) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = (saving ?? Promise.resolve()).then(() => withOutput(cacheFile(), (file) =>
      writeFile(file, JSON.stringify(Array.from(items).slice(-1000))))).catch(() => {});
  }, 450);
  saveTimer.unref?.();
}

async function translateSkill(title, description) {
  const text = [title, description].filter(Boolean).join('\n');
  if (!text || !/[a-z]{2}/i.test(text) || (han.test(title) && (!description || han.test(description)))) return '';
  const items = await translations();
  if (items.has(text)) return items.get(text);
  if (Date.now() < pauseUntil) return '';
  const endpoint = new URL('https://translate.googleapis.com/translate_a/single');
  endpoint.search = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: 'zh-CN', dt: 't', q: text });
  try {
    const response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error('翻译服务暂不可用');
    const json = await response.json();
    const chinese = json[0].map((part) => typeof part?.[0] === 'string' ? part[0] : '').join('')
      .replace(/\s*\n\s*/g, ' · ').trim().slice(0, 1000);
    if (!han.test(chinese) || chinese === text) return '';
    items.set(text, chinese);
    if (items.size > 1000) items.delete(items.keys().next().value);
    save(items);
    return chinese;
  } catch {
    pauseUntil = Date.now() + 30_000;
    return '';
  }
}

module.exports = { translateSkill };
