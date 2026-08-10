// Supabase REST 共享缓存。所有调用仅使用服务端 service_role；浏览器无表权限。

function config(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('CACHE_CONFIG_MISSING');
  return { url, key };
}

async function request(path, init, env) {
  const { url, key } = config(env);
  const authHeaders = key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` };
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`CACHE_HTTP_${response.status}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function getAnalysis(presetId, modelVersion, analysisVersion, env = process.env) {
  const query = new URLSearchParams({
    select: 'status,analyses,model_version,analysis_version,generated_at,updated_at',
    preset_id: `eq.${presetId}`,
    model_version: `eq.${modelVersion}`,
    analysis_version: `eq.${analysisVersion}`,
    limit: '1',
  });
  const rows = await request(`weather_ai_analyses?${query}`, { method: 'GET' }, env);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function claimAnalysis(presetId, modelVersion, analysisVersion, env = process.env) {
  const result = await request('rpc/claim_weather_ai_analysis', {
    method: 'POST',
    body: JSON.stringify({ p_preset_id: presetId, p_model_version: modelVersion, p_analysis_version: analysisVersion }),
  }, env);
  return result === true;
}

export async function completeAnalysis(presetId, modelVersion, analysisVersion, analyses, usage, env = process.env) {
  const query = new URLSearchParams({
    preset_id: `eq.${presetId}`,
    model_version: `eq.${modelVersion}`,
    analysis_version: `eq.${analysisVersion}`,
  });
  await request(`weather_ai_analyses?${query}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'ready', analyses, error_code: null, generated_at: new Date().toISOString(),
      prompt_tokens: Number(usage?.prompt_tokens) || 0,
      completion_tokens: Number(usage?.completion_tokens) || 0,
    }),
  }, env);
  // 当前版本已安全落库后，删除同一预设点的旧模型/旧提示词版本。
  // 每个预设点最终只保留当前一行；从未再次访问的点也最多残留一行，不会随时间无限增长。
  try {
    await pruneAnalyses(presetId, modelVersion, analysisVersion, env);
  } catch {
    console.error('weather-analysis: old cache prune failed');
  }
}

export async function pruneAnalyses(presetId, modelVersion, analysisVersion, env = process.env) {
  const olderModels = new URLSearchParams({
    preset_id: `eq.${presetId}`,
    model_version: `lt.${modelVersion}`,
  });
  const olderSchemas = new URLSearchParams({
    preset_id: `eq.${presetId}`,
    model_version: `eq.${modelVersion}`,
    analysis_version: `neq.${analysisVersion}`,
  });
  await request(`weather_ai_analyses?${olderModels}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, env);
  await request(`weather_ai_analyses?${olderSchemas}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, env);
}

export async function failAnalysis(presetId, modelVersion, analysisVersion, errorCode, env = process.env) {
  const query = new URLSearchParams({
    preset_id: `eq.${presetId}`,
    model_version: `eq.${modelVersion}`,
    analysis_version: `eq.${analysisVersion}`,
  });
  await request(`weather_ai_analyses?${query}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'failed', error_code: String(errorCode || 'UNKNOWN').slice(0, 80) }),
  }, env);
}
