import { applyEdits, createScanner, format, SyntaxKind } from 'jsonc-parser';
import { area, check, field, input, isPro, outputTool, proValue, select, transformTool } from '../ui.js';

function json(source, mode, indent = '2', eol = '\n') {
  JSON.parse(source);
  if (mode === 'validate') return 'JSON 有效。';
  if (mode === 'format') return applyEdits(source, format(source, undefined, {
    tabSize: Number(indent) || 2, insertSpaces: indent !== 'tabs', eol,
  })).replace(/\r\n|\n|\r/gu, eol);
  const scanner = createScanner(source, true);
  const pieces = [];
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    pieces.push(source.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()));
  }
  return pieces.join('');
}

function decodeBase64(source) {
  const standard = source.replace(/\s+/gu, '').replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Uint8Array.from(atob(standard), (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

function encodeBase64(source) {
  const bytes = new TextEncoder().encode(source);
  const pieces = [];
  for (let index = 0; index < bytes.length; index += 8192) {
    pieces.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  }
  return btoa(pieces.join(''));
}

function parseDate(source, unit = 'auto') {
  const value = source.trim();
  if (!value) throw new Error('请输入时间戳或日期时间。');
  const date = /^-?\d+(?:\.\d+)?$/u.test(value)
    ? new Date(Number(value) * (unit === 'seconds' || (unit === 'auto' && Math.abs(Number(value)) < 1e11) ? 1000 : 1))
    : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('无法识别日期。可输入 ISO 8601 格式或 Unix 时间戳。');
  return date;
}

function describeDate(date, timeZone) {
  const local = new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'full', timeStyle: 'long', timeZone,
  }).format(date);
  return `${timeZone || '本地时间'}    ${local}\nUTC         ${date.toISOString()}\n秒          ${Math.floor(date.getTime() / 1000)}\n毫秒        ${date.getTime()}`;
}

function naming(source, separator) {
  const words = source.trim()
    .replace(/(\p{Ll}|\d)(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((word) => word.toLowerCase());
  if (!words.length) throw new Error('请输入包含字母或数字的名称。');
  const caps = (word) => word[0].toUpperCase() + word.slice(1);
  return [
    ['camelCase', words[0] + words.slice(1).map(caps).join('')],
    ['PascalCase', words.map(caps).join('')],
    ['snake_case', words.join('_')],
    ['kebab-case', words.join('-')],
    ['CONSTANT_CASE', words.join('_').toUpperCase()], ...(separator == null ? [] : [['自定义分隔', words.join(separator)]]),
  ].map(([label, value]) => `${label.padEnd(15)} ${value}`).join('\n');
}

function findMatches(pattern, flags, text, limit) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./regex.worker.js', import.meta.url), { type: 'module' });
    const finish = (complete, value) => {
      clearTimeout(timeout);
      worker.terminate();
      complete(value);
    };
    const timeout = setTimeout(() => finish(reject, new Error('匹配超时，请简化表达式或缩短测试文本。')), 1500);
    worker.onmessage = ({ data }) => data.error ? finish(reject, new Error(data.error)) : finish(resolve, data.result);
    worker.onerror = () => finish(reject, new Error('无法启动匹配任务。'));
    worker.postMessage({ pattern, flags, text, limit });
  });
}

function nextSnowflake(machine) {
  const worker = Number(machine);
  if (!/^\d+$/u.test(machine) || !Number.isInteger(worker) || worker > 1023) {
    throw new Error('机器编号必须是 0 到 1023 的整数。');
  }
  const key = `jinkra.snowflake.${worker}`;
  const now = Date.now();
  const last = JSON.parse(localStorage.getItem(key) || 'null');
  let time = Math.max(now, last?.time ?? now);
  let sequence = last?.time === time ? last.sequence + 1 : 0;
  if (sequence > 4095) {
    time += 1;
    sequence = 0;
  }
  const epoch = Date.UTC(2024, 0, 1);
  if (time < epoch || time - epoch >= 2 ** 41) throw new Error('系统时间超出可用范围。');
  localStorage.setItem(key, JSON.stringify({ time, sequence }));
  return ((BigInt(time - epoch) << 22n) | (BigInt(worker) << 12n) | BigInt(sequence)).toString();
}

