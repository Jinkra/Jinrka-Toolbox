const { execFile } = require('node:child_process');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const powershell = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const shellIcons = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Icons';
let changing = false;

const literal = (value) => "'" + value.replace(/'/g, "''") + "'";
const encoded = (value) => Buffer.from("$ErrorActionPreference='Stop'; " + value, 'utf16le').toString('base64');

async function run(script) {
  return execute(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(script)],
    { windowsHide: true, timeout: 120_000 });
}

const overlayFolders = () => [process.env.ProgramData, process.env.LOCALAPPDATA].filter((folder) => folder && path.isAbsolute(folder));

function arrowIcon() {
  return overlayFolders().map((folder) => path.join(folder, 'Jinkra-Toolbox', 'shortcut-overlay-32.ico'));
}

// Earlier releases used a 1-bit icon, which Explorer renders as a black corner.
function legacyArrowIcon() {
  return overlayFolders().map((folder) => path.join(folder, 'Jinkra-Toolbox', 'shortcut-overlay.ico'));
}

function transparentIcon() {
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  const bitmaps = sizes.map((size, index) => {
    const mask = Math.ceil(size / 32) * 4 * size;
    const bitmap = Buffer.alloc(40 + size * size * 4 + mask);
    bitmap.writeUInt32LE(40, 0);
    bitmap.writeInt32LE(size, 4);
    bitmap.writeInt32LE(2 * size, 8);
    bitmap.writeUInt16LE(1, 12);
    bitmap.writeUInt16LE(32, 14);
    bitmap.writeUInt32LE(size * size * 4 + mask, 20);
    // 32-bit BGRA with zero alpha everywhere, plus an all-transparent AND mask.
    bitmap.fill(0xff, 40 + size * size * 4);
    const entry = 6 + index * 16;
    directory[entry] = size === 256 ? 0 : size;
    directory[entry + 1] = directory[entry];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(bitmap.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += bitmap.length;
    return bitmap;
  });
  return Buffer.concat([directory, ...bitmaps]);
}

async function writeOverlay() {
  const icon = transparentIcon();
  for (const target of arrowIcon()) {
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, icon, { flag: 'wx' }).catch(async (error) => {
        if (error.code !== 'EEXIST' || !(await readFile(target)).equals(icon)) throw error;
      });
      return target;
    } catch {
      // Another Windows profile may own the shared folder.
    }
  }
  throw new Error('无法保存快捷方式覆盖图标。');
}

async function arrowStatus() {
  const own = [...arrowIcon(), ...legacyArrowIcon()].map(literal).join(', ');
  const { stdout } = await run(`
    $hives = @([Microsoft.Win32.Registry]::LocalMachine, [Microsoft.Win32.Registry]::CurrentUser)
    $values = @()
    foreach ($hive in $hives) {
      $key = $hive.OpenSubKey(${literal(shellIcons)})
      if ($key) {
        try {
          $value = $key.GetValue('29')
          if ($value) { $values += [string]$value }
        } finally { $key.Dispose() }
      }
    }
    $ours = @(${own})
    if (!$values.Count) { 'default' }
    elseif ($values | Where-Object { $_ -notin $ours }) { 'custom' }
    else { 'hidden' }
  `);
  return stdout.trim();
}

async function changeArrow(show) {
  if (typeof show !== 'boolean') throw new Error('快捷方式箭头操作无效。');
  if (changing) throw new Error('正在修改箭头设置，请稍候。');
  changing = true;
  try {
    const entry = show ? null : await writeOverlay();
    const edit = entry
      ? `$key = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey(${literal(shellIcons)}); try { $key.SetValue('29', ${literal(entry)}, 'String') } finally { $key.Dispose() }`
      : `$key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey(${literal(shellIcons)}, $true); if ($key) { try { $key.DeleteValue('29', $false) } finally { $key.Dispose() } }`;
    await run(`$p = Start-Process -FilePath ${literal(powershell)} -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encoded(edit)}') -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`);
    if (show) await run(`$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${literal(shellIcons)}, $true); if ($key) { try { $key.DeleteValue('29', $false) } finally { $key.Dispose() } }`);
    await run(`Start-Process -FilePath ${literal(path.join(system, 'ie4uinit.exe'))} -ArgumentList '-show' -WindowStyle Hidden -Wait`).catch(() => {});
    return await arrowStatus();
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('无法调用 Windows PowerShell。');
    throw new Error('箭头设置未完成。请确认管理员权限后重试。');
  } finally {
    changing = false;
  }
}

async function openSystemCheck() {
  try {
    await run(`Start-Process -FilePath ${literal(path.join(system, 'cmd.exe'))} -Verb RunAs -ArgumentList '/k sfc /scannow' -WindowStyle Normal`);
  } catch {
    throw new Error('无法启动 Windows 系统文件检查。请确认管理员权限。');
  }
}

module.exports = { arrowStatus, changeArrow, openSystemCheck };
