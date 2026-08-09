// 高德 REST API 服务端代理（Vercel Function，Node.js Runtime）
// 前端 window._AMapSecurityConfig.serviceHost = '<origin>/_AMapService'，
// JS API 2.0 会把 Geocoder / AutoComplete / Geolocation 等 REST 请求发到 /_AMapService/<path>，
// 本函数代理转发到 https://restapi.amap.com/<path>，并在服务端注入 jscode。
// AMAP_SECRET 只在此处通过 process.env 读取，绝不进入任何静态文件或日志。
import { checkOrigin } from './_origin-check.mjs';

const UPSTREAM_BASE = 'https://restapi.amap.com/';
// 只允许形如 v3/geocode/geo 的路径段；配合 .. / 反斜杠 / 以 / 开头排除，防路径穿越
const PATH_RE = /^[A-Za-z0-9/._-]+$/;
// path 白名单：仅放行前端实际用到的轻量接口（Geocoder / AutoComplete / Geolocation），
// 避免代理被当作任意高德接口的免费通道（如 staticmap 大图、direction 批量调用等产生费用/配额消耗）。
const ALLOWED_PATHS = new Set([
  'v3/geocode/geo',           // 地理编码（Geocoder.getLocation）
  'v3/geocode/regeo',         // 逆地理编码（Geocoder.getAddress）
  'v3/assistant/inputtips',   // 输入联想（AutoComplete）
  'v3/place/text',            // 关键词搜索（AutoComplete/POI）
  'v3/place/around',          // 周边搜索
  'v3/geolocation',           // 定位（Geolocation）
  'v3/ip',                    // IP 定位兜底
  'v3/log/init',              // SDK 初始化日志上报（JS API 2.0 经 serviceHost 发送，轻量无配额风险）
  'v3/log/error',             // SDK 错误日志上报（同上）
]);
// 未配置 ALLOWED_ORIGINS 时只警告一次，避免刷日志（部署后建议在 Vercel 配置该环境变量）
let warnedOrigin = false;
function originAllowed(req) {
  const r = checkOrigin(req);
  if (!r.configured && !warnedOrigin) {
    warnedOrigin = true;
    console.error('amap proxy: ALLOWED_ORIGINS is not configured; requests from any origin are accepted. Set it to the comma-separated host list of your site.');
  }
  return r.ok;
}
// hop-by-hop 头不转发（连接级头由代理自身管理；accept-encoding 避免上游压缩与解压不一致）
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-length',
  'accept-encoding', 'upgrade', 'proxy-connection', 'te',
]);

export default async function handler(req, res) {
  // 高德 JS API 的服务请求均为 GET（含 HEAD）；拒绝其他 method 缩小攻击面
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ status: '0', info: 'METHOD_NOT_ALLOWED' });
    return;
  }
  // 来源校验：ALLOWED_ORIGINS 配置后仅放行自己站点的 Origin/Referer
  if (!originAllowed(req)) {
    res.status(403).json({ status: '0', info: 'ORIGIN_FORBIDDEN' });
    return;
  }

  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\') || !PATH_RE.test(path) || !ALLOWED_PATHS.has(path)) {
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
  // 代理接口仅需要查询参数；显式拒绝 body（GET 语义），避免残留请求体被意外转发
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
