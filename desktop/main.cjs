const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, net, powerMonitor, protocol, shell, Tray } = require('electron');
const { randomUUID } = require('node:crypto');
const { readFile, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { createZip, extractZip, hashFiles, planRenames, applyRenames, withOutput } = require('./files.cjs');
const { convertVideo, inspectMedia } = require('./video.cjs');
const { activate, activationState, loadActivation } = require('./activation.cjs');
const { checkUpdate, getReleaseNotes, getUpdateError, installUpdate, cleanCompletedUpdate } = require('./updater.cjs');
const { openRepo, openToolDocs, installTool } = require('./ai.cjs');
const { loadSkills, inspectSkills, listInstalled, installSkill, uninstallSkill, skillDetails } = require('./skills.cjs');
const { systemInfo, trimMemory, scanCleanup, cleanScan, openStorageSettings } = require('./system.cjs');
const { runtimeStatus, inspectDll, installRuntime, runtimeDocs } = require('./runtime.cjs');
const { arrowStatus, changeArrow, openSystemCheck } = require('./windows-maintenance.cjs');
const { checkApi } = require('./ai-connection.cjs');
const network = require('./network.cjs');
const { startupArg, loginStatus, setLogin, migrateLogin } = require('./startup.cjs');
const { createSchedule } = require('./schedule.cjs');
const { createReminderNotifications } = require('./reminder-notifications.cjs');
const { shellAppId, prepareWindowsBrand } = require('./windows-brand.cjs');

const origin = 'app://jinkra';
const dist = path.resolve(__dirname, '../dist');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

const selections = new Map();
const inputKinds = new Set(['image', 'gif', 'pdf']);
const fileFilters = {
  any: [],
  directory: [],
  zip: [{ name: 'ZIP 归档', extensions: ['zip'] }],
  executable: [{ name: 'Windows 程序', extensions: ['exe'] }],
  video: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'flv', 'wmv', 'ogv', 'mpg', 'mpeg', 'ts', 'm2ts', '3gp'] }],
  audio: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'mp4', 'webm'] }],
  image: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'svg', 'ico', 'heic', 'heif', 'tif', 'tiff'] }],
  gif: [{ name: 'GIF 动图', extensions: ['gif'] }],
  pdf: [{ name: 'PDF 文档', extensions: ['pdf'] }],
};
const hotkey = 'CommandOrControl+Alt+J';
const icon = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.resolve(__dirname, '../assets/icon.png');
const windowIcon = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.ico')
  : path.resolve(__dirname, '../assets/icon.ico');
let window;
let tray;
let quitting = false;
let closeBehavior = 'tray';
let shortcutRegistered = false;
let renameInProgress = false;
let videoJob;
let showOnReady = !process.argv.includes(startupArg);
let dashboardReady = false;
const windowsBrand = prepareWindowsBrand(icon, windowIcon);
const notify = createReminderNotifications(() => window, () => {
  showWindow();
  window.webContents.send('toolbox:schedule:open');
}, icon, windowsBrand.register);
const schedule = createSchedule((item) => {
  void notify(item).catch((error) => console.error('日程通知', error.message));
}, () => {
  if (window && !window.isDestroyed()) window.webContents.send('toolbox:schedule:changed');
});

