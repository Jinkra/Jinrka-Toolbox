const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const nsis = require('app-builder-lib/out/targets/nsis/nsisUtil');

const root = path.resolve(__dirname, '..');
const staging = mkdtempSync(path.join(tmpdir(), 'jinkra-portable-'));

function copyTemplates(source, destination) {
  mkdirSync(destination);
  for (const item of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name);
    const to = path.join(destination, item.name);
    if (item.isDirectory()) copyTemplates(from, to);
    else writeFileSync(to, readFileSync(from));
  }
}

async function build() {
  const helper = path.join(staging, 'jinkra-splash.exe');
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const result = spawnSync(compiler, [
    '/nologo', '/codepage:65001', '/target:winexe', '/optimize+', '/platform:x64', '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll', '/out:' + helper, '/resource:' + path.join(root, 'assets', 'icon.png') + ',logo.png',
    path.join(root, 'desktop', 'windows-splash.cs'),
  ], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Windows 启动窗口编译失败。');

  const templates = path.join(staging, 'nsis');
  copyTemplates(nsis.nsisTemplatesDir, templates);
  const script = path.join(templates, 'portable.nsi');
  const template = readFileSync(script, 'utf8').replace(/\r\n/g, '\n');
  const beforeExtract = '  !insertmacro check64BitAndSetRegView\nFunctionEnd';
  if (!template.includes(beforeExtract)) throw new Error('electron-builder 的便携启动模板已变更，请更新启动窗口接入点。');
  const splash = String.raw`
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=jinkra-splash.exe "@HELPER@"
  System::Call 'kernel32::GetCurrentProcessId() i .r1'
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("JINKRA_SPLASH_SIGNAL", "$PLUGINSDIR\jinkra-splash.ready").r0'
  Exec '"$PLUGINSDIR\jinkra-splash.exe" "$1" "$PLUGINSDIR\jinkra-splash.ready"'`;
  writeFileSync(script, template.replace(beforeExtract, (line) => line.replace('\nFunctionEnd', () =>
    splash.replace('@HELPER@', () => helper) + '\nFunctionEnd')));
  nsis.nsisTemplatesDir = templates;
  const { build: bundle, Platform, Arch } = require('electron-builder');
  const electronDist = process.env.JINKRA_ELECTRON_DIST;
  await bundle({ targets: Platform.WINDOWS.createTarget('portable', Arch.x64), publish: 'never',
    ...(electronDist && { config: { electronDist } }) });
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => rmSync(staging, { recursive: true, force: true }));
