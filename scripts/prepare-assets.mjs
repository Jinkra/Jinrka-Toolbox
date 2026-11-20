import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const target = new URL('../public/pdf/', import.meta.url);
await mkdir(target, { recursive: true });
await Promise.all(['cmaps', 'standard_fonts', 'wasm', 'iccs'].map((name) =>
  cp(new URL(name, source), new URL(name, target), { recursive: true }),
));

const project = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(project, 'package-lock.json'), 'utf8'));
const buildOnly = new Set(['electron', 'electron-builder', 'playwright-core', 'vite']);
const visited = new Set();

function dependency(name, owner) {
  const location = `${owner ? `${owner}/` : ''}node_modules/${name}`;
  const found = lock.packages[location];
  if (!found && owner) return dependency(name, owner.replace(/(^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/u, ''));
  if (!found || visited.has(location)) return;
  visited.add(location);
  for (const child of Object.keys(found.dependencies ?? {})) dependency(child, location);
}

for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
  if (!buildOnly.has(name)) dependency(name, '');
}

const notices = await Promise.all([...visited].sort().map(async (entry) => {
  const folder = path.join(project, entry);
  const item = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
  const children = await readdir(folder, { withFileTypes: true });
  const licenses = await Promise.all(children.filter((child) => child.isFile() && /^(licen[cs]e|copying|notice|ofl)(?:\.|$)/iu.test(child.name))
    .map((child) => readFile(path.join(folder, child.name), 'utf8')));
  const sourceUrl = typeof item.repository === 'string' ? item.repository : item.repository?.url;
  return [`${item.name} ${item.version} · ${item.license ?? ''}`, sourceUrl, ...licenses].filter(Boolean).join('\n\n');
}));
await writeFile(new URL('../public/oss-licenses.txt', import.meta.url), notices.join('\n\n----------------------------------------\n\n'));
