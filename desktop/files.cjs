const fs = require('node:fs');
const { lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir, link, unlink } = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { crc32 } = require('node:zlib');
const yauzl = require('yauzl');
const { ZipFile } = require('yazl');

const algorithms = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'];

function validateName(name) {
  if (!name || /[<>:"/\\|?*\x00-\x1f]/u.test(name) || /[. ]$/u.test(name) ||
      /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(name) || name.length > 255) {
    throw new Error(`Windows 文件名无效：${name || '空名称'}`);
  }
  return name;
}

async function isPresent(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function regularFile(file) {
  if (!(await lstat(file)).isFile()) throw new Error(`请选择普通文件：${path.basename(file)}`);
}

async function withOutput(destination, write) {
  const temp = await mkdtemp(path.join(path.dirname(destination), '.jinkra-'));
  try {
    const intermediate = path.join(temp, path.basename(destination));
    await write(intermediate);
    await rename(intermediate, destination);
    return destination;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function createZip(files, destination, compressionLevel = 6) {
  if (!Number.isInteger(compressionLevel) || compressionLevel < 0 || compressionLevel > 9) throw new Error('压缩等级必须是 0–9。');
  const entries = [];
  const names = new Set();
  async function add(file, name) {
    const metadata = await lstat(file);
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error(`归档中已有同名路径：${name}`);
    names.add(key);
    if (metadata.isFile()) {
      entries.push({ file, name });
    } else if (metadata.isDirectory()) {
      entries.push({ name, directory: true });
      for (const item of await readdir(file)) await add(path.join(file, item), `${name}/${validateName(item)}`);
    } else {
      throw new Error(`归档不支持链接或特殊文件：${name}`);
    }
  }
  for (const file of files) {
    const source = file.toLowerCase();
    const target = destination.toLowerCase();
    if (source === target || target.startsWith(source + path.sep)) throw new Error('请将 ZIP 保存到源文件夹之外。');
    await add(file, validateName(path.basename(file)));
  }
  return withOutput(destination, async (output) => {
    const archive = new ZipFile();
    const writing = pipeline(archive.outputStream, fs.createWriteStream(output, { flags: 'wx' }));
    archive.on('error', (error) => archive.outputStream.destroy(error));
    try {
      for (const { file, name, directory } of entries) {
        if (directory) archive.addEmptyDirectory(name);
        else archive.addFile(file, name, { compressionLevel });
      }
      archive.end();
    } catch (error) {
      archive.outputStream.destroy(error);
    }
    await writing;
  });
}

async function extractZip(archive, parent, flatten = false) {
  await regularFile(archive);
  const suggested = path.join(parent, validateName(path.basename(archive, path.extname(archive)) || '解压文件'));
  let output = suggested;
  for (let index = 2; ; index += 1) {
    try {
      await mkdir(output);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      output = `${suggested} (${index})`;
    }
  }
  try {
    const zip = await promisify(yauzl.open)(archive, { lazyEntries: true, strictFileNames: true });
    try {
      for await (const entry of zip.eachEntry()) {
        const folder = entry.fileName.endsWith('/');
        const names = (folder ? entry.fileName.slice(0, -1) : entry.fileName).split('/').map(validateName);
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode && mode !== 0o100000 && mode !== 0o040000) throw new Error('归档包含不支持的特殊文件。');
        if (folder && flatten) continue;
        const target = path.join(output, ...(flatten ? names.slice(-1) : names));
        if (folder) {
          await mkdir(target, { recursive: true });
        } else {
          await mkdir(path.dirname(target), { recursive: true });
          const stream = await promisify(zip.openReadStream.bind(zip))(entry);
          let checksum = 0;
          const verify = new Transform({
            transform(chunk, _encoding, callback) {
              checksum = crc32(chunk, checksum);
              callback(null, chunk);
            },
            flush(callback) {
              callback(checksum === entry.crc32 ? null : new Error(`归档数据损坏：${entry.fileName}`));
            },
          });
          await pipeline(stream, verify, fs.createWriteStream(target, { flags: 'wx' }));
        }
      }
    } finally {
      zip.close();
    }
    return output;
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

async function hashFiles(files, algorithm) {
  if (!algorithms.includes(algorithm)) throw new Error('请选择有效的哈希算法。');
  const results = [];
  for (const file of files) {
    await regularFile(file);
    const hash = createHash(algorithm);
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    results.push({ name: path.basename(file), hash: hash.digest('hex') });
  }
  return results;
}

async function prepareRenames(files, { prefix = '', suffix = '', find = '', replace = '', numbered = false, start = 1,
  digits = 2, separator = '-', casing = 'keep' } = {}) {
  const fields = [prefix, suffix, find, replace, separator];
  if (fields.some((field) => typeof field !== 'string' || field.length > 255)) throw new Error('请检查重命名参数。');
  if (numbered && (!Number.isSafeInteger(start) || start < 0 || start > 999999999)) throw new Error('起始序号应为 0 到 999999999。');
  if (!Number.isInteger(digits) || digits < 1 || digits > 10 || !['keep', 'lower', 'upper'].includes(casing)) {
    throw new Error('请检查序号位数和大小写设置。');
  }
  const targets = new Set();
  const changes = [];
  for (const [index, source] of files.entries()) {
    await regularFile(source);
    const extension = path.extname(source);
    const before = path.basename(source);
    const stem = path.basename(source, extension);
    const replaced = find ? stem.replaceAll(find, () => replace) : stem;
    const number = numbered ? `${String(start + index).padStart(digits, '0')}${separator}` : '';
    const name = `${prefix}${number}${replaced}${suffix}`;
    const after = validateName(`${casing === 'lower' ? name.toLowerCase() : casing === 'upper' ? name.toUpperCase() : name}${extension}`);
    const target = path.join(path.dirname(source), after);
    const key = target.toLowerCase();
    if (targets.has(key) || (key !== source.toLowerCase() && await isPresent(target))) {
      throw new Error(`目标文件已存在或重复：${after}`);
    }
    targets.add(key);
    changes.push({ source, target, before, after, changed: before !== after });
  }
  return changes;
}

async function planRenames(files, settings) {
  return (await prepareRenames(files, settings)).map(({ before, after, changed }) => ({ before, after, changed }));
}

async function moveWithoutOverwrite(source, target) {
  if (source.toLowerCase() !== target.toLowerCase()) {
    await link(source, target);
    try {
      await unlink(source);
    } catch (error) {
      await unlink(target);
      throw error;
    }
    return;
  }
  const temp = await mkdtemp(path.join(path.dirname(source), '.jinkra-'));
  const staged = path.join(temp, path.basename(source));
  try {
    await rename(source, staged);
    try {
      await moveWithoutOverwrite(staged, target);
    } catch (error) {
      await moveWithoutOverwrite(staged, source);
      throw error;
    }
  } finally {
    await rmdir(temp).catch(() => {});
  }
}

async function applyRenames(files, settings) {
  const changes = (await prepareRenames(files, settings)).filter(({ changed }) => changed);
  const moved = [];
  try {
    for (const change of changes) {
      await moveWithoutOverwrite(change.source, change.target);
      moved.push(change);
    }
  } catch (error) {
    const retained = [];
    for (const change of moved.reverse()) {
      await moveWithoutOverwrite(change.target, change.source).catch(() => retained.push(change.after));
    }
    if (retained.length) throw new Error(`部分改名无法撤回：${retained.join('、')}。原因：${error.message}`);
    if (error.code === 'ENOTSUP' || error.code === 'EPERM' || error.code === 'ENOSYS') {
      throw new Error('无法在此位置安全重命名。请检查权限或将文件移到 NTFS 磁盘。');
    }
    throw error;
  }
  return moved.length;
}

module.exports = { createZip, extractZip, hashFiles, planRenames, applyRenames, validateName, withOutput };
