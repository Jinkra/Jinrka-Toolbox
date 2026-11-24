const { app } = require('electron');
const { existsSync } = require('node:fs');
const { stat } = require('node:fs/promises');
const path = require('node:path');

const appId = 'com.jinkra.toolbox';
// Electron reports positional login arguments but omits Chromium switches.
const startupArg = 'jinkra-autostart';
const uninstallers = ['Uninstall 小金工具箱.exe', 'Uninstall Jinkra 工具箱.exe'];

function installedExecutable() {
  if (process.platform !== 'win32' || !app.isPackaged) return null;
  const executable = app.getPath('exe');
  const folder = path.dirname(executable);
  return uninstallers.some((name) => existsSync(path.join(folder, name))) ? executable : null;
}

function loginStatus() {
  const target = installedExecutable();
  if (!target) return { available: false, enabled: false };
  const settings = app.getLoginItemSettings({ path: target, args: [startupArg] });
  const item = settings.launchItems.find((entry) => entry.name === appId && entry.scope === 'user');
  const enabled = item ? item.enabled && path.normalize(item.path).toLowerCase() === target.toLowerCase() &&
    item.args.includes(startupArg) : settings.openAtLogin && settings.executableWillLaunchAtLogin;
  return { available: true, enabled: Boolean(enabled) };
}

async function setLogin(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('开机自启设置无效。');
  const target = installedExecutable();
  if (!target || !(await stat(target).catch(() => null))?.isFile()) throw new Error('请从已安装的工具箱设置开机自启。');
  app.setLoginItemSettings({ openAtLogin: enabled, enabled, name: appId, path: target, args: [startupArg] });
  const result = loginStatus();
  if (result.enabled !== enabled) throw new Error('Windows 未接受自启设置，请检查系统的启动应用设置。');
  return result;
}

// After the executable was renamed, an enabled login item still points at the old path.
function migrateLogin() {
  const target = installedExecutable();
  if (!target) return;
  const settings = app.getLoginItemSettings({ path: target, args: [startupArg] });
  const item = settings.launchItems.find((entry) => entry.name === appId && entry.scope === 'user');
  if (!item?.enabled || path.normalize(item.path).toLowerCase() === target.toLowerCase()) return;
  if (path.normalize(path.dirname(item.path)).toLowerCase() !== path.dirname(target).toLowerCase()) return;
  app.setLoginItemSettings({ openAtLogin: true, enabled: true, name: appId, path: target, args: [startupArg] });
}

module.exports = { appId, startupArg, installedExecutable, loginStatus, setLogin, migrateLogin };
