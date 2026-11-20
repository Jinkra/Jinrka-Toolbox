import { actions, area, box, button, check, chosenFiles, copyButton, el, field, fileInput, input, isPro, makeStatus, pro, proPanel, proValue, readableSize, resultText, row, saveBlob, select, simpleOnly, task } from '../ui.js';
import { mediaTool } from './media-engine.js';

const imageFormats = [['image/png', 'PNG'], ['image/jpeg', 'JPEG'], ['image/webp', 'WebP']];
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function canvasAt(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 16384 || height > 16384 || width * height > 64_000_000) {
    throw new Error('图片长边不能超过 16384 像素，总面积不能超过 6400 万像素。');
  }
  return el('canvas', { width, height });
}

export function canvasBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob?.type === type) resolve(blob);
    else reject(new Error('无法按所选格式生成图片。'));
  }, type, quality));
}

export async function zipBlobs(files) {
  const { zip } = await import('fflate');
  const entries = await Promise.all(files.map(async ([name, blob]) => [name, new Uint8Array(await blob.arrayBuffer())]));
  return new Promise((resolve, reject) => zip(Object.fromEntries(entries), { level: 0 }, (error, data) => {
    if (error) reject(error);
    else resolve(new Blob([data], { type: 'application/zip' }));
  }));
}

function number(control, minimum, maximum, label, integer = false) {
  const value = Number(control.value);
  if (!control.value || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error(`${label}应为 ${minimum} 到 ${maximum} 之间的${integer ? '整数' : '数值'}。`);
  }
  return value;
}

function renderImage(canvas, type) {
  const context = canvas.getContext('2d');
  if (type === 'image/jpeg') {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return context;
}

function rotateCrop(image, values, type) {
  const [x, y, width, height, angle] = values;
  if (x + width > image.width || y + height > image.height) throw new Error('裁剪区域超出原图尺寸。');
  const swap = angle % 180 !== 0;
  const canvas = canvasAt(swap ? height : width, swap ? width : height);
  const context = renderImage(canvas, type);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle * Math.PI / 180);
  context.drawImage(image, x, y, width, height, -width / 2, -height / 2, width, height);
  return canvas;
}

function stitchImages(images, vertical, type, gap = 0) {
  const widths = images.map((image) => image.width);
  const heights = images.map((image) => image.height);
  const sum = (items) => items.reduce((total, value) => total + value, 0);
  const width = vertical ? Math.max(...widths) : sum(widths) + gap * (images.length - 1);
  const height = vertical ? sum(heights) + gap * (images.length - 1) : Math.max(...heights);
  const canvas = canvasAt(width, height);
  const context = renderImage(canvas, type);
  let offset = 0;
  for (const image of images) {
    const x = vertical ? Math.floor((width - image.width) / 2) : offset;
    const y = vertical ? offset : Math.floor((height - image.height) / 2);
    context.drawImage(image, x, y);
    offset += (vertical ? image.height : image.width) + gap;
  }
  return canvas;
}

