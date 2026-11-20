import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import { canvasAt, canvasBlob } from './media.js';
import { mediaTool } from './media-engine.js';
import {
  actions, area, box, button, check, chosenFiles, copyButton, desktopOnly, el, field, fileInput,
  input, isPro, makeStatus, nativeFiles, note, outputTool, pro, proPanel, proValue, readableSize,
  resultText, row, saveBlob, select, task, transformTool,
} from '../ui.js';

function urlParameters() {
  const [sortLabel, sort] = check('按参数名排序');
  const [emptyLabel, empty] = check('跳过空值');
  return transformTool({ sample: 'https://example.com/?tag=blue&tag=white&name=Jinkra', advanced: [sortLabel, emptyLabel],
    operations: [['拆解参数', (value) => {
      const source = value.trim();
      const query = source.includes('?') ? source.slice(source.indexOf('?') + 1).split('#', 1)[0] : source;
      const params = new URLSearchParams(query);
      if (isPro() && sort.checked) params.sort();
      return Array.from(params).filter(([, item]) => !isPro() || !empty.checked || item !== '').map(([key, item]) => `${key} = ${item}`).join('\n');
    }], ['构建参数', (value) => {
      const params = new URLSearchParams();
      for (const line of value.split(/\r?\n/u).filter((item) => item.trim())) {
        const index = line.indexOf('=');
        if (index < 1) throw new Error('每行请输入参数名和值，例如 name = Jinkra。');
        const item = line.slice(index + 1).trim();
        if (!isPro() || !empty.checked || item !== '') params.append(line.slice(0, index).trim(), item);
      }
      if (isPro() && sort.checked) params.sort();
      return params.toString();
    }]] });
}

function unicode() {
  const method = select([['point', 'Unicode 码位 · U+'], ['bytes', 'UTF-8 十六进制字节']]);
  const [lowerLabel, lower] = check('使用小写十六进制');
  return transformTool({ sample: '你好，Jinkra ✨', advanced: [field('编码方式', method), lowerLabel], operations: [['编码', (value) => {
    const hex = (number, digits) => {
      const part = number.toString(16).padStart(digits, '0');
      return isPro() && lower.checked ? part : part.toUpperCase();
    };
    return proValue(method, 'point') === 'bytes'
      ? Array.from(new TextEncoder().encode(value), (byte) => hex(byte, 2)).join(' ')
      : Array.from(value, (part) => `U+${hex(part.codePointAt(0), 4)}`).join(' ');
  }], ['解码', (value) => {
    const items = value.trim().split(/\s+/u);
    if (proValue(method, 'point') === 'bytes') {
      if (items.some((item) => !/^[\da-f]{2}$/iu.test(item))) throw new Error('请输入用空格分隔的两位十六进制字节。');
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(items, (item) => parseInt(item, 16)));
    }
    return items.map((item) => {
      if (!/^U\+[\da-f]{1,6}$/iu.test(item)) throw new Error('请输入用空格分隔的码位，例如 U+0041。');
      const point = parseInt(item.slice(2), 16);
      if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error('包含无效的 Unicode 码位。');
      return String.fromCodePoint(point);
    }).join('');
  }]] });
}

function jsonExtract() {
  const pointer = input({ value: '/items/0/name' });
  const output = select([['raw', 'JSON 原始值'], ['text', '展开字符串内容']]);
  return transformTool({ sample: '{"items":[{"name":"Jinkra","enabled":true}]}', fields: field('路径', pointer, '使用 JSON Pointer，例如 /items/0/name。'),
    advanced: field('输出方式', output), operations: [['提取值', (text) => {
      JSON.parse(text);
      const query = pointer.value;
      if (query && (!query.startsWith('/') || /~(?![01])/u.test(query))) throw new Error('请输入有效的 JSON Pointer。');
      let node = parseTree(text);
      for (const segment of query ? query.slice(1).split('/') : []) {
        const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
        node = node && findNodeAtLocation(node, [node.type === 'array' && /^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : key]);
      }
      if (!node) throw new Error('路径中没有对应的值。');
      return proValue(output, 'raw') === 'text' && node.type === 'string' ? node.value : text.slice(node.offset, node.offset + node.length);
    }]] });
}

