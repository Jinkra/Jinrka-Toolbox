const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, net, protocol, shell, Tray } = require('electron');
const { randomUUID } = require('node:crypto');
const { stat, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createZip, extractZip, hashFiles, planRenames, applyRenames, withOutput } = require('./files.cjs');
const { convertVideo, inspectMedia } = require('./video.cjs');
const { activate, activationState, loadActivation } = require('./activation.cjs');
const { checkUpdate, getUpdateError, installUpdate } = require('./updater.cjs');

const origin = 'app://jinkra';
const dist = path.resolve(__dirname, '../dist');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

const selections = new Map();
const fileFilters = {
  any: [],
  directory: [],
  zip: [{ name: 'ZIP 归档', extensions: ['zip'] }],
  video: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'flv', 'wmv', 'ogv', 'mpg', 'mpeg', 'ts', 'm2ts', '3gp'] }],
  audio: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'mp4', 'webm'] }],
};
const hotkey = 'CommandOrControl+Alt+J';
const icon = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.resolve(__dirname, '../assets/icon.png');
let window;
let tray;
let quitting = false;
let closeBehavior = 'tray';
let shortcutRegistered = false;
let renameInProgress = false;
let videoJob;

function showWindow() {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function setupWindow() {
  window = new BrowserWindow({
    title: 'Jinkra 工具箱', width: 1300, height: 880, minWidth: 640, minHeight: 600,
    backgroundColor: '#f4f7fc', icon, autoHideMenuBar: true, show: false,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#fffeff', symbolColor: '#344865', height: 52 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, devTools: !app.isPackaged,
    },
  });
  window.once('ready-to-show', showWindow);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('close', (event) => {
    if (quitting) return;
    if (closeBehavior === 'quit') {
      event.preventDefault();
      app.quit();
    } else if (tray) {
      event.preventDefault();
      window.hide();
    }
  });
  return window.loadURL(`${origin}/`);
}

function ipc(name, handler, locked = true) {
  ipcMain.handle(`toolbox:${name}`, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== `${origin}/`) {
      throw new Error('无法从此页面调用桌面功能。');
    }
    if (locked && !activationState().active) throw new Error('请先激活当前版本。');
    return handler(...args);
  });
}

function getPaths(selection, kind) {
  const entry = selections.get(selection);
  if (!entry || (kind && entry.kind !== kind)) throw new Error('请重新选择文件。');
  return entry.paths;
}

async function pickFolder() {
  const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0];
}

async function pickSave(title, defaultPath, extensions) {
  const result = await dialog.showSaveDialog(window, {
    title, defaultPath, filters: [{ name: extensions[0].toUpperCase(), extensions }],
    properties: ['showOverwriteConfirmation', 'createDirectory'],
  });
  if (result.canceled || !result.filePath) return null;
  if (path.extname(result.filePath).toLowerCase() !== `.${extensions[0]}`) {
    throw new Error(`请使用 .${extensions[0]} 作为文件扩展名。`);
  }
  return result.filePath;
}

