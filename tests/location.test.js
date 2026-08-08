// 地点服务层纯函数测试（无 DOM / 网络）：node tests/location.test.js
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = {};
vm.runInNewContext(`${fs.readFileSync('js/location.js', 'utf8')}\nglobalThis.__loc = Location;`, ctx);
const L = ctx.__loc;

// 1. GCJ-02 ↔ WGS84 往返一致性：正向再反向应回到原点（误差 < 1e-5 度 ≈ 1 米）
const points = [[18.224, 109.512], [19.0, 110.0], [20.1, 108.6], [18.1, 111.0], [30.0, 120.0]];
for (const [lat, lon] of points) {
  const [gLng, gLat] = L.wgs84ToGcj02(lon, lat);
  const [wLng, wLat] = L.gcj02ToWgs84(gLng, gLat);
  if (Math.abs(wLng - lon) > 1e-5 || Math.abs(wLat - lat) > 1e-5) {
    console.error('ROUNDTRIP FAIL:', lat, lon, '→', wLat, wLng); process.exit(1);
  }
}
// 2. 偏移方向：三亚区域 GCJ-02 相对 WGS84 应有可观测偏移（> 1e-4 度）
const [gLng2, gLat2] = L.wgs84ToGcj02(109.512, 18.224);
if (Math.abs(gLng2 - 109.512) < 1e-4 && Math.abs(gLat2 - 18.224) < 1e-4) {
  console.error('OFFSET TOO SMALL'); process.exit(1);
}
// 3. 海南范围矩形判断
if (!L.isInHainan(19.0, 110.0)) { console.error('HAINAN INSIDE FAIL'); process.exit(1); }
if (L.isInHainan(30.0, 120.0) || L.isInHainan(18.0, 109.0) || L.isInHainan(19.0, 112.0)) { console.error('HAINAN OUTSIDE FAIL'); process.exit(1); }
// 4. 兜底名称格式
if (L.formatCoordName(18.5, 110.03) !== '自选点 (18.50°N, 110.03°E)') { console.error('NAME FAIL:', L.formatCoordName(18.5, 110.03)); process.exit(1); }
if (L.formatCoordName(-18.5, -110.03) !== '自选点 (18.50°S, 110.03°W)') { console.error('NAME SW FAIL'); process.exit(1); }
// 5. 境外（outOfChina）坐标不做转换
const [uLng, uLat] = L.gcj02ToWgs84(10.0, 50.0);
if (uLng !== 10.0 || uLat !== 50.0) { console.error('OUTOFCHINA FAIL'); process.exit(1); }

console.log('location tests passed');
