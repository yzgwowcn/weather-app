// 高德 REST API 服务端代理（Vercel Function，Node.js Runtime）
// 前端 window._AMapSecurityConfig.serviceHost = '<origin>/_AMapService'，
// JS API 2.0 会把 Geocoder / AutoComplete / Geolocation 等 REST 请求发到 /_AMapService/<path>，
// 本函数代理转发到 https://restapi.amap.com/<path>，并在服务端注入 jscode。
// AMAP_SECRET 只在此处通过 process.env 读取，绝不进入任何静态文件或日志。
const UPSTREAM_BASE = 'https://restapi.amap.com/';
// 只允许形如 v3/geocode/geo 的路径段；配合 .. / 反斜杠 / 以 / 开头排除，防路径穿越
const PATH_RE = /^[A-Za-z0-9/._-]+$/;
// hop-by-hop 头不转发（连接级头由代理自身管理；accept-encoding 避免上游压缩与解压不一致）
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-length',
  'accept-encoding', 'upgrade', 'proxy-connection', 'te',
]);

export default async function handler(req, res) {
  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\') || !PATH_RE.test(path)) {
    res.status(400).json({ status: '0', info: 'INVALID_PATH' });
    return;
  }

  const secret = process.env.AMAP_SECRET;
  if (!secret) {
    // 只报告缺失状态，不打印任何 secret 值
    console.error('amap proxy: AMAP_SECRET is not configured on the server');
    res.status(500).json({ status: '0', info: 'SERVER_ERROR' });
    return;
  }

  // 保留原始查询参数；删除内部参数 path 与客户端传入的 jscode，强制用服务端 secret
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path' || key === 'jscode') continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value !== undefined) params.append(key, value);
  }
  params.set('jscode', secret);
  const qs = params.toString();
  const upstreamUrl = UPSTREAM_BASE + path + (qs ? '?' + qs : '');

  // 转发请求：保留 method 与原始头（过滤 hop-by-hop）；GET/HEAD 无 body，其余 method 原样转发 body
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  }
  const init = { method: req.method, headers, redirect: 'manual' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length > 0) init.body = Buffer.concat(chunks);
  }

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch (err) {
    // 只记录 path 与 method，不记录 query / jscode / 完整 URL
    console.error(`amap proxy: upstream request failed (path=${path}, method=${req.method})`);
    res.status(502).json({ status: '0', info: 'UPSTREAM_ERROR' });
    return;
  }

  // 将高德响应原样返回（状态码 + 头，至少保留 Content-Type）
  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
  });

  if (req.method === 'HEAD' || (upstream.status >= 300 && upstream.status < 400)) {
    res.end();
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  res.end(body);
}