function textStats() {
  const language = select([['zh', '中文'], ['en', '英语'], ['ja', '日语'], ['th', '泰语']]);
  const [detailedLabel, detailed] = check('按字形、空白和标点分类', true);
  return transformTool({ sample: '今天使用 Jinkra 整理笔记。\nEverything stays local.', advanced: [field('分词语言', language), detailedLabel],
    operations: [['统计', (value) => {
      const words = Array.from(new Intl.Segmenter(proValue(language, 'zh'), { granularity: 'word' }).segment(value)).filter((part) => part.isWordLike).length;
      const points = Array.from(value).length;
      const lines = value ? value.split(/\r\n|\r|\n/u).length : 0;
      const result = [`字词  ${words}`, `字符  ${points}`, `行数  ${lines}`, `UTF-8  ${new TextEncoder().encode(value).length} 字节`];
      if (isPro() && detailed.checked) {
        result.push(`字形  ${Array.from(new Intl.Segmenter(proValue(language, 'zh'), { granularity: 'grapheme' }).segment(value)).length}`,
          `空白  ${(value.match(/\s/gu) ?? []).length}`, `标点  ${(value.match(/\p{P}/gu) ?? []).length}`);
      }
      return result.join('\n');
    }]] });
}

function textReplace() {
  const find = input({ value: '旧' });
  const replace = input({ value: '新' });
  const count = select([['all', '全部匹配'], ['one', '仅首个匹配']]);
  const [caseLabel, ignore] = check('忽略大小写');
  const [wordLabel, whole] = check('匹配完整单词');
  return transformTool({ sample: '旧计划，旧清单。', fields: [field('查找', find), field('替换为', replace)],
    advanced: [field('替换范围', count), caseLabel, wordLabel], operations: [['查找并替换', (value) => {
      if (!find.value) throw new Error('请输入要查找的文字。');
      const literal = RegExp.escape(find.value);
      const pattern = isPro() && whole.checked ? `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])` : literal;
      const flags = 'u' + (isPro() && ignore.checked ? 'i' : '') + (proValue(count, 'all') === 'all' ? 'g' : '');
      return value.replace(new RegExp(pattern, flags), () => replace.value);
    }]] });
}

function lineSort() {
  const direction = select([['up', '升序'], ['down', '降序']]);
  const locale = select([['zh', '中文'], ['en', '英语']]);
  const [numericLabel, numeric] = check('识别行中的数字', true);
  const [uniqueLabel, unique] = check('移除重复行');
  return transformTool({ sample: '10. 文档\n2. 兑换\n1. 图片', fields: field('排序方向', direction),
    advanced: [field('排序语言', locale), numericLabel, uniqueLabel], operations: [['排序', (value) => {
      const lines = value.split(/\r\n|\r|\n/u).filter((line) => line.trim());
      const collator = new Intl.Collator(proValue(locale, 'zh'), { numeric: !isPro() || numeric.checked });
      return (isPro() && unique.checked ? [...new Set(lines)] : lines)
        .sort((a, b) => collator.compare(a, b) * (direction.value === 'up' ? 1 : -1)).join('\n');
    }]] });
}

function imageInfo() {
  const files = fileInput('image');
  const include = select([['summary', '尺寸与色彩'], ['meta', '同时读取 EXIF']]);
  const status = makeStatus();
  const result = resultText();
  return box(field('选择图片', files.node), proPanel(field('报告内容', include)), actions(button('读取图片信息', task(status, async () => {
    const [file] = await chosenFiles(files);
    const bitmap = await createImageBitmap(file);
    try {
      const resultText = [file.name, `尺寸  ${bitmap.width} × ${bitmap.height}`, `体积  ${readableSize(file.size)}`, `类型  ${file.type || '未知'}`];
      if (isPro()) resultText.push(`宽高比  ${(bitmap.width / bitmap.height).toFixed(4)}`, `像素数  ${bitmap.width * bitmap.height}`);
      if (proValue(include, 'summary') === 'meta') {
        const { default: exifr } = await import('exifr');
        const exif = await exifr.parse(file, { tiff: true, exif: true, gps: false }).catch(() => null);
        resultText.push(exif ? JSON.stringify(exif, null, 2) : '未发现 EXIF 数据。');
      }
      result.textContent = resultText.join('\n');
    } finally {
      bitmap.close();
    }
  }), 'primary')), result, status.node);
}

