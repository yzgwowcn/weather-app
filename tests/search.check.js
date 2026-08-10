// 端到端验证：地点搜索功能（输入 → 下拉 → 选中 → 查询 → 自定义按钮 → 切回预设）
// 依赖全局 playwright-core（NODE_PATH 指向 npm root -g）。node tests/search.check.js
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
  await new Promise((r) => server.listen(8124, r));
  const pw = require('playwright-core');
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const failures = [];
  const marineRequests = [];
  page.on('request', (request) => { if (request.url().startsWith('https://marine-api.open-meteo.com/')) marineRequests.push(request.url()); });
  const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures.push(name); };
  page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
  await page.goto('http://127.0.0.1:8124/', { waitUntil: 'networkidle', timeout: 60000 });

  check('搜索框存在', await page.locator('#location-search').count() === 1);
  // XSS 防御：render.js 的 escapeText 须转义五种危险字符
  const esc = await page.evaluate(() => escapeText('<b>&"\'</b>'));
  check('escapeText 转义生效', esc === '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;', esc);
  await page.fill('#location-search', '杭州');
  // 等待防抖 + Photon 请求返回下拉结果（最多 20s）
  await page.waitForFunction(() => document.querySelectorAll('.search-item').length >= 1, null, { timeout: 20000 }).catch(() => {});
  check('下拉出现结果', await page.locator('.search-item').count() >= 1, `items=${await page.locator('.search-item').count()}`);
  check('非海南结果带标签', await page.locator('.search-item-tag').count() >= 1, `tags=${await page.locator('.search-item-tag').count()}`);
  check('结果含坐标摘要', /°[NS], /.test(await page.locator('.search-item-coord').first().textContent()), await page.locator('.search-item-coord').first().textContent());
  const firstName = await page.locator('.search-item-name').first().textContent();
  check('结果含中文名称', /杭州/.test(firstName), firstName);
  await page.locator('.search-item').first().click();
  // 选中非海南点应出现 toast 提示
  await page.waitForTimeout(120);
  check('非海南选择有 toast 提示', await page.locator('.toast.visible').count() === 1);
  // 等待查询完成：结果区标题出现自定义地点名（网络慢时最多等 60s）
  await page.waitForFunction(() => /杭州市/.test(document.querySelector('.section-kicker')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
  const loadingVisible = await page.locator('#loading').evaluate((el) => !el.classList.contains('hidden'));
  check('查询完成后 loading 隐藏', !loadingVisible);
  check('自定义按钮出现', await page.locator('.dest-btn.custom').count() === 1);
  check('自定义按钮激活', (await page.locator('.dest-btn.custom').getAttribute('aria-pressed')) === 'true');
  const kicker = await page.locator('.section-kicker').first().textContent();
  check('结果区域显示自定义地点', /杭州市/.test(kicker), kicker);
  // 切回预设地点
  await page.locator('.dest-btn[data-id="sanya"]').click();
  check('切回预设激活', (await page.locator('.dest-btn[data-id="sanya"]').getAttribute('aria-pressed')) === 'true');
  // Escape 关闭下拉
  await page.fill('#location-search', '大理');
  await page.waitForFunction(() => document.querySelectorAll('.search-item').length >= 1, null, { timeout: 20000 }).catch(() => {});
  check('再次搜索出现下拉', await page.locator('.search-item').count() >= 1);
  await page.keyboard.press('Escape');
  check('Escape 关闭下拉', await page.locator('#search-results').evaluate((el) => el.classList.contains('hidden')));

  // 手动经纬度选点：展开输入行 → 填坐标 → 查询此坐标 → 自定义按钮出现
  await page.locator('#coord-toggle').click();
  check('坐标输入行展开', await page.locator('#coord-input').evaluate((el) => !el.classList.contains('hidden')));
  // 无效坐标：toast 提示且不发起查询
  await page.fill('#coord-lat', '99');
  await page.fill('#coord-lon', '110');
  await page.locator('#coord-confirm').click();
  await page.waitForTimeout(120);
  check('无效坐标有 toast 提示', await page.locator('.toast.visible').count() === 1, `visible=${await page.locator('.toast.visible').count()}`);
  // 有效坐标（海南内）→ 查询成功
  await page.fill('#coord-lat', '18.5');
  await page.fill('#coord-lon', '110.03');
  await page.locator('#coord-confirm').click();
  await page.waitForFunction(() => /自选点/.test(document.querySelector('.section-kicker')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
  check('坐标查询生成自定义按钮', /自选点 \(18\.50°N, 110\.03°E\)/.test(await page.locator('.dest-btn.custom').textContent()), await page.locator('.dest-btn.custom').textContent());
  check('海南自选点请求近海数据', marineRequests.some((url) => /latitude=18\.5(?:0|&)/.test(url) && /cell_selection=sea/.test(url)), `marineRequests=${marineRequests.length}`);
  const coordLoading = await page.locator('#loading').evaluate((el) => !el.classList.contains('hidden'));
  check('坐标查询完成后 loading 隐藏', !coordLoading);
  // 高德 GCJ-02 坐标勾选换算：输入高德拾取坐标，确认后名称应显示换算后的 WGS84 坐标
  await page.locator('#coord-toggle').click(); // 重新展开（确认后未收起时跳过）
  const coordVisible = await page.locator('#coord-input').evaluate((el) => !el.classList.contains('hidden'));
  if (!coordVisible) { await page.locator('#coord-toggle').click(); }
  await page.fill('#coord-lat', '18.236');
  await page.fill('#coord-lon', '109.529');
  await page.locator('#coord-is-gcj').check();
  await page.locator('#coord-confirm').click();
  await page.waitForTimeout(300);
  const gcjName = await page.locator('.dest-btn.custom').textContent();
  check('GCJ-02 自动换算为 WGS84', /自选点 \(18\.2\d°N, 109\.5\d°E\)/.test(gcjName), gcjName);
  await browser.close();
  server.close();
  if (failures.length) { console.log(`\n${failures.length} FAILURES: ${failures.join(' | ')}`); process.exit(1); }
  console.log('\nSEARCH FEATURE all passed');
})().catch((err) => { console.error('Error:', err); server.close(); process.exit(1); });
