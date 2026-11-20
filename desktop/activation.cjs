const { app, safeStorage } = require('electron');
const { createHash, timingSafeEqual } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { withOutput } = require('./files.cjs');

const { version } = require('../package.json');
const keyDigest = Buffer.from('7a2d347f7280d6855250b191745a4b723e6862debb5a173da1bdacee0b06fea2', 'hex');
let active = false;
let pending;
const marker = () => path.join(app.getPath('userData'), 'activation.dat');

async function loadActivation() {
  try {
    const saved = await safeStorage.decryptStringAsync(await readFile(marker()));
    active = saved.result === version;
  } catch {
    active = false;
  }
}

function activationState() {
  return { version, active };
}

async function activate(code) {
  if (active) return activationState();
  if (typeof code !== 'string' || code.length > 128 ||
      !timingSafeEqual(createHash('sha256').update(code.trim()).digest(), keyDigest)) {
    throw new Error('激活码不正确，请检查后重试。');
  }
  pending ??= (async () => {
    const file = marker();
    const encrypted = await safeStorage.encryptStringAsync(version);
    await mkdir(path.dirname(file), { recursive: true });
    await withOutput(file, (temp) => writeFile(temp, encrypted, { flag: 'wx' }));
    active = true;
  })().finally(() => { pending = undefined; });
  await pending;
  return activationState();
}

module.exports = { activate, activationState, loadActivation };