function contrast() {
  const foreground = input({ type: 'color', value: '#1a3455' });
  const background = input({ type: 'color', value: '#f5f7fc' });
  const target = select([['normal', '普通文本'], ['large', '大号文本与图标']]);
  const digits = select(['2', '3', '4']);
  const luminance = (value) => {
    const [r, g, b] = value.slice(1).match(/../gu).map((part) => {
      const s = parseInt(part, 16) / 255;
      return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    });
    return .2126 * r + .7152 * g + .0722 * b;
  };
  return outputTool([field('前景颜色', foreground), field('背景颜色', background)], '计算对比度', () => {
    const first = luminance(foreground.value);
    const second = luminance(background.value);
    const ratio = (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
    const result = [`对比度  ${ratio.toFixed(Number(proValue(digits, '2')))} : 1`];
    if (proValue(target, 'normal') === 'large') result.push(`大号文字 AA  ${ratio >= 3 ? '通过' : '未通过'}`, `大号文字 AAA  ${ratio >= 4.5 ? '通过' : '未通过'}`);
    else result.push(`普通文字 AA  ${ratio >= 4.5 ? '通过' : '未通过'}`, `普通文字 AAA  ${ratio >= 7 ? '通过' : '未通过'}`);
    return result.join('\n');
  }, [field('评估对象', target), field('结果小数位', digits)]);
}

function fileInfo() {
  if (!globalThis.desktop) return desktopOnly();
  const status = makeStatus();
  const files = nativeFiles('any', true, status);
  const sort = select([['selected', '选择顺序'], ['name', '文件名'], ['size', '从大到小']]);
  const [pathLabel, showPath] = check('包括完整路径');
  const result = resultText();
  let value = '';
  return box(files.node, proPanel(field('排序', sort), pathLabel), actions(button('读取文件信息', task(status, async () => {
    const entries = await desktop.fileInfo(files.id);
    if (proValue(sort, 'selected') === 'name') entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (proValue(sort, 'selected') === 'size') entries.sort((a, b) => b.bytes - a.bytes);
    value = entries.map((entry) => [
      entry.name, `大小  ${readableSize(entry.bytes)}`, `修改  ${new Date(entry.modified).toLocaleString()}`,
      ...(isPro() ? [`创建  ${new Date(entry.created).toLocaleString()}`, `字节  ${entry.bytes}`] : []),
      ...(isPro() && showPath.checked ? [entry.path] : []),
    ].join('\n')).join('\n\n');
    result.textContent = value;
  }), 'primary'), copyButton(() => value, status)), result, status.node);
}

function pdfOrganize() {
  const files = fileInput('pdf');
  const pages = input({ placeholder: '例如 3,1-2（依此顺序输出）' });
  const rotate = select([['0', '保留原角度'], ['90', '顺时针 90°'], ['180', '180°'], ['270', '逆时针 90°']]);
  const [reverseLabel, reverse] = check('反转所选页面顺序');
  const status = makeStatus();
  return box(row(field('选择 PDF', files.node), field('页面与顺序', pages, '留空保留所有页面。重复页码会重复输出。')),
    proPanel(field('所有输出页额外旋转', rotate), reverseLabel),
    actions(button('导出整理后的 PDF', task(status, async () => {
      const [file] = await chosenFiles(files);
      const { organizePdf } = await import('./pdf.js');
      const blob = await organizePdf(file, pages.value, Number(proValue(rotate, '0')), isPro() && reverse.checked);
      await saveBlob(blob, '整理结果.pdf', status);
    }), 'primary')), status.node);
}

function imagePdf() {
  const files = fileInput('image', true);
  const paper = select([['auto', '随图片尺寸'], ['a4', 'A4'], ['letter', 'Letter']]);
  const layout = select([['portrait', '纵向'], ['landscape', '横向']]);
  const margin = input({ type: 'number', min: 0, max: 90, value: 15 });
  const status = makeStatus();
  return box(field('选择图片', files.node, '每张图生成一页，按文件选择顺序输出。'),
    proPanel(field('纸张尺寸', paper), field('纸张方向', layout), field('留白（点）', margin)),
    actions(button('生成并保存 PDF', task(status, async () => {
      if (isPro() && (!margin.value || !margin.checkValidity())) throw new Error('留白须为 0–90 之间的整数。');
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      for (const file of await chosenFiles(files)) {
        const bitmap = await createImageBitmap(file);
        try {
          const canvas = canvasAt(bitmap.width, bitmap.height);
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          const image = await pdf.embedPng(await (await canvasBlob(canvas)).arrayBuffer());
          const size = proValue(paper, 'auto');
          const padding = size === 'auto' ? 0 : Number(margin.value);
          const dimensions = size === 'auto' ? [image.width, image.height] : size === 'a4' ? [595.28, 841.89] : [612, 792];
          if (size !== 'auto' && layout.value === 'landscape') dimensions.reverse();
          const [width, height] = dimensions;
          const page = pdf.addPage(dimensions);
          const scale = Math.min((width - padding * 2) / image.width, (height - padding * 2) / image.height);
          const w = image.width * scale;
          const h = image.height * scale;
          page.drawImage(image, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h });
        } finally {
          bitmap.close();
        }
      }
      await saveBlob(new Blob([await pdf.save()], { type: 'application/pdf' }), '图片合并.pdf', status);
    }), 'primary')), status.node);
}

