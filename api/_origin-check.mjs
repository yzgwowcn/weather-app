// 共享来源校验：防止 Vercel Function 被第三方站点/脚本当免费代理或免费验证服务滥用。
// 用法：const { checkOrigin } = await import('./_origin-check.mjs');
// 行为：
//   - 未配置 ALLOWED_ORIGINS（逗号分隔的 host 列表，如 "example.com,www.example.com"）
//     → 返回 { ok: true, configured: false }，调用方应放行并打一次警告日志（向后兼容）；
//   - 已配置 → 校验请求头 Origin / Referer 的 host，任一匹配即放行；
//     Origin 与 Referer 均缺失或均不匹配 → 拒绝（返回 ok: false）。
// 注意：该校验防"普通浏览器/页面滥用"，不防可伪造请求头的技术攻击者；
//       真正的防线是 RLS / 服务端密钥 + 本模块 + 平台级限流（如 Vercel Firewall）。
export function checkOrigin(req, { env = process.env } = {}) {
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return { ok: true, configured: false };

  const hosts = [];
  for (const header of [req.headers.origin, req.headers.referer]) {
    if (typeof header === 'string' && header) {
      try {
        hosts.push(new URL(header).host.toLowerCase());
      } catch (e) { /* 非法头值：忽略，由下方统一判定 */ }
    }
  }
  if (hosts.some((h) => allowed.includes(h))) return { ok: true, configured: true };
  return { ok: false, configured: true };
}
