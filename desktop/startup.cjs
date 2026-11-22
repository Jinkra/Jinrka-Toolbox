const { app } = require('electron');
const { existsSync } = require('node:fs');
const { stat } = require('node:fs/promises');
const path = require('node:path');

const appId = 'com.jinkra.toolbox';
// Electron reports positional login arguments but omits Chromium switches.
const startupArg = 'jinkra-autostart';

function installedExecutable() {
  if (process.platform !== 'win32' || !app.isPackaged) return null;
  const executable = app.getPath('exe');
  return existsSync(path.join(path.dirname(executable), 'Uninstall Jinkra 工具箱.exe')) ? executable : null;
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

module.exports = { appId, startupArg, installedExecutable, loginStatus, setLogin };
