// CSS 结构检查：node tests/css.check.js
// 验证天气状态机选择器、闪电关键帧、reduced-motion 降级块完整性。
const fs = require('node:fs');
const css = fs.readFileSync('css/style.css', 'utf8');

const moods = ['sunny', 'cloudy', 'rain', 'windy', 'storm', 'thunder'];
for (const m of moods) {
  if (!css.includes(`body[data-mood="${m}"]`)) { console.error('MISSING mood selector:', m); process.exit(1); }
}
if (!css.includes('lightning-flash')) { console.error('lightning keyframes MISSING'); process.exit(1); }
if (!css.includes('body[data-mood="thunder"]::before')) { console.error('thunder ::before MISSING'); process.exit(1); }
if (css.includes('body[data-mood="rainy"]')) { console.error('OLD rainy selector left'); process.exit(1); }

const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
let depth = 0;
let end = start;
for (let i = start; i < css.length; i += 1) {
  if (css[i] === '{') depth += 1;
  if (css[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
}
const block = css.slice(start, end + 1);
if (!block.includes('animation: none !important') || !block.includes('filter: none !important')) { console.error('reduced-motion block missing keys'); process.exit(1); }
if (!block.includes('spinner')) { console.error('spinner missing'); process.exit(1); }

console.log('css check OK');
