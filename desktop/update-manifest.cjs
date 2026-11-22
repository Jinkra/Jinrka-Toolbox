const { verify } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const manifestName = 'jinkra-update.json';
const maxBytes = 650 * 1024 * 1024;
const releaseVersion = /^\d{1,7}\.\d{1,7}\.\d{1,7}$/u;

function validUpdate({ version, size, sha256 }) {
  return typeof version === 'string' && releaseVersion.test(version) &&
    Number.isSafeInteger(size) && size >= 4096 && size <= maxBytes &&
    typeof sha256 === 'string' && /^[a-f0-9]{64}$/u.test(sha256);
}

function manifestMessage({ version, size, sha256 }) {
  return Buffer.from('jinkra-toolbox/windows-x64/update-v1\n' + JSON.stringify([version, size, sha256]));
}

function verifiedManifest(manifest) {
  if (!manifest || !validUpdate(manifest) || typeof manifest.signature !== 'string' ||
      !/^[A-Za-z0-9+/]{86}==$/u.test(manifest.signature)) throw new Error('更新清单格式无效。');
  const key = readFileSync(path.join(__dirname, 'update-public-key.pem'));
  if (!verify(null, manifestMessage(manifest), key, Buffer.from(manifest.signature, 'base64'))) {
    throw new Error('更新清单签名校验失败。');
  }
  const { version, size, sha256 } = manifest;
  return { version, size, sha256 };
}

module.exports = { manifestName, validUpdate, manifestMessage, verifiedManifest };
