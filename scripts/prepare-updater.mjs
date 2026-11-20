import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('vendor/updater/', root);
await mkdir(output, { recursive: true });
const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const result = spawnSync(compiler, ['/nologo', '/target:winexe', '/optimize+', '/platform:x64',
  '/out:' + fileURLToPath(new URL('jinkra-updater.exe', output)),
  fileURLToPath(new URL('desktop/windows-updater.cs', root))], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
