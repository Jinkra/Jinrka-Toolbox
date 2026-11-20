import { actions, area, box, button, check, copy, el, field, input, isPro, makeStatus, outputTool, pro, proPanel, proValue, row, saveBlob, select, simpleOnly, task } from '../ui.js';

function randomIndex(length) {
  const sample = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % length);
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % length;
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const pick = randomIndex(index + 1);
    [items[index], items[pick]] = [items[pick], items[index]];
  }
  return items;
}

function passwordTool() {
  const length = input({ type: 'number', min: 4, max: 256, value: 20 });
  const preset = select([['20', '常用 · 20 位'], ['12', '短 · 12 位'], ['32', '长 · 32 位']]);
  const batch = select(['1', '4', '8', '16']);
  const [excludeLabel, exclude] = check('排除易混淆字符 I l O 0 1');
  const types = [
    ['小写字母', 'abcdefghijklmnopqrstuvwxyz'], ['大写字母', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
    ['数字', '0123456789'], ['符号', '!@#$%^&*_-+=?'],
  ].map(([label, characters]) => [...check(label, true), characters]);
  return outputTool([simpleOnly(field('密码长度', preset))], '生成密码', () => {
    const count = Number(proValue(length, preset.value));
    const selected = types.filter(([, control]) => !isPro() || control.checked)
      .map(([, , chars]) => isPro() && exclude.checked ? chars.replace(/[IlO01]/gu, '') : chars);
    if (!Number.isInteger(count) || count < 4 || count > 256) throw new Error('密码长度必须为 4 到 256 的整数。');
    if (!selected.length) throw new Error('请至少选择一类字符。');
    const pool = selected.join('');
    return Array.from({ length: Number(proValue(batch, '1')) }, () => {
      const password = selected.map((chars) => chars[randomIndex(chars.length)]);
      while (password.length < count) password.push(pool[randomIndex(pool.length)]);
      return shuffle(password).join('');
    }).join('\n');
  }, [field('自定义长度', length), field('生成条数', batch), excludeLabel, types.map(([label]) => label)]);
}

function drawTool() {
  const options = area('每行输入一个候选项…', '方案 A\n方案 B\n方案 C\n方案 D');
  const count = input({ type: 'number', min: 1, value: 1 });
  const delimiter = select([['lines', '每行一项'], ['comma', '按逗号分隔']]);
  const [repeatLabel, repeat] = check('允许重复抽中');
  return outputTool([field('候选项', options, '默认每行一项。'), field('抽取数量', count)], '开始抽签', () => {
    const choices = [...new Set(options.value.split(proValue(delimiter, 'lines') === 'lines' ? /\r?\n/u : /[,，]/u).map((item) => item.trim()).filter(Boolean))];
    const total = Number(count.value);
    const allowed = isPro() && repeat.checked;
    const max = choices.length ? (allowed ? 500 : choices.length) : 0;
    if (!Number.isInteger(total) || total < 1 || total > max) throw new Error(`请提供候选项，抽取数量上限为 ${max}。`);
    const result = allowed ? Array.from({ length: total }, () => choices[randomIndex(choices.length)]) : shuffle(choices).slice(0, total);
    return result.map((item, index) => `${index + 1}. ${item}`).join('\n');
  }, [field('候选项分隔方式', delimiter), repeatLabel]);
}

const countdown = { remaining: 0, deadline: 0, interval: null, finished: false, display: null, audio: null, sound: true, pitch: 720 };

function ring() {
  const audio = countdown.audio;
  if (!countdown.sound || audio?.state !== 'running') return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  oscillator.frequency.value = countdown.pitch;
  gain.gain.setValueAtTime(0.11, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.6);
}

function tick() {
  if (countdown.deadline) {
    countdown.remaining = Math.max(0, countdown.deadline - Date.now());
    if (!countdown.remaining) {
      countdown.finished = true;
      countdown.deadline = 0;
      clearInterval(countdown.interval);
      ring();
    }
  }
  countdown.display?.();
}

function timerTool() {
  const minutes = input({ type: 'number', min: 0, max: 720, value: 5 });
  const seconds = input({ type: 'number', min: 0, max: 59, value: 0 });
  const clock = el('p', { class: 'countdown', role: 'timer' }, '05:00');
  const status = makeStatus();
  const [soundLabel, sound] = check('结束时播放提示音', true);
  const pitch = select([['720', '标准'], ['440', '低音'], ['1000', '高音']]);
  const shortcuts = actions(...[1, 5, 10, 25].map((duration) => button(`${duration} 分钟`, () => {
    if (countdown.deadline) return;
    minutes.value = String(duration);
    seconds.value = '0';
    reset();
  })));
  const start = button('开始', () => {
    if (countdown.deadline) return;
    const mins = Number(minutes.value);
    const secs = Number(seconds.value);
    if (!countdown.remaining) {
      if (!Number.isInteger(mins) || !Number.isInteger(secs) || mins < 0 || mins > 720 || secs < 0 || secs > 59 || (!mins && !secs)) {
        status.set('请输入有效时长。分钟为 0–720，秒为 0–59。', 'error');
        return;
      }
      countdown.remaining = (mins * 60 + secs) * 1000;
    }
    if (!countdown.audio) countdown.audio = new AudioContext();
    void countdown.audio.resume().catch(() => {});
    countdown.sound = !isPro() || sound.checked;
    countdown.pitch = Number(proValue(pitch, '720'));
    countdown.finished = false;
    countdown.deadline = Date.now() + countdown.remaining;
    countdown.interval = setInterval(tick, 200);
    tick();
  }, 'primary');
  const pause = button('暂停', () => {
    if (!countdown.deadline) return;
    tick();
    countdown.deadline = 0;
    clearInterval(countdown.interval);
    tick();
  });
  function reset() {
    clearInterval(countdown.interval);
    countdown.remaining = 0;
    countdown.deadline = 0;
    countdown.finished = false;
    tick();
  }
  countdown.display = () => {
    const duration = countdown.remaining || (!countdown.finished ? ((Number(minutes.value) || 0) * 60 + (Number(seconds.value) || 0)) * 1000 : 0);
    const rounded = Math.ceil(duration / 1000);
    clock.textContent = `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
    start.disabled = Boolean(countdown.deadline);
    start.textContent = !countdown.deadline && countdown.remaining ? '继续' : '开始';
    pause.disabled = !countdown.deadline;
    minutes.disabled = seconds.disabled = Boolean(countdown.deadline || countdown.remaining);
    status.set(countdown.finished ? '时间到。' : '', 'success');
  };
  minutes.addEventListener('input', reset);
  seconds.addEventListener('input', reset);
  tick();
  return box(row(field('分钟', minutes), field('秒', seconds)), simpleOnly(shortcuts), proPanel(soundLabel, field('提示音音高', pitch)), clock,
    actions(start, pause, button('重置', reset, 'quiet')), status.node);
}

function memoTool() {
  const key = 'jinkra.memo';
  const content = area('记录想法、清单或待办事项…', localStorage.getItem(key) ?? '');
  content.classList.add('memo');
  const status = makeStatus();
  const [wrapLabel, wrap] = check('自动换行', true);
  const format = select([['txt', '纯文本'], ['md', 'Markdown']]);
  const counter = el('p', { class: 'hint' });
  const count = () => { counter.textContent = `${Array.from(content.value).length} 字符 · ${content.value ? content.value.split(/\r?\n/u).length : 0} 行`; };
  wrap.addEventListener('change', () => { content.wrap = wrap.checked ? 'soft' : 'off'; });
  count();
  content.addEventListener('input', () => {
    count();
    try {
      localStorage.setItem(key, content.value);
      status.set('已自动保存到本机。', 'success');
    } catch {
      status.set('本机没有足够的空间保存这条备忘录。', 'error');
    }
  });
  const panel = box(field('备忘录', content, '输入内容后会自动保存。'), proPanel(wrapLabel, field('导出格式', format)),
    pro(actions(counter, button('导出备忘录', task(status, () => saveBlob(new Blob([content.value]), `jinkra-note.${format.value}`, status))))), status.node);
  panel.addEventListener('tool-mode-changed', () => { content.wrap = isPro() && !wrap.checked ? 'off' : 'soft'; });
  return panel;
}

function clipboardTool() {
  const content = area('粘贴或输入要写入剪贴板的内容…');
  const status = makeStatus();
  const [trimLabel, trim] = check('写入前去掉首尾空白');
  const newline = select([['keep', '保持'], ['lf', 'LF'], ['crlf', 'CRLF']]);
  return box(field('剪贴板文本', content), proPanel(trimLabel, field('写入时的换行格式', newline)), actions(button('读取剪贴板', task(status, async () => {
    content.value = globalThis.desktop ? await desktop.clipboardRead() : await navigator.clipboard.readText();
    status.set(content.value ? '已读取剪贴板。' : '剪贴板没有文本。', 'success');
  }), 'primary', 'Clipboard'), button('写入剪贴板', task(status, async () => {
    if (!content.value) throw new Error('请输入要写入的文本。');
    const style = proValue(newline, 'keep');
    const value = isPro() && trim.checked ? content.value.trim() : content.value;
    await copy(style === 'keep' ? value : value.replace(/\r\n|\r|\n/gu, style === 'lf' ? '\n' : '\r\n'));
    status.set('已写入剪贴板。', 'success');
  }), 'secondary', 'Copy')), status.node);
}

export const efficiencyTools = [
  { id: 'password', name: '随机密码', icon: 'LockKeyhole', keywords: '随机 密码 安全 password', description: '按长度和字符类型生成随机密码。', render: passwordTool },
  { id: 'draw', name: '随机抽签', icon: 'Shuffle', keywords: '抽取 随机 选择 抽奖', description: '从候选列表中随机抽取若干项。', render: drawTool },
  { id: 'timer', name: '倒计时', icon: 'Timer', keywords: '计时器 定时 提醒 timer', description: '设置倒计时，暂停后可继续。', render: timerTool },
  { id: 'memo', name: '备忘录', icon: 'NotebookPen', keywords: '笔记 记事 便签 todo', description: '随手记下清单或想法，自动本地保存。', render: memoTool },
  { id: 'clipboard', name: '剪贴板', icon: 'Clipboard', keywords: '粘贴板 复制 粘贴 clipboard', description: '读取、编辑和写入剪贴板文本。', render: clipboardTool },
];
