import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const version = '9.1';
const basename = `ffmpeg-${version}-essentials_build`;
const digest = '835b9a733445ba7a56a37a26cf7bde84e2f3ce7da2a8ec984276bb2abb1b922c';
const url = `https://www.gyan.dev/ffmpeg/builds/packages/${basename}.7z`;
const destination = fileURLToPath(new URL('../vendor/ffmpeg/', import.meta.url));
const marker = path.join(destination, `version-${version}`);
const files = { 'bin/ffmpeg.exe': 'ffmpeg.exe', LICENSE: 'LICENSE', 'README.txt': 'README.txt' };

const cached = await Promise.all([marker, ...Object.values(files).map((file) => path.join(destination, file))]
  .map((file) => access(file).then(() => true, () => false)));
if (cached.every(Boolean)) process.exit(0);
if (process.platform !== 'win32') throw new Error('此构建脚本需要 Windows。');

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${executable} 退出码 ${code}。`)));
  });
}

const temp = await mkdtemp(path.join(tmpdir(), 'jinkra-ffmpeg-'));
const staging = `${destination.replace(/[\\/]$/u, '')}-staging`;
await mkdir(path.dirname(staging), { recursive: true });
try {
  const archive = process.env.JINKRA_FFMPEG_ARCHIVE || path.join(temp, 'ffmpeg.7z');
  if (!process.env.JINKRA_FFMPEG_ARCHIVE) {
    console.log(`下载用于 Windows 安装包的 FFmpeg ${version}…`);
    await run('curl.exe', ['--fail', '--silent', '--show-error', '--location',
      '--retry', '2', '--max-time', '180', '--output', archive, url]);
  }
  const checksum = createHash('sha256');
  for await (const chunk of createReadStream(archive)) checksum.update(chunk);
  if (checksum.digest('hex') !== digest) throw new Error('FFmpeg 归档的 SHA-256 与发布记录不一致。');
  const output = await mkdtemp(staging);
  try {
    const requested = Object.keys(files).map((file) => `${basename}/${file}`);
    await run('tar.exe', ['-xf', archive, '-C', temp, ...requested]);
    for (const [index, file] of Object.values(files).entries()) {
      await copyFile(path.join(temp, requested[index]), path.join(output, file));
    }
    await mkdir(destination, { recursive: true });
    for (const file of Object.values(files)) await rename(path.join(output, file), path.join(destination, file));
    await writeFile(marker, version);
    console.log(`FFmpeg ${version} 已就绪。`);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
