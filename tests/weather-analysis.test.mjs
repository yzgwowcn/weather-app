import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { DEEPSEEK_TIMEOUT_MS, UPSTREAM_TIMEOUT_MS } from '../api/weather-analysis.mjs';
import {
  ANALYSIS_VERSION, PRESETS, addGlassSeaForecast, deepSeekRequest, marineUrl, shanghaiDateRange,
  summarizeWeather, validateAnalyses, weatherUrls,
} from '../api/_weather-analysis-core.mjs';
import { completeAnalysis, getAnalysis } from '../api/_weather-analysis-store.mjs';

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

test('DeepSeek 使用独立长超时并为函数收尾留出余量', () => {
  assert.equal(UPSTREAM_TIMEOUT_MS, 25000);
  assert.equal(DEEPSEEK_TIMEOUT_MS, 70000);
  assert.ok(DEEPSEEK_TIMEOUT_MS > UPSTREAM_TIMEOUT_MS);
  assert.ok(DEEPSEEK_TIMEOUT_MS < 90000);
});

test('服务端聚合 EC 主运行与集合并保持规则结论', () => {
  const days = ['2026-08-10', '2026-08-11', '2026-08-12'];
  const main = hourly(days);
  main.cloud_cover_low = main.cloud_cover_low.map((value, index) => index >= 24 && index < 48 ? 90 : value);
  main.cloud_cover_mid = main.cloud_cover_mid.map((value, index) => index >= 24 && index < 48 ? 90 : value);
  const result = summarizeWeather({ hourly: main }, { hourly: ensemble(days) });
  assert.equal(result.length, 3);
  assert.equal(result[0].verdict, '推荐出行');
  assert.equal(result[0].ensembleProbability, 100);
  assert.equal(result[1].ensembleProbability, 50);
  assert.equal(result[1].ensembleTotal, 2);
  assert.equal(result[1].verdict, '审慎出行');
  assert.equal(result[1].ecDisagreement, 'members_split');
  assert.equal(result[0].ecDisagreement, undefined);
  assert.equal(result[1].nextBetterDate, '2026-08-12');
  assert.equal(result[0].nextBetterDate, null);
});

test('上海日期范围和天气 URL 不接受客户端坐标', () => {
  const range = shanghaiDateRange(new Date('2026-08-09T17:00:00Z'), 14);
  assert.deepEqual(range, { start: '2026-08-10', end: '2026-08-23' });
  const urls = weatherUrls(PRESETS.sanya, range.start, range.end);
  assert.match(urls.main, /latitude=18\.224/);
  assert.match(urls.ensemble, /models=ecmwf_ifs025/);
  assert.match(marineUrl(PRESETS.sanya, range.start, range.end), /cell_selection=sea/);
  assert.match(marineUrl(PRESETS.sanya, range.start, range.end), /wind_wave_height/);
});

test('服务端为海南分析注入与前端同口径的玻璃海候选窗口', () => {
  const dates = ['2026-08-10'];
  const main = hourly(dates, { wind_speed_10m: Array(24).fill(10) });
  const days = [{ date: dates[0] }];
  const marine = {
    hourly: {
      time: [...main.time], wave_height: Array(24).fill(0.4),
      wind_wave_height: Array(24).fill(0.1), swell_wave_height: Array(24).fill(0.4),
    },
  };
  const result = addGlassSeaForecast(days, { hourly: main }, marine);
  assert.equal(result[0].glassSea.level, 'excellent');
  assert.equal(result[0].glassSea.windows[0].time, '08:00–17:00');
  assert.equal(addGlassSeaForecast(days, { hourly: main }, null)[0].glassSea.level, 'unavailable');
});

test('DeepSeek 请求按海南云层口径解释并严格校验 JSON', () => {
  const days = [{ date: '2026-08-10', verdict: '推荐出行' }];
  const request = deepSeekRequest(PRESETS.sanya, 123, days);
  assert.equal(request.thinking.type, 'disabled');
  assert.equal(request.response_format.type, 'json_object');
  assert.match(request.messages[0].content, /ecDisagreement=main_opposed/);
  assert.match(request.messages[0].content, /ecDisagreement=members_split/);
  assert.match(request.messages[0].content, /阴晴观感以低云和中云/);
  assert.match(request.messages[0].content, /覆盖率而非光学厚度/);
  assert.match(request.messages[0].content, /不得笼统写“云量少”/);
  assert.match(request.messages[0].content, /海南每项必须额外输出 glassSea/);
  assert.match(request.messages[0].content, /高云不单独否决候选/);
  assert.doesNotMatch(deepSeekRequest(PRESETS.chengdu, 123, days).messages[0].content, /玻璃海/);
  const payload = { analyses: [{ date: '2026-08-10', summary: '晴好', reason: '云量低', uncertainty: '集合一致', advice: '注意防晒' }] };
  assert.deepEqual(validateAnalyses(payload, ['2026-08-10']), payload.analyses);
  assert.throws(() => validateAnalyses(payload, ['2026-08-10'], { requireGlassSea: true }), /AI_INVALID_OUTPUT/);
  const hainanPayload = { analyses: [{ ...payload.analyses[0], glassSea: '08:00–10:00较佳候选，仍需看现场水质。' }] };
  assert.deepEqual(validateAnalyses(hainanPayload, ['2026-08-10'], { requireGlassSea: true }), hainanPayload.analyses);
  assert.throws(() => validateAnalyses({ analyses: [] }, ['2026-08-10']), /AI_INVALID_OUTPUT/);
  assert.equal(ANALYSIS_VERSION, 'weather-v4');
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

test('分析完成后自动删除同一预设点的旧模型和旧提示词版本', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return new Response(null, { status: 204 });
  };
  try {
    await completeAnalysis('sanya', 456, 'weather-v4', [], {}, {
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_example',
    });
    assert.deepEqual(calls.map((call) => call.method), ['PATCH', 'DELETE', 'DELETE']);
    assert.match(calls[1].url, /model_version=lt\.456/);
    assert.match(calls[2].url, /analysis_version=neq\.weather-v4/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
