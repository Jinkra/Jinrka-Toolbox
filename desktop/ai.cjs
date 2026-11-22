const { shell } = require('electron');
const { validRepo } = require('./skills.cjs');
const { installPackage } = require('./winget.cjs');

const tools = new Map(require('./ai-tools.json').map((tool) => [tool.key, tool]));

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

function installTool(key) {
  const tool = getTool(key);
  if (!tool.id) throw new Error('请使用此工具的官方安装入口。');
  return installPackage(tool);
}

module.exports = { openRepo, openToolDocs, installTool };
