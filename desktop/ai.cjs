const { shell } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');
const { validRepo } = require('./skills.cjs');

const run = promisify(execFile);
const tools = new Map(require('./ai-tools.json').map((tool) => [tool.key, tool]));

let installing = false;

function openRepo(name, folder) {
  if (!validRepo(name)) throw new Error('GitHub 仓库名称无效。');
  const parts = typeof folder === 'string' && folder ? folder.split('/') : [];
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('GitHub 文件夹路径无效。');
  const suffix = parts.length ? '/tree/HEAD/' + parts.map(encodeURIComponent).join('/') : '';
  return shell.openExternal('https://github.com/' + name + suffix);
}

function getTool(key) {
  const tool = tools.get(key);
  if (!tool) throw new Error('不支持此安装项。');
  return tool;
}

function openToolDocs(key) {
  return shell.openExternal(getTool(key).url);
}

async function installTool(key) {
  const { id, source = 'winget' } = getTool(key);
  if (!id) throw new Error('请使用此工具的官方安装入口。');
  if (installing) throw new Error('已有工具正在安装。');
  if (!process.env.LOCALAPPDATA) throw new Error('找不到 WinGet。请从 Microsoft Store 安装或更新「应用安装程序」。');
  const executable = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'winget.exe');
  installing = true;
  try {
    await run(executable, ['install', '--id', id, '--exact', '--source', source, ...(source === 'winget' ? ['--silent'] : []),
      '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], { windowsHide: true });
    return { alreadyCurrent: false };
  } catch (error) {
    if (['ENOENT', 'EACCES'].includes(error.code)) throw new Error('无法启动 WinGet。请从 Microsoft Store 安装或更新「应用安装程序」。');
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

module.exports = { openRepo, openToolDocs, installTool };
