// CSS 结构检查：node tests/css.check.js
// 验证天气状态机选择器、canvas 雨效层、reduced-motion 降级块完整性。
// 注：雨滴与闪电已由 js/rain.js Canvas 特效接管，CSS 不再含雨线关键帧。
const fs = require('node:fs');
const css = fs.readFileSync('css/style.css', 'utf8');

// rain/thunder 无独立 CSS（雨滴与闪电由 Canvas 接管）；其余状态有叠加层
const moods = ['sunny', 'cloudy', 'windy', 'storm'];
for (const m of moods) {
  if (!css.includes(`body[data-mood="${m}"]`)) { console.error('MISSING mood selector:', m); process.exit(1); }
}
if (!css.includes('#rain-layer')) { console.error('rain-layer style MISSING'); process.exit(1); }
if (!css.includes('pointer-events: none')) { console.error('rain-layer pointer-events missing'); process.exit(1); }
// CSS 雨线/闪电关键帧应已移除（由 Canvas 接管）
for (const gone of ['rain-fall', 'storm-fall', 'lightning-flash']) {
  if (css.includes(`@keyframes ${gone}`)) { console.error('CSS keyframes should be removed:', gone); process.exit(1); }
}

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
