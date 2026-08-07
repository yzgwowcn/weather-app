// 渲染层无依赖冒烟测试：node tests/render.smoke.js
// 用夹具 bundle 验证 renderWeatherApp 的区块顺序、视图切换与准星渲染。
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = {};
vm.runInNewContext(
  `${fs.readFileSync('js/metrics.js', 'utf8')}\n${fs.readFileSync('js/render.js', 'utf8')}\nglobalThis.__out = { renderWeatherApp };`,
  ctx,
);
const { renderWeatherApp } = ctx.__out;

const DAYS = ['2026-08-08', '2026-08-09', '2026-08-10'];

function day(d, low = 20, mid = 20, high = 90, precip = 0, wind = 20, codes = 0) {
  const time = Array.from({ length: 24 }, (_, i) => `${d}T${String(i).padStart(2, '0')}:00`);
  const fill = (v) => Array(24).fill(v);
  return { time, cloud_cover_low: fill(low), cloud_cover_mid: fill(mid), cloud_cover_high: fill(high), precipitation: fill(precip), wind_speed_10m: fill(wind), weather_code: Array.isArray(codes) ? [...codes] : fill(codes) };
}
function ens(members) {
  const h = day(DAYS[0]);
  members.forEach((m, i) => {
    const s = i === 0 ? '' : `_member${String(i).padStart(2, '0')}`;
    h[`cloud_cover_low${s}`] = Array(24).fill(m.low);
    h[`cloud_cover_mid${s}`] = Array(24).fill(m.mid);
    h[`cloud_cover_high${s}`] = Array(24).fill(m.high);
    h[`precipitation${s}`] = Array(24).fill(m.precip);
    h[`wind_speed_10m${s}`] = Array(24).fill(m.wind);
    h[`weather_code${s}`] = Array(24).fill(m.codes ?? 0);
  });
  return h;
}
function allDay(d, codes = 0) {
  const time = Array.from({ length: 24 }, (_, i) => `${d}T${String(i).padStart(2, '0')}:00`);
  return { time, cloud_cover_low: Array(24).fill(20), cloud_cover_mid: Array(24).fill(20), cloud_cover_high: Array(24).fill(90), precipitation: Array(24).fill(0), wind_speed_10m: Array(24).fill(20), weather_code: Array.isArray(codes) ? [...codes] : Array(24).fill(codes) };
}

const members = Array.from({ length: 51 }, () => ({ low: 20, mid: 20, high: 90, precip: 0, wind: 20 }));
const bundle = {
  forecast: {
    daily: {
      time: DAYS, weather_code: [0, 2, 61], cloud_cover_mean: [30, 60, 90],
      precipitation_sum: [0, 3, 8], precipitation_probability_max: [10, 60, 90],
      wind_speed_10m_max: [21, 25, 33], wind_gusts_10m_max: [30, 38, 45],
      temperature_2m_min: [25, 24, 23], temperature_2m_max: [31, 30, 28],
    },
    hourly: {
      time: DAYS.flatMap((d) => allDay(d).time),
      cloud_cover_low: DAYS.flatMap(() => Array(24).fill(20)),
      cloud_cover_mid: DAYS.flatMap(() => Array(24).fill(20)),
      cloud_cover_high: DAYS.flatMap(() => Array(24).fill(90)),
      precipitation: DAYS.flatMap(() => Array(24).fill(0)),
      wind_speed_10m: DAYS.flatMap(() => Array(24).fill(20)),
    },
  },
  deterministic: {
    'ECMWF IFS': { hourly: allDay(DAYS[0]) },
    'NOAA GFS': { hourly: allDay(DAYS[1]) },
    'JMA GSM': { hourly: allDay(DAYS[2], 95, 95) },
    'CMA GRAPES': { error: 'x' },
  },
  ensembles: {
    'ECMWF IFS 集合': { hourly: ens(members) },
    'GFS 集合': { hourly: ens(members.slice(0, 3)) },
  },
  marine: null,
};
const dest = { name: '三亚·亚龙湾', id: 'sanya', lat: 18.224, lon: 109.512, marine: false };

const html = renderWeatherApp(bundle, dest, 3, null, {});
const checks = ['ec-hero', 'verdict-badge good', 'EC 集合晴好率', '100%', '51 成员满足', 'sky-section', 'sky-svg', 'sky-hit', 'sky-view-btn', 'cross-section', 'cross-stat support', 'cross-stat oppose', 'cross-stat missing', 'date-rail', 'forecast-section', 'ECMWF 主运行'];
for (const c of checks) {
  if (!html.includes(c)) { console.error('MISSING:', c); process.exit(1); }
}
const iRail = html.indexOf('date-rail');
const iHero = html.indexOf('ec-hero');
const iSky = html.indexOf('sky-section');
const iCross = html.indexOf('cross-section');
if (!(iRail < iHero && iHero < iSky && iSky < iCross)) { console.error('ORDER FAIL'); process.exit(1); }

const htmlF = renderWeatherApp(bundle, dest, 3, DAYS[2], { skyView: 'forecast', skyIndex: 32 });
if (!htmlF.includes('data-sky-view="ec" hidden') || !htmlF.includes('sky-crosshair-line')) { console.error('VIEW/SKY FAIL'); process.exit(1); }

// 雷雨日：云量低但有雷阵雨 → 适合出行 + 雷雨注意时段徽章 + 低中云提示文案
const thunderCodes = Array(24).fill(0);
thunderCodes[13] = 95; thunderCodes[14] = 95; thunderCodes[15] = 96; // 13:00–15:00
const thunderBundle = {
  ...bundle,
  deterministic: { ...bundle.deterministic, 'ECMWF IFS': { hourly: allDay(DAYS[0], thunderCodes) } },
  ensembles: { 'ECMWF IFS 集合': { hourly: ens(Array.from({ length: 51 }, () => ({ low: 20, mid: 20, high: 90, precip: 0, wind: 20, codes: thunderCodes }))) }, 'GFS 集合': { hourly: ens(members.slice(0, 3)) } },
};
const htmlT = renderWeatherApp(thunderBundle, dest, 3, null, {});
for (const c of ['verdict-badge good', '13:00–15:00 有雷阵雨，注意避雨', 'lightning-bolt.svg', '海边天色重点看低云与中云', '阈值 <75%']) {
  if (!htmlT.includes(c)) { console.error('THUNDER/COPY MISSING:', c); process.exit(1); }
}
if (!htmlT.includes('data-mood="thunder"')) { console.error('THUNDER MOOD FAIL'); process.exit(1); }
// 天气图标：meteocons Lottie 容器（js/icons.js 播放），hero 与逐日卡片均使用
for (const c of ['data-lottie="clear-day"', 'data-lottie="cloudy"', 'data-lottie="rain"', 'weather-lottie weather-symbol', 'weather-lottie forecast-symbol']) {
  if (!htmlT.includes(c)) { console.error('ICON FAIL:', c); process.exit(1); }
}

console.log('render smoke OK; html length', html.length);
