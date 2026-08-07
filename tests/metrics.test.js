// 无依赖夹具测试：node tests/metrics.test.js
// 覆盖新口径：中雨及以上阻断、毛毛雨/雾不阻断、雷阵雨可出行+注意时段合并、
// 遮蔽云量 75% 边界、weather_code 缺失降级、风速 30 边界、51 成员同步、天气状态机、云图序列。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {};
vm.runInNewContext(`${fs.readFileSync('js/metrics.js', 'utf8')}\nglobalThis.metricsUnderTest = Metrics;`, context);
const Metrics = context.metricsUnderTest;

const DAY = '2026-08-08';

// 日间（08:00–17:00 共 10 小时）确定性响应夹具
function hourlyFixture({ low = 20, mid = 20, high = 100, precip = 0, wind = 20, hours = 10, codes = 0 } = {}) {
  const time = Array.from({ length: hours }, (_, i) => `${DAY}T${String(8 + i).padStart(2, '0')}:00`);
  const fill = (v) => Array(hours).fill(v);
  return {
    time,
    cloud_cover_low: fill(low), cloud_cover_mid: fill(mid), cloud_cover_high: fill(high),
    precipitation: fill(precip), wind_speed_10m: fill(wind),
    weather_code: Array.isArray(codes) ? [...codes] : fill(codes),
  };
}

// 集合响应夹具：members[0] 为控制成员（无后缀字段），其余为扰动成员
function ensembleFixture(members, hours = 10) {
  const h = hourlyFixture({ hours });
  members.forEach((m, i) => {
    const suffix = i === 0 ? '' : `_member${String(i).padStart(2, '0')}`;
    h[`cloud_cover_low${suffix}`] = Array(hours).fill(m.low);
    h[`cloud_cover_mid${suffix}`] = Array(hours).fill(m.mid);
    h[`cloud_cover_high${suffix}`] = Array(hours).fill(m.high);
    h[`precipitation${suffix}`] = Array(hours).fill(m.precip);
    h[`wind_speed_10m${suffix}`] = Array(hours).fill(m.wind);
    h[`weather_code${suffix}`] = Array.isArray(m.codes) ? [...m.codes] : Array(hours).fill(m.codes ?? 0);
  });
  return h;
}

// 全天 0–23 时序列夹具（云图时间轴）
function allDayFixture() {
  const time = Array.from({ length: 24 }, (_, i) => `${DAY}T${String(i).padStart(2, '0')}:00`);
  return {
    time,
    cloud_cover_low: Array(24).fill(20), cloud_cover_mid: Array(24).fill(20), cloud_cover_high: Array(24).fill(90),
    precipitation: Array(24).fill(0), wind_speed_10m: Array(24).fill(20), weather_code: Array(24).fill(0),
  };
}

function assess(ensembles, deterministic) {
  return Metrics.buildAssessment(ensembles, deterministic, [DAY])[DAY];
}
function ecEnsemble(members) { return { 'ECMWF IFS 集合': { hourly: ensembleFixture(members) } }; }
function ecMain(hourly = hourlyFixture()) { return { 'ECMWF IFS': { hourly } }; }

// 1. 高云 100% 但低中云达标 → 晴好成立，高云单独聚合
{
  const result = assess(ecEnsemble([{ low: 20, mid: 20, high: 100, precip: 0, wind: 20 }]), ecMain(hourlyFixture({ low: 20, mid: 20, high: 100 })));
  assert.equal(result.ec.main.suitable, true, '高云 100% 不降低晴好率');
  assert.equal(result.ec.main.highMean, 100, '高云单独聚合');
  assert.equal(result.ec.main.maskMean, 20, '加权遮蔽 = 20×0.6 + 20×0.4');
}

// 2. 中雨及以上（61）阻断 → 即使云量低也不适合
{
  const codes = Array(10).fill(0); codes[4] = 61;
  const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 20, codes }]), ecMain(hourlyFixture({ low: 10, mid: 10, high: 0, codes })));
  assert.equal(result.ec.main.blocked, true, '中雨时段阻断');
  assert.equal(result.ec.main.suitable, false, '中雨阻断出行');
  assert.equal(result.ec.ensemble.probability, 0, '成员同样不达标');
}

