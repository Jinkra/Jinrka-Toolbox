const { app, shell } = require('electron');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { copyFile, mkdir, readFile, readdir, writeFile } = require('node:fs/promises');
const { promisify } = require('node:util');
const path = require('node:path');
const { appId: previousId, installedExecutable } = require('./startup.cjs');

// Windows can retain an icon for a Shell ID even after its original EXE is gone.
const notificationId = 'Jinkra.Toolbox.Windows';
const shellAppId = 'Jinkra.Toolbox.Desktop';
const ownedIds = [shellAppId, notificationId, 'Jinkra.Toolbox.Portable', previousId];
const brandName = 'Jinkra-Toolbox';
const displayName = '小金工具箱';
const toastClsid = '{FDD365C6-1AC9-4DA9-8512-5E06D6789004}';
const execute = promisify(execFile);
const literal = (value) => "'" + value.replace(/'/g, "''") + "'";
const brandDirectory = () => path.join(process.env.LOCALAPPDATA || app.getPath('appData'), brandName);

function prepareWindowsBrand(icon, windowIcon) {
  app.setAppUserModelId(notificationId);
  app.setToastActivatorCLSID(toastClsid);
  let taskbarIcon;
  let registration;
  const resolveIcon = () => taskbarIcon ??= prepareTaskbarIcon(windowIcon).catch(() => windowIcon);
  const register = () => {
    registration ??= resolveIcon().then((iconPath) => registerBrand(icon, iconPath)).catch((error) => {
      console.warn('Windows 通知来源注册失败', error.message);
      registration = undefined;
      return false;
    });
    return registration;
  };
  return { icon: resolveIcon, register };
}

function readShortcut(shortcut) {
  try { return shell.readShortcutLink(shortcut); } catch { return null; }
}

async function prepareTaskbarIcon(windowIcon) {
  const target = installedExecutable();
  if (!app.isPackaged || !target) return windowIcon;
  const image = await readFile(windowIcon);
  const revision = createHash('sha256').update(image).digest('hex').slice(0, 12);
  const directory = brandDirectory();
  const icon = path.join(directory, `taskbar-${revision}.ico`);
  await mkdir(directory, { recursive: true });
  await writeFile(icon, image, { flag: 'wx' }).catch(async (error) => {
    if (error.code !== 'EEXIST' || !(await readFile(icon)).equals(image)) throw error;
  });

  // A pinned shortcut can still carry the previous version's icon resource and executable path.
  const pins = path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  const names = await readdir(pins).catch(() => []);
  for (const name of names) {
    if (path.extname(name).toLowerCase() !== '.lnk') continue;
    const shortcut = path.join(pins, name);
    const existing = readShortcut(shortcut);
    if (!existing || !ownedIds.includes(existing.appUserModelId)) continue;
    if (existing.target === target && existing.icon === icon && existing.appUserModelId === shellAppId) continue;
    try {
      shell.writeShortcutLink(shortcut, 'update', {
        target, cwd: path.dirname(target), icon, iconIndex: 0, appUserModelId: shellAppId,
      });
    } catch {}
  }
  return icon;
}

async function registerBrand(icon, taskbarIcon) {
  const target = installedExecutable();
  if (!app.isPackaged || !target) return false;

  // Windows keeps using the attribution icon after the temporary app directory is removed.
  const directory = brandDirectory();
  const iconPath = path.join(directory, 'notification.png');
  await mkdir(directory, { recursive: true });
  await copyFile(icon, iconPath);

  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${literal(path.win32.join('Software', 'Classes', 'AppUserModelId', notificationId))})
    try {
      $key.SetValue('DisplayName', ${literal(displayName)}, 'String')
      $key.SetValue('IconUri', ${literal(iconPath)}, 'String')
      $key.SetValue('CustomActivator', ${literal(toastClsid)}, 'String')
    } finally { $key.Dispose() }
    [Environment]::GetFolderPath('Programs')
  `;
  const { stdout } = await execute(powershell,
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 5000 });
  const folder = stdout.trim();
  if (!path.isAbsolute(folder)) return true;
  const shortcut = path.join(folder, brandName + '.lnk');
  const existing = readShortcut(shortcut);
  if (existing && !ownedIds.includes(existing.appUserModelId)) return true;
  if (existing?.target === target && existing.icon === taskbarIcon && existing.appUserModelId === shellAppId &&
      existing.toastActivatorClsid?.toLowerCase() === toastClsid.toLowerCase()) return true;
  await mkdir(folder, { recursive: true });
  // Also register a Start Menu entry for Windows versions that resolve desktop toast sources from shortcuts.
  shell.writeShortcutLink(shortcut, {
    target, cwd: path.dirname(target), icon: taskbarIcon, iconIndex: 0, appUserModelId: shellAppId, toastActivatorClsid: toastClsid,
    description: '打开小金工具箱',
  });
  return true;
}

module.exports = { shellAppId, brandName, prepareWindowsBrand };
