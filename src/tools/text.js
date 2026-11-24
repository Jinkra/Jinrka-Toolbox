import { actions, area, box, button, check, el, field, isPro, makeStatus, pro, proPanel, proValue, saveBlob, select, task, transformTool } from '../ui.js';

function diffTool() {
  const before = area('输入原文本…', '小金工具箱\n开发工具\n文本工具');
  const after = area('输入新文本…', '小金工具箱\n开发工具\n媒体工具\n文件工具');
  const status = makeStatus();
  const granularity = select([['lines', '行'], ['words', '词'], ['characters', '字符']]);
  const [spaceLabel, space] = check('忽略首尾空白（逐行时）');
  const [caseLabel, caseControl] = check('忽略大小写');
  const output = el('pre', { class: 'output diff-output', 'aria-live': 'polite' }, '差异会显示在这里。');
  return box(proPanel(field('对比粒度', granularity), spaceLabel, caseLabel), el('div', { class: 'editor-grid' }, field('原文本', before), field('新文本', after)),
    actions(button('对比文本', task(status, async () => {
      const { diffLines, diffWordsWithSpace, diffChars } = await import('diff');
      const diff = { lines: diffLines, words: diffWordsWithSpace, characters: diffChars }[proValue(granularity, 'lines')];
      const changes = diff(before.value, after.value, { maxEditLength: 12000, timeout: 1000,
        ignoreWhitespace: isPro() && space.checked, ignoreCase: isPro() && caseControl.checked });
      if (!changes) throw new Error('文本差异过多，请缩短输入后再试。');
      if (changes.every((part) => !part.added && !part.removed)) {
        output.textContent = '两段文本相同。';
        return;
      }
      output.replaceChildren(...changes.flatMap(({ value, added, removed }) =>
        value.replace(/\n$/u, '').split('\n').map((line) => el('span', {
          class: added ? 'added' : removed ? 'removed' : '',
        }, `${added ? '+' : removed ? '−' : ' '}  ${line}`))));
    }), 'primary')), output, status.node);
}

function markdownTool() {
  const source = area('输入 Markdown…', '# 我的工作清单\n\n- 整理工作笔记\n- 导出备份\n\n**用 Markdown 记录日常。**\n\n```js\nconst local = true;\n```');
  const status = makeStatus();
  const [gfmLabel, gfm] = check('支持表格和任务列表（GFM）', true);
  const [breaksLabel, breaks] = check('单个换行显示为换行');
  const preview = el('article', { class: 'markdown-preview' }, '预览会显示在这里。');
  const render = task(status, async () => {
    const [{ marked }, { default: purifier }] = await Promise.all([import('marked'), import('dompurify')]);
    const parsed = await marked.parse(source.value, { gfm: !isPro() || gfm.checked, breaks: isPro() && breaks.checked });
    preview.replaceChildren(purifier.sanitize(parsed, {
      RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['img', 'form', 'video', 'audio', 'style'],
      FORBID_ATTR: ['href', 'src', 'srcset', 'style', 'id', 'name'],
    }));
    status.set('');
  });
  let update;
  source.addEventListener('input', () => {
    clearTimeout(update);
    update = setTimeout(() => render(), 180);
  });
  for (const control of [gfm, breaks]) control.addEventListener('change', () => { void render(); });
  void render();
  const panel = box(proPanel(gfmLabel, breaksLabel), el('div', { class: 'editor-grid' }, field('Markdown', source), field('预览', preview)),
    pro(actions(button('保存 Markdown', task(status, () => saveBlob(new Blob([source.value], { type: 'text/markdown' }), 'jinkra-note.md', status)), 'quiet'))), status.node);
  panel.addEventListener('tool-mode-changed', () => { void render(); });
  return panel;
}

