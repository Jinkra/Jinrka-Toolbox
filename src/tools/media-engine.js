import {
  actions, box, button, check, desktopOnly, el, field, input, isPro, makeStatus,
  nativeFiles, note, presets, pro, readableSize, row, select, simpleOnly, task,
} from '../ui.js';

const levels = [
  ['highest', '超高', '优先保留细节', 0, .155, 192],
  ['high', '高', '兼顾画质和体积', 1080, .105, 160],
  ['medium', '中', '适合日常分享', 720, .078, 128],
  ['low', '低', '优先减小体积', 480, .06, 96],
];
const formats = {
  compress: ['mp4', 'mkv', 'webm'], cut: ['mp4', 'mkv', 'webm'], format: ['mp4', 'mkv', 'webm'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'opus'], frame: ['png', 'jpg'], gif: ['gif'],
};
const number = (value, min, max, step = 1) => input({ type: 'number', value, min, max, step });
const metric = (label, value) => el('div', {}, el('dt', {}, label), el('dd', {}, value));

export function mediaTool(audioOnly = false) {
  if (!globalThis.desktop) return desktopOnly();
  const status = makeStatus();
  const files = nativeFiles(audioOnly ? 'audio' : 'video', false, status, () => { void inspect(); });
  const mode = select([['compress', '压缩视频'], ['cut', '剪辑片段'], ['format', '转换格式'],
    ['audio', '提取音频'], ['frame', '导出指定时间的画面'], ['gif', '生成 GIF']]);
  const format = select(['mp4']);
  const level = presets('视频压缩档位', levels, 'medium');
  const audioLevel = presets('音频品质', [
    ['256', '高', '256 kbps'], ['160', '中', '160 kbps'], ['96', '低', '96 kbps'],
  ], '160');
  const start = number(0, 0, 360000, .01);
  const end = number(10, 0, 360000, .01);
  const control = select([['bitrate', '目标码率'], ['quality', '恒定画质 CRF']]);
  const quality = number(25, 0, 63);
  const bitrate = number(1800, 64, 150000);
  const height = select([['0', '保留原始高度'], ['2160', '最高 2160p'], ['1440', '最高 1440p'], ['1080', '最高 1080p'],
    ['720', '最高 720p'], ['480', '最高 480p'], ['360', '最高 360p']]);
  const fps = number('', 1, 240, .01);
  const gifWidth = number(480, 64, 1920);
  const gifFps = number(12, 1, 30, .01);
  const frameQuality = number(3, 2, 31);
  const preset = select(['ultrafast', 'veryfast', 'fast', 'medium', 'slow']);
  preset.value = 'fast';
  const codec = select([['h264', 'H.264'], ['hevc', 'H.265 / HEVC']]);
  const audioRate = number(160, 32, 320);
  const sampleRate = select([['0', '自动'], ['44100', '44.1 kHz'], ['48000', '48 kHz'], ['96000', '96 kHz']]);
  const channels = select([['0', '自动'], ['1', '单声道'], ['2', '立体声']]);
  const speed = number(1, .5, 2, .05);
  const [audioLabel, keepAudio] = check('保留音轨', true);
  const [metadataLabel, metadata] = check('移除源文件元数据');
  const startField = field('起始时间（秒）', start);
  const endField = field('结束时间（秒）', end);
  const startEnd = row(startField, endField);
  const videoLevel = simpleOnly(el('section', { class: 'control-panel' }, el('h3', {}, '压缩档位'), level.node));
  const soundLevel = simpleOnly(el('section', { class: 'control-panel' }, el('h3', {}, '音频品质'), audioLevel.node));
  const options = el('section', { class: 'control-panel pro-panel pro-only' }, el('h3', {}, '专业参数'));
  const estimate = el('p', { class: 'estimate', 'aria-live': 'polite' }, '等待选择文件');
  const explanation = note('');
  const metrics = el('dl', { class: 'metrics' });
  const progress = el('progress', { max: 100, 'aria-label': '媒体处理进度' });
  const progressLabel = note('处理中');
  const progressGroup = el('div', { hidden: true }, progress, progressLabel);
  let info;
  let sequence = 0;
  let inspecting = false;
  const activeMode = () => audioOnly ? 'audio' : mode.value;
  const hasVideo = () => ['compress', 'cut', 'format'].includes(activeMode());
  const hasBitrate = () => ['mp3', 'm4a', 'opus'].includes(format.value);

  function compressionSettings() {
    const [, , , maxHeight, density, audioRate] = levels.find(([name]) => name === level.value);
    const sourceHeight = info?.height || 720;
    const scale = maxHeight ? Math.min(1, maxHeight / sourceHeight) : 1;
    const pixels = (info?.width || 1280) * sourceHeight * scale ** 2;
    const kbps = pixels * (info?.fps || 30) * density / 1000;
    return { height: maxHeight, bitrate: Math.max(160, Math.min(150000, Math.round(kbps))), audioRate };
  }

  function settings() {
    const common = { mode: activeMode(), start: start.value, end: end.value, format: format.value, duration: info?.duration };
    if (!isPro()) return {
      ...common, ...compressionSettings(), width: 480, control: 'bitrate',
      ...(activeMode() === 'audio' && { audioRate: Number(audioLevel.value) }),
    };
    return { ...common, control: control.value, quality: quality.value, bitrate: bitrate.value, height: Number(height.value),
      fps: activeMode() === 'gif' ? gifFps.value : fps.value, width: gifWidth.value, frameQuality: frameQuality.value,
      preset: preset.value, codec: codec.value, audioRate: audioRate.value, sampleRate: Number(sampleRate.value),
      channels: Number(channels.value), speed: ['frame', 'gif'].includes(activeMode()) ? 1 : speed.value,
      keepAudio: keepAudio.checked, removeMetadata: metadata.checked };
  }

  function refreshEstimate() {
    const selected = settings();
    const sourceDuration = info?.duration ?? 0;
    const segment = selected.mode === 'cut' ? Number(selected.end) - Number(selected.start) : sourceDuration;
    const duration = segment / Number(selected.speed || 1);
    let kbps = 0;
    let detail = '';
    if (hasVideo() && selected.control === 'bitrate') {
      kbps = Number(selected.bitrate) + (info?.audio && selected.keepAudio !== false ? Number(selected.audioRate) : 0);
      detail = '按目标码率和时长估算，低运动画面可能明显小于估算。';
    } else if (activeMode() === 'audio' && hasBitrate()) {
      kbps = Number(selected.audioRate);
      detail = '按音频码率和时长估算。';
    } else if (activeMode() === 'audio' && format.value === 'wav' && selected.sampleRate && selected.channels) {
      kbps = selected.sampleRate * selected.channels * 16 / 1000;
      detail = '按 16 位 PCM、采样率和声道数估算。';
    } else {
      detail = hasVideo() ? '恒定画质的文件大小随内容变化。选择目标码率可查看估算。' : '当前格式的文件大小取决于内容。';
    }
    estimate.textContent = inspecting ? '正在读取文件…' : !info ? '等待选择文件'
      : duration > 0 && kbps > 0 ? `≈ ${readableSize(duration * kbps * 125)}` : '暂无法估算';
    explanation.textContent = info ? detail : '选择本地媒体后显示源文件属性和可用的大小估算。';
    metrics.replaceChildren(...(info ? [
      metric('原文件大小', readableSize(info.bytes)), metric('时长', info.duration ? `${info.duration.toFixed(2)} 秒` : '未知'),
      info.width && metric('原始分辨率', `${info.width} × ${info.height}`), info.fps && metric('原始帧率', `${info.fps} fps`),
      info.videoCodec && metric('视频编码', info.videoCodec.toUpperCase()), info.audioCodec && metric('音频编码', info.audioCodec.toUpperCase()),
      kbps > 0 && metric('预计总码率', `${kbps} kbps`),
    ].filter(Boolean) : []));
  }

  function refresh() {
    const operation = activeMode();
    const video = hasVideo();
    const audio = operation === 'audio';
    startEnd.hidden = !['cut', 'gif', 'frame'].includes(operation);
    endField.hidden = operation === 'frame';
    videoLevel.hidden = !video;
    soundLevel.hidden = !audio || !hasBitrate();
    options.replaceChildren(el('h3', {}, '专业参数'), row(
      video && field('码率控制', control),
      video && (control.value === 'bitrate' ? field('目标视频码率（kbps）', bitrate) : field('画质 CRF', quality, '数值越低，画质越高。')),
      video && field('输出高度', height), video && field('输出帧率（fps）', fps, '留空保留原始帧率。'),
      video && format.value !== 'webm' && [field('视频编码器', codec), field('编码速度', preset)],
      (video || audio) && field('播放倍速', speed),
      video && audioLabel,
      ((video && keepAudio.checked) || (audio && hasBitrate())) && field('音频码率（kbps）', audioRate),
      audio && [field('音频采样率', sampleRate), field('声道数', channels)],
      operation === 'gif' && [field('GIF 宽度（像素）', gifWidth), field('GIF 帧率（fps）', gifFps)],
      operation === 'frame' && format.value === 'jpg' && field('JPEG 质量', frameQuality, '2 的画质最高。'),
      metadataLabel));
    refreshEstimate();
  }

  function setFormat() {
    format.replaceChildren(...formats[activeMode()].map((value) => el('option', { value }, value.toUpperCase())));
    refresh();
  }

  async function inspect() {
    const id = ++sequence;
    inspecting = true;
    info = undefined;
    refreshEstimate();
    try {
      const result = await desktop.inspectMedia(files.id);
      if (id !== sequence) return;
      info = result;
      if (result.duration > 0) end.value = String(Number(Math.min(10, result.duration).toFixed(3)));
    } catch (error) {
      if (id === sequence) status.set(error.message.replace(/^Error invoking remote method '[^']+': Error: /u, ''), 'error');
    } finally {
      if (id === sequence) {
        inspecting = false;
        refreshEstimate();
      }
    }
  }

  setFormat();
  mode.addEventListener('change', setFormat);
  format.addEventListener('change', refresh);
  control.addEventListener('change', refresh);
  keepAudio.addEventListener('change', refresh);
  const cancel = button('取消处理', () => { void desktop.cancelVideo(); });
  const run = button('选择位置并处理', task(status, async () => {
    const selection = files.id;
    const next = settings();
    if (inspecting) throw new Error('请等待读取文件信息。');
    if (info && next.mode === 'audio' && !info.audio) throw new Error('选择的文件没有可用音轨。');
    if (info && next.mode !== 'audio' && !info.videoCodec) throw new Error('选择的文件没有可用视频。');
    progressGroup.hidden = false;
    progress.removeAttribute('value');
    progressLabel.textContent = '等待保存路径…';
    const unsubscribe = desktop.onVideoProgress((ratio) => {
      progress.value = Math.round(ratio * 100);
      progressLabel.textContent = `正在处理 · ${progress.value}%`;
    });
    try {
      const destination = await desktop.video(selection, next);
      status.set(destination ? `已保存到 ${destination}` : '', 'success');
    } finally {
      unsubscribe();
      progressGroup.hidden = true;
    }
  }, '准备处理…'), 'primary');
  progressGroup.append(cancel);
  const panel = box(el('div', { class: 'media-layout' },
    el('div', { class: 'media-form' },
      el('section', { class: 'control-panel' }, el('h3', {}, audioOnly ? '选择音频' : '选择源视频'), files.node),
      row(!audioOnly && field('处理方式', mode), field('输出格式', format)), startEnd, videoLevel, soundLevel, options,
      actions(run), progressGroup, status.node),
    el('aside', { class: 'control-panel media-summary' }, el('h3', {}, '预计输出大小'), estimate, explanation, metrics)));
  panel.addEventListener('input', refreshEstimate);
  panel.addEventListener('tool-mode-changed', refreshEstimate);
  return panel;
}
