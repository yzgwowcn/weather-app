// Vercel 构建时注入高德 Key：将 js/config.js 中的占位符替换为环境变量值。
// 环境变量在 Vercel Dashboard → Settings → Environment Variables 配置：
//   AMAP_KEY    = 高德 JS API Key
//   AMAP_SECRET = 高德安全密钥（jscode）
// 未配置环境变量时占位符被替换为空字符串，地图选点功能自动禁用。
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, 'js', 'config.js');
let config = fs.readFileSync(configPath, 'utf-8');
const before = config;
// 用 split/join 而非 String.replace：避免替换值含 $ 时触发特殊替换语义
config = config.split('__AMAP_KEY__').join(process.env.AMAP_KEY || '');
config = config.split('__AMAP_SECRET__').join(process.env.AMAP_SECRET || '');
if (config === before) {
  // Vercel 每次构建从仓库全新拉取（占位符状态）；本地重复运行时提示而非误改
  console.error('WARN: placeholders not found in js/config.js — 文件可能已注入过，跳过写入');
  process.exit(0);
}
fs.writeFileSync(configPath, config, 'utf-8');
console.log(`AMAP config injected (key=${process.env.AMAP_KEY ? 'yes' : 'EMPTY'}, secret=${process.env.AMAP_SECRET ? 'yes' : 'EMPTY'})`);