async function processGif(file, operation, speed, stride = 1) {
  const { parseGIF, decompressFrame } = await import('gifuct-js');
  const gif = parseGIF(await file.arrayBuffer());
  const { width, height } = gif.lsd;
  const frames = gif.frames.filter((frame) => frame.image);
  if (!frames.length) throw new Error('无法读取 GIF 帧。');
  if (width * height * frames.length > 100_000_000) throw new Error('GIF 帧数量或尺寸过大。');
  const canvas = canvasAt(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const patch = canvasAt(1, 1);
  const patchContext = patch.getContext('2d');
  const zip = [];
  const encoder = operation === 'speed' ? await import('gifenc') : null;
  const writer = encoder?.GIFEncoder();
  const loopBlock = gif.frames.find((frame) => frame.application?.id === 'NETSCAPE2.0')?.application?.blocks;
  const repeat = loopBlock?.[0] === 1 ? (loopBlock[1] | (loopBlock[2] << 8)) : -1;
  for (const [index, frame] of frames.entries()) {
    const { left, top, width: patchWidth, height: patchHeight } = frame.image.descriptor;
    if (patchWidth <= 0 || patchHeight <= 0 || left + patchWidth > width || top + patchHeight > height) {
      throw new Error('GIF 帧尺寸超出画布。');
    }
    const { patch: pixels, disposalType, delay, transparentIndex } = decompressFrame(frame, gif.gct, true);
    const previous = disposalType === 3 ? context.getImageData(0, 0, width, height) : null;
    patch.width = patchWidth;
    patch.height = patchHeight;
    patchContext.putImageData(new ImageData(pixels, patchWidth, patchHeight), 0, 0);
    context.drawImage(patch, left, top);
    if (writer) {
      const rgba = context.getImageData(0, 0, width, height).data;
      const format = 'rgba4444';
      const palette = encoder.quantize(rgba, 256, { format, oneBitAlpha: true });
      const transparent = palette.findIndex((entry) => entry[3] === 0);
      writer.writeFrame(encoder.applyPalette(rgba, palette, format), width, height, {
        palette, delay: Math.max(20, Math.round((delay || 100) / speed)), repeat,
        dispose: 2, transparent: transparent >= 0, transparentIndex: Math.max(0, transparent),
      });
    } else if (index % stride === 0) {
      zip.push([`frame-${String(index + 1).padStart(4, '0')}.png`, await canvasBlob(canvas)]);
    }
    if (disposalType === 2) {
      context.clearRect(left, top, patchWidth, patchHeight);
      const background = gif.gct?.[gif.lsd.backgroundColorIndex];
      if (background && transparentIndex === undefined) {
        context.fillStyle = `rgb(${background.join(',')})`;
        context.fillRect(left, top, patchWidth, patchHeight);
      }
    }
    if (previous) context.putImageData(previous, 0, 0);
  }
  if (!writer) return zipBlobs(zip);
  writer.finish();
  return new Blob([writer.bytes()], { type: 'image/gif' });
}

function imageTool() {
  const mode = select([['compress', '压缩 / 转格式'], ['crop', '裁剪 / 旋转'], ['color', '调色'],
    ['watermark', '文字水印'], ['stitch', '拼接'], ['exif', '查看 EXIF'], ['gif', 'GIF 处理']]);
  const files = fileInput('image/*,.heic,.heif');
  const type = select(imageFormats);
  const quality = input({ type: 'number', min: 1, max: 100, value: 82 });
  const maxSide = input({ type: 'number', min: 0, max: 16384, value: 0 });
  const profile = select([['94', '超高 · 94%'], ['86', '高 · 86%'], ['76', '中 · 76%'], ['62', '低 · 62%']]);
  profile.value = '86';
  const ratio = select([['0', '保留原图'], ['1', '正方形 · 1:1'], ['1.333333333', '横图 · 4:3'], ['1.777777778', '横图 · 16:9'], ['0.75', '竖图 · 3:4']]);
  const colorPreset = select([['normal', '自然'], ['bright', '明亮'], ['vivid', '鲜艳'], ['gray', '黑白']]);
  const x = input({ type: 'number', min: 0, value: 0 });
  const y = input({ type: 'number', min: 0, value: 0 });
  const width = input({ type: 'number', min: 1, placeholder: '剩余宽度' });
  const height = input({ type: 'number', min: 1, placeholder: '剩余高度' });
  const angle = select([['0', '不旋转'], ['90', '顺时针 90°'], ['180', '180°'], ['270', '逆时针 90°']]);
  const brightness = input({ type: 'number', min: 0, max: 300, value: 100 });
  const contrast = brightness.cloneNode();
  const saturation = brightness.cloneNode();
  const text = input({ value: 'Jinkra', maxlength: 80 });
  const opacity = input({ type: 'number', min: 1, max: 100, value: 70 });
  const watermarkColor = input({ type: 'color', value: '#ffffff' });
  const corner = select([['right', '右下角'], ['left', '左下角'], ['center', '居中']]);
  const direction = select([['vertical', '上下拼接'], ['horizontal', '左右拼接']]);
  const gap = input({ type: 'number', min: 0, max: 500, value: 0 });
  const gifOperation = select([['frames', '导出 PNG 帧（ZIP）'], ['speed', '调整 GIF 播放速度']]);
  const speed = input({ type: 'number', min: 0.25, max: 4, step: 0.25, value: 1 });
  const stride = input({ type: 'number', min: 1, max: 60, value: 1 });
  const [gpsLabel, gps] = check('包含 GPS、IPTC 和 XMP 元数据');
  const settings = el('div');
  const preview = el('div', { class: 'media-preview', 'aria-live': 'polite' });
  const details = el('p', { class: 'hint' });
  const status = makeStatus();
  let output;
  let previewUrl;
  const save = button('保存结果', task(status, () => saveBlob(output.blob, output.name, status)));
  save.hidden = true;

  function reset() {
    output = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.replaceChildren();
    details.textContent = '';
    save.hidden = true;
  }

  function refreshFields() {
    const active = mode.value;
    files.accept = active === 'gif' ? '.gif,image/gif' : 'image/*,.heic,.heif';
    files.multiple = active === 'stitch';
    const common = active === 'gif' || active === 'exif' ? [] : [
      field('输出格式', type), type.value !== 'image/png' && simpleOnly(field('输出品质', profile)),
    ];
    const entries = {
      compress: [],
      crop: [simpleOnly(field('居中裁剪比例', ratio)), field('旋转', angle)],
      color: [simpleOnly(field('色彩预设', colorPreset))],
      watermark: [field('水印文字', text)],
      stitch: [field('方向', direction, '按文件选择器返回的顺序拼接。')],
      exif: [],
      gif: [field('GIF 处理方式', gifOperation), gifOperation.value === 'speed' && field('播放倍速', speed)],
    };
    const advanced = {
      compress: [field('最长边（像素）', maxSide, '0 保留原始分辨率。')],
      crop: [field('左边距 X', x), field('上边距 Y', y), field('宽度', width), field('高度', height)],
      color: [field('亮度 (%)', brightness), field('对比度 (%)', contrast), field('饱和度 (%)', saturation)],
      watermark: [field('不透明度 (%)', opacity), field('水印颜色', watermarkColor), field('位置', corner)],
      stitch: [field('图片间距（像素）', gap)],
      exif: [gpsLabel],
      gif: gifOperation.value === 'frames' ? [field('提帧间隔', stride, '每隔指定帧数导出一帧。')] : [],
    };
    const controls = [...advanced[active]];
    if (common.length && type.value !== 'image/png') controls.push(field('质量 (%)', quality));
    settings.replaceChildren(row(common, entries[active]), ...(controls.length ? [proPanel(controls)] : []));
  }

  type.value = 'image/webp';
  refreshFields();
  mode.addEventListener('change', () => { files.value = ''; reset(); status.set(); refreshFields(); });
  type.addEventListener('change', refreshFields);
  gifOperation.addEventListener('change', refreshFields);
  files.addEventListener('change', () => { reset(); status.set(); });

  const process = task(status, async () => {
    reset();
    const picked = chosenFiles(files);
    const [file] = picked;
    const base = file.name.replace(/\.[^.]+$/u, '');
    const active = mode.value;
    if (active === 'exif') {
      const { default: exifr } = await import('exifr');
      const extended = isPro() && gps.checked;
      const data = await exifr.parse(file, { tiff: true, exif: true, gps: extended, iptc: extended, xmp: extended, icc: extended });
      preview.append(el('pre', { class: 'output' }, data ? JSON.stringify(data, null, 2) : '此文件未发现可读取的 EXIF 元数据。'));
      return;
    }
    if (active === 'gif') {
      const operation = gifOperation.value;
      const blob = await processGif(file, operation, operation === 'speed' ? number(speed, 0.25, 4, '倍速') : 1,
        isPro() && operation === 'frames' ? number(stride, 1, 60, '提帧间隔', true) : 1);
      output = { blob, name: operation === 'speed' ? `${base}-speed.gif` : `${base}-frames.zip` };
    } else {
      if (active === 'stitch' && picked.length < 2) throw new Error('请为拼接选择至少两张图片。');
      const mime = type.value;
      const bitmaps = [];
      try {
        for (const selected of picked) bitmaps.push(await createImageBitmap(selected));
        const [image] = bitmaps;
        let canvas;
        if (active === 'crop') {
          const aspect = Number(ratio.value);
          let cropWidth = Math.max(1, aspect ? Math.floor(Math.min(image.width, image.height * aspect)) : image.width);
          let cropHeight = Math.max(1, aspect ? Math.floor(Math.min(image.height, cropWidth / aspect)) : image.height);
          let left = Math.floor((image.width - cropWidth) / 2);
          let top = Math.floor((image.height - cropHeight) / 2);
          if (isPro()) {
            left = number(x, 0, image.width - 1, '左边距', true);
            top = number(y, 0, image.height - 1, '上边距', true);
            cropWidth = width.value ? number(width, 1, image.width, '宽度', true) : image.width - left;
            cropHeight = height.value ? number(height, 1, image.height, '高度', true) : image.height - top;
          }
          canvas = rotateCrop(image, [left, top, cropWidth, cropHeight, Number(angle.value)], mime);
        } else if (active === 'stitch') {
          canvas = stitchImages(bitmaps, direction.value === 'vertical', mime, isPro() ? number(gap, 0, 500, '间距', true) : 0);
        } else {
          const limit = active === 'compress' && isPro() ? number(maxSide, 0, 16384, '最长边', true) : 0;
          const scale = limit ? Math.min(1, limit / Math.max(image.width, image.height)) : 1;
          canvas = canvasAt(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
          const context = renderImage(canvas, mime);
          if (active === 'color') {
            const [b, c, s] = isPro()
              ? [number(brightness, 0, 300, '亮度'), number(contrast, 0, 300, '对比度'), number(saturation, 0, 300, '饱和度')]
              : { normal: [100, 100, 100], bright: [115, 105, 105], vivid: [100, 112, 145], gray: [100, 100, 0] }[colorPreset.value];
            context.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          if (active === 'watermark') {
            if (!text.value.trim()) throw new Error('请输入水印文字。');
            const margin = Math.max(4, Math.floor(Math.min(canvas.width, canvas.height) / 25));
            context.font = `bold ${Math.max(8, Math.round(canvas.width / 24))}px sans-serif`;
            const align = proValue(corner, 'right');
            context.textAlign = align;
            context.textBaseline = align === 'center' ? 'middle' : 'bottom';
            context.globalAlpha = isPro() ? number(opacity, 1, 100, '不透明度') / 100 : .7;
            context.fillStyle = proValue(watermarkColor, '#fff');
            context.strokeStyle = '#162521';
            context.lineWidth = Math.max(1, canvas.width / 350);
            const textWidth = Math.max(1, canvas.width - 2 * margin);
            const horizontal = align === 'center' ? canvas.width / 2 : align === 'left' ? margin : canvas.width - margin;
            const vertical = align === 'center' ? canvas.height / 2 : canvas.height - margin;
            context.strokeText(text.value, horizontal, vertical, textWidth);
            context.fillText(text.value, horizontal, vertical, textWidth);
          }
        }
        const blob = await canvasBlob(canvas, mime, mime === 'image/png' ? undefined : (isPro() ? number(quality, 1, 100, '质量') : Number(profile.value)) / 100);
        output = { blob, name: `${base}-${active}.${extensions[mime]}` };
        details.textContent = `${canvas.width} × ${canvas.height} 像素 · `;
      } finally {
        bitmaps.forEach((bitmap) => bitmap.close());
      }
    }
    details.textContent += `${readableSize(output.blob.size)} · 源文件 ${readableSize(picked.reduce((sum, item) => sum + item.size, 0))}`;
    if (output.blob.type.startsWith('image/')) {
      previewUrl = URL.createObjectURL(output.blob);
      preview.append(el('img', { src: previewUrl, alt: '处理结果预览', onload: () => {
        if (previewUrl && !preview.isConnected) URL.revokeObjectURL(previewUrl);
      } }));
    }
    save.hidden = false;
  });
  return box(row(field('操作', mode), field('选择图片', files)), settings,
    actions(button('处理图片', process, 'primary'), save), status.node, details, preview);
}

function qrTool() {
  const content = area('输入文本或链接…', 'Jinkra 工具箱');
  const file = fileInput('image/*');
  const status = makeStatus();
  const result = resultText();
  const preview = el('div', { class: 'qr-preview' });
  const dimension = input({ type: 'number', min: 120, max: 2048, value: 320 });
  const margin = input({ type: 'number', min: 0, max: 12, value: 4 });
  const errorLevel = select(['M', 'L', 'Q', 'H']);
  const dark = input({ type: 'color', value: '#101928' });
  const light = input({ type: 'color', value: '#ffffff' });
  let code;
  let decoded = '';
  const exportButton = button('保存 PNG', task(status, async () => {
    await saveBlob(await canvasBlob(code), 'jinkra-qrcode.png', status);
  }));
  exportButton.hidden = true;
  const encode = task(status, async () => {
    if (!content.value.trim()) throw new Error('请输入二维码内容。');
    const { default: QRCode } = await import('qrcode');
    code = await QRCode.toCanvas(content.value, { width: isPro() ? number(dimension, 120, 2048, '尺寸', true) : 320,
      margin: isPro() ? number(margin, 0, 12, '留白', true) : 4, errorCorrectionLevel: proValue(errorLevel, 'M'),
      color: { dark: proValue(dark, '#101928'), light: proValue(light, '#ffffff') } });
    code.setAttribute('aria-label', '生成的二维码');
    preview.replaceChildren(code);
    exportButton.hidden = false;
  });
  const decode = task(status, async () => {
    decoded = '';
    result.textContent = '';
    const [chosen] = chosenFiles(file);
    const image = await createImageBitmap(chosen);
    try {
      const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
      const canvas = canvasAt(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const { default: jsQR } = await import('jsqr');
      const value = jsQR(data, canvas.width, canvas.height);
      if (!value) throw new Error('未识别到二维码。试试更清晰或已裁剪的图片。');
      decoded = value.data;
      result.textContent = decoded;
    } finally {
      image.close();
    }
  });
  return box(proPanel(field('尺寸（像素）', dimension), field('留白（模块）', margin), field('纠错等级', errorLevel),
    field('前景颜色', dark), field('背景颜色', light)), el('div', { class: 'editor-grid' },
    el('div', { class: 'tool-column' }, field('二维码内容', content), actions(button('生成二维码', encode, 'primary'), exportButton), preview),
    el('div', { class: 'tool-column' }, field('二维码图片', file), actions(button('识别二维码', decode, 'primary'),
      copyButton(() => decoded, status)), result)), status.node);
}

function colorTool() {
  const source = input({ value: '#176c60', placeholder: '#176c60、rgb(23 108 96) 或 hsl(172 65% 26%)' });
  const picker = input({ type: 'color', value: source.value, 'aria-label': '颜色选择器' });
  const output = resultText();
  const status = makeStatus();
  const precision = select(['4', '2', '6', '8']);
  const space = select(['oklch', 'lab', 'lch', 'hwb', 'p3']);
  let values = '';
  const convert = task(status, async () => {
    const { default: Color } = await import('colorjs.io');
    let color;
    try { color = new Color(source.value.trim()).to('srgb').toGamut({ method: 'clip' }); }
    catch { throw new Error('无法识别色值。可输入 HEX、RGB、HSL 或 CSS 颜色名。'); }
    const colorHex = color.toString({ format: 'hex', collapse: false });
    picker.value = colorHex.slice(0, 7);
    const digits = Number(proValue(precision, '4'));
    values = `HEX    ${colorHex}\nRGB    ${color.toString({ format: 'rgb', precision: digits })}\nHSL    ${color.to('hsl').toString({ precision: digits })}`;
    if (isPro()) values += `\n${space.value.toUpperCase()}  ${color.to(space.value).toString({ precision: digits })}`;
    output.textContent = values;
  });
  picker.addEventListener('input', () => { source.value = picker.value; });
  return box(row(field('色值', source), field('取色', picker)), proPanel(field('显示精度', precision), field('额外色彩空间', space)), actions(button('转换色值', convert, 'primary'),
    copyButton(() => values, status)), output, status.node);
}

export const mediaTools = [
  { id: 'image', name: '图片工具箱', icon: 'Image', keywords: '压缩 旋转 图片格式 水印 EXIF 裁剪 拼接 GIF JPG PNG WEBP', description: '压缩、裁剪、转格式、加水印与 GIF 处理。', render: imageTool },
  { id: 'video', name: '视频工具箱', icon: 'Video', keywords: '音频 裁剪 抽帧 压缩 FFmpeg MP4 MP3 GIF 格式', description: '压缩、剪辑、转格式、提取音频、抽帧与生成 GIF。', render: () => mediaTool() },
  { id: 'qr', name: '二维码', icon: 'QrCode', keywords: 'qrcode 二维码生成 解析 扫码', description: '生成二维码，或读取图片里的二维码。', render: qrTool },
  { id: 'color', name: '色值转换', icon: 'Palette', keywords: '颜色 取色器 hex rgb hsl', description: '在 HEX、RGB 和 HSL 色值之间转换。', render: colorTool },
];