function showWindow() {
  showOnReady = true;
  if (!dashboardReady || !window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function signalSplash() {
  const file = process.env.JINKRA_SPLASH_SIGNAL;
  if (file && path.isAbsolute(file) && path.basename(file) === 'jinkra-splash.ready') {
    void writeFile(file, '', { flag: 'wx' }).catch(() => {});
  }
}

async function setupWindow(iconPath) {
  window = new BrowserWindow({
    title: '小金工具箱', width: 1300, height: 880, minWidth: 640, minHeight: 600,
    backgroundColor: '#f4f7fc', icon: iconPath, autoHideMenuBar: true, show: false, skipTaskbar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#fffeff', symbolColor: '#344865', height: 52 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, devTools: !app.isPackaged,
    },
  });
  window.setAppDetails({ appId: shellAppId });
  let painted = false;
  const reveal = () => {
    if (!painted || !dashboardReady) return;
    window.setSkipTaskbar(false);
    if (showOnReady) showWindow();
    signalSplash();
  };
  window.once('ready-to-show', () => { painted = true; reveal(); });
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
  dashboardReady = await loadDashboard();
  reveal();
  return dashboardReady;
}

async function loadDashboard() {
  const log = path.join(app.getPath('userData'), 'startup-error.log');
  for (;;) {
    const failures = [];
    for (const pause of [0, 250, 750]) {
      if (pause) await delay(pause);
      if (quitting || window.isDestroyed()) return false;
      try {
        await stat(path.join(dist, 'index.html'));
        await window.loadURL(`${origin}/`);
        return true;
      } catch (error) {
        failures.push(`${new Date().toISOString()} ${error.message}`);
        await writeFile(log, failures.join('\n') + '\n', 'utf8').catch(() => {});
      }
    }
    if (quitting || window.isDestroyed()) return false;
    signalSplash();
    const choice = await dialog.showMessageBox({
      type: 'error', title: '小金工具箱', message: '启动页面暂时无法加载。',
      detail: `已尝试重新加载。排查日志保存在 ${log}`,
      buttons: ['重试', '退出'], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (choice.response !== 0) { app.quit(); return false; }
  }
}

function ipc(name, handler, locked = true) {
  ipcMain.handle(`toolbox:${name}`, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== `${origin}/`) {
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

function setupIpc(activationReady) {
  ipc('activation:state', async () => {
    await activationReady;
    return activationState();
  }, false);
  ipc('activation:submit', async (code) => {
    await activationReady;
    const result = await activate(code);
    schedule.start();
    return result;
  }, false);
  ipc('creator:open', () => shell.openExternal('https://jinkra.slatt.cn/'), false);
  ipc('ai:skills', loadSkills);
  ipc('ai:skills:inspect', inspectSkills);
  ipc('ai:skills:details', skillDetails);
  ipc('ai:skills:installed', listInstalled);
  ipc('ai:skills:install', installSkill);
  ipc('ai:skills:uninstall', uninstallSkill);
  ipc('ai:repo', openRepo);
  ipc('ai:tool-docs', openToolDocs);
  ipc('ai:install', installTool);
  ipc('ai:check-api', checkApi);
  ipc('system:info', systemInfo);
  ipc('system:trim-memory', trimMemory);
  ipc('system:scan-cleanup', scanCleanup);
  ipc('system:clean-scan', (id) => cleanScan(window, id));
  ipc('system:storage-settings', openStorageSettings);
  ipc('system:runtime-status', runtimeStatus);
  ipc('system:inspect-dll', (selection, text, arch) => inspectDll(
    selection ? getPaths(selection, 'executable')[0] : null, text, arch));
  ipc('system:install-runtime', installRuntime);
  ipc('system:runtime-docs', runtimeDocs);
  ipc('system:arrow-status', arrowStatus);
  ipc('system:change-arrow', changeArrow);
  ipc('system:sfc', openSystemCheck);
  ipc('ocr:languages', network.ocrLanguages);
  ipc('ocr:image', network.ocrBytes);
  ipc('ocr:clipboard', network.ocrClipboard);
  ipc('hosts:read', network.hostsRead);
  ipc('hosts:save', network.hostsSave);
  ipc('hosts:restore', () => network.hostsRestore(window));
  ipc('dns:flush', network.dnsFlush);
  ipc('ports:list', (all) => network.portsList(all === true));
  ipc('process:kill', (pid) => network.processKill(window, pid));
  const networkProgress = (data) => { if (!window.isDestroyed()) window.webContents.send('toolbox:network:progress', data); };
  ipc('network:ping', (options) => network.ping(options, networkProgress));
  ipc('network:speed', () => network.speedTest(networkProgress));
  ipc('network:cancel', network.networkCancel);
  ipc('schedule:list', schedule.list);
  ipc('schedule:save', schedule.save);
  ipc('schedule:remove', schedule.remove);
  ipc('schedule:test', schedule.test);
  ipc('update:check', checkUpdate, false);
  ipc('update:notes', getReleaseNotes, false);
  ipc('update:error', getUpdateError, false);
  ipc('update:install', () => installUpdate((progress) => window.webContents.send('toolbox:update:progress', progress)), false);
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
  ipc('window:login-status', loginStatus);
  ipc('window:set-login', setLogin);
}

if (!app.requestSingleInstanceLock()) {
  signalSplash();
  app.quit();
} else {
  app.on('second-instance', (_event, args) => { if (!args.includes(startupArg)) showWindow(); });
  app.on('before-quit', () => { quitting = true; schedule.stop(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.whenReady().then(async () => {
    void cleanCompletedUpdate().catch(() => {});
    protocol.handle('app', async (request) => {
      const address = new URL(request.url);
      if (address.host !== 'jinkra' || request.method !== 'GET') return new Response(null, { status: 404 });
      try {
        const relative = decodeURIComponent(address.pathname.slice(1)) || 'index.html';
        const input = relative.match(/^selected\/([a-f0-9-]{36})\/(\d+)$/u);
        if (input) {
          const chosen = selections.get(input[1]);
          let file;
          if (activationState().active && inputKinds.has(chosen?.kind)) file = chosen.paths[Number(input[2])];
          if (!file || !(await stat(file)).isFile()) return new Response(null, { status: 404 });
          return await net.fetch(pathToFileURL(file).href, { bypassCustomProtocolHandlers: true });
        }
        const file = path.resolve(dist, relative);
        if (!file.startsWith(dist + path.sep)) return new Response(null, { status: 404 });
        if (relative === 'index.html') {
          const html = await readFile(file);
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        return await net.fetch(pathToFileURL(file).href, { bypassCustomProtocolHandlers: true });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    Menu.setApplicationMenu(null);
    // Explorer resolves and caches the taskbar identity when the first window appears.
    try { migrateLogin(); } catch (error) { console.warn('开机自启迁移失败', error.message); }
    const brandingReady = windowsBrand.register();
    const activationReady = loadActivation();
    setupIpc(activationReady);
    await brandingReady;
    if (!await setupWindow(await windowsBrand.icon())) return;
    tray = new Tray(icon);
    tray.setToolTip('小金工具箱');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开工具箱', click: showWindow },
      { label: '退出', click: () => app.quit() },
    ]));
    tray.on('double-click', showWindow);
    shortcutRegistered = globalShortcut.register(hotkey, showWindow);
    await activationReady;
    if (activationState().active) schedule.start();
    powerMonitor.on('resume', schedule.wake);
  }).catch((error) => {
    signalSplash();
    dialog.showErrorBox('无法启动小金工具箱', error.message);
    app.quit();
  });
}
