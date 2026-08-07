// 无依赖夹具测试：node tests/metrics.test.js
// 覆盖新口径：三层云加权遮蔽、高云不扣分、严格边界、EC 主结论、成员一致性、外部模型验证、云图序列、天气状态机。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {};
vm.runInNewContext(`${fs.readFileSync('js/metrics.js', 'utf8')}\nglobalThis.metricsUnderTest = Metrics;`, context);
const Metrics = context.metricsUnderTest;

const DAY = '2026-08-08';

// 日间（08:00–17:00 共 10 小时）确定性响应夹具
function hourlyFixture({ low = 20, mid = 20, high = 100, precip = 0, wind = 20, hours = 10 } = {}) {
  const time = Array.from({ length: hours }, (_, i) => `${DAY}T${String(8 + i).padStart(2, '0')}:00`);
  const fill = (v) => Array(hours).fill(v);
  return {
    time,
    cloud_cover_low: fill(low), cloud_cover_mid: fill(mid), cloud_cover_high: fill(high),
    precipitation: fill(precip), wind_speed_10m: fill(wind),
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
  });
  return h;
}

// 全天 0–23 时序列夹具（云图时间轴）
function allDayFixture() {
  const time = Array.from({ length: 24 }, (_, i) => `${DAY}T${String(i).padStart(2, '0')}:00`);
  return {
    time,
    cloud_cover_low: Array(24).fill(20), cloud_cover_mid: Array(24).fill(20), cloud_cover_high: Array(24).fill(90),
    precipitation: Array(24).fill(0), wind_speed_10m: Array(24).fill(20),
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

// 2. 低中云加权恰为 50% → 不满足严格 <50%
{
  const result = assess(ecEnsemble([{ low: 50, mid: 50, high: 0, precip: 0, wind: 20 }]), ecMain(hourlyFixture({ low: 50, mid: 50, high: 0 })));
  assert.ok(Math.abs(result.ec.main.maskMean - 50) < 1e-9, '加权遮蔽应为 50');
  assert.equal(result.ec.main.suitable, false, '加权遮蔽恰为 50% 不满足严格 <50%');
  assert.equal(result.ec.ensemble.probability, 0, '集合成员同样不达标');
}

// 3. 日间累计降水恰为 1 mm → 不满足严格 <1mm
{
  const rainEdge = hourlyFixture({ low: 10, mid: 10, high: 0, precip: 0 });
  rainEdge.precipitation[0] = 1;
  const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 20 }]), ecMain(rainEdge));
  assert.equal(result.ec.main.precipitationSum, 1);
  assert.equal(result.ec.main.suitable, false, '累计降水恰 1mm 不满足严格 <1mm');
}

// 4. 最大风速恰为 30 km/h → 不满足严格 <30
{
  const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 20 }]), ecMain(hourlyFixture({ wind: 30 })));
  assert.equal(result.ec.main.windMax, 30);
  assert.equal(result.ec.main.suitable, false, '最大风速恰 30 不满足严格 <30');
}

// 5. EC 集合缺失 → 概率为 null、成员一致性不可用；GFS 集合不能替代主概率
{
  const result = assess(
    { 'ECMWF IFS 集合': { error: 'offline' }, 'GFS 集合': { hourly: ensembleFixture([{ low: 10, mid: 10, high: 0, precip: 0, wind: 10 }]) } },
    ecMain(),
  );
  assert.equal(result.probability, null, 'EC 集合缺失时不得伪造晴好率');
  assert.equal(result.ec.ensemble, null);
  assert.equal(result.ec.memberConsistency.level, 'unavailable');
  assert.equal(result.weatherMood.mood, 'sunny', '主运行可用时状态机仍按 EC 主运行驱动');
}

// 6. EC 主运行缺失 → neutral 状态 + 外部验证不可用
{
  const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 10 }]), { 'NOAA GFS': { hourly: hourlyFixture() } });
  assert.equal(result.ec.main, null);
  assert.equal(result.weatherMood.mood, 'neutral');
  assert.equal(result.crossModel.direction, null);
  assert.equal(result.crossModel.missing.join('|'), 'NOAA GFS|JMA GSM|CMA GRAPES', '主方向缺失时外部模型均记入缺失');
}

