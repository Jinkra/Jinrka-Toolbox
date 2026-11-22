async function checkApi(base, token) {
  if (typeof base !== 'string' || base.length > 1500 || typeof token !== 'string' ||
      token.length > 4096 || /[\r\n]/.test(token)) throw new Error('连接参数无效。');
  let url;
  try { url = new URL(base.trim()); } catch { throw new Error('请输入完整的 API 地址。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) throw new Error('请使用 HTTPS 或本机 HTTP 地址，并将密钥填写在独立字段。');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
  if (!url.pathname.endsWith('/models')) url.pathname += '/models';

  const started = performance.now();
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', ...(token.trim() && { Authorization: 'Bearer ' + token.trim() }) },
      signal: AbortSignal.timeout(12_000), redirect: 'error',
    });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? '连接超时。' : '连接失败，请检查地址、网络或证书。');
  }
  const latency = Math.round(performance.now() - started);
  const result = { status: response.status, latency, endpoint: url.href, models: [], compatible: false };
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return result;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 512 * 1024) throw new Error('模型列表响应过大。');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')).data;
    if (Array.isArray(data)) {
      result.compatible = true;
      result.models = data.filter((item) => typeof item?.id === 'string').slice(0, 100).map((item) => item.id.slice(0, 256));
    }
  } catch {}
  return result;
}

module.exports = { checkApi };