// 3. 毛毛雨（51）与雾（45）不阻断 → 云量低时可出行
{
  for (const code of [51, 45]) {
    const codes = Array(10).fill(0); codes[3] = code;
    const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 20, codes }]), ecMain(hourlyFixture({ low: 10, mid: 10, high: 0, codes })));
    assert.equal(result.ec.main.blocked, false, `天气码 ${code} 不阻断`);
    assert.equal(result.ec.main.suitable, true, `天气码 ${code} 可出行`);
  }
}

// 4. 雷阵雨（95）不阻断出行，输出合并后的注意时段
{
  const codes = Array(10).fill(0);
  codes[5] = 95; codes[6] = 95; codes[7] = 96; // 13:00–15:00 连续雷雨
  const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 20, codes }]), ecMain(hourlyFixture({ low: 10, mid: 10, high: 0, codes })));
  assert.equal(result.ec.main.suitable, true, '云量低时雷阵雨日可出行');
  assert.equal(JSON.stringify(result.ec.main.thunderWindows), '[[13,15]]', '连续雷雨小时合并为 13:00–15:00');
  assert.equal(result.weatherMood.mood, 'thunder', '雷阵雨日状态机为 thunder');
}

// 5. 雷雨时段拆分：不连续小时各自成段
{
  const codes = Array(10).fill(0);
  codes[0] = 95; codes[2] = 99; // 12:00 与 14:00 单独
  const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 20, codes }]), ecMain(hourlyFixture({ low: 10, mid: 10, high: 0, codes })));
  assert.equal(JSON.stringify(result.ec.main.thunderWindows), '[[8,8],[10,10]]', '不连续小时各自成段');
}

// 6. 遮蔽云量恰 75% → 不满足严格 <75%
{
  const result = assess(ecEnsemble([{ low: 75, mid: 75, high: 0, precip: 0, wind: 20 }]), ecMain(hourlyFixture({ low: 75, mid: 75, high: 0 })));
  assert.ok(Math.abs(result.ec.main.maskMean - 75) < 1e-9, '加权遮蔽应为 75');
  assert.equal(result.ec.main.suitable, false, '遮蔽恰 75% 不满足严格 <75%');
  assert.equal(result.ec.ensemble.probability, 0);
  assert.equal(result.weatherMood.mood, 'cloudy', '≥75% 为多云状态');
}

// 7. 遮蔽 74% 且无雨 → 适合
{
  const result = assess(ecEnsemble([{ low: 74, mid: 74, high: 0, precip: 0, wind: 20 }]), ecMain(hourlyFixture({ low: 74, mid: 74, high: 0 })));
  assert.equal(result.ec.main.maskMean, 74);
  assert.equal(result.ec.main.suitable, true, '遮蔽 74% 可出行');
}

// 8. 最大风速恰 30 km/h → 保留必要条件
{
  const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 20 }]), ecMain(hourlyFixture({ wind: 30 })));
  assert.equal(result.ec.main.suitable, false, '最大风速恰 30 不满足严格 <30');
}

// 9. weather_code 缺失 → 降级为不阻断，仅按云量与风判定
{
  const h = hourlyFixture({ low: 10, mid: 10, high: 0, precip: 0 });
  delete h.weather_code;
  const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 20, codes: undefined }]), ecMain(h));
  assert.equal(result.ec.main.blocked, false, '天气码缺失不阻断');
  assert.equal(result.ec.main.suitable, true, '降级后按云量与风判定');
  assert.equal(result.ec.main.thunderWindows.length, 0, '无雷雨时段');
}

