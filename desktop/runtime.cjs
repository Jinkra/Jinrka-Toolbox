const { shell } = require('electron');
const { readdir, stat } = require('node:fs/promises');
const path = require('node:path');
const { importedLibraries, architectureOf, dllName } = require('./pe-imports.cjs');
const { installPackage } = require('./winget.cjs');

const windows = process.env.SystemRoot || 'C:\\Windows';
const systemDirectory = (arch) => path.join(windows, arch === 'x86' ? 'SysWOW64' : 'System32');
const visualStudio = 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist';
const dotnet = 'https://learn.microsoft.com/dotnet/core/install/windows';
const directX = 'https://www.microsoft.com/download/details.aspx?id=8109';
const entries = [
  ...[
    ['vc14', 'Visual C++ v14', '2015+', ['vcruntime140.dll', 'msvcp140.dll']],
    ['vc12', 'Visual C++ 2013', '2013', ['msvcr120.dll', 'msvcp120.dll']],
    ['vc11', 'Visual C++ 2012', '2012', ['msvcr110.dll', 'msvcp110.dll']],
  ].flatMap(([key, title, version, files]) => ['x64', 'x86'].map((arch) => ({
    key: key + '-' + arch, title: `${title} · ${arch}`, id: `Microsoft.VCRedist.${version}.${arch}`, files, arch, url: visualStudio,
  }))),
  ...[8, 10].map((major) => ({
    key: 'dotnet' + major, title: `.NET Desktop Runtime ${major} · x64`, id: `Microsoft.DotNet.DesktopRuntime.${major}`,
    major, arch: 'x64', url: dotnet,
  })),
  { key: 'directx', title: 'DirectX 旧版游戏组件', url: directX,
    files: ['d3dx9_43.dll', 'xinput1_3.dll', 'd3dcompiler_43.dll'] },
];
const byKey = new Map(entries.map((entry) => [entry.key, entry]));

async function hasFile(file) {
  return Boolean((await stat(file).catch(() => null))?.isFile());
}

async function runtimeStatus() {
  const shared = path.join(process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files',
    'dotnet', 'shared', 'Microsoft.WindowsDesktop.App');
  const versions = await readdir(shared, { withFileTypes: true }).catch(() => []);
  return Promise.all(entries.map(async ({ key, title, id, files, arch, major }) => {
    const checks = files ? await Promise.all((arch ? [arch] : ['x64', 'x86'])
      .flatMap((kind) => files.map((name) => hasFile(path.join(systemDirectory(kind), name))))) : [];
    const installed = major ? versions.some((version) => version.isDirectory() && version.name.startsWith(major + '.')) : checks.every(Boolean);
    return { key, title, id, installed, manual: !id };
  }));
}

function categoryFor(name, arch) {
  if (/^(?:d3dx(?:9|10|11)_\d+|d3dcompiler_43|xaudio2_7|xinput1_3|x3daudio1_7|xactengine3_\d+)\.dll$/i.test(name)) return 'directx';
  if (!['x64', 'x86'].includes(arch)) return '';
  if (/^(?:msvcp|vcruntime|vcomp|concrt|mfc|mfcm)140(?:_\w+|u)?\.dll$/i.test(name)) return 'vc14-' + arch;
  if (/^(?:msvcp|msvcr|vcomp|mfc|mfcm)120u?\.dll$/i.test(name)) return 'vc12-' + arch;
  if (/^(?:msvcp|msvcr|vcomp|mfc|mfcm)110u?\.dll$/i.test(name)) return 'vc11-' + arch;
  return '';
}

async function inspectDll(file, pasted, manualArch) {
  if (typeof pasted !== 'string' || pasted.length > 2500 || !['x64', 'x86'].includes(manualArch)) throw new Error('DLL 检查参数无效。');
  const manual = (pasted.match(/[a-z0-9_][a-z0-9_.+-]{0,122}\.dll\b/gi) || []).filter((name) => dllName.test(name));
  const selected = file ? await importedLibraries(file) : null;
  const architecture = selected?.architecture ?? manualArch;
  const names = new Set([...(selected?.names ?? []), ...manual.map((name) => name.toLowerCase())]);
  if (!file && !names.size) throw new Error('请选择一个 EXE，或粘贴带有 DLL 文件名的错误提示。');
  const folders = [...new Set([
    ...(file ? [path.dirname(file)] : []), systemDirectory(architecture), windows,
    ...(process.env.Path ?? '').split(path.delimiter).map((folder) => folder.trim()).filter((folder) => /^[a-z]:[\\/]/i.test(folder)).slice(0, 48),
  ])];
  const libraries = [];
  for (const name of names) {
    if (/^(api-ms-win-|ext-ms-win-)/i.test(name)) {
      libraries.push({ name, state: 'api' });
      continue;
    }
    let found;
    for (const folder of folders) {
      const candidate = path.join(folder, name);
      if (await architectureOf(candidate).catch(() => '') === architecture) { found = candidate; break; }
    }
    const packageInfo = byKey.get(categoryFor(name, architecture));
    libraries.push({ name, state: found ? 'found' : 'missing', location: found,
      packageKey: packageInfo?.key, packageTitle: packageInfo?.title, manual: packageInfo && !packageInfo.id });
  }
  return { architecture, executable: file && path.basename(file), libraries };
}

function getRuntime(key) {
  const item = byKey.get(key);
  if (!item) throw new Error('不支持此运行库。');
  return item;
}

function installRuntime(key) {
  const item = getRuntime(key);
  if (!item.id) throw new Error('请使用 Microsoft 官方下载页安装此组件。');
  return installPackage(item);
}
const runtimeDocs = (key) => shell.openExternal(getRuntime(key).url);
module.exports = { runtimeStatus, inspectDll, installRuntime, runtimeDocs };
