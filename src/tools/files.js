import { actions, box, button, check, chosenFiles, copyButton, desktopOnly, el, field, fileInput, input, isPro, makeStatus, nativeFiles, note, pro, proPanel, proValue, resultText, row, saveBlob, select, task } from '../ui.js';

function zipTool() {
  if (!globalThis.desktop) return desktopOnly();
  const status = makeStatus();
  let source;
  const files = nativeFiles('any', true, status, () => { source = files; });
  const directory = nativeFiles('directory', false, status, () => { source = directory; });
  const inputType = select([['files', '多个文件'], ['directory', '一个文件夹']]);
  const compression = select([['6', '标准 · 6'], ['0', '仅打包 · 0'], ['1', '最快 · 1'], ['9', '最大压缩 · 9']]);
  const [flatLabel, flatten] = check('把文件放在同一层级');
  directory.node.hidden = true;
  inputType.addEventListener('change', () => {
    const isFolder = inputType.value === 'directory';
    files.node.hidden = isFolder;
    directory.node.hidden = !isFolder;
    source = isFolder ? directory : files;
  });
  const archive = nativeFiles('zip', false, status);
  return box(el('div', { class: 'editor-grid' },
    el('section', { class: 'tool-column' }, el('h3', {}, '创建 ZIP'), field('打包内容', inputType), files.node, directory.node, pro(field('压缩等级', compression)),
      button('保存 ZIP…', task(status, async () => {
        const output = await desktop.zipCreate((source ?? files).id, Number(proValue(compression, '6')));
        status.set(output ? `已保存到 ${output}` : '', 'success');
      }), 'primary', 'Archive')),
    el('section', { class: 'tool-column' }, el('h3', {}, '解压 ZIP'), archive.node,
      note('解压时会在目标位置新建目录。'), pro(flatLabel),
      button('解压到…', task(status, async () => {
        const output = await desktop.zipExtract(archive.id, isPro() && flatten.checked);
        status.set(output ? `已解压到 ${output}` : '', 'success');
      }), 'primary', 'Archive'))), status.node);
}

function fileHashTool() {
  if (!globalThis.desktop) return desktopOnly();
  const status = makeStatus();
  const output = resultText();
  let value = '';
  const files = nativeFiles('any', true, status, () => { output.textContent = ''; value = ''; });
  const algorithm = select([['sha256', 'SHA-256'], ['sha512', 'SHA-512'], ['sha384', 'SHA-384'], ['sha1', 'SHA-1'], ['md5', 'MD5']]);
  const format = select([['hex', '小写十六进制'], ['upper', '大写十六进制'], ['base64', 'Base64']]);
  const expected = input({ placeholder: '可选。粘贴要核对的十六进制摘要。', spellcheck: 'false' });
  return box(files.node, row(field('预期摘要', expected)), proPanel(field('哈希算法', algorithm), field('摘要输出格式', format)),
    actions(button('计算 / 校验', task(status, async () => {
      value = '';
      output.textContent = '';
      const selected = proValue(algorithm, 'sha256');
      const encoding = proValue(format, 'hex');
      const target = expected.value.trim().toLowerCase();
      const lengths = { md5: 32, sha1: 40, sha256: 64, sha384: 96, sha512: 128 };
      if (target && (!/^[0-9a-f]+$/u.test(target) || target.length !== lengths[selected])) {
        throw new Error('预期摘要的格式或长度和所选算法不匹配。');
      }
      const results = await desktop.fileHash(files.id, selected);
      value = results.map(({ name, hash }) => {
        const formatted = encoding === 'base64' ? btoa(String.fromCharCode(...hash.match(/../gu).map((part) => parseInt(part, 16))))
          : encoding === 'upper' ? hash.toUpperCase() : hash;
        return `${formatted}  ${name}${target ? (hash === target ? '  ✓ 匹配' : '  × 不匹配') : ''}`;
      }).join('\n');
      output.textContent = value;
    }), 'primary'), copyButton(() => value, status)), output, status.node);
}

