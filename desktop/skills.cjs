const { app, shell } = require('electron');
const { createHash } = require('node:crypto');
const { readFile, writeFile, lstat, mkdir, mkdtemp, readdir, rename, rm } = require('node:fs/promises');
const path = require('node:path');
const { validateName, withOutput } = require('./files.cjs');

const catalogRepo = 'anbeime/skill';
const repositoryPattern = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i;
const objectId = /^[a-f0-9]{40}$/;
const maxFileSize = 32 * 1024 * 1024;
const regularModes = new Set(['100644', '100755']);
const cacheDuration = 30 * 60_000;
const inspected = new Map();
let refreshing;
let mutating = false;

function bundledSnapshot() {
  return require('./skills-seed.json');
}

function validRepo(repo) {
  return typeof repo === 'string' && repositoryPattern.test(repo) && !/\/\.{1,2}$/.test(repo);
}

function api(repo, endpoint) {
  return `https://api.github.com/repos/${repo}/${endpoint}`;
}

function raw(repo, ref, file) {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

async function fetchGitHub(url, limit = 4 * 1024 * 1024) {
  const response = await fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { 'User-Agent': 'Jinkra-Toolbox' },
  });
  if (!response.ok) {
    if (response.headers.get('x-ratelimit-remaining') === '0') throw new Error('GitHub 匿名访问已达上限，请稍后重试。');
    throw new Error(`GitHub 返回 HTTP ${response.status}，请稍后重试。`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) throw new Error('GitHub 返回的文件超过大小限制。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function json(url) {
  return JSON.parse((await fetchGitHub(url)).toString('utf8'));
}

async function repositoryTree(repo) {
  const branch = repo.toLowerCase() === catalogRepo ? 'main' : 'HEAD';
  const snapshot = await json(api(repo, `git/trees/${branch}?recursive=1`));
  if (snapshot.truncated || !Array.isArray(snapshot.tree) || !objectId.test(snapshot.sha)) {
    throw new Error('暂时无法读取完整的 GitHub 文件列表。');
  }
  return { ref: snapshot.sha, tree: snapshot.tree };
}

function skillPaths(tree) {
  return tree.filter((item) => item.type === 'blob' && regularModes.has(item.mode) &&
    (item.path === 'SKILL.md' || item.path.endsWith('/SKILL.md')))
    .map((item) => item.path === 'SKILL.md' ? '' : item.path.slice(0, -'/SKILL.md'.length));
}

function shortText(value, max = 380) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function repoEntries(sources, trending) {
  const items = new Map();
  for (const [key, entry] of Object.entries(sources?.sources ?? {})) {
    const repo = key.split('/').slice(0, 2).join('/');
    if (validRepo(repo)) items.set(repo.toLowerCase(), { repo, description: shortText(entry?.description),
      updated: shortText(entry?.discovered_at, 35) });
  }
  for (const entry of trending?.skills ?? []) {
    try {
      const url = new URL(entry.link);
      const repo = url.pathname.split('/').slice(1, 3).join('/');
      if (url.origin !== 'https://github.com' || !validRepo(repo)) continue;
      const old = items.get(repo.toLowerCase());
      const updated = shortText(entry.pushed_at ?? old?.updated, 35);
      if (updated && (!old?.updated || entry.pushed_at)) {
        items.set(repo.toLowerCase(), { repo, description: shortText(entry.description), updated });
      }
    } catch {
      // The upstream index includes links to sites other than GitHub.
    }
  }
  items.delete(catalogRepo);
  return Array.from(items.values()).sort((a, b) => b.updated.localeCompare(a.updated) || a.repo.localeCompare(b.repo));
}

async function loadSkills(force) {
  const filename = path.join(app.getPath('userData'), 'ai-catalog.json');
  const saved = await readFile(filename, 'utf8').then(JSON.parse).catch(() => null);
  if (refreshing) return refreshing;
  if (saved && Date.now() - saved.fetchedAt < (force === true ? 8_000 : cacheDuration)) return saved;
  refreshing = (async () => {
    const requests = await Promise.allSettled([
      repositoryTree(catalogRepo), json(raw(catalogRepo, 'main', 'SKILL_SOURCES.json')),
      json(raw(catalogRepo, 'main', 'public/data/skills.json')),
    ]);
    const [bundled, sources, trending] = requests;
    const offline = requests.every((result) => result.status === 'rejected');
    if (offline && saved) return { ...saved, state: 'cached' };
    const available = bundled.status === 'fulfilled' ? bundled.value : bundledSnapshot();
    const result = {
      bundled: skillPaths(available.tree).filter((folder) => folder && !folder.split('/').includes('_template')),
      repos: sources.status === 'fulfilled' || trending.status === 'fulfilled' ? repoEntries(
        sources.value ?? { sources: Object.fromEntries((saved?.repos ?? []).map((item) =>
          [item.repo, { description: item.description, discovered_at: item.updated }])) }, trending.value,
      ) : saved?.repos ?? [],
      fetchedAt: Date.now(), state: offline ? 'offline' : requests.every((item) => item.status === 'fulfilled') ? 'ready' : 'partial',
    };
    rememberTree(catalogRepo, available);
    if (!offline) await withOutput(filename, (file) => writeFile(file, JSON.stringify(result))).catch(() => {});
    return result;
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

function rememberTree(repo, snapshot) {
  inspected.set(repo.toLowerCase(), { snapshot, time: Date.now() });
  if (inspected.size > 12) inspected.delete(inspected.keys().next().value);
}

async function snapshotFor(repo) {
  if (!validRepo(repo)) throw new Error('GitHub 仓库名称无效。');
  const previous = inspected.get(repo.toLowerCase());
  if (previous && Date.now() - previous.time < cacheDuration) return previous.snapshot;
  const snapshot = await repositoryTree(repo).catch((error) => {
    if (repo.toLowerCase() !== catalogRepo) throw error;
    return previous?.snapshot ?? bundledSnapshot();
  });
  rememberTree(repo, snapshot);
  return snapshot;
}

async function inspectSkills(repo) {
  return skillPaths((await snapshotFor(repo)).tree);
}

function locations() {
  const home = app.getPath('home');
  const claude = process.env.CLAUDE_CONFIG_DIR;
  const codex = process.env.CODEX_HOME;
  return {
    codex: path.join(home, '.agents', 'skills'),
    claude: path.join(claude && path.isAbsolute(claude) ? claude : path.join(home, '.claude'), 'skills'),
    legacy: path.join(codex && path.isAbsolute(codex) ? codex : path.join(home, '.codex'), 'skills'),
  };
}

async function installedSkill(directory, name) {
  const target = path.join(directory, name);
  const info = await lstat(target).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info || (!info.isDirectory() && !info.isSymbolicLink())) return null;
  const manifest = await lstat(path.join(target, 'SKILL.md')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  return manifest?.isFile() ? { target, linked: info.isSymbolicLink() } : null;
}

async function listInstalled() {
  const lists = await Promise.all(Object.entries(locations()).map(async ([agent, location]) => {
    const entries = await readdir(location, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const results = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
      const skill = await installedSkill(location, entry.name);
      if (skill) results.push({ name: entry.name, agent, file: skill.target, linked: skill.linked });
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }));
  return lists.flat();
}

async function changeSkills(work) {
  if (mutating) throw new Error('正在处理另一个 Skill，请稍候。');
  mutating = true;
  try { return await work(); }
  finally { mutating = false; }
}

async function installSkill(repo, folder, agent) {
  const root = locations()[agent];
  if ((agent !== 'codex' && agent !== 'claude') || !root) throw new Error('请选择安装平台。');
  return changeSkills(async () => {
    const { ref, tree } = await snapshotFor(repo);
    if (!skillPaths(tree).includes(folder)) throw new Error('所选目录没有 SKILL.md，请刷新后重试。');
    const name = validateName(folder.split('/').pop() || repo.split('/')[1]);
    if (name.startsWith('.')) throw new Error('Skill 名称无效。');
    const prefix = folder ? folder + '/' : '';
    const files = tree.filter((item) => item.type !== 'tree' && item.path.startsWith(prefix));
    let total = 0;
    for (const file of files) {
      if (file.type !== 'blob' || !regularModes.has(file.mode) || !objectId.test(file.sha) ||
          !Number.isSafeInteger(file.size) || file.size < 0) {
        throw new Error('此 Skill 包含链接或不支持的文件类型。');
      }
      file.path.slice(prefix.length).split('/').forEach(validateName);
      total += file.size;
    }
    if (files.length > 512 || total > maxFileSize) throw new Error('此 Skill 超过 512 个文件或 32 MiB，请从来源仓库手动安装。');
    await mkdir(root, { recursive: true });
    const destination = path.join(root, name);
    await ensureAvailable(destination);
    const temporary = await mkdtemp(path.join(root, '.jinkra-'));
    try {
      for (let offset = 0; offset < files.length; offset += 6) {
        const batch = await Promise.allSettled(files.slice(offset, offset + 6).map(async (file) => {
          const target = path.join(temporary, ...file.path.slice(prefix.length).split('/'));
          const content = await fetchGitHub(raw(repo, ref, file.path), file.size);
          const checksum = createHash('sha1').update('blob ' + content.length + '\0').update(content).digest('hex');
          if (content.length !== file.size || checksum !== file.sha) throw new Error('下载文件与 GitHub 目录不一致，请刷新后重试。');
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, content, { flag: 'wx' });
        }));
        const failure = batch.find((result) => result.status === 'rejected');
        if (failure) throw failure.reason;
      }
      await ensureAvailable(destination);
      await rename(temporary, destination);
      return { name };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

async function ensureAvailable(destination) {
  const info = await lstat(destination).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (info) throw new Error('已经有同名文件夹，请先在「已安装」中确认。');
}

async function uninstallSkill(agent, name) {
  const directories = locations();
  if (!Object.hasOwn(directories, agent) || typeof name !== 'string' || validateName(name).startsWith('.')) {
    throw new Error('本地 Skill 路径无效。');
  }
  return changeSkills(async () => {
    const skill = await installedSkill(directories[agent], name);
    if (!skill) throw new Error('找不到可卸载的 Skill 文件夹。');
    await shell.trashItem(skill.target);
  });
}

module.exports = { loadSkills, inspectSkills, listInstalled, installSkill, uninstallSkill, validRepo };