function integerFromBase(source, base) {
  const text = source.trim().toLowerCase();
  if (!/^[+-]?[0-9a-z]+$/u.test(text)) throw new Error('请输入整数，支持正负号。');
  const digits = text.replace(/^[+-]/u, '');
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let value = 0n;
  for (const digit of digits) {
    const index = alphabet.indexOf(digit);
    if (index >= base) throw new Error(`字符 ${digit} 在 ${base} 进制中无效。`);
    value = value * BigInt(base) + BigInt(index);
  }
  return text.startsWith('-') ? -value : value;
}

const units = {
  B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12,
  KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4,
};

export const developerTools = [
  { id: 'json', name: 'JSON 格式化', icon: 'Braces', keywords: '校验 压缩', description: '格式化、压缩并校验 JSON 数据。', render: () => {
    const indent = select([['2', '2 个空格'], ['4', '4 个空格'], ['tabs', 'Tab']]);
    const line = select([['unix', 'LF'], ['windows', 'CRLF']]);
    return transformTool({
      sample: '{"toolbox":"Jinkra","offline":true,"tools":["JSON","图片","PDF"]}',
      advanced: [field('缩进', indent), field('输出换行符', line)],
      operations: [['格式化', (source) => json(source, 'format', proValue(indent, '2'), proValue(line, 'unix') === 'windows' ? '\r\n' : '\n')], ['压缩', (source) => json(source, 'compact')],
        ['校验', (source) => json(source, 'validate')]],
    });
  } },
  { id: 'base64', name: 'Base64 编解码', icon: 'Binary', keywords: 'base64url unicode', description: '转换 UTF-8 文本与 Base64 字符串。', render: () => {
    const alphabet = select([['normal', '标准 Base64'], ['url', 'Base64 URL 安全模式']]);
    const [padLabel, pad] = check('保留填充字符 =', true);
    return transformTool({ sample: '你好，Jinkra！', advanced: [field('字母表', alphabet), padLabel], operations: [['编码', (source) => {
      let value = encodeBase64(source);
      if (proValue(alphabet, 'normal') === 'url') value = value.replaceAll('+', '-').replaceAll('/', '_');
      if (isPro() && !pad.checked) value = value.replace(/=+$/u, '');
      return value;
    }], ['解码', decodeBase64]] });
  } },
  { id: 'url', name: 'URL 编解码', icon: 'Link2', keywords: 'URI 百分号', description: '编码或还原 URL 参数、完整地址和表单值。', render: () => {
    const style = select([['component', '单个参数'], ['whole', '完整 URL'], ['form', '表单值（空格为 +）']]);
    return transformTool({ sample: '关键词=桌面工具&标签=离线', advanced: field('编码范围', style), operations: [['编码', (source) => {
      const type = proValue(style, 'component');
      if (type === 'whole') return encodeURI(source);
      if (type === 'form') return new URLSearchParams({ value: source }).toString().slice(6);
      return encodeURIComponent(source);
    }], ['解码', (source) => {
      const type = proValue(style, 'component');
      return type === 'whole' ? decodeURI(source) : decodeURIComponent(type === 'form' ? source.replaceAll('+', ' ') : source);
    }]] });
  } },
  { id: 'timestamp', name: '时间戳转换', icon: 'Clock3', keywords: 'unix 日期', description: '查看 Unix 时间戳、UTC 和本地时间。', render: () => {
    const unit = select([['auto', '自动识别'], ['seconds', '秒'], ['millis', '毫秒']]);
    const zone = input({ placeholder: '例如 Asia/Shanghai 或 UTC' });
    return transformTool({ sample: '1735689600', advanced: [field('数字输入单位', unit), field('输出时区', zone, '留空使用系统时区。')],
      operations: [['转换', (source) => describeDate(parseDate(source, proValue(unit, 'auto')), proValue(zone, '').trim() || undefined)],
        ['现在', () => describeDate(new Date(), proValue(zone, '').trim() || undefined)]] });
  } },
  { id: 'naming', name: '命名互转', icon: 'CaseSensitive', keywords: '驼峰 蛇形 camelCase kebab-case', description: '在驼峰、下划线和连字符等命名间转换。', render: () => {
    const separator = input({ value: '.', maxlength: 12 });
    return transformTool({ sample: 'httpResponseStatus', advanced: field('自定义分隔符', separator),
      operations: [['转换命名', (source) => naming(source, proValue(separator, null))]] });
  } },
  { id: 'regex', name: '正则测试', icon: 'Regex', keywords: 'regexp regex', description: '查看正则匹配位置与捕获组。', render: () => {
    const pattern = input({ value: '(\\w+)@(\\w+\\.\\w+)', spellcheck: 'false' });
    const flags = input({ value: 'g', spellcheck: 'false' });
    const limit = select(['100', '25', '250', '500']);
    const text = area('输入要匹配的文本…', '联系 hello@example.com 或 team@jinkra.dev');
    return outputTool([field('表达式', pattern), field('测试文本', text)], '测试表达式',
      () => findMatches(pattern.value, proValue(flags, 'g'), text.value, Number(proValue(limit, '100'))),
      [field('正则标志', flags, '例如 gi 表示全局匹配并忽略大小写。'), field('最大匹配数', limit)]);
  } },
  { id: 'hash', name: '文本哈希', icon: 'Hash', keywords: 'sha256 sha512 sha1 digest', description: '为 UTF-8 文本计算 SHA 摘要。', render: () => {
    const algorithm = select(['SHA-256', 'SHA-384', 'SHA-512', 'SHA-1']);
    const encoding = select([['hex', '小写十六进制'], ['upper', '大写十六进制'], ['base64', 'Base64']]);
    return transformTool({ fields: field('哈希算法', algorithm), sample: 'Jinkra', advanced: field('摘要输出格式', encoding), operations: [['计算摘要', async (source) => {
      const digest = await crypto.subtle.digest(algorithm.value, new TextEncoder().encode(source));
      const bytes = new Uint8Array(digest);
      const format = proValue(encoding, 'hex');
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return format === 'base64' ? btoa(String.fromCharCode(...bytes)) : format === 'upper' ? hex.toUpperCase() : hex;
    }]] });
  } },
  { id: 'ids', name: 'ID 生成', icon: 'Fingerprint', keywords: 'UUID 雪花 Snowflake GUID', description: '生成 UUID v4 或带机器编号的雪花 ID。', render: () => {
    const type = select([['uuid', 'UUID v4'], ['snowflake', '雪花 ID']]);
    const machine = input({ type: 'number', min: 0, max: 1023, value: 0 });
    const batch = select(['1', '5', '10', '20', '50', '100']);
    const worker = field('机器编号', machine, '起始时间为 2024-01-01 UTC。跨设备使用时请分配不同的机器编号。');
    worker.hidden = true;
    type.addEventListener('change', () => { worker.hidden = type.value === 'uuid'; });
    return outputTool([field('ID 类型', type)], '生成 ID',
      () => Array.from({ length: Number(proValue(batch, '1')) }, () => type.value === 'uuid' ? crypto.randomUUID() : nextSnowflake(proValue(machine, '0'))).join('\n'),
      [worker, field('批量数量', batch)]);
  } },
  { id: 'cron', name: 'Cron 解析', icon: 'CalendarClock', keywords: 'cron crontab 计划 时间', description: '检查 Cron 表达式，查看接下来的触发时间。', render: () => {
    const expression = input({ value: '0 9 * * 1-5', spellcheck: 'false' });
    const zone = input({ value: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const count = select(['8', '3', '15', '30', '50']);
    const baseline = input({ type: 'datetime-local' });
    return outputTool([field('表达式', expression, '支持五字段和含秒的六字段。')],
      '查看触发时间', async () => {
        const { CronExpressionParser } = await import('cron-parser');
        const tz = proValue(zone, Intl.DateTimeFormat().resolvedOptions().timeZone).trim();
        const parsed = CronExpressionParser.parse(expression.value.trim(), { tz, currentDate: proValue(baseline, '') || undefined });
        const formatTime = new Intl.DateTimeFormat('zh-CN', {
          timeZone: tz, dateStyle: 'full', timeStyle: 'long',
        });
        return parsed.take(Number(proValue(count, '8'))).map((date) => formatTime.format(date.toDate())).join('\n');
      }, [field('时区', zone, '例如 Asia/Shanghai 或 UTC。'), field('计算起点', baseline), field('显示次数', count)]);
  } },
  { id: 'jwt', name: 'JWT 解析', icon: 'KeyRound', keywords: 'token JSON Web Token', description: '查看 JWT 的头部、载荷和过期时间。', render: () => {
    const part = select([['all', '全部'], ['header', '仅头部'], ['payload', '仅载荷']]);
    const [utcLabel, utc] = check('声明时间使用 UTC', true);
    return transformTool({ placeholder: '粘贴三段式 JWT…', advanced: [field('显示内容', part), utcLabel], operations: [['解析 JWT', (source) => {
      const [header, payload, signature, ...rest] = source.trim().split('.');
      if (!header || !payload || signature === undefined || rest.length) throw new Error('请输入三段式 JWT。');
      const data = JSON.parse(decodeBase64(payload));
      const head = json(decodeBase64(header), 'format');
      const body = json(decodeBase64(payload), 'format');
      const show = proValue(part, 'all');
      if (show === 'header') return head;
      if (show === 'payload') return body;
      const dates = [['exp', '过期'], ['nbf', '生效'], ['iat', '签发']].filter(([key]) => typeof data?.[key] === 'number')
        .map(([key, label]) => {
          const date = new Date(data[key] * 1000);
          const value = Number.isFinite(date.getTime()) ? (isPro() && utc.checked ? date.toISOString() : date.toLocaleString()) : '无效';
          return `${label}时间  ${value}`;
        });
      return [`头部\n${head}`, `载荷\n${body}`, [...dates, '签名状态  未验证'].join('\n')].join('\n\n');
    }]] });
  } },
  { id: 'radix', name: '进制转换', icon: 'ArrowDownUp', keywords: '十六进制 八进制 二进制 BigInt', description: '在二、八、十及十六进制之间转换整数。', render: () => {
    const original = select([['10', '十进制'], ['2', '二进制'], ['8', '八进制'], ['16', '十六进制']]);
    const value = input({ value: '255', spellcheck: 'false' });
    const from = input({ type: 'number', min: 2, max: 36, value: 10 });
    const to = input({ type: 'number', min: 2, max: 36, value: 16 });
    return outputTool([field('输入进制', original), field('整数', value)], '转换进制', () => {
      if (isPro()) {
        for (const base of [from, to]) if (!/^\d+$/u.test(base.value) || !base.checkValidity()) throw new Error('进制必须是 2 到 36 之间的整数。');
        return integerFromBase(value.value, Number(from.value)).toString(Number(to.value));
      }
      const number = integerFromBase(value.value, Number(original.value));
      return [2, 8, 10, 16].map((base) => `${String(base).padStart(2)} 进制    ${number.toString(base)}`).join('\n');
    }, [field('自定义输入进制', from), field('自定义输出进制', to)]);
  } },
  { id: 'bytes', name: '字节换算', icon: 'Layers3', keywords: 'kb mb gb mib 容量', description: '换算十进制和二进制存储单位。', render: () => {
    const unit = select(Object.keys(units));
    const value = input({ type: 'number', min: 0, step: 'any', value: 1048576 });
    const digits = select(['12', '4', '6', '8', '16']);
    const target = select([['all', '全部单位'], ...Object.keys(units)]);
    return outputTool([field('数值', value), field('输入单位', unit)], '换算', () => {
      const number = Number(value.value) * units[unit.value];
      if (!value.value || !Number.isFinite(number) || number < 0) throw new Error('请输入有效的非负数。');
      const formatNumber = new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: Number(proValue(digits, '12')) });
      return Object.entries(units).filter(([name]) => !isPro() || target.value === 'all' || name === target.value)
        .map(([name, ratio]) => `${name.padEnd(4)} ${formatNumber.format(number / ratio)}`).join('\n');
    }, [field('有效数字', digits), field('目标单位', target)]);
  } },
];
