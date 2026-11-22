import {
  AlignLeft, Archive, ArrowDownUp, ArrowLeft, ArrowRight, Binary, Braces, CaseSensitive,
  Check, ChevronRight, CircleHelp, Clipboard, CodeXml, Copy, FileCheck, FilePenLine,
  Files, FileText, Fingerprint, Grid2X2, Hash, Image, KeyRound, Link2, LockKeyhole,
  NotebookPen, Palette, Pin, QrCode, Regex, Search, Settings2, ShieldCheck, Shuffle, Star,
  Table2, Terminal, Timer, Type, Video, X, Clock3, ScanLine, CalendarClock, Layers3, Sparkles, Download, RefreshCw, ExternalLink,
} from 'lucide';

const icons = {
  AlignLeft, Archive, ArrowDownUp, ArrowLeft, ArrowRight, Binary, Braces, CaseSensitive,
  Check, ChevronRight, CircleHelp, Clipboard, CodeXml, Copy, FileCheck, FilePenLine,
  Files, FileText, Fingerprint, Grid2X2, Hash, Image, KeyRound, Link2, LockKeyhole,
  NotebookPen, Palette, Pin, QrCode, Regex, Search, Settings2, ShieldCheck, Shuffle, Star,
  Table2, Terminal, Timer, Type, Video, X, Clock3, ScanLine, CalendarClock, Layers3, Sparkles, Download, RefreshCw, ExternalLink,
};

export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return node;
}

export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(key, value);
  for (const [tag, attributes] of icons[name] ?? CircleHelp) {
    const part = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes)) part.setAttribute(key, value);
    svg.append(part);
  }
  return svg;
}

export const button = (text, handler, style = 'secondary', symbol) => el('button', {
  type: 'button', class: `button ${style}`, onclick: handler,
}, symbol && icon(symbol, 16), text);
export const iconButton = (name, label, handler) => el('button', {
  type: 'button', class: 'icon-button', title: label, 'aria-label': label, onclick: handler,
}, icon(name, 17));
export const input = (attributes = {}) => el('input', { ...attributes });
export const area = (placeholder = '', value = '') => el('textarea', { placeholder, spellcheck: 'false' }, value);
export const select = (options) => el('select', {}, options.map((item) => {
  const [value, label] = Array.isArray(item) ? item : [item, item];
  return el('option', { value }, label);
}));
let fieldCount = 0;
export function field(label, control, hint) {
  const id = `tool-field-${++fieldCount}`;
  const description = hint ? `${id}-hint` : null;
  const labelable = control.matches('input,select,textarea');
  if (labelable) {
    control.id = id;
    if (description) control.setAttribute('aria-describedby', description);
  }
  return el('div', { class: 'field' },
    el(labelable ? 'label' : 'span', { class: 'field-label', for: labelable ? id : null }, label), control,
    hint && el('span', { class: 'hint', id: description }, hint));
}
export const row = (...children) => el('div', { class: 'fields' }, children);
export const isPro = () => document.documentElement.dataset.experience === 'pro';
export const proValue = (control, fallback) => isPro() ? control.value : fallback;
export function pro(control) {
  control.classList.add('pro-only');
  return control;
}
export function simpleOnly(control) {
  control.classList.add('simple-only');
  return control;
}
export const proPanel = (...children) => el('section', { class: 'control-panel pro-panel pro-only' }, el('h3', {}, '专业参数'), row(children));
export const actions = (...children) => el('div', { class: 'actions' }, children);
export const note = (message) => el('p', { class: 'hint' }, message);
export const box = (...children) => el('section', { class: 'surface' }, children);
export const resultText = () => el('pre', { class: 'output', 'aria-live': 'polite' }, '处理结果会显示在这里。');
const browserFileTypes = { image: 'image/*,.heic,.heif,.tif,.tiff', gif: '.gif,image/gif', pdf: '.pdf,application/pdf' };

export function fileInput(kind, multiple = false) {
  if (!globalThis.desktop) {
    const node = input({ type: 'file', accept: browserFileTypes[kind], multiple });
    return {
      node,
      clear: () => { node.value = ''; node.dispatchEvent(new Event('change')); },
      configure: (nextKind, nextMultiple) => { node.accept = browserFileTypes[nextKind]; node.multiple = nextMultiple; },
      readFiles: () => [...node.files],
    };
  }
  const status = makeStatus();
  const node = el('div', { class: 'file-input' });
  const picker = nativeFiles(kind, multiple, status, () => node.dispatchEvent(new Event('change')));
  node.append(picker.node, status.node);
  return {
    node,
    clear: picker.clear,
    configure: picker.configure,
    async readFiles() {
      const selection = picker.selection;
      if (!selection) return [];
      return Promise.all(selection.names.map(async (name, index) => {
        const response = await fetch(`app://jinkra/selected/${selection.id}/${index}`);
        if (!response.ok) throw new Error(`无法读取「${name}」，请重新选择该文件。`);
        const blob = await response.blob();
        return new File([blob], name, { type: blob.type });
      }));
    },
  };
}
export const check = (label, checked = false) => {
  const control = input({ type: 'checkbox', checked });
  return [el('label', { class: 'check' }, control, label), control];
};

export function makeStatus() {
  const node = el('p', { class: 'task-status', role: 'status' });
  return {
    node,
    set(message = '', type = '') {
      node.textContent = message;
      node.dataset.type = type;
    },
  };
}