const unitGroups = {
  length: { mm: .001, cm: .01, m: 1, km: 1000, in: .0254, ft: .3048, mi: 1609.344 },
  weight: { mg: .000001, g: .001, kg: 1, t: 1000, oz: .028349523125, lb: .45359237 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, mph: .44704, kn: 1852 / 3600 },
  area: { 'cm²': .0001, 'm²': 1, 'km²': 1e6, ha: 1e4, 'ft²': .09290304 },
  volume: { mL: .001, L: 1, 'm³': 1000, '美制加仑': 3.785411784 },
  temperature: { '°C': 1, '°F': 1, K: 1 },
};

function unitConversion() {
  const category = select([['length', '长度'], ['weight', '质量'], ['temperature', '温度'], ['speed', '速度'], ['area', '面积'], ['volume', '容量']]);
  const source = select([]);
  const target = select([]);
  const value = input({ type: 'number', value: 1, step: 'any' });
  const precision = select(['6', '2', '4', '8', '12']);
  const [allLabel, all] = check('显示同类所有单位');
  function update() {
    const units = Object.keys(unitGroups[category.value]);
    for (const list of [source, target]) list.replaceChildren(...units.map((item) => el('option', { value: item }, item)));
    target.selectedIndex = units.length - 1;
  }
  category.addEventListener('change', update);
  update();
  return outputTool([field('类别', category), field('数值', value), field('从', source), field('到', target)], '换算', () => {
    const amount = Number(value.value);
    if (!value.value || !Number.isFinite(amount)) throw new Error('请输入有限数值。');
    const units = unitGroups[category.value];
    const places = new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: Number(proValue(precision, '6')) });
    const celsius = source.value === 'K' ? amount - 273.15 : source.value === '°F' ? (amount - 32) * 5 / 9 : amount;
    const convert = (unit) => category.value === 'temperature'
      ? { '°C': celsius, '°F': celsius * 9 / 5 + 32, K: celsius + 273.15 }[unit]
      : amount * units[source.value] / units[unit];
    return (isPro() && all.checked ? Object.keys(units) : [target.value]).map((unit) => `${places.format(convert(unit))} ${unit}`).join('\n');
  }, [field('结果有效位', precision), allLabel]);
}

