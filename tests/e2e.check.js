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
  const xhsHref = await page.getAttribute('.xhs-link', 'href');
  check('小红书主页链接', xhsHref === 'https://xhslink.cn/m/4BS8N8iCK3F', xhsHref);
  check('小红书新标签打开', (await page.getAttribute('.xhs-link', 'target')) === '_blank');
  check('EC 主结论徽章', await page.locator('.verdict-badge').count() === 1);
  const verdict = await page.locator('.verdict-badge').textContent();
  check('EC 主结论为适合/不适合', /推荐出行|适合出行|审慎出行|关注后续预报|不建议出行|数据待补充/.test(verdict), verdict);
  check('EC 集合晴好率 orb', (await page.locator('.probability-orb strong').textContent()).includes('%'));
  const memberText = await page.locator('.probability-orb small').textContent();
  check('EC 51 成员统计', /\/\s*51\s*成员/.test(memberText), memberText);
  check('成员一致性 pill', await page.locator('.confidence-pill').count() === 1);
  check('天空剖面 SVG 三曲线', (await page.locator('.sky-line.low').count()) >= 1 && (await page.locator('.sky-line.mid').count()) >= 1 && (await page.locator('.sky-line.high').count()) >= 1, `low=${await page.locator('.sky-line.low').count()} mid=${await page.locator('.sky-line.mid').count()} high=${await page.locator('.sky-line.high').count()}`);
  check('命中区小时点', (await page.locator('.sky-hit').count()) > 100, `hits=${await page.locator('.sky-hit').count()}`);
  check('外部模型验证统计', await page.locator('.cross-stat').count() === 3);
  const statText = await page.locator('.cross-stats').textContent();
  check('支持/反对/缺失数值', /支持\s*\d+[\s\S]*?反对\s*\d+[\s\S]*?缺失\s*\d+/.test(statText.replace(/\s+/g, ' ')), statText.replace(/\s+/g, ' ').slice(0, 60));
  check('body mood 已应用', /sunny|cloudy|rain|windy|storm|thunder|neutral/.test(await page.getAttribute('body', 'data-mood')), await page.getAttribute('body', 'data-mood'));

  // 雨滴特效：canvas 存在，且 RainFX 随 mood 启停
  check('雨滴 canvas 存在', await page.locator('#rain-layer').count() === 1);
  const currentMood = await page.getAttribute('body', 'data-mood');
  const rainRunning = await page.evaluate(() => typeof RainFX !== 'undefined' && RainFX.running);
  const shouldRain = ['rain', 'storm', 'thunder'].includes(currentMood);
  check('雨效随 mood 启停', rainRunning === shouldRain, `mood=${currentMood} running=${rainRunning}`);

  // 布局：预报范围在目的地选择下方（y 坐标更大）
  const destBox = await page.locator('.destination-field').boundingBox();
  const horizonBox = await page.locator('.horizon-field').boundingBox();
  check('预报范围位于目的地下方', destBox.y + destBox.height < horizonBox.y, `dest y=${Math.round(destBox.y + destBox.height)} horizon y=${Math.round(horizonBox.y)}`);

  // 布局：日期选择位于 EC 主结论（是否建议出行）上方
  const railBox = await page.locator('.date-rail').boundingBox();
  const heroBox = await page.locator('.ec-hero').boundingBox();
  check('日期选择位于主结论上方', railBox.y + railBox.height < heroBox.y, `rail y=${Math.round(railBox.y + railBox.height)} hero y=${Math.round(heroBox.y)}`);

  // 悬停提示（先滚动到图表区域，再 mouse.move 模拟真实指针）
  await page.locator('.sky-view-pane:not([hidden])').scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const hitBox = await page.locator('.sky-view-pane:not([hidden]) .sky-hit').nth(12).boundingBox();
  await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2);
  await page.waitForTimeout(150);
  check('悬停 tooltip 显示', await page.locator('.sky-view-pane:not([hidden]) .sky-tooltip.visible').count() === 1);
  const tip = await page.locator('.sky-view-pane:not([hidden]) .sky-tooltip').textContent();
  check('tooltip 含三层云与遮蔽', /低云.*中云.*高云.*遮蔽/.test(tip.replace(/\s+/g, ' ')));

  // 点击显示详情：点击命中区 → 浮层出现；移开鼠标后（已选中）详情保留
  // 注：.sky-hit 是 SVG line（零面积 bbox），playwright locator.click 判定不可见，改用坐标点击
  await page.locator('.sky-view-pane:not([hidden])').scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const chartBox = await page.locator('.sky-view-pane:not([hidden]) [data-sky-chart]').boundingBox();
  const hitX = Number(await page.locator('.sky-view-pane:not([hidden]) .sky-hit').nth(15).getAttribute('data-x'));
  await page.mouse.click(chartBox.x + hitX, chartBox.y + 100);
  await page.waitForTimeout(100);
  check('点击显示详情浮层', await page.locator('.sky-view-pane:not([hidden]) .sky-tooltip.visible').count() === 1);
  const clickTip = await page.locator('.sky-view-pane:not([hidden]) .sky-tooltip').textContent();
  check('点击浮层含三层云', /低云.*中云.*高云.*遮蔽/.test(clickTip.replace(/\s+/g, ' ')));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(100);
  check('点击选中后移开保留详情', await page.locator('.sky-view-pane:not([hidden]) .sky-tooltip.visible').count() === 1);

  // 视图切换
  await page.locator('.sky-view-btn[data-sky-view="forecast"]').click();
  await page.waitForTimeout(120);
  check('切换综合预报视图', await page.locator('.sky-view-pane[data-sky-view="forecast"]').isVisible());
  check('EC 视图隐藏', !(await page.locator('.sky-view-pane[data-sky-view="ec"]').isVisible()));

  // 日期切换联动 mood（新值域：thunder/rain 取代 rainy）
  const moods = new Set();
  for (let i = 0; i < 7; i++) {
    const chip = page.locator('.date-chip').nth(i);
    if (await chip.count()) { await chip.click(); await page.waitForTimeout(80); moods.add(await page.getAttribute('body', 'data-mood')); }
  }
  check('日期切换收集到 mood 变化', moods.size >= 1 && [...moods].every((m) => /sunny|cloudy|rain|windy|storm|thunder|neutral/.test(m)), [...moods].join(','));

  // 点击日期不应把页面纵向滚回顶部（回归：scrollIntoView block:'nearest' 曾把页面滚回顶部）
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(120);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => {
    const cards = document.querySelectorAll('.forecast-summary');
    if (cards.length >= 2) cards[1].click();
  });
  await page.waitForTimeout(200);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check('点击日期后页面不滚回顶部', scrollBefore > 0 && scrollAfter > scrollBefore * 0.5, `before=${Math.round(scrollBefore)} after=${Math.round(scrollAfter)}`);

  // 选中日期展开区：当天逐小时低云/中云/降雨量曲线（低云+中云 2 条线，1 小时间隔 24 点）
  const curveLines = await page.locator('.forecast-card.selected .cloud-line').count();
  check('展开区云量曲线两条线', curveLines === 2, `lines=${curveLines}`);
  const curveHead = await page.locator('.forecast-card.selected .cloud-curve-head').textContent();
  check('云量曲线标注 1 小时间隔', /1 小时间隔 · 24 点/.test(curveHead.replace(/\s+/g, ' ')), curveHead.replace(/\s+/g, ' '));

  // 云量曲线悬浮详情（同天空剖面交互）：移入命中条 → tooltip 显示低云/中云/降雨
  const cloudChart = page.locator('.forecast-card.selected [data-cloud-chart]');
  await cloudChart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const cloudBox = await cloudChart.boundingBox();
  const cloudHitX = Number(await cloudChart.locator('.cloud-hit').nth(9).getAttribute('data-x'));
  await page.mouse.move(cloudBox.x + cloudHitX, cloudBox.y + 80);
  await page.waitForTimeout(150);
  check('云量曲线悬浮详情', await page.locator('.forecast-card.selected .cloud-tooltip.visible').count() === 1);
  const cloudTip = await page.locator('.forecast-card.selected .cloud-tooltip').textContent();
  check('云量详情含低云/中云/降雨', /低云.*中云.*降雨/.test(cloudTip.replace(/\s+/g, ' ')), cloudTip.replace(/\s+/g, ' '));
  // 点击持久显示：pointerdown 后移开鼠标，详情保留
  await page.mouse.click(cloudBox.x + cloudHitX, cloudBox.y + 80);
  await page.waitForTimeout(120);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(120);
  check('云量曲线点击后详情保留', await page.locator('.forecast-card.selected .cloud-tooltip.visible').count() === 1);
  const thunderCount = await page.locator('.thunder-window').count();
  check('雷雨徽章渲染正常（0 或含时段文案与图标）', thunderCount === 0 || (/有雷阵雨，注意避雨/.test(await page.locator('.thunder-window').textContent()) && (await page.locator('.thunder-window .thunder-icon').count()) === 1), `thunder-window=${thunderCount}`);
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

  // 日期条：滚动到右侧后点击远端日期，滚动位置不回零且选中 chip 可见
  await mobile.evaluate(() => { const rail = document.querySelector('.date-rail'); rail.scrollLeft = rail.scrollWidth; });
  const railBefore = await mobile.evaluate(() => document.querySelector('.date-rail').scrollLeft);
  await mobile.locator('.date-chip').nth(6).click();
  await mobile.waitForTimeout(150);
  const railAfter = await mobile.evaluate(() => document.querySelector('.date-rail').scrollLeft);
  check('日期滚动位置不回零', railBefore > 0 && railAfter > 0, `before=${railBefore} after=${railAfter}`);
  const chipVisible = await mobile.evaluate(() => {
    const chip = document.querySelector('.date-chip.active');
    if (!chip) return false;
    const rail = document.querySelector('.date-rail');
    const cr = rail.getBoundingClientRect();
    const cc = chip.getBoundingClientRect();
    return cc.left >= cr.left - 1 && cc.right <= cr.right + 1;
  });
  check('选中日期 chip 保持可见', chipVisible);

  // 移动端：tap 命中区 → 详情浮层显示（触屏无 hover，点击即显示）
  await mobile.locator('.sky-view-pane:not([hidden])').scrollIntoViewIfNeeded();
  await mobile.waitForTimeout(120);
  const mChartBox = await mobile.locator('.sky-view-pane:not([hidden]) [data-sky-chart]').boundingBox();
  const mHitX = Number(await mobile.locator('.sky-view-pane:not([hidden]) .sky-hit').nth(10).getAttribute('data-x'));
  await mobile.touchscreen.tap(mChartBox.x + mHitX, mChartBox.y + 100);
  await mobile.waitForTimeout(150);
  check('移动端点击显示详情', await mobile.locator('.sky-view-pane:not([hidden]) .sky-tooltip.visible').count() === 1, `visible=${await mobile.locator('.sky-view-pane:not([hidden]) .sky-tooltip.visible').count()}`);

  // 移动端：云量曲线横向滚动（24h 固定宽 > 视口）+ 点击显示详情（触屏点击即见）
  const cloudScrollable = await mobile.evaluate(() => {
    const el = document.querySelector('.forecast-card.selected .cloud-scroll');
    return el ? { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null;
  });
  check('移动端云量曲线可横向滚动', cloudScrollable && cloudScrollable.scrollWidth > cloudScrollable.clientWidth, JSON.stringify(cloudScrollable));
  const mCloudChart = mobile.locator('.forecast-card.selected [data-cloud-chart]');
  await mCloudChart.scrollIntoViewIfNeeded();
  await mobile.waitForTimeout(120);
  const mCloudBox = await mCloudChart.boundingBox();
  const mCloudX = Number(await mCloudChart.locator('.cloud-hit').nth(4).getAttribute('data-x'));
  await mobile.touchscreen.tap(mCloudBox.x + mCloudX, mCloudBox.y + 80);
  await mobile.waitForTimeout(150);
  check('移动端云量曲线点击显示详情', await mobile.locator('.forecast-card.selected .cloud-tooltip.visible').count() === 1);
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
  const rmRain = await rm.evaluate(() => typeof RainFX !== 'undefined' && RainFX.running);
  check('reduced-motion 不启动雨效', rmRain === false, `running=${rmRain}`);
  await rm.close();

  await browser.close();
  server.close();
  if (failures.length) { console.log(`\n${failures.length} FAILURES: ${failures.join(' | ')}`); process.exit(1); }
  console.log('\nE2E all passed');
})().catch((err) => { console.error('E2E error:', err); server.close(); process.exit(1); });
