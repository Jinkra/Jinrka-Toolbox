const { spawn } = require('node:child_process');
const { stat } = require('node:fs/promises');
const path = require('node:path');
const { withOutput } = require('./files.cjs');

const inputOptions = ['-protocol_whitelist', 'file,pipe', '-format_whitelist',
  'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,flv,asf,ogg,mpeg,mpegts,mp3,wav,flac,aac'];
const extensions = {
  compress: ['mp4', 'mkv', 'webm'], cut: ['mp4', 'mkv', 'webm'], format: ['mp4', 'mkv', 'webm'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'opus'], frame: ['png', 'jpg'], gif: ['gif'],
};

function ffmpeg() {
  const { app } = require('electron');
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')
    : path.resolve(__dirname, '../vendor/ffmpeg/ffmpeg.exe');
}

function range(value, minimum, maximum, label, integer = false) {
  const amount = Number(value);
  if (value === '' || value == null || !Number.isFinite(amount) || amount < minimum || amount > maximum ||
      (integer && !Number.isInteger(amount))) {
    throw new Error(`${label}须为 ${minimum} 到 ${maximum} 之间的${integer ? '整数' : '数字'}。`);
  }
  return amount;
}

function execute(args, { signal, duration, report, capture = false } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('已取消处理。'));
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stderr = '';
    let lines = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-(capture ? 30000 : 2200)); });
    child.stdout.on('data', (chunk) => {
      if (!report || !duration) return;
      const complete = (lines + chunk).split('\n');
      lines = complete.pop();
      for (const line of complete) {
        const matched = line.match(/^out_time_us=(\d+)\s*$/u);
        if (matched) report(Math.min(.99, Number(matched[1]) / 1e6 / duration));
      }
    });
    let spawnError;
    child.once('error', (error) => { spawnError = error; });
    child.once('close', (code) => {
      if (signal?.aborted) reject(new Error('已取消处理。'));
      else if (spawnError) reject(spawnError);
      else if (code === 0) resolve(stderr);
      else reject(new Error(stderr.trim() || 'FFmpeg 无法处理这个文件。'));
    });
  });
}