function renameTool() {
  if (!globalThis.desktop) return desktopOnly();
  const status = makeStatus();
  const prefix = input({ placeholder: '例如：旅行-' });
  const suffix = input({ placeholder: '例如：-备份' });
  const find = input({ placeholder: '文件名中要查找的文字' });
  const replace = input({ placeholder: '留空则删除匹配的文字' });
  const [numberedLabel, numbered] = check('添加序号');
  const start = input({ type: 'number', min: 0, max: 999999999, value: 1, disabled: true });
  const digits = input({ type: 'number', min: 1, max: 10, value: 2 });
  const separator = input({ value: '-', maxlength: 12 });
  const casing = select([['keep', '保持'], ['lower', '小写'], ['upper', '大写']]);
  const preview = el('div', { class: 'rename-preview' });
  let approved;
  const files = nativeFiles('any', true, status, invalidate);
  const apply = button('应用重命名', task(status, async () => {
    const count = await desktop.renameApply(approved.id, approved.rules);
    files.clear();
    status.set(`已重命名 ${count} 个文件。`, 'success');
  }), 'primary');
  apply.disabled = true;

  function invalidate() {
    approved = null;
    apply.disabled = true;
    preview.replaceChildren();
  }
  for (const control of [prefix, suffix, find, replace, numbered, start, digits, casing, separator]) {
    control.addEventListener('input', invalidate);
  }
  numbered.addEventListener('change', () => { start.disabled = !numbered.checked; });

  const plan = button('预览改名', task(status, async () => {
    invalidate();
    const id = files.id;
    if (isPro() && numbered.checked && !start.value) throw new Error('请输入起始序号。');
    const rules = { prefix: prefix.value, suffix: suffix.value, find: proValue(find, ''), replace: proValue(replace, ''),
      numbered: numbered.checked, start: Number(proValue(start, '1')), digits: Number(proValue(digits, '2')),
      casing: proValue(casing, 'keep'), separator: proValue(separator, '-') };
    const results = await desktop.renamePlan(id, rules);
    const changed = results.some((item) => item.changed);
    preview.replaceChildren(el('table', {},
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '原文件名'), el('th', { scope: 'col' }, '新文件名'))),
      el('tbody', {}, results.map((item) => el('tr', {}, el('td', {}, item.before), el('td', {}, item.after))))));
    approved = { id, rules };
    apply.disabled = !changed;
    status.set(changed ? '请确认预览后应用重命名。' : '当前规则未改变文件名。');
  }));

  const panel = box(files.node, row(field('前缀', prefix), field('后缀', suffix), numberedLabel),
    proPanel(field('查找文字', find), field('替换为', replace), field('起始序号', start),
      field('序号位数', digits), field('序号分隔符', separator), field('文件名大小写', casing)), note('规则只作用于文件名，保留扩展名。'),
    actions(plan, apply), status.node, preview);
  panel.addEventListener('tool-mode-changed', invalidate);
  return panel;
}

function pdfTool() {
  const files = fileInput('pdf', true);
  const mode = select([['merge', '合并 PDF'], ['split', '拆分 PDF'], ['render', 'PDF 转图片']]);
  const pages = input({ placeholder: '例如 1-3,5，留空处理全部页' });
  const scale = select([['1', '1×（72 DPI）'], ['2', '2×（144 DPI）'], ['3', '3×（216 DPI）']]);
  scale.value = '2';
  const scaleField = field('渲染分辨率', scale);
  const imageFormat = select([['png', 'PNG'], ['jpg', 'JPEG']]);
  const [reverseLabel, reverse] = check('反转文件顺序');
  const imageField = field('输出图片格式', imageFormat);
  const advanced = proPanel(scaleField, imageField, reverseLabel);
  const pagesField = field('页码范围', pages);
  const status = makeStatus();
  let exportFile;
  const save = button('保存结果', task(status, () => saveBlob(exportFile.blob, exportFile.name, status)));
  save.hidden = true;

  function invalidate() {
    exportFile = null;
    save.hidden = true;
    status.set();
  }
  function refresh() {
    files.configure('pdf', mode.value === 'merge');
    files.clear();
    scaleField.hidden = mode.value !== 'render';
    imageField.hidden = mode.value !== 'render';
    reverseLabel.hidden = mode.value !== 'merge';
    advanced.hidden = mode.value === 'split';
    pagesField.hidden = mode.value === 'merge';
    invalidate();
  }
  refresh();
  mode.addEventListener('change', refresh);
  files.node.addEventListener('change', invalidate);
  pages.addEventListener('input', invalidate);
  scale.addEventListener('change', invalidate);
  return box(row(field('操作', mode), field('选择 PDF', files.node), pagesField), advanced,
    note('合并按所选文件顺序进行。拆分时每个页码范围生成一个 PDF，结果打包为 ZIP。'),
    actions(button('处理 PDF', task(status, async () => {
      exportFile = null;
      save.hidden = true;
      const picked = await chosenFiles(files);
      const [file] = picked;
      const pdf = await import('./pdf.js');
      if (mode.value === 'merge') {
        if (picked.length < 2) throw new Error('请至少选择两个 PDF。');
        exportFile = { blob: await pdf.mergePdf(isPro() && reverse.checked ? [...picked].reverse() : picked), name: '合并结果.pdf' };
      } else if (mode.value === 'split') {
        exportFile = { blob: await pdf.splitPdf(file, pages.value), name: '拆分结果.zip' };
      } else {
        exportFile = await pdf.renderPdf(file, pages.value, Number(proValue(scale, '2')), proValue(imageFormat, 'png'));
      }
      save.hidden = false;
    }), 'primary'), save), status.node);
}

export const fileTools = [
  { id: 'zip', name: 'ZIP 压缩解压', icon: 'Archive', keywords: 'zip 归档 打包', description: '打包文件或文件夹，或把 ZIP 解压到新目录。', render: zipTool },
  { id: 'file-hash', name: '文件哈希校验', icon: 'FileCheck', keywords: 'sha256 sha512 md5 checksum 哈希', description: '批量计算文件摘要并核对预期值。', render: fileHashTool },
  { id: 'rename', name: '批量重命名', icon: 'FilePenLine', keywords: '文件 重命名 rename 前缀 后缀', description: '批量添加前后缀、替换文字或顺序编号。', render: renameTool },
  { id: 'pdf', name: 'PDF 工具箱', icon: 'Files', keywords: 'pdf 合并 拆分 分页 png 转图片', description: '合并、拆分 PDF，或把指定页面转成 PNG。', render: pdfTool },
];