function setupIpc() {
  ipc('activation:state', activationState, false);
  ipc('activation:submit', activate, false);
  ipc('creator:open', () => shell.openExternal('https://jinkra.slatt.cn/'), false);
  ipc('update:check', checkUpdate);
  ipc('update:error', getUpdateError);
  ipc('update:install', () => installUpdate((progress) => window.webContents.send('toolbox:update:progress', progress)));
  ipc('files', async (kind, multiple) => {
    if (!Object.hasOwn(fileFilters, kind)) throw new Error('不支持该文件类型。');
    const result = await dialog.showOpenDialog(window, {
      properties: kind === 'directory' ? ['openDirectory'] : multiple === true ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: fileFilters[kind],
    });
    if (result.canceled) return null;
    const id = randomUUID();
    selections.set(id, { kind, paths: result.filePaths });
    if (selections.size > 32) selections.delete(selections.keys().next().value);
    return { id, names: result.filePaths.map((file) => path.basename(file)) };
  });
  ipc('zip:create', async (selection, level) => {
    const kind = selections.get(selection)?.kind;
    if (kind !== 'any' && kind !== 'directory') throw new Error('请重新选择要打包的文件或文件夹。');
    const files = getPaths(selection, kind);
    const destination = await pickSave('保存 ZIP', '归档.zip', ['zip']);
    return destination ? createZip(files, destination, level) : null;
  });
  ipc('zip:extract', async (selection, flatten) => {
    const [archive] = getPaths(selection, 'zip');
    const folder = await pickFolder();
    return folder ? extractZip(archive, folder, flatten === true) : null;
  });
  ipc('hash', (selection, algorithm) => hashFiles(getPaths(selection, 'any'), algorithm));
  ipc('files:info', (selection) => Promise.all(getPaths(selection, 'any').map(async (file) => {
    const info = await stat(file);
    return { name: path.basename(file), extension: path.extname(file), bytes: info.size,
      modified: info.mtime.toISOString(), created: info.birthtime.toISOString(), path: file };
  })));
  ipc('save', async (name, bytes) => {
    const extension = path.extname(name).slice(1).toLowerCase();
    if (!['png', 'jpg', 'webp', 'gif', 'pdf', 'zip', 'txt', 'md', 'csv', 'json'].includes(extension) || !ArrayBuffer.isView(bytes)) {
      throw new Error('无法保存这个文件类型。');
    }
    const filename = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/gu, '-');
    const destination = await pickSave('保存处理结果', filename, [extension]);
    if (!destination) return null;
    return withOutput(destination, (output) => writeFile(output, bytes, { flag: 'wx' }));
  });
  ipc('rename:plan', (selection, settings) => planRenames(getPaths(selection, 'any'), settings));
  ipc('rename:apply', async (selection, settings) => {
    if (renameInProgress) throw new Error('正在重命名文件。');
    renameInProgress = true;
    try {
      return await applyRenames(getPaths(selection, 'any'), settings);
    } finally {
      renameInProgress = false;
    }
  });
  function mediaFile(selection) {
    const kind = selections.get(selection)?.kind;
    if (kind !== 'video' && kind !== 'audio') throw new Error('请重新选择媒体文件。');
    return getPaths(selection, kind)[0];
  }
  ipc('video:inspect', (selection) => inspectMedia(mediaFile(selection)));
  ipc('video:cancel', () => {
    videoJob?.abort();
  });
  ipc('video', async (selection, settings) => {
    if (videoJob) throw new Error('正在处理媒体。');
    const file = mediaFile(selection);
    videoJob = new AbortController();
    try {
      return await convertVideo(file, settings, pickSave, videoJob.signal, (ratio) => {
        window.webContents.send('toolbox:video:progress', ratio);
      });
    } finally {
      videoJob = null;
    }
  });
  ipc('clipboard:read', () => clipboard.readText());
  ipc('clipboard:write', (value) => clipboard.writeText(String(value)));
  ipc('window:state', () => ({ pinned: window.isAlwaysOnTop(), shortcutRegistered }), false);
  ipc('window:close-behavior', (value) => { closeBehavior = value === 'quit' ? 'quit' : 'tray'; });
  ipc('window:pin', () => {
    window.setAlwaysOnTop(!window.isAlwaysOnTop());
    return window.isAlwaysOnTop();
  });
  ipc('window:hide', () => window.hide());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (window) showWindow(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.whenReady().then(async () => {
    protocol.handle('app', async (request) => {
      const address = new URL(request.url);
      if (address.host !== 'jinkra' || request.method !== 'GET') return new Response(null, { status: 404 });
      const relative = decodeURIComponent(address.pathname.slice(1)) || 'index.html';
      const resolved = path.resolve(dist, relative);
      if (!resolved.startsWith(dist + path.sep)) return new Response(null, { status: 404 });
      try {
        return await net.fetch(pathToFileURL(resolved).href, { bypassCustomProtocolHandlers: true });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('com.jinkra.toolbox');
    await loadActivation();
    setupIpc();
    await setupWindow();
    tray = new Tray(icon);
    tray.setToolTip('Jinkra 工具箱');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开工具箱', click: showWindow },
      { label: '退出', click: () => app.quit() },
    ]));
    tray.on('double-click', showWindow);
    shortcutRegistered = globalShortcut.register(hotkey, showWindow);
  }).catch((error) => {
    dialog.showErrorBox('无法启动 Jinkra 工具箱', error.message);
    app.quit();
  });
}
