// 预设目的地 DeepSeek 天气解释：以 EC 数据版本为缓存边界，每个预设点每次更新最多生成一次。
import { checkOrigin } from './_origin-check.mjs';
import {
  ANALYSIS_VERSION, DEEPSEEK_MODEL_DEFAULT, MODEL_META_URL, PRESETS,
  deepSeekRequest, shanghaiDateRange, summarizeWeather, validateAnalyses, weatherUrls,
} from './_weather-analysis-core.mjs';
import { claimAnalysis, completeAnalysis, failAnalysis, getAnalysis } from './_weather-analysis-store.mjs';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const SETTLE_SECONDS = 600;
let warnedOrigin = false;

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function getJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`);
  return response.json();
}

function publicReady(row, cached) {
  return {
    ok: true, status: 'ready', cached, modelVersion: Number(row.model_version),
    analysisVersion: row.analysis_version, generatedAt: row.generated_at, analyses: row.analyses,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  const origin = checkOrigin(req);
  if (!origin.configured && !warnedOrigin) {
    warnedOrigin = true;
    console.error('weather-analysis: ALLOWED_ORIGINS is not configured');
  }
  if (!origin.ok) return send(res, 403, { ok: false, error: 'ORIGIN_FORBIDDEN' });

  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { ok: false, error: 'INVALID_JSON' }); }
  const presetId = typeof body.presetId === 'string' ? body.presetId : '';
  const preset = PRESETS[presetId];
  if (!preset) return send(res, 400, { ok: false, error: 'INVALID_PRESET' });
  const requestedVersion = Number(body.modelVersion);
  if (!Number.isSafeInteger(requestedVersion) || requestedVersion <= 0) {
    return send(res, 400, { ok: false, error: 'INVALID_MODEL_VERSION' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || !process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    console.error('weather-analysis: required server environment is not configured');
    return send(res, 503, { ok: false, error: 'SERVICE_NOT_CONFIGURED' });
  }

  let modelVersion;
  try {
    const meta = await getJson(MODEL_META_URL);
    modelVersion = Number(meta.last_run_availability_time);
    if (!Number.isFinite(modelVersion) || modelVersion <= 0) throw new Error('META_INVALID');
  } catch {
    return send(res, 502, { ok: false, error: 'WEATHER_META_UNAVAILABLE' });
  }
  if (requestedVersion !== modelVersion) {
    return send(res, 409, { ok: false, status: 'version_mismatch', error: 'MODEL_VERSION_MISMATCH' });
  }

  // Open-Meteo 各节点最终一致；新版本刚出现时先等待 10 分钟，避免分析到新旧混合数据。
  const age = Math.floor(Date.now() / 1000) - modelVersion;
  if (age < SETTLE_SECONDS) {
    return send(res, 202, { ok: true, status: 'settling', retryAfterSeconds: Math.max(30, SETTLE_SECONDS - age) });
  }

  try {
    const cached = await getAnalysis(presetId, modelVersion, ANALYSIS_VERSION);
    if (cached?.status === 'ready' && Array.isArray(cached.analyses)) return send(res, 200, publicReady(cached, true));
    const claimed = await claimAnalysis(presetId, modelVersion, ANALYSIS_VERSION);
    if (!claimed) return send(res, 202, { ok: true, status: 'generating', retryAfterSeconds: 8 });
  } catch {
    return send(res, 503, { ok: false, error: 'CACHE_UNAVAILABLE' });
  }

  try {
    const { start, end } = shanghaiDateRange();
    const urls = weatherUrls(preset, start, end);
    const [main, ensemble] = await Promise.all([getJson(urls.main), getJson(urls.ensemble)]);
    const days = summarizeWeather(main, ensemble);
    if (days.length < 3) throw new Error('EC_DATA_INCOMPLETE');

    const model = process.env.DEEPSEEK_MODEL || DEEPSEEK_MODEL_DEFAULT;
    const completion = await getJson(DEEPSEEK_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(deepSeekRequest(preset, modelVersion, days, model)),
    });
    const content = completion?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    const analyses = validateAnalyses(parsed, days.map((day) => day.date));
    await completeAnalysis(presetId, modelVersion, ANALYSIS_VERSION, analyses, completion.usage);
    return send(res, 200, {
      ok: true, status: 'ready', cached: false, modelVersion,
      analysisVersion: ANALYSIS_VERSION, generatedAt: new Date().toISOString(), analyses,
    });
  } catch (error) {
    const code = String(error?.message || 'ANALYSIS_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 80);
    try { await failAnalysis(presetId, modelVersion, ANALYSIS_VERSION, code); } catch { /* 下次租约过期后可重试 */ }
    console.error(`weather-analysis: generation failed (${code})`);
    return send(res, 502, { ok: false, error: 'ANALYSIS_UNAVAILABLE' });
  }
}
