// Cloudflare Turnstile 服务端验证（Vercel Function，Node.js Runtime，零依赖）
// 前端注册表单提交 Turnstile token，本函数用服务端 Secret Key 调 siteverify 校验。
// CLOUDFLARE_TURNSTILE_SECRET 只在此处通过 process.env 读取，绝不进入任何静态文件或日志。
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET;
  if (!secret) {
    // 只报告缺失状态，不打印任何 secret 值
    console.error('verify-turnstile: CLOUDFLARE_TURNSTILE_SECRET is not configured on the server');
    res.status(500).json({ success: false, error: 'SERVER_ERROR' });
    return;
  }

  // 读取 JSON body（不依赖任何解析库）
  let body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8');
    body = raw ? JSON.parse(raw) : {};
  } catch (err) {
    res.status(400).json({ success: false, error: 'INVALID_JSON' });
    return;
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    res.status(400).json({ success: false, error: 'MISSING_TOKEN' });
    return;
  }

  let upstream;
  try {
    upstream = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secret, response: token }).toString(),
    });
  } catch (err) {
    // 不记录 token / secret / 完整 URL
    console.error('verify-turnstile: siteverify request failed');
    res.status(502).json({ success: false, error: 'UPSTREAM_ERROR' });
    return;
  }

  let result;
  try {
    result = await upstream.json();
  } catch (err) {
    res.status(502).json({ success: false, error: 'UPSTREAM_ERROR' });
    return;
  }

  // 验证不通过按 Turnstile 语义返回 200 + success:false（不是服务器错误）
  if (result && result.success === true) {
    res.status(200).json({ success: true });
  } else {
    res.status(200).json({
      success: false,
      error: 'VERIFY_FAILED',
      codes: result && Array.isArray(result['error-codes']) ? result['error-codes'] : undefined,
    });
  }
}
