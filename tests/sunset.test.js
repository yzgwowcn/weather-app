// 朝晚霞规则模块单测：node tests/sunset.test.js
// 覆盖几何（可照距离 / 云幕高度角 / 晨昏线速度）、光学（AOD 反演 / 通透度 / 光谱配色）、
// 降雨罚分、晴空判定、3 天窗口与日出/日落两种视角的时段方向。
const assert = require('node:assert');
const Sunset = require('../js/sunset.js');

const DAYS = ['2026-10-21', '2026-10-22', '2026-10-23'];

function hourList(days) {
  return days.flatMap((d) => Array.from({ length: 24 }, (_, i) => `${d}T${String(i).padStart(2, '0')}:00`));
}
function makeBundle({ low = 20, mid = 45, high = 10, total = 55, vis = 24000, temp = 28, dew = 22, precip = 0, code = 2, days = DAYS } = {}) {
  const time = hourList(days);
  const fill = (value) => time.map(() => value);
  const hourly = {
    time,
    cloud_cover: fill(total),
    cloud_cover_low: fill(low),
    cloud_cover_mid: fill(mid),
    cloud_cover_high: fill(high),
    precipitation: fill(precip),
    weather_code: fill(code),
  };
  return {
    forecast: {
      daily: {
        time: days,
        sunrise: days.map((d, i) => `${d}T06:${String(30 + i).padStart(2, '0')}`),
        sunset: days.map((d, i) => `${d}T18:${String(12 - i).padStart(2, '0')}`),
      },
      hourly: { ...hourly, visibility: fill(vis), temperature_2m: fill(temp), dew_point_2m: fill(dew) },
    },
    deterministic: { 'ECMWF IFS': { hourly } },
  };
}
const DEST = { name: '三亚·亚龙湾', lat: 18.224, lon: 109.512 };

// ---- 几何 ----
// 高度 H 的云底被低角度阳光照亮的水平可达范围 = 2·√(2RH)
assert.strictEqual(Math.round(Sunset.glowReachKm(3.6)), 428);
assert.strictEqual(Math.round(Sunset.glowReachKm(1.1)), 237);
assert.strictEqual(Sunset.glowReachKm(0), 0);
assert.strictEqual(Sunset.glowReachKm(null), 0);
// 太阳沉到该高度角以下时云底失去光照：H 越高需要越低的高度角
const angleLow = Sunset.litSunAngleDeg(1.1);
const angleHigh = Sunset.litSunAngleDeg(7);
assert.ok(angleHigh > angleLow && angleLow > 0, '云底越高，失去光照时的太阳高度角越低（绝对值越大）');
assert.ok(Math.abs(angleLow - 1.064) < 0.02, `H=1.1km 的临界太阳高度角应约 1.06°，实得 ${angleLow}`);

// ---- 晨昏线速度查表 ----
const speedEq = Sunset.terminatorSpeed(0, 3);
const speedMid = Sunset.terminatorSpeed(30, 3);
const speedHigh = Sunset.terminatorSpeed(55, 3);
assert.ok(speedEq > speedMid && speedMid > speedHigh, '纬度越高晨昏线地面移动越慢');
assert.ok(speedEq > 20 && speedEq < 24, `赤道晨昏线速度应约 21–24 km/min，实得 ${speedEq}`);
assert.ok(Sunset.terminatorSpeed(70, 5) > 0, '高纬走解析式兜底，仍需返回正数');

// ---- 云幕距离经验反推 ----
assert.strictEqual(Sunset.boundaryDistanceKm(0), 600);
assert.strictEqual(Sunset.boundaryDistanceKm(100), 25);
assert.ok(Sunset.boundaryDistanceKm(50) > Sunset.boundaryDistanceKm(80), '总云量越大云幕越近');
assert.strictEqual(Sunset.boundaryDistanceKm(null), 600);