async function inspectMedia(file) {
  const metadata = await stat(file);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let details;
  try {
    details = await execute(['-hide_banner', '-nostdin', ...inputOptions, '-i', file,
      '-t', '0', '-map', '0:V:0?', '-map', '0:a:0?', '-f', 'null', '-'],
    { capture: true, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('读取媒体信息超时。');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const header = details.split('Stream mapping:')[0];
  const duration = header.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/u);
  const video = header.split('\n').find((line) => line.includes('Video:') && !line.includes('(attached pic)'));
  const audio = header.split('\n').find((line) => line.includes('Audio:'));
  const resolution = video?.match(/\b(\d{2,5})x(\d{2,5})\b/u);
  const fps = video?.match(/([\d.]+)\s+fps\b/u);
  const rate = header.match(/bitrate:\s*(\d+)\s*kb\/s/u);
  const codec = (line, type) => line?.split(`${type}: `)[1]?.match(/^[\w-]+/u)?.[0] ?? '';
  return {
    name: path.basename(file), bytes: metadata.size,
    duration: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0,
    bitrate: Number(rate?.[1] ?? 0), width: Number(resolution?.[1] ?? 0), height: Number(resolution?.[2] ?? 0),
    fps: Number(fps?.[1] ?? 0), audio: Boolean(audio), videoCodec: codec(video, 'Video'), audioCodec: codec(audio, 'Audio'),
  };
}

async function convertVideo(file, options, pickSave, signal, report) {
  const { mode, format } = options;
  if (!Object.hasOwn(extensions, mode) || !extensions[mode].includes(format)) throw new Error('不支持所选媒体操作或格式。');
  const limit = 360_000;
  const start = ['cut', 'frame', 'gif'].includes(mode) ? range(options.start, 0, limit, '起始时间') : 0;
  const end = ['cut', 'gif'].includes(mode) ? range(options.end, 0, limit, '结束时间') : 0;
  if (end && end <= start || (['cut', 'gif'].includes(mode) && !end)) throw new Error('结束时间必须晚于起始时间。');
  if (mode === 'gif' && end - start > 120) throw new Error('GIF 片段最长为 120 秒。');
  const speed = range(options.speed ?? 1, .5, 2, '播放倍速');
  const duration = end ? (end - start) / speed : (Number(options.duration) || 0) / speed;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-abort_on', 'empty_output', '-y',
    '-progress', 'pipe:1', '-nostats'];
  if (start) args.push('-ss', String(start));
  if (end) args.push('-t', String(end - start));
  args.push(...inputOptions, '-i', file);

  if (mode === 'audio') {
    const codec = { mp3: 'libmp3lame', wav: 'pcm_s16le', flac: 'flac', m4a: 'aac', opus: 'libopus' }[format];
    args.push('-map', '0:a:0', '-vn', '-c:a', codec);
    if (['mp3', 'm4a', 'opus'].includes(format)) args.push('-b:a', `${range(options.audioRate ?? 160, 32, 320, '音频码率', true)}k`);
  } else if (mode === 'frame') {
    args.push('-map', '0:V:0', '-an', '-frames:v', '1', '-update', '1');
    if (format === 'jpg') args.push('-q:v', String(range(options.frameQuality ?? 3, 2, 31, 'JPEG 质量', true)));
  } else if (mode === 'gif') {
    const width = range(options.width ?? 480, 64, 1920, 'GIF 宽度', true);
    const fps = range(options.fps ?? 12, 1, 30, 'GIF 帧率');
    args.push('-an', '-filter_complex',
      `[0:V:0]fps=${fps},scale=w='min(${width},iw)':h=-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse[g]`,
      '-map', '[g]', '-loop', '0');
  } else {
    const encoding = format === 'webm' ? 'libvpx-vp9' : (options.codec === 'hevc' ? 'libx265' : 'libx264');
    args.push('-map', '0:V:0', '-c:v', encoding, '-pix_fmt', 'yuv420p');
    if (format !== 'webm') {
      const preset = options.preset ?? 'fast';
      if (!['ultrafast', 'veryfast', 'fast', 'medium', 'slow'].includes(preset)) throw new Error('编码预设无效。');
      args.push('-preset', preset);
    }
    if (format === 'mp4') {
      args.push('-movflags', '+faststart');
      if (encoding === 'libx265') args.push('-tag:v', 'hvc1');
    }
    if (options.control === 'bitrate') {
      const limit = range(options.bitrate, 64, 150000, '视频码率', true);
      args.push('-b:v', `${limit}k`);
    } else {
      const max = format === 'webm' ? 63 : 51;
      args.push('-crf', String(range(options.quality ?? 25, 0, max, 'CRF', true)));
      if (format === 'webm') args.push('-b:v', '0');
    }
    const filter = [];
    if (options.height) {
      const height = range(options.height, 144, 4320, '高度上限', true);
      filter.push(`scale=w=-2:h='trunc(min(ih,${height})/2)*2'`);
    }
    if (speed !== 1) filter.push(`setpts=PTS/${speed}`);
    if (options.fps) filter.push(`fps=${range(options.fps, 1, 240, '输出帧率')}`);
    filter.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    args.push('-vf', filter.join(','));
    if (options.keepAudio === false) args.push('-an');
    else args.push('-map', '0:a:0?', '-c:a', format === 'webm' ? 'libopus' : 'aac',
      '-b:a', `${range(options.audioRate ?? 128, 32, 320, '音频码率', true)}k`);
  }
  if (mode === 'audio') {
    if (options.sampleRate) args.push('-ar', String(range(options.sampleRate, 8000, 96000, '采样率', true)));
    if (options.channels) args.push('-ac', String(range(options.channels, 1, 2, '声道数', true)));
  }
  if (speed !== 1 && !['frame', 'gif'].includes(mode)) args.push('-af', `atempo=${speed}`);
  if (options.removeMetadata) args.push('-map_metadata', '-1', '-map_chapters', '-1');

  const basename = path.basename(file, path.extname(file));
  const target = await pickSave('保存处理结果', `${basename}-${mode}.${format}`, [format]);
  if (!target) return null;
  if (target.toLowerCase() === file.toLowerCase()) throw new Error('请选择其他输出文件，避免覆盖原文件。');
  return withOutput(target, async (output) => {
    await execute([...args, output], { signal, duration, report });
    if (!(await stat(output)).size) throw new Error('指定时间没有可导出的内容。');
  });
}

module.exports = { convertVideo, inspectMedia };
