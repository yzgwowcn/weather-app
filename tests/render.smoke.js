// 渲染层无依赖冒烟测试：node tests/render.smoke.js
// 用夹具 bundle 验证 renderWeatherApp 的区块顺序、视图切换与准星渲染。
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = {};
vm.runInNewContext(
  `${fs.readFileSync('js/glass-sea.js', 'utf8')}\n${fs.readFileSync('js/metrics.js', 'utf8')}\n${fs.readFileSync('js/render.js', 'utf8')}\nglobalThis.__out = { renderWeatherApp };`,
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
function allDay(d, codes = 0, wind = 20) {
  const time = Array.from({ length: 24 }, (_, i) => `${d}T${String(i).padStart(2, '0')}:00`);
  return { time, cloud_cover_low: Array(24).fill(20), cloud_cover_mid: Array(24).fill(20), cloud_cover_high: Array(24).fill(90), precipitation: Array(24).fill(0), wind_speed_10m: Array(24).fill(wind), weather_code: Array.isArray(codes) ? [...codes] : Array(24).fill(codes) };
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
      cloud_cover: DAYS.flatMap(() => Array(24).fill(50)),
      cloud_cover_low: DAYS.flatMap(() => Array(24).fill(20)),
      cloud_cover_mid: DAYS.flatMap(() => Array(24).fill(20)),
      cloud_cover_high: DAYS.flatMap(() => Array(24).fill(90)),
      // 第二天 08–14 时有降雨（云量曲线降雨柱 fixture）
      precipitation: [...Array(24).fill(0), ...Array(24).fill(0).map((_, i) => (i >= 8 && i <= 14 ? [1.2, 2.5, 3.1, 2.2, 1.0, 0.4, 0.2][i - 8] : 0)), ...Array(24).fill(0)],
      wind_speed_10m: DAYS.flatMap(() => Array(24).fill(20)),
    },
  },
  deterministic: {
    'ECMWF IFS': { hourly: allDay(DAYS[0], 0, 10) },
    'NOAA GFS': { hourly: allDay(DAYS[1]) },
    'JMA GSM': { hourly: allDay(DAYS[2], 95, 95) },
    'CMA GRAPES': { error: 'x' },
  },
  ensembles: {
    'ECMWF IFS 集合': { hourly: ens(members) },
    'GFS 集合': { hourly: ens(members.slice(0, 3)) },
  },
  marine: {
    latitude: 18.208, longitude: 109.542,
    hourly: {
      time: DAYS.flatMap((d) => allDay(d).time),
      wave_height: DAYS.flatMap(() => Array(24).fill(0.4)),
      wind_wave_height: DAYS.flatMap(() => Array(24).fill(0.1)),
      swell_wave_height: DAYS.flatMap(() => Array(24).fill(0.4)),
    },
    daily: { time: DAYS, wave_height_max: [0.4, 0.4, 0.4] },
  },
};
const dest = { name: '三亚·亚龙湾', id: 'sanya', lat: 18.224, lon: 109.512, marine: true };

