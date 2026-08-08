// Open-Meteo 请求层：主预报、确定性模型、集合预报和海况统一在这里管理。
const API = (() => {
  const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
  const ENSEMBLE_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';
  const MODEL_ENDPOINTS = {
    ecmwf: { label: 'ECMWF IFS', url: 'https://api.open-meteo.com/v1/ecmwf' },
    gfs:   { label: 'NOAA GFS', url: 'https://api.open-meteo.com/v1/gfs' },
    jma:   { label: 'JMA GSM', url: 'https://api.open-meteo.com/v1/jma' },
    cma:   { label: 'CMA GRAPES', url: 'https://api.open-meteo.com/v1/cma' },
  };
  const ENSEMBLE_MODELS = {
    ecmwf: { label: 'ECMWF IFS 集合', model: 'ecmwf_ifs025' },
    gfs: { label: 'GFS 集合', model: 'gfs_seamless' },
  };
  // Metadata API（不计请求限额）：https://api.open-meteo.com/data/{model}/static/meta.json
  // 返回 last_run_availability_time（数据在 API 可用的时间）等字段，用于展示"模型数据多久前更新"
  const MODEL_META = {
    ecmwf: { name: 'ecmwf_ifs025' },
    gfs: { name: 'ncep_gfs025' },
    jma: { name: 'jma_gsm' },
    cma: { name: 'cma_grapes_global' },
  };

  const HOURLY = ['temperature_2m', 'precipitation', 'rain', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility'].join(',');
  const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max', 'sunrise', 'sunset', 'cloud_cover_mean', 'cloud_cover_max', 'cloud_cover_min'].join(',');
  const MODEL_HOURLY = ['weather_code', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation', 'wind_speed_10m'].join(',');
  const MARINE_HOURLY = ['wave_height', 'wind_wave_height', 'swell_wave_height', 'wave_direction', 'wave_period', 'swell_wave_period'].join(',');
  const MARINE_DAILY = 'wave_height_max,wave_period_max,swell_wave_height_max,swell_wave_period_max';

  // ---- 用户侧缓存：同一地点 + 预报范围短时间重复查询，先查模型是否更新（meta 不计配额），未更新直接读缓存 ----
  const CACHE_PREFIX = 'omCache:v1:';
  const CACHE_MAX_KEYS = 8;            // 最多保留 8 个地点的缓存，超出删最旧
  const CACHE_STALE_LIMIT_MS = 6 * 3600 * 1000; // meta 查询失败兜底：缓存超 6 小时强制重新请求

  function cacheKey(destination, startDate, endDate) {
    return CACHE_PREFIX + destination.lat.toFixed(4) + ':' + destination.lon.toFixed(4) + ':' +
      startDate + ':' + endDate + ':' + (destination.marine ? '1' : '0');
  }
  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || !entry.bundle) return null;
      return entry;
    } catch (e) { return null; } // 隐私模式/存储异常：静默降级为直接请求
  }
  function cacheSet(key, bundle, metaAvail) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), metaAvail: metaAvail || 0, bundle }));
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
      }
      if (keys.length > CACHE_MAX_KEYS) {
        keys.sort((a, b) => (cacheGet(a) ? cacheGet(a).ts : 0) - (cacheGet(b) ? cacheGet(b).ts : 0));
        for (let i = 0; i < keys.length - CACHE_MAX_KEYS; i += 1) localStorage.removeItem(keys[i]);
      }
    } catch (e) { /* 存储不可用：静默 */ }
  }
  // 限流检测：任一天气请求返回 "Daily API request limit exceeded" 视为配额耗尽
  function hasRateLimitError(bundle) {
    const list = [bundle.forecast, bundle.marine];
    Object.keys(bundle.deterministic || {}).forEach((k) => list.push(bundle.deterministic[k]));
    Object.keys(bundle.ensembles || {}).forEach((k) => list.push(bundle.ensembles[k]));
    return list.some((m) => m && m.error && /Daily API request limit/i.test(m.error));
  }

  function query(params) { return new URLSearchParams(params).toString(); }
  async function getJSON(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      let reason = '';
      try {
        const body = await response.json();
        if (body && body.reason) reason = body.reason;
      } catch (e) { /* 非 JSON 响应 */ }
      throw new Error(reason ? `HTTP ${response.status}：${reason}` : `HTTP ${response.status}`);
    }
    return response.json();
  }
  async function safeRequest(url, source, signal) {
    try {
      const data = await getJSON(url, signal);
      return { ...data, source, fetchedAt: new Date().toISOString() };
    } catch (error) {
      return { error: `${source} 请求失败：${error.message}`, source, fetchedAt: new Date().toISOString() };
    }
  }
  function baseParams(lat, lon, startDate, endDate) {
    return { latitude: lat, longitude: lon, start_date: startDate, end_date: endDate, timezone: TIMEZONE };
  }

  function fetchForecast(lat, lon, startDate, endDate, signal) {
    return safeRequest(`${FORECAST_URL}?${query({ ...baseParams(lat, lon, startDate, endDate), hourly: HOURLY, daily: DAILY })}`, '综合预报', signal);
  }
  function fetchDeterministic(id, lat, lon, startDate, endDate, signal) {
    const model = MODEL_ENDPOINTS[id];
    return safeRequest(`${model.url}?${query({ ...baseParams(lat, lon, startDate, endDate), hourly: MODEL_HOURLY })}`, model.label, signal);
  }
  function fetchEnsemble(id, lat, lon, startDate, endDate, signal) {
    const model = ENSEMBLE_MODELS[id];
    return safeRequest(`${ENSEMBLE_URL}?${query({ ...baseParams(lat, lon, startDate, endDate), hourly: MODEL_HOURLY, models: model.model })}`, model.label, signal);
  }
  function fetchMarine(lat, lon, startDate, endDate, signal) {
    return safeRequest(`${MARINE_URL}?${query({ ...baseParams(lat, lon, startDate, endDate), cell_selection: 'sea', hourly: MARINE_HOURLY, daily: MARINE_DAILY })}`, '近海海况', signal);
  }
  function fetchModelMeta(id, signal) {
    const meta = MODEL_META[id];
    return safeRequest(`https://api.open-meteo.com/data/${meta.name}/static/meta.json`, meta.name, signal);
  }
  // 地名搜索（Photon / OpenStreetMap）：返回 [{ name, region, lat, lon }]
  // 注意 Photon 坐标顺序为 [lng, lat]；查询失败或为空时返回空数组，不抛错。
  async function searchLocation(q) {
    const trimmed = String(q || '').trim();
    if (!trimmed) return [];
    try {
      const url = `https://photon.komoot.io/api/?${query({ q: trimmed, limit: 5 })}`;
      const data = await getJSON(url);
      return (data.features || []).map((feature) => {
        const p = feature.properties || {};
        const [lon, lat] = feature.geometry?.coordinates || [null, null];
        const region = [p.state, p.country].filter(Boolean).join(' · ');
        return { name: p.name || '', region, lat, lon };
      }).filter((item) => item.name && Number.isFinite(item.lat) && Number.isFinite(item.lon));
    } catch {
      return [];
    }
  }
  // 完整拉取（无缓存路径）：8 个天气请求 + 4 个 meta
  async function fetchBundleFresh(destination, startDate, endDate, signal) {
    const { lat, lon, marine } = destination;
    const [forecast, ecmwf, gfs, jma, cma, ensembleEcmwf, ensembleGfs, marineData, metaEcmwf, metaGfs, metaJma, metaCma] = await Promise.all([
      fetchForecast(lat, lon, startDate, endDate, signal),
      fetchDeterministic('ecmwf', lat, lon, startDate, endDate, signal),
      fetchDeterministic('gfs', lat, lon, startDate, endDate, signal),
      fetchDeterministic('jma', lat, lon, startDate, endDate, signal),
      fetchDeterministic('cma', lat, lon, startDate, endDate, signal),
      fetchEnsemble('ecmwf', lat, lon, startDate, endDate, signal),
      fetchEnsemble('gfs', lat, lon, startDate, endDate, signal),
      marine ? fetchMarine(lat, lon, startDate, endDate, signal) : Promise.resolve(null),
      fetchModelMeta('ecmwf', signal),
      fetchModelMeta('gfs', signal),
      fetchModelMeta('jma', signal),
      fetchModelMeta('cma', signal),
    ]);
    return {
      forecast,
      deterministic: { 'ECMWF IFS': ecmwf, 'NOAA GFS': gfs, 'JMA GSM': jma, 'CMA GRAPES': cma },
      ensembles: { 'ECMWF IFS 集合': ensembleEcmwf, 'GFS 集合': ensembleGfs },
      marine: marineData,
      modelMeta: { 'ECMWF IFS': metaEcmwf, 'NOAA GFS': metaGfs, 'JMA GSM': metaJma, 'CMA GRAPES': metaCma },
    };
  }
  // 带缓存的入口：同一地点短时间重复查询，先查 EC meta（不计配额）判断模型是否出新数据，未更新直接读缓存
  async function fetchBundle(destination, startDate, endDate, signal) {
    const key = cacheKey(destination, startDate, endDate);
    const cached = cacheGet(key);
    if (cached) {
      const meta = await fetchModelMeta('ecmwf', signal); // Metadata API 不计请求限额
      const avail = meta && !meta.error ? Number(meta.last_run_availability_time) : NaN;
      if (Number.isFinite(avail) && avail > 0) {
        if (avail === cached.metaAvail) {
          return { ...cached.bundle, fromCache: true }; // 模型未更新 → 读缓存
        }
      } else if (Date.now() - cached.ts < CACHE_STALE_LIMIT_MS) {
        return { ...cached.bundle, fromCache: true }; // meta 查询失败：缓存 6 小时内直接使用
      }
      // meta 显示模型已更新，或缓存超过 6 小时 → 重新请求
    }
    const bundle = await fetchBundleFresh(destination, startDate, endDate, signal);
    // 配额耗尽兜底：天气请求被限流且有缓存时，受限部分用缓存对应数据替换，避免页面空白
    if (cached && hasRateLimitError(bundle)) {
      const merged = { ...bundle, deterministic: { ...bundle.deterministic }, ensembles: { ...bundle.ensembles } };
      ['forecast', 'marine'].forEach((k) => {
        if (bundle[k] && bundle[k].error && cached.bundle[k] && !cached.bundle[k].error) merged[k] = cached.bundle[k];
      });
      ['deterministic', 'ensembles'].forEach((group) => {
        Object.keys(bundle[group] || {}).forEach((name) => {
          const m = bundle[group][name];
          const c = cached.bundle[group] && cached.bundle[group][name];
          if (m && m.error && c && !c.error) merged[group][name] = c;
        });
      });
      return { ...merged, fromCache: true, partialFallback: true };
    }
    // 写入缓存：以 EC 集合所属模型的 last_run_availability_time 作为"数据版本"快照
    const metaEcmwf = bundle.modelMeta && bundle.modelMeta['ECMWF IFS'];
    const avail = metaEcmwf && !metaEcmwf.error ? Number(metaEcmwf.last_run_availability_time) : NaN;
    cacheSet(key, bundle, Number.isFinite(avail) && avail > 0 ? avail : 0);
    return bundle;
  }
  return { fetchBundle, searchLocation };
})();
