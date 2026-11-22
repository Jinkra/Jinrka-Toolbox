const { spawnSync } = require('node:child_process');
const { unlinkSync } = require('node:fs');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const { version } = require('../package.json');
const { releaseFilename } = require('../desktop/update-manifest.cjs');

async function buildInstaller() {
  const root = path.resolve(__dirname, '..');
  const release = path.join(root, 'release');
  const payload = path.join(release, `Jinkra-Toolbox-Payload-${version}-x64.exe`);
  const installer = path.join(release, releaseFilename(version));
  const electronDist = process.env.JINKRA_ELECTRON_DIST;
  await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never',
    ...(electronDist && { config: { electronDist } }) });

  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const buildResult = spawnSync(compiler, [
    '/nologo', '/codepage:65001', '/target:winexe', '/optimize+', '/platform:x64',
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/win32icon:' + path.join(root, 'assets', 'icon.ico'),
    '/out:' + installer, '/resource:' + payload + ',package.exe',
    '/resource:' + path.join(root, 'assets', 'icon.png') + ',logo.png',
    path.join(root, 'desktop', 'windows-setup.cs'),
  ], { stdio: 'inherit', windowsHide: true });
  if (buildResult.error) throw buildResult.error;
  if (buildResult.status !== 0) throw new Error('Windows 安装向导编译失败。');
  unlinkSync(payload);
}

buildInstaller().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