function dateMath() {
  const start = input({ type: 'date', value: '2026-01-01' });
  const end = input({ type: 'date', value: '2026-02-01' });
  const offset = input({ type: 'number', step: 1, min: -100000, max: 100000, value: 0 });
  const [inclusiveLabel, inclusive] = check('天数包含起止两天');
  const day = 86_400_000;
  return outputTool([field('起始日期', start), field('结束日期', end)], '计算日期', () => {
    if (!start.value || !end.value) throw new Error('请选择起始和结束日期。');
    const duration = (end.valueAsNumber - start.valueAsNumber) / day;
    const days = isPro() && inclusive.checked ? Math.sign(duration || 1) * (Math.abs(duration) + 1) : duration;
    const result = [`${days} 天`, `${(days / 7).toFixed(2)} 周`];
    if (isPro()) {
      if (!offset.value || !offset.checkValidity()) throw new Error('请输入有效的偏移天数。');
      result.push(`起始日期偏移后  ${new Date(start.valueAsNumber + Number(offset.value) * day).toISOString().split('T')[0]}`);
    }
    return result.join('\n');
  }, [inclusiveLabel, field('起始日期偏移（天）', offset)]);
}

function percent() {
  const style = select([['part', '计算百分比'], ['increase', '涨跌幅'], ['ratio', '按百分比折算']]);
  const first = input({ type: 'number', step: 'any', value: 20 });
  const second = input({ type: 'number', step: 'any', value: 80 });
  const precision = select(['2', '0', '4', '6']);
  const controls = [field('第一个数', first), field('第二个数', second)];
  return outputTool([field('计算方式', style), controls], '计算', () => {
    const a = Number(first.value);
    const b = Number(second.value);
    if (!first.value || !second.value || !Number.isFinite(a) || !Number.isFinite(b)) throw new Error('请输入两个数字。');
    const type = style.value;
    if (type === 'part' && !b || type === 'increase' && !a) throw new Error('作为基准的数字不能为零。');
    const result = type === 'part' ? 100 * a / b : type === 'increase' ? 100 * (b - a) / Math.abs(a) : a * b / 100;
    return result.toFixed(Number(proValue(precision, '2'))) + (type === 'ratio' ? '' : '%');
  }, field('结果小数位', precision));
}

const watch = { start: null, elapsed: 0, laps: [] };
function stopwatch() {
  const display = el('p', { class: 'countdown' });
  const laps = el('pre', { class: 'output pro-only', 'aria-live': 'polite' }, '尚无计次。');
  const precision = select([['hundredth', '百分之一秒'], ['millisecond', '毫秒']]);
  const [splitLabel, split] = check('同时显示每段用时', true);
  let frame;
  const duration = () => watch.elapsed + (watch.start == null ? 0 : performance.now() - watch.start);
  function format(time) {
    const minutes = String(Math.floor(time / 60000)).padStart(2, '0');
    const seconds = String(Math.floor(time / 1000) % 60).padStart(2, '0');
    const fraction = String(Math.floor(time) % 1000).padStart(3, '0');
    return `${minutes}:${seconds}.${proValue(precision, 'hundredth') === 'millisecond' ? fraction : fraction.slice(0, 2)}`;
  }
  function render() {
    display.textContent = format(duration());
    toggle.textContent = watch.start == null ? '开始' : '暂停';
    lap.disabled = watch.start == null;
  }
  function tick() {
    render();
    if (watch.start != null && panel.isConnected) frame = requestAnimationFrame(tick);
  }
  function updateLaps() {
    laps.textContent = watch.laps.map((time, index) => `${index + 1}    ${format(time)}${split.checked ? `    +${format(time - (watch.laps[index - 1] ?? 0))}` : ''}`).join('\n') || '尚无计次。';
  }
  const toggle = button('开始', () => {
    if (watch.start == null) watch.start = performance.now();
    else { watch.elapsed = duration(); watch.start = null; }
    cancelAnimationFrame(frame);
    tick();
  }, 'primary');
  const lap = pro(button('记录计次', () => { watch.laps.push(duration()); updateLaps(); }));
  const panel = box(display, actions(toggle, button('归零', () => {
    watch.start = null;
    watch.elapsed = 0;
    watch.laps = [];
    cancelAnimationFrame(frame);
    render();
    updateLaps();
  }), lap), proPanel(field('显示精度', precision), splitLabel), laps);
  for (const control of [precision, split]) control.addEventListener('change', () => { render(); updateLaps(); });
  panel.addEventListener('tool-mode-changed', () => { render(); updateLaps(); });
  requestAnimationFrame(tick);
  updateLaps();
  return panel;
}

