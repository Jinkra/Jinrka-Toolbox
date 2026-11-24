const { spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const nsis = require('app-builder-lib/out/targets/nsis/nsisUtil');
const { version } = require('../package.json');
const { releaseFilename } = require('../desktop/update-manifest.cjs');

function copyTemplates(source, destination) {
  mkdirSync(destination);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTemplates(from, to);
    else writeFileSync(to, readFileSync(from));
  }
}

async function buildInstaller() {
  const root = path.resolve(__dirname, '..');
  const release = path.join(root, 'release');
  const payload = path.join(release, `Jinkra-Toolbox-Payload-${version}-x64.exe`);
  const installer = path.join(release, releaseFilename(version));
  const electronDist = process.env.JINKRA_ELECTRON_DIST;
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const staging = mkdtempSync(path.join(tmpdir(), 'jinkra-setup-build-'));
  const metadata = path.join(staging, 'SetupVersion.cs');
  const launcher = path.join(staging, 'legacy-launcher.exe');
  const uninstaller = path.join(root, 'vendor', 'updater', 'jinkra-uninstall-ui.exe');
  const originalTemplates = nsis.nsisTemplatesDir;
  const compile = (output, resources = []) => {
    const result = spawnSync(compiler, [
      '/nologo', '/codepage:65001', '/target:winexe', '/optimize+', '/platform:x64',
      '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/win32icon:' + path.join(root, 'assets', 'icon.ico'),
      '/out:' + output, ...resources,
      '/resource:' + path.join(root, 'assets', 'icon.png') + ',logo.png',
      '/resource:' + launcher + ',legacy-launcher.exe',
      path.join(root, 'desktop', 'windows-setup.cs'), metadata,
    ], { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Windows 安装或卸载向导编译失败。');
  };
  try {
    writeFileSync(metadata, `using System.Reflection;
[assembly: AssemblyVersion(${JSON.stringify(version)})]
[assembly: AssemblyInformationalVersion(${JSON.stringify(version)})]
`);
    const built = spawnSync(compiler, ['/nologo', '/codepage:65001', '/target:winexe', '/optimize+', '/platform:x64',
      '/win32icon:' + path.join(root, 'assets', 'icon.ico'), '/out:' + launcher,
      path.join(root, 'desktop', 'windows-legacy-launcher.cs')], { stdio: 'inherit', windowsHide: true });
    if (built.error) throw built.error;
    if (built.status !== 0) throw new Error('旧版启动入口编译失败。');
    mkdirSync(path.dirname(uninstaller), { recursive: true });
    compile(uninstaller);
    const templates = path.join(staging, 'nsis');
    copyTemplates(originalTemplates, templates);
    const uninstScript = path.join(templates, 'uninstaller.nsh');
    const original = readFileSync(uninstScript, 'utf8').replace(/\r\n/g, '\n');
    const beforeConfirm = '  ${If} ${Silent}\n    call un.checkAppRunning';
    if (!original.includes(beforeConfirm)) throw new Error('卸载模板已变更，请检查卸载向导的入口。');
    // Keep the silent uninstaller intact for in-place upgrades.
    writeFileSync(uninstScript, original.replace(beforeConfirm, () => '  !insertmacro jinkraUninstallWizard\n' + beforeConfirm));
    nsis.nsisTemplatesDir = templates;
    await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never',
      ...(electronDist && { config: { electronDist } }) });
    compile(installer, ['/resource:' + payload + ',package.exe']);
    unlinkSync(payload);
  } finally {
    nsis.nsisTemplatesDir = originalTemplates;
    rmSync(staging, { recursive: true, force: true });
  }
}

buildInstaller().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