// ---- 光学 ----
const aod = Sunset.aodFromVisibility(24000);
assert.ok(aod > 0.2 && aod < 0.3, `能见度 24km 反演的 AOD 应约 0.24，实得 ${aod}`);
assert.ok(Sunset.aodFromVisibility(1000) > aod, '能见度越差 AOD 越大');
assert.ok(Sunset.aodFromVisibility(null) === null);
assert.ok(Sunset.clarityFromAod(0) === 1);
assert.ok(Sunset.clarityFromAod(3) < 0.1);
// 光谱配色：可见光积分必须落在合法 sRGB，且消光越强红色占比越高
const bright = Sunset.spectralColor(0.3, 0.2);
const dim = Sunset.spectralColor(0.3, 20);
for (const color of [bright, dim]) {
  for (const channel of ['r', 'g', 'b']) {
    assert.ok(Number.isInteger(color[channel]) && color[channel] >= 0 && color[channel] <= 255, `${channel} 越界`);
  }
  assert.ok(/^#[0-9a-f]{6}$/.test(color.hex));
}
assert.ok(dim.transmittance < bright.transmittance, '光学厚度越大透过率越低');
assert.ok(dim.r - dim.b > bright.r - bright.b, '消光越强越偏红（红蓝差更大）');
assert.strictEqual(Sunset.describeColor({ r: 240, g: 102, b: 91 }).name, '绛红');
assert.strictEqual(Sunset.describeColor({ r: 251, g: 209, b: 157 }).name, '橘黄');
assert.strictEqual(Sunset.describeColor({ r: 200, g: 200, b: 200 }).name, '灰白 · 无霞');

// ---- 云底高度 ----
const highBase = Sunset.cloudBase(10, 20, 60, 28, 24);
assert.strictEqual(highBase.layer, 'high');
assert.strictEqual(highBase.km, 7);
const midBase = Sunset.cloudBase(10, 60, 5, 28, 24);
assert.strictEqual(midBase.layer, 'mid');
assert.strictEqual(midBase.km, 3.6);
// 低云为主时用抬升凝结高度修正：125 m/℃ × (T − Td) = 0.5 km，低于 0.6 km 的雾状云底按 0.6 km 兜底
const lowBase = Sunset.cloudBase(60, 5, 5, 28, 24);
assert.strictEqual(lowBase.layer, 'low');
assert.strictEqual(lowBase.km, 0.6);
assert.ok(lowBase.source.includes('抬升凝结高度'));
// 三层都 <12% → 晴空（无云可染）
assert.strictEqual(Sunset.cloudBase(5, 5, 5, 28, 24).km, null);

// ---- 降雨罚分 ----
assert.strictEqual(Sunset.rainPenaltyOf(0, 0).penalty, 0);
assert.strictEqual(Sunset.rainPenaltyOf(0.2, 51).penalty, 0, '0.1–0.2 mm 的逐小时值挡不住太阳，按无有效降水处理');
assert.ok(Sunset.rainPenaltyOf(0.4, 51).penalty > 0);
assert.ok(Sunset.rainPenaltyOf(20, 65).penalty > Sunset.rainPenaltyOf(1, 61).penalty, '雨越大扣分越多');
assert.ok(Sunset.rainPenaltyOf(10, 80).penalty < Sunset.rainPenaltyOf(10, 61).penalty, '阵雨按间歇性打折');
assert.ok(Sunset.rainPenaltyOf(10, 95).penalty >= 55, '雷雨至少按大雨扣分');
assert.ok(Sunset.rainPenaltyOf(30, 65).penalty <= 75, '罚分上限 75');

// ---- build 主流程 ----
const built = Sunset.build(makeBundle(), DEST, DAYS);
assert.strictEqual(built.source, 'ECMWF IFS');
assert.strictEqual(Object.keys(built.days).length, 3, '只覆盖最近 3 天');
const first = built.days[DAYS[0]].sunset;
assert.strictEqual(first.available, true);
assert.strictEqual(first.modeLabel, '晚霞');
assert.strictEqual(first.timeLabel, '18:12');
assert.ok(first.score >= 0 && first.score <= 100);
assert.ok(/^#[0-9a-f]{6}$/.test(first.color.hex));
assert.ok(first.window.durationMin > 0);
assert.ok(first.notes.length > 0, '必须给出可读的判定理由');
// 晚霞时段应围绕日落：起点早于日落、终点晚于日落
assert.ok(first.window.startOffset < 0 && first.window.endOffset >= 0);
assert.ok(first.window.startLabel < first.timeLabel && first.window.endLabel > first.timeLabel);

// 朝霞时段应整体早于日出：终点不晚于日出
const sunrise = built.days[DAYS[0]].sunrise;
assert.strictEqual(sunrise.timeLabel, '06:30');
assert.ok(sunrise.window.endOffset <= 8);
assert.ok(sunrise.window.startOffset < 0);

// 5 天日期只取前 3 天
const longDates = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const limited = Sunset.build(makeBundle({ days: longDates }), DEST, longDates);
assert.strictEqual(Object.keys(limited.days).length, Sunset.DAY_LIMIT);

// 晴空 → 无霞（不是高分的"完美"）
const clear = Sunset.build(makeBundle({ low: 2, mid: 0, high: 0, total: 2 }), DEST, DAYS);
assert.strictEqual(clear.days[DAYS[0]].sunset.level, 'none');
assert.strictEqual(clear.days[DAYS[0]].sunset.label, '无霞');
assert.strictEqual(clear.days[DAYS[0]].sunset.color.name, '晴空无色');

// 厚低云 + 大雨 → 分数被压低
const rainy = Sunset.build(makeBundle({ low: 95, mid: 30, high: 5, total: 95, precip: 9, code: 65 }), DEST, DAYS);
assert.ok(rainy.days[DAYS[0]].sunset.score < built.days[DAYS[0]].sunset.score, '降雨与厚低云必须扣分');
assert.ok(rainy.days[DAYS[0]].sunset.rain.penalty > 0);

// 浑浊空气（能见度 3km）通透度应明显低于 24km
const hazy = Sunset.build(makeBundle({ vis: 3000 }), DEST, DAYS);
assert.ok(hazy.days[DAYS[0]].sunset.clarity < built.days[DAYS[0]].sunset.clarity);

// EC 缺失时回退综合预报，且标注来源
const noEc = makeBundle();
delete noEc.deterministic;
const fallback = Sunset.build(noEc, DEST, DAYS);
assert.strictEqual(fallback.source, '综合预报');
assert.strictEqual(fallback.days[DAYS[0]].sunset.available, true);

// 完全无数据 → 不抛错，返回空 days（渲染层据此整块隐藏）
const empty = Sunset.build({}, DEST, DAYS);
assert.deepStrictEqual(empty.days, {});
assert.strictEqual(empty.source, null);

// 缺 daily（日落/日出时刻）→ 用经纬度本地推算，仍然可用
const noDaily = makeBundle();
delete noDaily.forecast.daily;
const noDailyBuilt = Sunset.build(noDaily, DEST, DAYS);
assert.strictEqual(noDailyBuilt.days[DAYS[0]].sunset.available, true);
assert.ok(/^18:[0-2]\d$/.test(noDailyBuilt.days[DAYS[0]].sunset.timeLabel), `三亚 10 月日落应约 18:0x，实得 ${noDailyBuilt.days[DAYS[0]].sunset.timeLabel}`);
// 连经纬度都没有 → 该天不可用
const noCoord = Sunset.build(noDaily, { name: 'x' }, DAYS);
assert.strictEqual(noCoord.days[DAYS[0]].sunset.available, false);
assert.ok(noCoord.days[DAYS[0]].sunset.note.includes('日落'));

// ---- 太阳方位与扫描几何 ----
const bearings = Sunset.scanBearings(DEST, DAYS);
assert.ok(bearings && bearings.sunset > 180 && bearings.sunset < 360, '日落方位应偏西');
assert.ok(bearings.sunrise > 0 && bearings.sunrise < 180, '日出方位应偏东');
assert.strictEqual(Sunset.scanBearings({ lat: null, lon: null }, DAYS), null);
const solar = Sunset.solarAngles(new Date(Date.UTC(2026, 9, 21, 4, 16)), 18.224, 109.512);
assert.ok(solar.elevation > 55 && solar.elevation < 65, `三亚 10 月正午太阳高度应约 60°，实得 ${solar.elevation}`);
assert.ok(solar.azimuth > 150 && solar.azimuth < 200, '正午方位应接近正南');
// 已给出的本地时刻应与官方日出日落基本一致（±5 分钟）
const computed = Sunset.eventTimes(DAYS[0], 18.224, 109.512);
assert.ok(computed.sunset && computed.sunrise);
assert.ok(Math.abs(Number(computed.sunset.slice(11, 13)) - 18) <= 1);

// 扫描序列 → 第一片成片云的方位距离
const DISTANCES = [0, 25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 600];
const LAST_DISTANCE = DISTANCES[DISTANCES.length - 1];
const clearSeries = DISTANCES.map(() => 0);
clearSeries[3] = 60; clearSeries[4] = 70; clearSeries[5] = 80;
assert.strictEqual(Sunset.boundaryFromScan(DISTANCES, clearSeries), 75, '少云时应返回第一段连续成片云');
const isolated = DISTANCES.map(() => 0);
isolated[4] = 60;
assert.strictEqual(Sunset.boundaryFromScan(DISTANCES, isolated), LAST_DISTANCE, '孤立单点云不算成片云');
const overcast = DISTANCES.map((distance) => (distance <= 50 ? 80 : distance <= 100 ? 20 : 5));
assert.strictEqual(Sunset.boundaryFromScan(DISTANCES, overcast), 75, '本地阴天时应返回云幕开始散开的边缘');
assert.strictEqual(Sunset.boundaryFromScan(DISTANCES, DISTANCES.map(() => 80)), LAST_DISTANCE, '全程有云时取最远点');
assert.strictEqual(Sunset.boundaryFromScan([], []), null);

// ---- 沿太阳方位扫描 + CAMS 气溶胶接入 ----
function withRealData(bundle) {
  const times = hourList(DAYS);
  const sunPath = {
    distances: DISTANCES,
    times,
    covers: {
      // 日落方向：0–100km 有云（成片云在 50km），日出方向：全程无云
      sunset: DISTANCES.map((d) => times.map(() => (d >= 50 && d <= 100 ? 65 : 5))),
      sunrise: DISTANCES.map(() => times.map(() => 5)),
    },
  };
  const aerosol = { hourly: { time: times, aerosol_optical_depth: times.map(() => 0.12) } };
  return { ...bundle, sunPath, aerosol };
}
const wired = Sunset.build(withRealData(makeBundle()), DEST, DAYS);
const wiredEvent = wired.days[DAYS[0]].sunset;
assert.strictEqual(wiredEvent.boundaryScanned, true, '有扫描数据时应走真实扫描');
assert.strictEqual(wiredEvent.boundaryKm, 50);
assert.strictEqual(wiredEvent.aodSource, 'CAMS');
assert.ok(Math.abs(wiredEvent.aod - 0.12) < 1e-6);
// 日出方向全程无云 → 云幕距离取扫描最远点
assert.strictEqual(wired.days[DAYS[0]].sunrise.boundaryKm, DISTANCES[DISTANCES.length - 1]);
// 无扫描数据时回落总云量折算，且标记为非扫描
const plain = Sunset.build(makeBundle(), DEST, DAYS);
assert.strictEqual(plain.days[DAYS[0]].sunset.boundaryScanned, false);
assert.strictEqual(plain.days[DAYS[0]].sunset.aodSource, '能见度反演');
// 实测 AOD 明显偏浑浊时，通透度必须随之下降
const hazyReal = Sunset.build({
  ...withRealData(makeBundle()),
  aerosol: { hourly: { time: hourList(DAYS), aerosol_optical_depth: hourList(DAYS).map(() => 0.9) } },
}, DEST, DAYS);
assert.ok(hazyReal.days[DAYS[0]].sunset.clarity < wired.days[DAYS[0]].sunset.clarity);

console.log('sunset test OK');
