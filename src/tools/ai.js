import { actions, box, button, copy, el, icon, makeStatus, task } from '../ui.js';
import packages from '../../desktop/ai-tools.json';
import { skillLibrary } from './skills.js';
import { aiHelpers } from './ai-helpers.js';

const groups = [
  ['desktop', '桌面应用', 'Grid2X2'],
  ['cli', 'CLI 工具', 'Terminal'],
  ['agent', 'Agent 工具', 'Sparkles'],
  ['management', '管理工具', 'Settings2'],
];

function installers() {
  const status = makeStatus();
  const installButtons = [];
  const sections = groups.map(([group, title, symbol]) => el('section', { class: 'ai-section' }, el('h2', {}, title),
    el('div', { class: 'skill-list' }, packages.filter((item) => item.group === group).map((item) => {
      const docs = button(item.id ? '安装来源' : '官方安装指南', task(status, async () => {
        if (globalThis.desktop) await desktop.aiToolDocs(item.key);
        else window.open(item.url, '_blank', 'noopener,noreferrer');
        status.set('');
      }), item.id ? 'quiet' : 'secondary', 'ExternalLink');
      const command = item.command && button('复制命令', task(status, async () => {
        await copy(item.command);
        status.set('命令已复制。', 'success');
      }), 'quiet', 'Copy');
      const install = item.id && button('一键安装', task(status, async () => {
        for (const control of installButtons) control.disabled = true;
        try {
          const result = await desktop.aiInstall(item.key);
          status.set(result.alreadyCurrent ? `${item.title} 已是最新可用版本。` : `${item.title} 安装完成。`, 'success');
        } finally {
          for (const control of installButtons) control.disabled = false;
        }
      }, `正在安装 ${item.title}…`), 'primary', 'Download');
      if (install) {
        install.disabled = !globalThis.desktop;
        install.setAttribute('aria-label', `安装 ${item.title}`);
        installButtons.push(install);
      }
      return el('article', { class: 'ai-install-row' },
        el('span', { class: 'tool-icon tone-ai' }, icon(symbol, 20)),
        el('div', { class: 'skill-details' }, el('h3', {}, item.title), el('p', {}, item.description),
          (item.command || item.id) && el('code', {}, item.command || item.id)),
        actions(install, command, docs));
    })),
  ));
  return box(el('p', { class: 'hint' }, '一键安装会联网，并通过 WinGet 或 Microsoft Store 接受软件包和源协议。'),
    status.node, sections);
}

export const aiTools = [
  { id: 'ai-skills', name: 'AI Skill 库', icon: 'Sparkles', description: '同步 GitHub Skill 目录，显示原文和中文译文，管理本地技能。', keywords: '技能 skill skills github', render: skillLibrary },
  { id: 'ai-install', name: 'AI 工具安装', icon: 'Download', description: '安装桌面应用、CLI、Agent 和管理工具。', keywords: 'codex claude ccswitch deepseek hermes openclaw opencode copilot ollama 部署', render: installers },
  ...aiHelpers,
];