let presetCount = 0;
export function presets(label, options, initial) {
  const name = `preset-${++presetCount}`;
  const choices = options.map(([value, title, description]) => {
    const choice = input({ type: 'radio', name, value, checked: value === initial });
    return [choice, el('label', { class: 'preset-option' }, choice, el('strong', {}, title), el('span', {}, description))];
  });
  const node = el('div', { class: 'preset-grid', role: 'radiogroup', 'aria-label': label }, choices.map(([, item]) => item));
  return { node, get value() { return choices.find(([control]) => control.checked)[0].value; } };
}

export function readableSize(bytes) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(bytes >= 2 ** 20 ? bytes / 2 ** 20 : bytes >= 1024 ? bytes / 1024 : bytes)
    + (bytes >= 2 ** 20 ? ' MiB' : bytes >= 1024 ? ' KiB' : ' B');
}

export function task(status, work, label = '处理中…') {
  let busy = false;
  return async (event) => {
    if (busy) return;
    busy = true;
    const source = event?.currentTarget;
    if (source instanceof HTMLButtonElement) source.setAttribute('aria-busy', 'true');
    status.set(label);
    try {
      await work(event);
      if (status.node.textContent === label) status.set('处理完成。', 'success');
    } catch (error) {
      status.set(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, ''), 'error');
    } finally {
      busy = false;
      if (source instanceof HTMLButtonElement) source.removeAttribute('aria-busy');
    }
  };
}

export async function copy(value) {
  if (globalThis.desktop) await desktop.clipboardWrite(value);
  else await navigator.clipboard.writeText(value);
}

export function copyButton(getValue, status) {
  return button('复制结果', task(status, async () => {
    const value = getValue();
    if (!value) throw new Error('请先生成结果。');
    await copy(value);
    status.set('已复制到剪贴板。', 'success');
  }), 'secondary', 'Copy');
}

export async function saveBlob(blob, name, status) {
  if (globalThis.desktop) {
    const path = await desktop.saveFile(name, new Uint8Array(await blob.arrayBuffer()));
    status.set(path ? `已保存到 ${path}` : '', 'success');
    return;
  }
  const url = URL.createObjectURL(blob);
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  status.set('已发起下载。', 'success');
}

export async function chosenFiles(control) {
  const files = await control.readFiles();
  if (!files.length) throw new Error('请先选择文件。');
  return files;
}

export function nativeFiles(kind, multiple, status, onChange = () => {}) {
  let selection;
  const empty = () => kind === 'directory' ? '尚未选择文件夹' : '尚未选择文件';
  const names = el('p', { class: 'file-names' }, empty());
  const choose = button(kind === 'directory' ? '选择文件夹…' : '选择文件…', task(status, async () => {
    const result = await desktop.pickFiles(kind, multiple);
    if (result) {
      selection = result;
      names.textContent = result.names.join('、');
      onChange();
    }
    status.set('');
  }, '等待选择文件…'), 'secondary', 'Files');
  return {
    node: el('div', { class: 'file-picker' }, choose, names),
    get selection() { return selection; },
    get id() {
      if (!selection) throw new Error('请先选择文件。');
      return selection.id;
    },
    configure(nextKind, nextMultiple) {
      if (nextKind === kind && nextMultiple === multiple) return;
      kind = nextKind;
      multiple = nextMultiple;
      selection = null;
      names.textContent = empty();
    },
    clear() {
      selection = null;
      names.textContent = empty();
      onChange();
    },
  };
}

export function desktopOnly() {
  return box(note('请打开 Jinkra 桌面程序使用此功能。'));
}

export function transformTool(options) {
  const source = area(options.placeholder || '在这里输入内容…');
  if (options.sample !== undefined) source.value = options.sample;
  const output = resultText();
  const status = makeStatus();
  let value = '';
  const stats = el('p', { class: 'hint', 'aria-live': 'polite' });
  const updateStats = () => {
    stats.textContent = `输入 ${Array.from(source.value).length} 字符 · ${source.value ? source.value.split(/\r\n|\n|\r/u).length : 0} 行${value ? ` · 输出 ${readableSize(new TextEncoder().encode(value).length)}` : ''}`;
  };
  source.addEventListener('input', updateStats);
  updateStats();
  const perform = (operation) => task(status, async () => {
    value = '';
    output.textContent = '';
    value = String(await operation(source.value));
    output.textContent = value;
    updateStats();
  });
  const sample = options.sample === undefined ? null : button('载入示例', () => {
    source.value = options.sample;
    updateStats();
    source.focus();
  }, 'quiet');
  const controls = options.fields ? row(options.fields) : null;
  return box(controls, options.advanced && proPanel(options.advanced),
    el('div', { class: 'editor-grid' }, field(options.inputLabel || '输入', source), field('结果', output)),
    actions(options.operations.map(([label, fn], index) => button(label, perform(fn), index === 0 ? 'primary' : 'secondary')),
      copyButton(() => value, status), sample),
    pro(actions(stats, button('从剪贴板粘贴', task(status, async () => {
      source.value = globalThis.desktop ? await desktop.clipboardRead() : await navigator.clipboard.readText();
      updateStats();
      status.set('已粘贴到输入区。', 'success');
    }), 'quiet', 'Clipboard'), button('保存为文本', task(status, () => {
      if (!value) throw new Error('请先生成结果。');
      return saveBlob(new Blob([value], { type: 'text/plain' }), 'jinkra-result.txt', status);
    }), 'quiet'))), status.node,
  );
}

export function outputTool(controls, label, produce, advanced) {
  const status = makeStatus();
  const output = resultText();
  let value = '';
  return box(row(controls), advanced && proPanel(advanced), actions(button(label, task(status, async () => {
    value = '';
    output.textContent = '';
    value = String(await produce());
    output.textContent = value;
  }), 'primary'), copyButton(() => value, status)), output, status.node);
}