const html = renderWeatherApp(bundle, dest, 3, null, {});
const checks = ['ec-hero', 'verdict-badge good', 'EC 集合晴好率', '100%', '51 成员满足', 'sky-section', 'sky-svg', 'sky-hit', 'sky-view-btn', 'cross-section', 'cross-stat support', 'cross-stat oppose', 'cross-stat missing', 'date-rail', 'forecast-section', 'ECMWF 主运行'];
for (const c of checks) {
  if (!html.includes(c)) { console.error('MISSING:', c); process.exit(1); }
}
// 预设点 AI 文案只替换解释层，核心 EC 数值与结论仍由规则引擎输出；外部文本必须转义。
const htmlAi = renderWeatherApp(bundle, dest, 3, null, { aiAnalyses: {
  [DAYS[0]]: { summary: '晴好窗口稳定', reason: '低中云较少', uncertainty: '集合一致', glassSea: '<08:00–10:00较佳候选>', advice: '<注意防晒>' },
} });
for (const c of ['DEEPSEEK 天气分析', 'ai-avatar', 'ai-bubble', 'ai-glass-sea', 'data-ai-typing="true"', '晴好窗口稳定', '低中云较少', '集合一致', '&lt;08:00–10:00较佳候选&gt;', '&lt;注意防晒&gt;', '玻璃海候选', '有效浪高≤0.4 m', '100%', '51 成员满足']) {
  if (!htmlAi.includes(c)) { console.error('AI RENDER MISSING:', c); process.exit(1); }
}
if (htmlAi.includes('<注意防晒>') || htmlAi.includes('<08:00–10:00较佳候选>')) { console.error('AI RENDER XSS'); process.exit(1); }
const htmlAiSeen = renderWeatherApp(bundle, dest, 3, null, { aiAnalyses: {
  [DAYS[0]]: { summary: '晴好窗口稳定', reason: '低中云较少', uncertainty: '集合一致', advice: '注意防晒' },
}, aiSeenDates: new Set([DAYS[0]]) });
if (htmlAiSeen.includes('data-ai-typing="true"')) { console.error('AI TYPEWRITER REPEATED'); process.exit(1); }
const htmlAiLoading = renderWeatherApp(bundle, dest, 3, null, { aiStatus: 'loading' });
for (const c of ['ai-analysis ai-loading', 'DeepSeek 正在分析', '正在结合 EC 集合、分层云与近海浪场分析', 'ai-loading-dots']) {
  if (!htmlAiLoading.includes(c)) { console.error('AI LOADING MISSING:', c); process.exit(1); }
}
const htmlAiRetrying = renderWeatherApp(bundle, dest, 3, null, { aiStatus: 'retrying' });
if (!htmlAiRetrying.includes('正在进行一次安全重试')) { console.error('AI RETRY COPY MISSING'); process.exit(1); }
if (htmlAi.includes('ai-loading')) { console.error('AI READY STILL LOADING'); process.exit(1); }
const htmlAiUnavailable = renderWeatherApp(bundle, dest, 3, null, { aiStatus: 'unavailable' });
for (const c of ['ai-analysis ai-unavailable', 'DeepSeek 分析暂未完成', '当前出行结论仍由气象规则正常提供']) {
  if (!htmlAiUnavailable.includes(c)) { console.error('AI UNAVAILABLE MISSING:', c); process.exit(1); }
}
// 概率环形图：SVG 环（pathLength=100，dasharray 即百分比；全成员晴好 → 100 100）
for (const c of ['prob-ring', 'prob-arc', 'prob-track', 'stroke-dasharray="100 100"', 'rotate(-90 60 60)']) {
  if (!html.includes(c)) { console.error('PROB-RING MISSING:', c); process.exit(1); }
}
// 逐日卡片展开区：当天逐小时低云/中云/降雨量曲线（横向滚动 + 命中条 + 准星/tooltip）
for (const c of ['cloud-scroll', 'cloud-chart', 'cloud-line low', 'cloud-line mid', 'cloud-hit', 'cloud-crosshair', 'cloud-tooltip', '1 小时间隔 · 24 点 · 综合预报', 'legend-low', 'legend-mid', 'legend-precip']) {
  if (!html.includes(c)) { console.error('CLOUD CURVE MISSING:', c); process.exit(1); }
}
// 选中第二天（有降雨）验证曲线细节：低云/中云 2 条线、24 条命中、7 根降雨柱
const htmlC = renderWeatherApp(bundle, dest, 3, DAYS[1], {});
for (const c of ['cloud-line low', 'cloud-line mid', 'cloud-bar', 'data-date="2026-08-09"']) {
  if (!htmlC.includes(c)) { console.error('CLOUD CURVE DAY2 MISSING:', c); process.exit(1); }
}
if (htmlC.includes('cloud-line total') || htmlC.includes('cloud-line high') || htmlC.includes('legend-total') || htmlC.includes('legend-high')) { console.error('CLOUD CURVE LEGACY CLASSES REMAIN'); process.exit(1); }
if ((htmlC.match(/class="cloud-line/g) || []).length !== 2) { console.error('CLOUD LINES COUNT FAIL（应为 2 条：低云/中云）'); process.exit(1); }
if ((htmlC.match(/class="cloud-hit"/g) || []).length !== 24) { console.error('CLOUD HIT COUNT FAIL（应为 24 条）'); process.exit(1); }
if ((htmlC.match(/class="cloud-bar"/g) || []).length !== 7) { console.error('CLOUD BAR COUNT FAIL（应为 7 根降雨柱）'); process.exit(1); }
if ((htmlC.match(/cloud-curve-wrap/g) || []).length !== 1) { console.error('CLOUD CURVE WRAP COUNT FAIL（应仅选中卡片展开）'); process.exit(1); }
const inlandHtml = renderWeatherApp(bundle, { ...dest, id: 'custom', lat: 19.05, lon: 109.78 }, 3, null, {});
if (inlandHtml.includes('glass-sea-detail') || inlandHtml.includes('marine-section')) { console.error('INLAND MARINE SHOULD BE HIDDEN'); process.exit(1); }
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
for (const c of ['verdict-badge good', '13:00–15:00 有雷阵雨，注意避雨', 'lightning-bolt.svg', '海边天色重点看低云与中云', '数值越低天色越通透']) {
  if (!htmlT.includes(c)) { console.error('THUNDER/COPY MISSING:', c); process.exit(1); }
}
if (!htmlT.includes('data-mood="thunder"')) { console.error('THUNDER MOOD FAIL'); process.exit(1); }
// 天气图标：meteocons Lottie 容器（js/icons.js 播放），hero 与逐日卡片均使用
for (const c of ['data-lottie="clear-day"', 'weather-lottie weather-symbol', 'weather-lottie forecast-symbol']) {
  if (!htmlT.includes(c)) { console.error('ICON FAIL:', c); process.exit(1); }
}
// 图标序列：日间（08–17）小时码分段 → 多图标 + 箭头分隔；适合出行时毛毛雨映射为"晴间多云伴零星阵雨"
const seqBundle = {
  ...bundle,
  forecast: {
    ...bundle.forecast,
    hourly: {
      ...bundle.forecast.hourly,
      time: [
        `${DAYS[0]}T08:00`, `${DAYS[0]}T09:00`, `${DAYS[0]}T10:00`, `${DAYS[0]}T11:00`, `${DAYS[0]}T12:00`, `${DAYS[0]}T13:00`, `${DAYS[0]}T14:00`, `${DAYS[0]}T15:00`, `${DAYS[0]}T16:00`, `${DAYS[0]}T17:00`,
        `${DAYS[1]}T08:00`, `${DAYS[1]}T09:00`, `${DAYS[1]}T10:00`, `${DAYS[1]}T11:00`, `${DAYS[1]}T12:00`, `${DAYS[1]}T13:00`, `${DAYS[1]}T14:00`, `${DAYS[1]}T15:00`, `${DAYS[1]}T16:00`, `${DAYS[1]}T17:00`,
        `${DAYS[2]}T08:00`, `${DAYS[2]}T09:00`, `${DAYS[2]}T10:00`, `${DAYS[2]}T11:00`, `${DAYS[2]}T12:00`, `${DAYS[2]}T13:00`, `${DAYS[2]}T14:00`, `${DAYS[2]}T15:00`, `${DAYS[2]}T16:00`, `${DAYS[2]}T17:00`,
      ],
      weather_code: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 51, 51, 51, 51, 51, 51, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95],
    },
  },
  deterministic: {
    ...bundle.deterministic,
    // EC 数据扩展到 3 天：DAY1 毛毛雨（适合出行）、DAY2 雷阵雨
    'ECMWF IFS': { hourly: (() => {
      const days3 = [allDay(DAYS[0], 0), allDay(DAYS[1], 51), allDay(DAYS[2], 95)];
      const merged = {};
      Object.keys(days3[0]).forEach((key) => { merged[key] = days3.flatMap((d) => d[key]); });
      return merged;
    })() },
  },
};
const htmlSeq = renderWeatherApp(seqBundle, dest, 3, null, {});
for (const c of ['data-lottie="clear-day"', 'data-lottie="partly-cloudy-day-drizzle"', 'data-lottie="thunderstorms"', 'icon-period', '>早<', '>中<', '>晚<']) {
  if (!htmlSeq.includes(c)) { console.error('SEQ FAIL:', c); process.exit(1); }
}
// 卡片为早-中-晚三段式（3 个 icon-slot）
const firstCard = htmlSeq.indexOf('forecast-summary');
const secondCard = htmlSeq.indexOf('forecast-summary', firstCard + 10);
const cardHtml = htmlSeq.slice(firstCard, secondCard === -1 ? htmlSeq.length : secondCard);
const cardSlots = (cardHtml.match(/icon-slot/g) || []).length;
if (cardSlots !== 3) { console.error('CARD 3-PERIOD FAIL:', cardSlots); process.exit(1); }

console.log('render smoke OK; html length', html.length);
