const { app } = require('electron');
const { spawn } = require('node:child_process');
const { lstat, mkdtemp, readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const { version } = require('../package.json');
const { readLatest, download } = require('./update-network.cjs');

let latest;
let checking;
let downloading = false;
const errorFile = () => path.join(app.getPath('userData'), 'update-error.txt');

async function checkUpdate() {
  checking ??= readLatest(version).then((result) => {
    latest = result;
    return result;
  }).finally(() => { checking = undefined; });
  const result = await checking;
  return result ? { version: result.version, canInstall: Boolean(process.env.PORTABLE_EXECUTABLE_FILE) } : null;
}

async function getUpdateError() {
  const file = errorFile();
  try {
    const error = await readFile(file, 'utf8');
    await rm(file, { force: true });
    return error;
  } catch {
    return '';
  }
}

async function installUpdate(report) {
  if (downloading) throw new Error('正在下载更新。');
  const update = latest;
  const target = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!update || !target || !path.isAbsolute(target) || path.extname(target).toLowerCase() !== '.exe') {
    throw new Error('请在便携 EXE 中检查更新。');
  }
  downloading = true;
  let folder;
  let handedOff = false;
  try {
    if (!(await lstat(target)).isFile()) throw new Error('无法定位当前运行的便携 EXE。');
    folder = await mkdtemp(path.join(path.dirname(target), '.jinkra-update-'));
    const staged = path.join(folder, 'update.exe');
    const size = await download(update, staged, report);
    const worker = app.isPackaged ? path.join(process.resourcesPath, 'jinkra-updater.exe')
      : path.resolve(__dirname, '../vendor/updater/jinkra-updater.exe');
    const ready = path.join(folder, 'ready');
    const helper = spawn(worker, [], {
      detached: true, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, JINKRA_UPDATE_TARGET: target, JINKRA_UPDATE_STAGED: staged, JINKRA_UPDATE_ERROR: errorFile(),
        JINKRA_UPDATE_READY: ready, JINKRA_UPDATE_PARENT: String(process.pid) },
    });
    let helperError;
    helper.once('error', (error) => { helperError = error; });
    let waiting = true;
    for (let retries = 0; retries < 35; retries++) {
      if (await lstat(ready).then(() => true, () => false)) { waiting = false; break; }
      if (helperError || helper.exitCode !== null) break;
      await delay(200);
    }
    if (waiting) {
      helper.kill();
      throw new Error('无法启动 Windows 更新组件，请从 GitHub 重新下载便携版。');
    }
    helper.unref();
    handedOff = true;
    report({ stage: 'restart', received: size, total: size, speed: 0 });
    setTimeout(() => app.quit(), 450);
  } finally {
    if (!handedOff && folder) await rm(folder, { recursive: true, force: true });
    if (!handedOff) downloading = false;
  }
}

module.exports = { checkUpdate, getUpdateError, installUpdate };
