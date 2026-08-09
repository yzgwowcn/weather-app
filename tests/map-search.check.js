// 端到端验证：地图选点搜索（自绘下拉，AMap stub） + 主搜索下拉层级不被遮挡
// 依赖全局 playwright-core（NODE_PATH 指向 npm root -g）。node tests/map-search.check.js
// 本地开发无 AMAP key：AMap 用 stub 注入（仅保证面板可打开、地图方法可调用），
// 搜索走 Photon 兜底通道（与部署环境行为一致：有结果即有反应）。
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
  await new Promise((r) => server.listen(8125, r));
  const pw = require('playwright-core');
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const failures = [];
  const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures.push(name); };
  page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
  // AMap stub：记录地图方法调用（focusMapPick → setCenter/setZoom；setMapPick → Marker）
  await page.addInitScript(() => {
    window.__mapCalls = { centers: [], zooms: [], markers: 0 };
    class MapStub {
      constructor() { this._on = {}; }
      on() {}
      setCenter(c) { window.__mapCalls.centers.push(c); }
      setZoom(z) { window.__mapCalls.zooms.push(z); }
      destroy() {}
    }
    class MarkerStub {
      constructor() { window.__mapCalls.markers += 1; }
      setMap() {}
      on() {}
      setPosition() {}
    }
    window.AMap = {
      Map: MapStub,
      Marker: MarkerStub,
      Geocoder: function () { this.getAddress = function (pos, cb) { cb('error'); }; },
      Geolocation: function () {},
      TileLayer: { Satellite: function () {}, RoadNet: function () {} },
    };
  });
  await page.goto('http://127.0.0.1:8125/', { waitUntil: 'networkidle', timeout: 60000 });
  // AMap stub 已存在但 loadAMap 不会触发 amap-ready（key 未注入），手动派发以启用地图按钮
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('amap-ready')));
  await page.waitForTimeout(200);

  // ---- 地图选点搜索：自绘下拉 ----
  check('地图按钮已启用', await page.locator('#map-btn').isEnabled());
  await page.locator('#map-btn').click();
  check('地图面板打开', await page.locator('#map-panel').evaluate((el) => el.classList.contains('open')));
  await page.fill('#map-search', '金牛区');
  // 等待防抖 + Photon 请求返回自绘下拉结果（最多 20s）
  await page.waitForFunction(() => document.querySelectorAll('#map-search-results .search-item').length >= 1, null, { timeout: 20000 }).catch(() => {});
  const mapItems = await page.locator('#map-search-results .search-item').count();
  check('地图搜索下拉出现结果', mapItems >= 1, `items=${mapItems}`);
  const firstName = await page.locator('#map-search-results .search-item-name').first().textContent();
  check('地图搜索结果含中文名称', /金牛/.test(firstName), firstName);
  check('地图下拉含坐标摘要', /°[NS], /.test(await page.locator('#map-search-results .search-item-coord').first().textContent()));
  // 点击选中 → focusMapPick 定位（stub 记录 setCenter）
  await page.locator('#map-search-results .search-item').first().click();
  await page.waitForTimeout(120);
  check('选中后输入框清空', (await page.locator('#map-search').inputValue()) === '');
  check('选中后下拉隐藏', await page.locator('#map-search-results').evaluate((el) => el.classList.contains('hidden')));
  const centers = await page.evaluate(() => window.__mapCalls.centers);
  check('地图定位被调用（setCenter）', centers.length >= 1, `centers=${JSON.stringify(centers)}`);
  check('定位坐标在成都金牛区附近', centers.length >= 1 && Math.abs(centers[0][0] - 104.06) < 0.3 && Math.abs(centers[0][1] - 30.69) < 0.3, JSON.stringify(centers[0]));
  // 关闭面板 → 搜索状态清空
  await page.locator('#map-cancel').click();
  check('关闭面板后输入框清空', (await page.locator('#map-search').inputValue()) === '');
  check('关闭面板后面板隐藏', await page.locator('#map-panel').evaluate((el) => !el.classList.contains('open')));

  // ---- 主搜索下拉层级：不被收藏框/时间轴遮挡 ----
  // 页面加载后自动查询过默认城市，结果区（含 date-rail 时间轴）已渲染
  await page.fill('#location-search', '大理');
  await page.waitForFunction(() => document.querySelectorAll('#search-results .search-item').length >= 1, null, { timeout: 20000 }).catch(() => {});
  check('主搜索下拉出现结果', await page.locator('#search-results .search-item').count() >= 1);
  // elementFromPoint：下拉中心应命中下拉自身（若被收藏框/时间轴盖住则命中其他元素）
  const hitInfo = await page.evaluate(() => {
    const list = document.getElementById('search-results');
    const rect = list.getBoundingClientRect();
    const probe = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el ? (el.closest('#search-results') ? 'search-results' : (el.closest('.fav-section') ? 'fav-section' : (el.closest('.date-rail') ? 'date-rail' : el.className || el.tagName))) : 'null';
    };
    const x = rect.left + rect.width / 2;
    return {
      visible: rect.height > 0 && rect.top >= 0,
      topHit: probe(x, Math.min(rect.top + 8, rect.bottom - 2)),
      midHit: probe(x, Math.min(rect.top + rect.height / 2, rect.bottom - 2)),
    };
  });
  check('下拉可见且在视口内', hitInfo.visible, JSON.stringify(hitInfo));
  check('下拉顶部未被遮挡', hitInfo.topHit === 'search-results', `topHit=${hitInfo.topHit}`);
  check('下拉中部未被遮挡', hitInfo.midHit === 'search-results', `midHit=${hitInfo.midHit}`);
  await page.keyboard.press('Escape');

  await browser.close();
  server.close();
  if (failures.length) { console.log(`\n${failures.length} FAILURES: ${failures.join(' | ')}`); process.exit(1); }
  console.log('\nMAP-SEARCH FEATURE all passed');
})().catch((err) => { console.error('Error:', err); server.close(); process.exit(1); });
