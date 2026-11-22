const { app } = require('electron');
const { stat } = require('node:fs/promises');
const path = require('node:path');

const appId = 'com.jinkra.toolbox';
// Electron reports positional login arguments but omits Chromium switches.
const startupArg = 'jinkra-autostart';

function portableExecutable() {
  const executable = process.env.PORTABLE_EXECUTABLE_FILE;
  return process.platform === 'win32' && executable && path.isAbsolute(executable) &&
    path.extname(executable).toLowerCase() === '.exe' ? path.normalize(executable) : null;
}

function loginStatus() {
  const target = portableExecutable();
  if (!target) return { available: false, enabled: false };
  const settings = app.getLoginItemSettings({ path: target, args: [startupArg] });
  const item = settings.launchItems.find((entry) => entry.name === appId && entry.scope === 'user');
  const enabled = item ? item.enabled && path.normalize(item.path).toLowerCase() === target.toLowerCase() &&
    item.args.includes(startupArg) : settings.openAtLogin && settings.executableWillLaunchAtLogin;
  return { available: true, enabled: Boolean(enabled) };
}

async function setLogin(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('开机自启设置无效。');
  const target = portableExecutable();
  if (!target || !(await stat(target).catch(() => null))?.isFile()) throw new Error('请从原始便携 EXE 打开工具箱。');
  app.setLoginItemSettings({ openAtLogin: enabled, enabled, name: appId, path: target, args: [startupArg] });
  const result = loginStatus();
  if (result.enabled !== enabled) throw new Error('Windows 未接受自启设置，请检查系统的启动应用设置。');
  return result;
}

module.exports = { appId, startupArg, portableExecutable, loginStatus, setLogin };
