// CSS 结构检查：node tests/css.check.js
// 验证天气状态机选择器、canvas 雨效层、reduced-motion 降级块完整性。
// 注：雨滴与闪电已由 js/rain.js Canvas 特效接管，CSS 不再含雨线关键帧。
const fs = require('node:fs');
const css = fs.readFileSync('css/style.css', 'utf8');

for (const key of ['.ai-avatar', '.ai-bubble', '.ai-glass-sea', '.glass-sea-detail', '.glass-sea-window', '.ai-analysis.typing', '.ai-loading-dots', '@keyframes ai-caret', '@keyframes ai-loading-dot']) {
  if (!css.includes(key)) { console.error('AI bubble style MISSING:', key); process.exit(1); }
}

// rain/thunder 无独立 CSS（雨滴与闪电由 Canvas 接管）；其余状态有叠加层
const moods = ['sunny', 'cloudy', 'windy', 'storm'];
for (const m of moods) {
  if (!css.includes(`body[data-mood="${m}"]`)) { console.error('MISSING mood selector:', m); process.exit(1); }
}
if (!css.includes('#rain-layer')) { console.error('rain-layer style MISSING'); process.exit(1); }
if (!css.includes('pointer-events: none')) { console.error('rain-layer pointer-events missing'); process.exit(1); }
// Liquid Glass（亚克力）：渐变描边、顶部内高光、饱和度增强
for (const key of ['--glass-border', '--glass-highlight', 'padding-box', 'border-box', 'saturate(1.5)', 'inset 0 1px 0']) {
  if (!css.includes(key)) { console.error('Liquid Glass missing:', key); process.exit(1); }
}
// 亚克力面板：五个玻璃面板必须使用 backdrop-filter 模糊
const glassPanels = ['.workspace', '.ec-hero', '.metric-grid', '.cross-stat', '.date-chip'];
for (const sel of glassPanels) {
  const idx = css.indexOf(`${sel} {`);
  if (idx === -1) { console.error('glass panel selector missing:', sel); process.exit(1); }
  const blockEnd = css.indexOf('}', idx);
  const block = css.slice(idx, blockEnd);
  if (!block.includes('backdrop-filter')) { console.error('acrylic panel should use backdrop-filter:', sel); process.exit(1); }
}
// 可读性：主内容区不应再有 11px 小字
if (css.includes('font-size: 11px')) { console.error('11px font remains'); process.exit(1); }
// CSS 雨线/闪电关键帧应已移除（由 Canvas 接管）
for (const gone of ['rain-fall', 'storm-fall', 'lightning-flash']) {
  if (css.includes(`@keyframes ${gone}`)) { console.error('CSS keyframes should be removed:', gone); process.exit(1); }
}

// 天空剖面滚动容器：圆角遮罩（滚动到最右也是圆角，深色底随容器裁剪）
const skyIdx = css.indexOf('.sky-scroll');
if (skyIdx === -1) { console.error('sky-scroll missing'); process.exit(1); }
const skyBlock = css.slice(skyIdx, css.indexOf('}', skyIdx));
if (!skyBlock.includes('border-radius') || !skyBlock.includes('overflow-x: auto')) { console.error('sky-scroll rounded scroll container missing'); process.exit(1); }
// 云量曲线滚动容器：与天空剖面同规格（圆角深底横向滚动）
const cloudIdx = css.indexOf('.cloud-scroll');
if (cloudIdx === -1) { console.error('cloud-scroll missing'); process.exit(1); }
const cloudBlock = css.slice(cloudIdx, css.indexOf('}', cloudIdx));
if (!cloudBlock.includes('border-radius') || !cloudBlock.includes('overflow-x: auto')) { console.error('cloud-scroll rounded scroll container missing'); process.exit(1); }
if (!css.includes('.cloud-tooltip') || !css.includes('.cloud-crosshair') || !css.includes('.cloud-hit')) { console.error('cloud curve interactive styles missing'); process.exit(1); }

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
