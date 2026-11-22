import { actions, area, box, button, copyButton, el, field, input, makeStatus, resultText, select, task } from '../ui.js';

const templatesKey = 'jinkra.prompt-templates';
const variablePattern = /\{\{\s*([\p{L}\p{N}_-]+)\s*\}\}/gu;

function promptTool() {
  const status = makeStatus();
  const name = input({ placeholder: '例如：文章摘要', maxlength: 80 });
  const source = area('例如：请将 {{文档}} 总结为 {{字数}} 字，并列出主要结论。');
  source.maxLength = 20_000;
  const output = resultText();
  const library = select([]);
  const variables = el('div', { class: 'fields' });
  const values = new Map();
  let result = '';
  let templates = [];
  try {
    const list = JSON.parse(localStorage.getItem(templatesKey) || '[]');
    if (Array.isArray(list)) templates = list.filter((item) =>
      typeof item?.name === 'string' && typeof item?.content === 'string').slice(0, 50);
  } catch {}

  function choices(title = '') {
    library.replaceChildren(el('option', { value: '' }, '选择已保存模板'),
      ...templates.map((item) => el('option', { value: item.name }, item.name)));
    library.value = title;
  }

  function drawVariables() {
    const keys = [...new Set(Array.from(source.value.matchAll(variablePattern), (match) => match[1]))];
    variables.replaceChildren(...keys.map((key) => {
      const control = input({ value: values.get(key) || '' });
      control.addEventListener('input', () => values.set(key, control.value));
      return field(key, control);
    }));
  }

  function persist(next) {
    localStorage.setItem(templatesKey, JSON.stringify(next));
    templates = next;
  }

  source.addEventListener('input', drawVariables);
  library.addEventListener('change', () => {
    const chosen = templates.find((item) => item.name === library.value);
    if (!chosen) return;
    name.value = chosen.name;
    source.value = chosen.content;
    values.clear();
    drawVariables();
    status.set('');
  });

  const save = button('保存模板', task(status, async () => {
    const title = name.value.trim();
    if (!title || !source.value.trim()) throw new Error('请填写模板名称和内容。');
    const list = templates.filter((item) => item.name !== title);
    if (list.length >= 50) throw new Error('已保存 50 个模板，请先移除一个。');
    persist([{ name: title, content: source.value }, ...list]);
    choices(title);
    status.set('模板已保存在本机。', 'success');
  }), 'secondary');
  const remove = button('移除模板', task(status, async () => {
    if (!library.value) throw new Error('请选择要移除的已保存模板。');
    persist(templates.filter((item) => item.name !== library.value));
    choices();
    status.set('已移除模板。', 'success');
  }), 'quiet');
  const generate = button('生成提示词', task(status, async () => {
    if (!source.value.trim()) throw new Error('请填写提示词模板。');
    result = source.value.replace(variablePattern, (match, key) => values.get(key) ?? match);
    output.textContent = result;
    status.set('已生成提示词。', 'success');
  }), 'primary', 'FileText');
  choices();
  return box(field('本地模板库', library), field('模板名称', name), field('提示词模板', source, '用 {{变量名}} 创建可填写字段。'),
    variables, actions(generate, save, remove, copyButton(() => result, status)), status.node, output);
}

function contextTool() {
  const status = makeStatus();
  const formats = '.txt,.md,.json,.yaml,.yml,.csv,.log,.js,.ts,.jsx,.tsx,.py,.html,.css,.xml,.toml,.sql,.cs,.java,.go,.rs,.cpp,.h';
  const files = input({ type: 'file', multiple: true, accept: formats });
  const taskText = area('可选。写下你想让 AI 完成的任务。');
  taskText.maxLength = 10_000;
  const output = resultText();
  let result = '';
  const build = button('打包上下文', task(status, async () => {
    const chosen = Array.from(files.files);
    if (!chosen.length && !taskText.value.trim()) throw new Error('请选择文本文件或填写任务说明。');
    if (chosen.length > 24 || chosen.some((file) => file.size > 1024 * 1024) ||
        chosen.reduce((sum, file) => sum + file.size, 0) > 4 * 1024 * 1024) {
      throw new Error('最多选择 24 个文件，每个不超过 1 MiB，合计不超过 4 MiB。');
    }
    const parts = [];
    for (const file of chosen) {
      const buffer = await file.arrayBuffer();
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch {}
      if (text === undefined || text.includes('\0')) throw new Error(`${file.name} 可能是二进制或非 UTF-8 文件，请使用 UTF-8 文本。`);
      const name = file.name.replace(/[\r\n]/g, ' ');
      parts.push(`===== ${name} =====\n${text}`);
    }
    result = [taskText.value.trim(), ...parts].filter(Boolean).join('\n\n');
    output.textContent = result;
    status.set(`已打包 ${chosen.length} 个文件，共 ${result.length} 字符。`, 'success');
  }, '正在读取所选文件…'), 'primary', 'Layers3');
  return box(field('文本与代码文件', files), field('任务说明', taskText),
    actions(build, copyButton(() => result, status)), status.node, output);
}

function apiTool() {
  if (!globalThis.desktop) return box(el('p', { class: 'hint' }, '请在 Windows 安装版中使用 API 测试。'));
  const status = makeStatus();
  const address = input({ type: 'url', placeholder: 'https://example.com/v1 或 http://127.0.0.1:11434/v1', maxlength: 1500 });
  const key = input({ type: 'password', maxlength: 4096, autocomplete: 'off', placeholder: '本地服务可留空' });
  const output = resultText();
  const test = button('测试连接', task(status, async () => {
    const { status: http, latency, endpoint, compatible, models } = await desktop.aiCheckConnection(address.value, key.value);
    output.textContent = [`地址 ${endpoint}`, `HTTP ${http} · ${latency} ms`,
      compatible ? `返回 ${models.length} 个模型` : '未返回兼容的模型列表。', ...models].join('\n');
    status.set(compatible ? 'API 可访问。' : http === 401 || http === 403 ? '服务拒绝访问，请核对密钥或权限。' : '服务已响应，但模型接口未通过。',
      compatible ? 'success' : 'error');
  }, '正在请求模型列表…'), 'primary', 'Link2');
  return box(field('OpenAI 兼容 API 地址', address), field('API 密钥', key, '只用于这次请求，不写入配置。'),
    actions(test), status.node, output);
}

export const aiHelpers = [
  { id: 'prompt-template', name: '提示词模板', icon: 'FileText', description: '保存常用提示词模板，填写变量后生成并复制。', keywords: 'AI Prompt 提示词 变量', render: promptTool },
  { id: 'context-pack', name: 'AI 上下文打包', icon: 'Layers3', description: '把选中的文本、代码和任务说明整理成可复制的上下文。', keywords: 'AI 批量 合并 上下文 代码 文件', render: contextTool },
  { id: 'api-connection', name: 'API 连通性测试', icon: 'Link2', description: '测试 OpenAI 兼容接口，查看响应时间和可用模型。', keywords: 'AI API Ollama OpenAI 模型 服务 连通性', render: apiTool },
];
