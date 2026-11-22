const { app, shell } = require('electron');
const { execFile } = require('node:child_process');
const { copyFile, mkdir } = require('node:fs/promises');
const { promisify } = require('node:util');
const path = require('node:path');
const { appId: previousId, portableExecutable } = require('./startup.cjs');

// Keep the login entry name separate. Windows has already cached the old Shell ID as Electron.
const shellAppId = 'Jinkra.Toolbox.Portable';
const brandName = 'Jinkra-Toolbox';
const toastClsid = '{FDD365C6-1AC9-4DA9-8512-5E06D6789004}';
const execute = promisify(execFile);
const literal = (value) => "'" + value.replace(/'/g, "''") + "'";

function prepareWindowsBrand(icon) {
  app.setAppUserModelId(shellAppId);
  app.setToastActivatorCLSID(toastClsid);
  let registration;
  return () => {
    registration ??= registerBrand(icon).catch((error) => {
      console.warn('Windows 通知来源注册失败', error.message);
      registration = undefined;
      return false;
    });
    return registration;
  };
}

async function registerBrand(icon) {
  const target = portableExecutable();
  if (!app.isPackaged || !target) return false;

  // Windows keeps using the attribution icon after the temporary app directory is removed.
  const directory = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), brandName);
  const iconPath = path.join(directory, 'notification.png');
  await mkdir(directory, { recursive: true });
  await copyFile(icon, iconPath);

  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${literal(path.win32.join('Software', 'Classes', 'AppUserModelId', shellAppId))})
    try {
      $key.SetValue('DisplayName', ${literal(brandName)}, 'String')
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
  let existing;
  try { existing = shell.readShortcutLink(shortcut); } catch {}
  if (existing && ![shellAppId, previousId].includes(existing.appUserModelId)) return true;
  if (existing?.target === target && existing.icon === target && existing.appUserModelId === shellAppId &&
      existing.toastActivatorClsid?.toLowerCase() === toastClsid.toLowerCase()) return true;
  await mkdir(folder, { recursive: true });
  // Also register a Start Menu entry for Windows versions that resolve desktop toast sources from shortcuts.
  shell.writeShortcutLink(shortcut, {
    target, cwd: path.dirname(target), icon: target, iconIndex: 0, appUserModelId: shellAppId, toastActivatorClsid: toastClsid,
    description: '打开 Jinkra 工具箱',
  });
  return true;
}

module.exports = { shellAppId, brandName, prepareWindowsBrand };