// 10. 51 成员同步新口径：含中雨成员不达标，其余达标
{
  const members = Array.from({ length: 51 }, (_, i) => ({ low: 20, mid: 20, high: 90, precip: 0, wind: 20 }));
  members[7].codes = Array(10).fill(0); members[7].codes[2] = 80; // 一个成员有阵雨
  const result = assess(ecEnsemble(members), ecMain(hourlyFixture({ low: 20, mid: 20 })));
  assert.equal(result.ec.ensemble.total, 51);
  assert.equal(result.ec.ensemble.suitable, 50, '含中雨成员不达标');
  assert.equal(Math.round(result.ec.ensemble.probability), 98);
}

// 11. EC 集合缺失 → 概率为 null、成员一致性不可用；GFS 集合不能替代主概率
{
  const result = assess(
    { 'ECMWF IFS 集合': { error: 'offline' }, 'GFS 集合': { hourly: ensembleFixture([{ low: 10, mid: 10, high: 0, precip: 0, wind: 10 }]) } },
    ecMain(),
  );
  assert.equal(result.probability, null);
  assert.equal(result.ec.memberConsistency.level, 'unavailable');
  assert.equal(result.weatherMood.mood, 'sunny', '主运行可用时状态机仍按 EC 主运行驱动');
}

// 12. 外部模型部分失败 + 支持/反对统计
{
  const result = assess(
    ecEnsemble([{ low: 20, mid: 20, high: 90, precip: 0, wind: 20 }]),
    {
      'ECMWF IFS': { hourly: hourlyFixture({ low: 20, mid: 20 }) },
      'NOAA GFS': { hourly: hourlyFixture({ low: 20, mid: 20 }) },
      'JMA GSM': { hourly: hourlyFixture({ low: 95, mid: 95 }) },
      'CMA GRAPES': { error: 'temporary failure' },
    },
  );
  assert.equal(result.crossModel.support, 1, 'GFS 支持 EC 方向');
  assert.equal(result.crossModel.oppose, 1, 'JMA 反对 EC 方向');
  assert.equal(result.crossModel.missing.join('|'), 'CMA GRAPES');
  assert.equal(result.ec.memberConsistency.level, 'high');
}

// 13. 天气状态机：sunny / cloudy / rain / storm / thunder / neutral
{
  const cases = [
    [{ low: 10, mid: 10, codes: 0, wind: 10 }, 'sunny'],
    [{ low: 90, mid: 90, codes: 0, wind: 10 }, 'cloudy'],
    [{ low: 10, mid: 10, codes: (() => { const c = Array(10).fill(0); c[2] = 65; return c; })(), wind: 10 }, 'rain'],
    [{ low: 10, mid: 10, codes: (() => { const c = Array(10).fill(0); c[2] = 61; return c; })(), wind: 35 }, 'storm'],
    [{ low: 10, mid: 10, codes: (() => { const c = Array(10).fill(0); c[2] = 95; return c; })(), wind: 10 }, 'thunder'],
  ];
  for (const [cfg, expected] of cases) {
    const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 20, codes: cfg.codes }]), ecMain(hourlyFixture(cfg)));
    assert.equal(result.weatherMood.mood, expected, `${expected} 状态判定`);
  }
  const noMain = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 10 }]), { 'NOAA GFS': { hourly: hourlyFixture() } });
  assert.equal(noMain.weatherMood.mood, 'neutral', '主运行缺失为 neutral');
}

// 14. cloudSeries：全天 24 点、小时精度、加权遮蔽计算、EC 与综合预报双序列
{
  const series = Metrics.buildCloudSeries(
    { source: 'ECMWF IFS', hourly: allDayFixture() },
    { source: '综合预报', hourly: allDayFixture() },
    [DAY],
  );
  assert.equal(series.ec.days[DAY].points.length, 24, '14 天视图保持小时精度');
  assert.equal(series.ec.days[DAY].points[8].hour, 8);
  assert.equal(series.ec.days[DAY].points[8].mask, 20, '每小时加权遮蔽 = low×0.6 + mid×0.4');
  assert.equal(series.ec.days[DAY].points[8].high, 90);
  assert.equal(series.forecast.days[DAY].points.length, 24);
}

console.log('metrics fixture tests passed');
