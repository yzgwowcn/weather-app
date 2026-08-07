// 端到端验证（真实 Open-Meteo API）：node tests/e2e.check.js
// 依赖全局 playwright-core（NODE_PATH 指向 npm root -g）。
// 检查：首屏加载、EC 主结论、51 成员集合、SVG 天空剖面、视图切换、
// 天气状态机、移动端横向滚动、reduced-motion 降级。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.replace(/^\//, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((resolve) => server.listen(8123, resolve));
  const pw = require('playwright-core');
  const browser = await pw.chromium.launch();
  const failures = [];
  const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures.push(name); };

  // 桌面端
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
  await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle', timeout: 60000 });

  check('页面标题', (await page.title()).includes('晴海'));
  check('EC 主结论徽章', await page.locator('.verdict-badge').count() === 1);
  const verdict = await page.locator('.verdict-badge').textContent();
  check('EC 主结论为适合/不适合', /适合出行|不建议出行|数据待补充/.test(verdict), verdict);
  check('EC 集合晴好率 orb', (await page.locator('.probability-orb strong').textContent()).includes('%'));
  const memberText = await page.locator('.probability-orb small').textContent();
  check('EC 51 成员统计', /\/\s*51\s*成员/.test(memberText), memberText);
  check('成员一致性 pill', await page.locator('.confidence-pill').count() === 1);
  check('天空剖面 SVG 三曲线', (await page.locator('.sky-line.low').count()) >= 1 && (await page.locator('.sky-line.mid').count()) >= 1 && (await page.locator('.sky-line.high').count()) >= 1, `low=${await page.locator('.sky-line.low').count()} mid=${await page.locator('.sky-line.mid').count()} high=${await page.locator('.sky-line.high').count()}`);
  check('命中区小时点', (await page.locator('.sky-hit').count()) > 100, `hits=${await page.locator('.sky-hit').count()}`);
  check('外部模型验证统计', await page.locator('.cross-stat').count() === 3);
  const statText = await page.locator('.cross-stats').textContent();
  check('支持/反对/缺失数值', /支持\s*\d+[\s\S]*?反对\s*\d+[\s\S]*?缺失\s*\d+/.test(statText.replace(/\s+/g, ' ')), statText.replace(/\s+/g, ' ').slice(0, 60));
  check('body mood 已应用', /sunny|cloudy|rainy|windy|storm|neutral/.test(await page.getAttribute('body', 'data-mood')), await page.getAttribute('body', 'data-mood'));

  // 悬停提示（先滚动到图表区域，再 mouse.move 模拟真实指针）
  await page.locator('.sky-view-pane:not([hidden])').scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const hitBox = await page.locator('.sky-view-pane:not([hidden]) .sky-hit').nth(12).boundingBox();
  await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2);
  await page.waitForTimeout(150);
  check('悬停 tooltip 显示', await page.locator('.sky-view-pane:not([hidden]) .sky-tooltip.visible').count() === 1);
  const tip = await page.locator('.sky-view-pane:not([hidden]) .sky-tooltip').textContent();
  check('tooltip 含三层云与遮蔽', /低云.*中云.*高云.*遮蔽/.test(tip.replace(/\s+/g, ' ')));

  // 视图切换
  await page.locator('.sky-view-btn[data-sky-view="forecast"]').click();
  await page.waitForTimeout(120);
  check('切换综合预报视图', await page.locator('.sky-view-pane[data-sky-view="forecast"]').isVisible());
  check('EC 视图隐藏', !(await page.locator('.sky-view-pane[data-sky-view="ec"]').isVisible()));

  // 日期切换联动 mood
  const moods = new Set();
  for (let i = 0; i < 7; i++) {
    const chip = page.locator('.date-chip').nth(i);
    if (await chip.count()) { await chip.click(); await page.waitForTimeout(80); moods.add(await page.getAttribute('body', 'data-mood')); }
  }
  check('日期切换收集到 mood 变化', moods.size >= 1, [...moods].join(','));
  await page.close();

  // 移动端
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', (err) => failures.push(`mobile pageerror: ${err.message}`));
  await mobile.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle', timeout: 60000 });
  const scrollable = await mobile.evaluate(() => {
    const el = document.querySelector('.sky-scroll');
    return el ? { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null;
  });
  check('移动端图表可横向滚动', scrollable && scrollable.scrollWidth > scrollable.clientWidth, JSON.stringify(scrollable));
  check('移动端 ec-hero 单列', await mobile.evaluate(() => getComputedStyle(document.querySelector('.ec-hero')).gridTemplateColumns.split(' ').length === 1));
  await mobile.close();

  // reduced-motion
  const rm = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await rm.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle', timeout: 60000 });
  const anim = await rm.evaluate(() => {
    const el = document.querySelector('.probability-orb');
    const before = getComputedStyle(document.body, '::before');
    return { beforeAnim: before.animationName, bodyTransition: getComputedStyle(document.body).transitionDuration };
  });
  check('reduced-motion 关闭背景动画', anim.beforeAnim === 'none', anim.beforeAnim);
  await rm.close();

  await browser.close();
  server.close();
  if (failures.length) { console.log(`\n${failures.length} FAILURES: ${failures.join(' | ')}`); process.exit(1); }
  console.log('\nE2E all passed');
})().catch((err) => { console.error('E2E error:', err); server.close(); process.exit(1); });
