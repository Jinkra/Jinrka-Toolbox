const { app, dialog, shell } = require('electron');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { lstat, readdir, realpath, statfs, unlink } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);
const storageRoot = /^[a-z]:$/i.test(process.env.SystemDrive) ? process.env.SystemDrive + '\\' : 'C:\\';
const days = new Set([3, 7, 14, 30]);
const scanLimit = 20_000;
const matchPath = (a, b) => a.toLowerCase() === b.toLowerCase();
let scan;
let scanning = false;
let cleaning = false;
let trimming = false;

function memory() {
  return { total: os.totalmem(), free: os.freemem() };
}

async function systemInfo() {
  const cpu = os.cpus();
  const disk = await statfs(storageRoot).catch(() => null);
  return {
    version: os.release(), arch: os.arch(), uptime: os.uptime(), cpu: cpu[0]?.model ?? '',
    threads: cpu.length, memory: memory(), drive: storageRoot,
    disk: disk && { total: disk.blocks * disk.bsize, free: disk.bavail * disk.bsize },
  };
}

async function trimMemory() {
  if (trimming) throw new Error('正在释放内存。');
  trimming = true;
  try {
    const executable = app.isPackaged ? path.join(process.resourcesPath, 'jinkra-memory.exe')
      : path.resolve(__dirname, '../vendor/updater/jinkra-memory.exe');
    const before = memory();
    const { stdout } = await run(executable, [], { windowsHide: true, timeout: 20_000 });
    const count = Number(stdout.trim());
    if (!Number.isInteger(count) || count < 0) throw new Error('无法读取内存释放结果。');
    return { before, after: memory(), count };
  } finally {
    trimming = false;
  }
}

async function sameLocation(file) {
  return matchPath(file, await realpath(file));
}

async function scanCleanup(age = 7) {
  if (!days.has(age)) throw new Error('请选择支持的文件保留天数。');
  if (scanning || cleaning) throw new Error('正在处理清理任务。');
  scanning = true;
  scan = undefined;
  const cutoff = Date.now() - age * 86_400_000;
  const local = process.env.LOCALAPPDATA;
  const roots = [
    ['用户临时文件', local && path.join(local, 'Temp')],
    ['DirectX 着色器缓存', local && path.join(local, 'D3DSCache')],
  ];
  const files = [];
  const categories = [];
  let entryCount = 0;
  async function visit(folder, depth, category) {
    if (depth > 10 || entryCount >= scanLimit || !await sameLocation(folder).catch(() => false)) return;
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++entryCount > scanLimit) break;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file, depth + 1, category);
      else if (entry.isFile()) {
        const info = await lstat(file).catch(() => null);
        if (!info?.isFile() || Math.max(info.mtimeMs, info.birthtimeMs) > cutoff) continue;
        files.push({ file, size: info.size, modified: info.mtimeMs, ino: info.ino });
        category.count++;
        category.bytes += info.size;
      }
    }
  }
  try {
    for (const [name, folder] of roots) {
      const category = { name, count: 0, bytes: 0 };
      if (folder && path.isAbsolute(folder) && matchPath(path.parse(folder).root, storageRoot)) await visit(folder, 0, category);
      categories.push(category);
    }
    const id = randomUUID();
    const bytes = categories.reduce((sum, category) => sum + category.bytes, 0);
    scan = { id, expires: Date.now() + 10 * 60_000, files, bytes };
    return { id, drive: storageRoot, count: files.length, bytes, categories, limited: entryCount >= scanLimit };
  } finally {
    scanning = false;
  }
}

async function cleanScan(window, id) {
  if (scanning || cleaning) throw new Error('正在处理清理任务。');
  if (!scan || scan.id !== id || Date.now() > scan.expires) throw new Error('扫描结果已过期，请重新扫描。');
  const { files, bytes } = scan;
  cleaning = true;
  try {
    const result = await dialog.showMessageBox(window, {
      type: 'warning', title: '系统盘清理', message: `永久删除 ${files.length} 个旧临时文件和缓存？`,
      detail: `扫描大小约 ${(bytes / 1048576).toFixed(1)} MiB。正在使用或扫描后变更的文件会跳过。`,
      buttons: ['取消', '确认清理'], cancelId: 0, defaultId: 0, noLink: true,
    });
    if (result.response !== 1) return null;
    scan = undefined;
    let removed = 0;
    let released = 0;
    for (const { file, size, modified, ino } of files) {
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.size !== size || info.mtimeMs !== modified || info.ino !== ino || !await sameLocation(file)) continue;
        await unlink(file);
        removed++;
        released += size;
      } catch {
        // Locked, missing or inaccessible cache files are skipped.
      }
    }
    return { removed, released, skipped: files.length - removed };
  } finally {
    cleaning = false;
  }
}

const openStorageSettings = () => shell.openExternal('ms-settings:storagesense');
module.exports = { systemInfo, trimMemory, scanCleanup, cleanScan, openStorageSettings };
