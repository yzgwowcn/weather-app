const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.replace(/^\//, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
const WEATHER_RE = /open-meteo\.com\/v1\/(forecast|ecmwf|gfs|jma|cma|ensemble|marine)/;
const META_RE = /open-meteo\.com\/data\/.+\/static\/meta\.json/;
(async () => {
  await new Promise((r) => server.listen(8135, r));
  const pw = require('playwright-core');
  const browser = await pw.chromium.launch();
  const failures = [];
  const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures.push(name); };

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let weather = 0, meta = 0;
  page.on('request', (r) => {
    const u = r.url();
    if (WEATHER_RE.test(u)) weather += 1;
    else if (META_RE.test(u)) meta += 1;
  });
  page.on('pageerror', (err) => failures.push('pageerror: ' + err.message));

  // 场景 1：首次查询（无缓存）→ 8 天气 + 4 meta
  await page.goto('http://127.0.0.1:8135/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.ec-hero'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  check('首次查询 7 个天气请求（三亚无海况）', weather === 7, 'weather=' + weather);
  check('首次查询 4 个 meta 请求', meta === 4, 'meta=' + meta);
  check('缓存已写入', await page.evaluate(() => { for (let i = 0; i < localStorage.length; i += 1) if (localStorage.key(i).indexOf('omCache:v1:') === 0) return true; return false; }));

  // 场景 2：同地点二次查询（模型未更新）→ 仅 1 meta，0 天气
  weather = 0; meta = 0;
  await page.click('#query-btn');
  await page.waitForTimeout(4000);
  check('二次查询 0 天气请求（读缓存）', weather === 0, 'weather=' + weather);
  check('二次查询仅 1 个 meta 检查', meta === 1, 'meta=' + meta);
  check('二次查询结果正常渲染', (await page.locator('.ec-hero').count()) === 1);

  // 场景 3：模拟模型更新（metaAvail +1）→ 重新请求
  await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k.indexOf('omCache:v1:') === 0) {
        const e = JSON.parse(localStorage.getItem(k));
        e.metaAvail += 1;
        localStorage.setItem(k, JSON.stringify(e));
      }
    }
  });
  weather = 0; meta = 0;
  await page.click('#query-btn');
  await page.waitForTimeout(4000);
  check('模型更新后重新请求（8 天气）', weather === 7, 'weather=' + weather);
  check('模型更新后 meta 重新拉取（1 检查 + 4 拉取）', meta === 5, 'meta=' + meta);

  // 场景 4：meta 全部失败 + 缓存 <6h → 读缓存
  const page2 = await browser.newPage();
  let w2 = 0, m2 = 0;
  page2.on('request', (r) => {
    const u = r.url();
    if (WEATHER_RE.test(u)) w2 += 1;
    else if (META_RE.test(u)) m2 += 1;
  });
  await page2.route('**/static/meta.json*', (route) => route.fulfill({ status: 500, body: 'boom' }));
  await page2.goto('http://127.0.0.1:8135/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page2.waitForFunction(() => document.querySelector('.ec-hero'), null, { timeout: 60000 }).catch(() => {});
  await page2.waitForTimeout(500);
  // 首次（无缓存）会发 8 天气（meta 失败不影响天气）
  check('meta 失败时首次仍发天气请求', w2 === 7, 'w2=' + w2);
  w2 = 0; m2 = 0;
  await page2.click('#query-btn');
  await page2.waitForTimeout(3000);
  check('meta 失败 + 缓存 6h 内 → 读缓存（0 天气）', w2 === 0, 'w2=' + w2);
  await page2.close();

  // 场景 5：配额耗尽兜底（天气 429 + 缓存 metaAvail 已变）→ 局部降级仍渲染
  await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k.indexOf('omCache:v1:') === 0) {
        const e = JSON.parse(localStorage.getItem(k));
        e.metaAvail += 1;
        localStorage.setItem(k, JSON.stringify(e));
      }
    }
  });
  const rateBody = JSON.stringify({ reason: 'Daily API request limit exceeded. Please try again tomorrow.', error: true });
  await page.route('**/v1/forecast*', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: rateBody }));
  await page.route('**/v1/ecmwf*', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: rateBody }));
  await page.route('**/v1/gfs*', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: rateBody }));
  await page.route('**/v1/jma*', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: rateBody }));
  await page.route('**/v1/cma*', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: rateBody }));
  await page.route('**/v1/ensemble*', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: rateBody }));
  await page.route('**/v1/marine*', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: rateBody }));
  await page.click('#query-btn');
  await page.waitForTimeout(3000);
  check('限流兜底：页面仍渲染主结论', (await page.locator('.ec-hero').count()) === 1);
  check('限流兜底：无错误卡片', (await page.locator('.error-card').count()) === 0);
  const hasFromCache = await page.evaluate(() => document.body.innerText.includes('EC 集合晴好率'));
  check('限流兜底：显示缓存数据（晴好率正常）', hasFromCache);

  await browser.close();
  server.close();
  if (failures.length) { console.log('\nFAILURES: ' + failures.join(' | ')); process.exit(1); }
  console.log('\nALL CACHE CHECKS PASSED');
})().catch((err) => { console.error('Error:', err); server.close(); process.exit(1); });
