// Vercel 构建时注入高德/Supabase/Turnstile 的前端公开配置：将 js/config.js 中的占位符替换为环境变量值。
// 环境变量在 Vercel Dashboard → Settings → Environment Variables 配置：
//   AMAP_KEY           = 高德 JS API Key（注入前端 js/config.js）
//   SUPABASE_URL       = Supabase Project URL（注入前端 js/config.js，公开）
//   SUPABASE_ANON_KEY  = Supabase anon public key（注入前端 js/config.js，公开）
//   TURNSTILE_SITE_KEY = Cloudflare Turnstile Site Key（注入前端 js/config.js，公开）
//   高德安全密钥（jscode）与 Turnstile Secret Key 不在此注入，仅由服务端 api/*.mjs 通过 process.env 读取，不进入任何静态文件
// 未配置环境变量时占位符被替换为空字符串，对应功能自动禁用。
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, 'js', 'config.js');
let config = fs.readFileSync(configPath, 'utf-8');
const before = config;
// 用 split/join 而非 String.replace：避免替换值含 $ 时触发特殊替换语义
config = config.split('__AMAP_KEY__').join(process.env.AMAP_KEY || '');
config = config.split('__SUPABASE_URL__').join(process.env.SUPABASE_URL || '');
config = config.split('__SUPABASE_ANON_KEY__').join(process.env.SUPABASE_ANON_KEY || '');
config = config.split('__TURNSTILE_SITE_KEY__').join(process.env.TURNSTILE_SITE_KEY || '');
if (config === before) {
  // Vercel 每次构建从仓库全新拉取（占位符状态）；本地重复运行时提示而非误改
  console.error('WARN: placeholders not found in js/config.js — 文件可能已注入过，跳过写入');
  process.exit(0);
}
fs.writeFileSync(configPath, config, 'utf-8');
console.log(`config injected (amap_key=${process.env.AMAP_KEY ? 'yes' : 'EMPTY'}, supabase=${process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? 'yes' : 'EMPTY'}, turnstile=${process.env.TURNSTILE_SITE_KEY ? 'yes' : 'EMPTY'})`);