export const extraTools = {
  developer: [
    { id: 'url-query', name: 'URL 参数工具', icon: 'Link2', keywords: 'query 查询字符串 参数 拼接', description: '读写查询字符串并保留重复参数。', render: urlParameters },
    { id: 'unicode', name: 'Unicode 与 UTF-8', icon: 'Binary', keywords: 'hex 十六进制 码位 字节', description: '在文本、Unicode 码位和 UTF-8 字节间转换。', render: unicode },
    { id: 'json-query', name: 'JSON 字段提取', icon: 'Braces', keywords: 'pointer JSON 路径 查询 取值', description: '根据 JSON Pointer 提取嵌套值。', render: jsonExtract },
  ],
  text: [
    { id: 'text-stats', name: '文字统计', icon: 'FileText', keywords: '字数 词数 字节 计数', description: '统计字词、字符、行数和字节。', render: textStats },
    { id: 'text-replace', name: '查找替换', icon: 'Regex', keywords: '文本 查找 替换 单词', description: '批量替换指定文字，可限制完整单词。', render: textReplace },
    { id: 'line-sort', name: '按行排序', icon: 'ArrowDownUp', keywords: '排序 去重 自然顺序 列表', description: '按文字或自然数字顺序整理列表。', render: lineSort },
  ],
  media: [
    { id: 'audio', name: '音频工具箱', icon: 'Video', keywords: '音频 转码 FLAC AAC WAV Opus MP3', description: '转换音频格式，调整码率、采样率和声道。', render: () => mediaTool(true) },
    { id: 'image-info', name: '图片属性', icon: 'Image', keywords: '图片 分辨率 宽高比 体积 EXIF', description: '查看图片分辨率、宽高比和文件大小。', render: imageInfo },
    { id: 'contrast', name: '配色对比度', icon: 'Palette', keywords: '颜色 对比度 WCAG AA AAA 可访问性', description: '检查文字与背景的亮度对比度。', render: contrast },
  ],
  files: [
    { id: 'file-info', name: '文件属性', icon: 'Files', keywords: '大小 路径 修改 创建 属性', description: '批量查看文件大小、时间与路径。', render: fileInfo },
    { id: 'pdf-organize', name: 'PDF 页面整理', icon: 'FileText', keywords: 'PDF 重排 旋转 提取 删除页面', description: '按页码挑选、排序或旋转 PDF 页面。', render: pdfOrganize },
    { id: 'image-pdf', name: '图片转 PDF', icon: 'Image', keywords: 'images to PDF A4 Letter 长图', description: '把多张图片合成可自选版面的 PDF。', render: imagePdf },
  ],
  efficiency: [
    { id: 'unit-converter', name: '单位换算', icon: 'ArrowDownUp', keywords: '温度 长度 质量 速度 面积 容量', description: '换算温度、长度、质量等常用单位。', render: unitConversion },
    { id: 'date-math', name: '日期计算', icon: 'CalendarClock', keywords: '日期 天数 日期差 偏移', description: '计算两个日期之间的天数与周数。', render: dateMath },
    { id: 'percent', name: '百分比计算', icon: 'Binary', keywords: '占比 涨跌幅 比例 折扣', description: '计算占比、涨跌幅和按比例折算。', render: percent },
    { id: 'stopwatch', name: '秒表', icon: 'Timer', keywords: '秒表 计时 计次 毫秒', description: '暂停、继续并记录每次用时。', render: stopwatch },
  ],
};
