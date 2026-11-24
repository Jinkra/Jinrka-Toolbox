const { execFile } = require('node:child_process');
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

// Windows ships a blank icon at imageres.dll,197; using it avoids custom overlay files entirely.
const blankOverlay = '%systemroot%\\system32\\imageres.dll,197';

// Overlay files written by earlier releases; still count as hidden by this toolbox.
function legacyArrowIcon() {
  const folders = [process.env.ProgramData, process.env.LOCALAPPDATA].filter((folder) => folder && path.isAbsolute(folder));
  return folders.flatMap((folder) => ['shortcut-overlay.ico', 'shortcut-overlay-32.ico']
    .map((name) => path.join(folder, 'Jinkra-Toolbox', name)));
}

async function refreshIcons() {
  await run(`
    Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    $cache = Join-Path $env:LOCALAPPDATA 'IconCache.db'
    if (Test-Path -LiteralPath $cache) { Remove-Item -LiteralPath $cache -Force -ErrorAction SilentlyContinue }
    Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer') -Filter 'iconcache_*.db' -ErrorAction SilentlyContinue |
      Remove-Item -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 1500
    if (!(Get-Process -Name explorer -ErrorAction SilentlyContinue)) { Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') }
  `);
}

async function arrowStatus() {
  const own = [blankOverlay, ...legacyArrowIcon()].map(literal).join(', ');
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
    const entry = show ? null : blankOverlay;
    const edit = entry
      ? `$key = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey(${literal(shellIcons)}); try { $key.SetValue('29', ${literal(entry)}, 'String') } finally { $key.Dispose() }`
      : `$key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey(${literal(shellIcons)}, $true); if ($key) { try { $key.DeleteValue('29', $false) } finally { $key.Dispose() } }`;
    await run(`$p = Start-Process -FilePath ${literal(powershell)} -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encoded(edit)}') -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`);
    if (show) await run(`$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${literal(shellIcons)}, $true); if ($key) { try { $key.DeleteValue('29', $false) } finally { $key.Dispose() } }`);
    await refreshIcons().catch(() => {});
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