export const textTools = [
  { id: 'diff', name: '文本对比', icon: 'Files', keywords: 'diff 差异 比较', description: '逐行对比两段文本，高亮增删。', render: diffTool },
  { id: 'clean-text', name: '去空行', icon: 'AlignLeft', keywords: '去除 空白 去重 trim', description: '去除空行，可同时修剪空白或按行去重。', render: () => {
    const [trimLabel, trim] = check('去除每行首尾空白');
    const [uniqueLabel, unique] = check('移除重复行');
    const line = select([['original', '保留'], ['lf', 'LF'], ['crlf', 'CRLF']]);
    return transformTool({ sample: '第一行\n\n  第二行\n\n第一行', advanced: [trimLabel, uniqueLabel, field('输出换行符', line)], operations: [['清理文本', (source) => {
      const mode = proValue(line, 'original');
      const lineBreak = mode === 'crlf' || (mode === 'original' && source.includes('\r\n')) ? '\r\n' : '\n';
      const lines = source.split(/\r\n|\n|\r/u).filter((line) => line.trim()).map((line) => isPro() && trim.checked ? line.trim() : line);
      return (isPro() && unique.checked ? [...new Set(lines)] : lines).join(lineBreak);
    }]] });
  } },
  { id: 'chinese', name: '简繁转换', icon: 'Type', keywords: '简体 繁体 OpenCC 台湾 香港', description: '转换简体和不同地区的繁体中文。', render: () => {
    const region = select([['twp', '台湾用语'], ['tw', '台湾繁体'], ['hk', '香港繁体'], ['t', '通用繁体']]);
    return transformTool({ sample: '简体中文与繁体中文，软件和文件夹。', advanced: field('繁体地区', region), operations: [
      ['简体 → 繁体', async (source) => (await import('opencc-js')).Converter({ from: 'cn', to: proValue(region, 'twp') })(source)],
      ['繁体 → 简体', async (source) => (await import('opencc-js')).Converter({ from: proValue(region, 'twp'), to: 'cn' })(source)],
    ] });
  } },
  { id: 'markdown', name: 'Markdown 预览', icon: 'FileText', keywords: 'markdown md', description: '边写边预览标题、表格和代码块。', render: markdownTool },
  { id: 'csv', name: 'CSV ↔ JSON', icon: 'Table2', keywords: 'csv json 表格 转换', description: '在带表头的表格和 JSON 对象数组间转换。', render: () => {
    const delimiter = select([['auto', '自动识别'], [',', '逗号'], [';', '分号'], ['tab', 'Tab']]);
    const [castLabel, cast] = check('自动推断数字和布尔值');
    const [escapeLabel, escape] = check('导出时转义表格公式', true);
    function separator() {
      const value = proValue(delimiter, 'auto');
      return value === 'auto' ? '' : value === 'tab' ? '\t' : value;
    }
    return transformTool({ sample: 'name,category\nJinkra,toolbox\nJSON,developer',
      advanced: [field('列分隔符', delimiter), castLabel, escapeLabel], operations: [
      ['CSV → JSON', async (source) => {
        const { default: Papa } = await import('papaparse');
        const result = Papa.parse(source, { header: true, skipEmptyLines: 'greedy', delimiter: separator(), dynamicTyping: isPro() && cast.checked });
        if (result.errors.length) throw new Error(result.errors[0].message);
        if (result.meta.renamedHeaders && Object.keys(result.meta.renamedHeaders).length) throw new Error('CSV 表头有重复列名。');
        return JSON.stringify(result.data, null, 2);
      }],
      ['JSON → CSV', async (source) => {
        const { default: Papa } = await import('papaparse');
        const values = JSON.parse(source);
        if (!Array.isArray(values) || values.some((item) => !item || Array.isArray(item) || typeof item !== 'object')) {
          throw new Error('请提供由对象组成的 JSON 数组。');
        }
        const headers = [...new Set(values.flatMap(Object.keys))];
        const rows = values.map((item) => headers.map((header) => {
          const value = Object.hasOwn(item, header) ? item[header] : '';
          return value && typeof value === 'object' ? JSON.stringify(value) : value;
        }));
        return Papa.unparse({ fields: headers, data: rows }, { delimiter: separator() || ',', escapeFormulae: !isPro() || escape.checked });
      }],
    ] });
  } },
];
