const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);
let installing = false;

async function installPackage({ id, source = 'winget', arch }) {
  if (installing) throw new Error('已有软件包正在安装。');
  if (!process.env.LOCALAPPDATA) throw new Error('找不到 WinGet。请在 Microsoft Store 中更新「应用安装程序」。');
  const executable = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'winget.exe');
  installing = true;
  try {
    await run(executable, ['install', '--id', id, '--exact', '--source', source,
      ...(arch ? ['--architecture', arch] : []), ...(source === 'winget' ? ['--silent'] : []),
      '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], { windowsHide: true });
    return { alreadyCurrent: false };
  } catch (error) {
    if (['ENOENT', 'EACCES'].includes(error.code)) throw new Error('无法启动 WinGet。请在 Microsoft Store 中更新「应用安装程序」。');
    if (typeof error.code === 'number') {
      const result = error.code >>> 0;
      if (result === 0x8a15002b) return { alreadyCurrent: true };
      throw new Error(`WinGet 安装失败（0x${result.toString(16).toUpperCase()}）。请检查网络或查看安装来源。`);
    }
    throw new Error('WinGet 安装未完成。请检查网络后重试。');
  } finally {
    installing = false;
  }
}

module.exports = { installPackage };
