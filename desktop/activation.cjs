const { app, safeStorage } = require('electron');
const { scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { withOutput } = require('./files.cjs');

const { version } = require('../package.json');
const keyDigest = Buffer.from('03eff1d8b2ed11ce79a501d89f80f38d0ced70786a9cb986972230451ca0f13b', 'hex');
const derive = promisify(scrypt);
const receipt = 'Jinkra/activation/' + version;
let active = false;
let pending;
let attempt;
let failures = 0;
let waitUntil = 0;
const marker = () => path.join(app.getPath('userData'), 'activation.dat');

async function loadActivation() {
  try {
    const saved = await safeStorage.decryptStringAsync(await readFile(marker()));
    active = saved.result === receipt;
  } catch {
    active = false;
  }
}

function activationState() {
  return { version, active };
}

async function activate(code) {
  if (active) return activationState();
  const seconds = Math.ceil((waitUntil - Date.now()) / 1000);
  if (seconds > 0) throw new Error(`尝试次数过多，请在 ${seconds} 秒后重试。`);
  if (attempt) throw new Error('正在验证激活码。');
  if (typeof code !== 'string' || code.length < 1 || code.length > 128) throw new Error('请输入有效的激活码。');
  let match;
  try {
    attempt = derive(code.trim(), 'Jinkra local activation v2', keyDigest.length);
    match = timingSafeEqual(await attempt, keyDigest);
  } finally {
    attempt = undefined;
  }
  if (!match) {
    if (++failures === 5) { waitUntil = Date.now() + 30_000; failures = 0; }
    throw new Error('激活码不正确，请检查后重试。');
  }
  pending ??= (async () => {
    const file = marker();
    const encrypted = await safeStorage.encryptStringAsync(receipt);
    await mkdir(path.dirname(file), { recursive: true });
    await withOutput(file, (temp) => writeFile(temp, encrypted, { flag: 'wx' }));
    active = true;
  })().finally(() => { pending = undefined; });
  await pending;
  return activationState();
}

module.exports = { activate, activationState, loadActivation };