// 7. EC 集合 51 成员比例 + 外部模型部分失败（CMA 缺失）
{
  const members = Array.from({ length: 51 }, (_, i) => ({ low: 20, mid: 20, high: 90, precip: 0, wind: 20 }));
  members.forEach((m, i) => { if (i >= 40) { m.low = 90; m.mid = 90; } }); // 后 11 个成员不达标
  const result = assess(
    ecEnsemble(members),
    {
      'ECMWF IFS': { hourly: hourlyFixture({ low: 20, mid: 20 }) },
      'NOAA GFS': { hourly: hourlyFixture({ low: 20, mid: 20 }) },
      'JMA GSM': { hourly: hourlyFixture({ low: 95, mid: 95 }) },
      'CMA GRAPES': { error: 'temporary failure' },
    },
  );
  assert.equal(result.ec.ensemble.total, 51, '控制成员 + 50 扰动成员');
  assert.equal(result.ec.ensemble.suitable, 40);
  assert.equal(Math.round(result.ec.ensemble.probability), 78);
  assert.equal(result.crossModel.support, 1, 'GFS 支持 EC 方向');
  assert.equal(result.crossModel.oppose, 1, 'JMA 反对 EC 方向');
  assert.equal(result.crossModel.missing.join('|'), 'CMA GRAPES', '失败来源应计入缺失');
  assert.equal(result.ec.memberConsistency.level, 'high', '78% 集中于高区间且主运行一致');
}

// 8. 成员一致性分档：集合集中但主运行反向 → low；集合分散 → medium
{
  const highMembers = Array.from({ length: 51 }, (_, i) => ({ low: 20, mid: 20, high: 0, precip: 0, wind: 20 }));
  highMembers.forEach((m, i) => { if (i >= 46) { m.low = 90; m.mid = 90; } }); // 46/51 ≈ 90%
  const reversed = assess(ecEnsemble(highMembers), ecMain(hourlyFixture({ low: 95, mid: 95 })));
  assert.equal(reversed.ec.memberConsistency.level, 'low', '集合集中但主运行反向');

  const mixedMembers = Array.from({ length: 51 }, (_, i) => ({ low: 20, mid: 20, high: 0, precip: 0, wind: 20 }));
  mixedMembers.forEach((m, i) => { if (i >= 26) { m.low = 90; m.mid = 90; } }); // 26/51 ≈ 51%
  const mixed = assess(ecEnsemble(mixedMembers), ecMain());
  assert.equal(mixed.ec.memberConsistency.level, 'medium', '中间区间为集合分散');
}

// 9. 天气状态机：sunny / cloudy / rainy / windy / storm
{
  const cases = [
    [{ low: 10, mid: 10, precip: 0, wind: 10 }, 'sunny'],
    [{ low: 60, mid: 60, precip: 0, wind: 10 }, 'cloudy'],
    [{ low: 10, mid: 10, precip: 0.2, wind: 10 }, 'rainy'],
    [{ low: 10, mid: 10, precip: 0, wind: 35 }, 'windy'],
    [{ low: 10, mid: 10, precip: 0.2, wind: 35 }, 'storm'],
  ];
  for (const [cfg, expected] of cases) {
    const result = assess(ecEnsemble([{ low: 10, mid: 10, high: 0, precip: 0, wind: 10 }]), ecMain(hourlyFixture(cfg)));
    assert.equal(result.weatherMood.mood, expected, `${expected} 状态判定`);
  }
}

// 10. cloudSeries：全天 24 点、小时精度、加权遮蔽计算、EC 与综合预报双序列
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
  assert.equal(series.forecast.days[DAY].points.length, 24, '综合预报参考序列同样小时精度');
}

console.log('metrics fixture tests passed');
