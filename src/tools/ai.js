import { actions, box, button, el, icon, makeStatus, task } from '../ui.js';

import { skillLibrary } from './skills.js';

const packages = [
  { key: 'codex', title: 'Codex CLI', id: 'OpenAI.Codex', description: '在终端运行 Codex。安装后打开终端输入 codex 完成登录。' },
  { key: 'claude', title: 'Claude Code CLI', id: 'Anthropic.ClaudeCode', description: '在终端运行 Claude Code。安装后打开终端输入 claude 完成登录。' },
  { key: 'ccswitch', title: 'CC Switch', id: 'farion1231.CC-Switch', description: '管理多种 AI 编程工具的服务提供商、MCP 与 Skills。' },
];

function installers() {
  const status = makeStatus();
  const installButtons = [];
  const list = packages.map((item) => {
    const install = button('一键安装', task(status, async () => {
      for (const control of installButtons) control.disabled = true;
      try {
        const result = await desktop.aiInstall(item.key);
        status.set(result.alreadyCurrent ? `${item.title} 已是最新可用版本。` : `${item.title} 安装完成。`, 'success');
      } finally {
        for (const control of installButtons) control.disabled = false;
      }
    }, `正在通过 WinGet 安装 ${item.title}…`), 'primary', 'Download');
    install.disabled = !globalThis.desktop;
    install.setAttribute('aria-label', `安装 ${item.title}`);
    installButtons.push(install);
    return el('article', { class: 'ai-install-row' },
      el('span', { class: 'tool-icon tone-ai' }, icon(item.key === 'ccswitch' ? 'Settings2' : 'Terminal', 20)),
      el('div', { class: 'skill-details' }, el('h3', {}, item.title), el('p', {}, item.description), el('code', {}, item.id)),
      actions(install, globalThis.desktop && button('安装来源', task(status, async () => {
        await desktop.aiToolDocs(item.key);
        status.set('');
      }), 'quiet', 'ExternalLink')),
    );
  });
  return box(el('p', { class: 'hint' }, '点击安装后，WinGet 会下载对应工具并接受软件包和源协议。安装需要联网。'),
    status.node, el('div', { class: 'skill-list' }, list));
}

export const aiTools = [
  { id: 'ai-skills', name: 'AI Skill 库', icon: 'Sparkles', description: '同步 GitHub Skill 目录，一键安装与卸载本地技能。', keywords: '技能 skill skills github', render: skillLibrary },
  { id: 'ai-install', name: 'AI 工具安装', icon: 'Download', description: '一键安装 Codex CLI、Claude Code CLI 和 CC Switch。', keywords: 'codex claude ccswitch cc switch winget 部署', render: installers },
];
