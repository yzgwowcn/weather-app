import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/weather-analysis.mjs';
import {
  ANALYSIS_VERSION, PRESETS, deepSeekRequest, shanghaiDateRange,
  summarizeWeather, validateAnalyses, weatherUrls,
} from '../api/_weather-analysis-core.mjs';
import { getAnalysis } from '../api/_weather-analysis-store.mjs';

function hourly(days, overrides = {}) {
  const time = days.flatMap((date) => Array.from({ length: 24 }, (_, hour) => `${date}T${String(hour).padStart(2, '0')}:00`));
  const fill = (value) => Array(time.length).fill(value);
  return {
    time,
    weather_code: fill(0), cloud_cover_low: fill(20), cloud_cover_mid: fill(30),
    cloud_cover_high: fill(80), precipitation: fill(0), wind_speed_10m: fill(18),
    ...overrides,
  };
}

function ensemble(days) {
  const h = hourly(days);
  for (const key of ['weather_code', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation', 'wind_speed_10m']) {
    h[`${key}_member01`] = [...h[key]];
  }
  // 第二天 member01 低中云偏高，形成 50% 集合晴好率。
  h.cloud_cover_low_member01 = h.cloud_cover_low_member01.map((value, index) => index >= 24 && index < 48 ? 90 : value);
  h.cloud_cover_mid_member01 = h.cloud_cover_mid_member01.map((value, index) => index >= 24 && index < 48 ? 90 : value);
  return h;
}

test('预设白名单固定为 12 个坐标且不含 custom', () => {
  assert.equal(Object.keys(PRESETS).length, 12);
  assert.equal(PRESETS.custom, undefined);
  assert.equal(PRESETS.sanya.name, '三亚·亚龙湾');
});

test('服务端聚合 EC 主运行与集合并保持规则结论', () => {
  const days = ['2026-08-10', '2026-08-11', '2026-08-12'];
  const result = summarizeWeather({ hourly: hourly(days) }, { hourly: ensemble(days) });
  assert.equal(result.length, 3);
  assert.equal(result[0].verdict, '推荐出行');
  assert.equal(result[0].ensembleProbability, 100);
  assert.equal(result[1].ensembleProbability, 50);
  assert.equal(result[1].ensembleTotal, 2);
});

test('上海日期范围和天气 URL 不接受客户端坐标', () => {
  const range = shanghaiDateRange(new Date('2026-08-09T17:00:00Z'), 14);
  assert.deepEqual(range, { start: '2026-08-10', end: '2026-08-23' });
  const urls = weatherUrls(PRESETS.sanya, range.start, range.end);
  assert.match(urls.main, /latitude=18\.224/);
  assert.match(urls.ensemble, /models=ecmwf_ifs025/);
});

test('DeepSeek 请求关闭思考并要求 JSON，输出严格按日期校验', () => {
  const days = [{ date: '2026-08-10', verdict: '推荐出行' }];
  const request = deepSeekRequest(PRESETS.sanya, 123, days);
  assert.equal(request.thinking.type, 'disabled');
  assert.equal(request.response_format.type, 'json_object');
  const payload = { analyses: [{ date: '2026-08-10', summary: '晴好', reason: '云量低', uncertainty: '集合一致', advice: '注意防晒' }] };
  assert.deepEqual(validateAnalyses(payload, ['2026-08-10']), payload.analyses);
  assert.throws(() => validateAnalyses({ analyses: [] }, ['2026-08-10']), /AI_INVALID_OUTPUT/);
  assert.equal(ANALYSIS_VERSION, 'weather-v1');
});

function responseRecorder() {
  return {
    code: 0, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('接口在任何外部调用前拒绝自选点', async () => {
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { presetId: 'custom' } }, res);
  assert.equal(res.code, 400);
  assert.equal(res.body.error, 'INVALID_PRESET');
});

test('接口在任何外部调用前拒绝缺失的数据版本', async () => {
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { presetId: 'sanya' } }, res);
  assert.equal(res.code, 400);
  assert.equal(res.body.error, 'INVALID_MODEL_VERSION');
});

test('Supabase 新 secret key 不放入 JWT Authorization 头', async () => {
  const originalFetch = globalThis.fetch;
  let headers;
  globalThis.fetch = async (_url, init) => {
    headers = init.headers;
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await getAnalysis('sanya', 123, 'weather-v1', {
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_example',
    });
    assert.equal(headers.apikey, 'sb_secret_example');
    assert.equal(headers.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
