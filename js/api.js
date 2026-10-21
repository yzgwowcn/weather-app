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
  // 返回 last_run_availability_time（数据在 API 可用的时间）等字段，用于展示"模型可用时间"
  const MODEL_META = {
    ecmwf: { name: 'ecmwf_ifs025' },
    gfs: { name: 'ncep_gfs025' },
    jma: { name: 'jma_gsm' },
    cma: { name: 'cma_grapes_global' },
  };

  // 朝晚霞模块需要的气象变量：露点/湿度用于低云云底高度，边界层高度用于气溶胶消光标高
  const HOURLY = ['temperature_2m', 'dew_point_2m', 'relative_humidity_2m', 'precipitation', 'rain', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility', 'boundary_layer_height'].join(',');
  const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max', 'sunrise', 'sunset', 'cloud_cover_mean', 'cloud_cover_max', 'cloud_cover_min'].join(',');
  const MODEL_HOURLY = ['weather_code', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation', 'wind_speed_10m'].join(',');
  const MARINE_HOURLY = ['wave_height', 'wind_wave_height', 'swell_wave_height', 'wave_direction', 'wave_period', 'swell_wave_period'].join(',');
  const MARINE_DAILY = 'wave_height_max,wave_period_max,swell_wave_height_max,swell_wave_period_max';

  // ---- 用户侧缓存：同一地点 + 预报范围短时间重复查询，先查模型是否更新（meta 不计配额），未更新直接读缓存 ----
  // v3：新增沿太阳方位云量扫描与气溶胶请求，旧缓存形状作废
  const CACHE_PREFIX = 'omCache:v3:';
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
  // ---- 朝晚霞：沿太阳方位做等距云量扫描 + 气溶胶实测 ----
  // 扫描点由调用方给出的方位角（日落/日出时的太阳方位）与距离表生成，一次多坐标请求取回全部点，
  // 结果压成「距离 → 逐小时总云量」的紧凑数组，既是真实观测点值，也不会撑爆本地缓存。
  const SUN_SCAN_DISTANCES = [0, 25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 600];
  const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

  // 大圆航线上按方位角/距离取点（与 js/sunset.js 的几何一致）
  function destinationPoint(lat, lon, bearingDeg, distanceKm) {
    const toRad = (value) => value * Math.PI / 180;
    const angular = distanceKm / 6371;
    const bearing = toRad(bearingDeg);
    const phi = toRad(lat);
    const lambda = toRad(lon);
    const phi2 = Math.asin(Math.sin(phi) * Math.cos(angular) + Math.cos(phi) * Math.sin(angular) * Math.cos(bearing));
    const lambda2 = lambda + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(phi),
      Math.cos(angular) - Math.sin(phi) * Math.sin(phi2),
    );
    return { lat: phi2 * 180 / Math.PI, lon: ((lambda2 * 180 / Math.PI + 540) % 360) - 180 };
  }
  // bearings: { sunset: 度, sunrise: 度 }
  // 返回 { distances, times, covers: { sunset: [每距离][每小时], sunrise: [...] } }
  async function fetchSunPath(lat, lon, startDate, endDate, bearings, signal) {
    const modes = ['sunset', 'sunrise'];
    const points = [];
    modes.forEach((mode) => {
      SUN_SCAN_DISTANCES.forEach((distance) => {
        points.push({ ...destinationPoint(lat, lon, bearings[mode], distance), mode });
      });
    });
    const url = `${FORECAST_URL}?${query({
      latitude: points.map((point) => point.lat.toFixed(3)).join(','),
      longitude: points.map((point) => point.lon.toFixed(3)).join(','),
      start_date: startDate,
      end_date: endDate,
      timezone: TIMEZONE,
      hourly: 'cloud_cover',
    })}`;
    let payload;
    try {
      payload = await getJSON(url, signal);
    } catch (error) {
      return { error: `太阳方位云量扫描请求失败：${error.message}`, source: '太阳方位云量扫描' };
    }
    // 多坐标请求返回数组；单坐标时是对象
    const list = Array.isArray(payload) ? payload : [payload];
    if (list.length !== points.length) {
      return { error: `太阳方位云量扫描返回 ${list.length} 个点，期望 ${points.length} 个`, source: '太阳方位云量扫描' };
    }
    const times = (list[0] && list[0].hourly && list[0].hourly.time) || [];
    const covers = { sunset: [], sunrise: [] };
    points.forEach((point, index) => {
      const series = (list[index] && list[index].hourly && list[index].hourly.cloud_cover) || [];
      covers[point.mode].push(series.map((value) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.round(number) : 0;
      }));
    });
    return { distances: SUN_SCAN_DISTANCES, times, covers, source: '太阳方位云量扫描' };
  }
  // 气溶胶光学厚度（CAMS），用于大气通透度与云面染色
  function fetchAerosol(lat, lon, startDate, endDate, signal) {
    const url = `${AIR_QUALITY_URL}?${query({ ...baseParams(lat, lon, startDate, endDate), hourly: 'aerosol_optical_depth' })}`;
    return safeRequest(url, '气溶胶 AOD', signal);
  }
  // ---- 地名搜索（高德 inputtips 优先，Photon 兜底）----
  // 高德通道：经 /_AMapService 代理（Vercel 部署时可用），国内节点快、中文地名全；
  //           key 未注入（本地开发）或代理失败/超时 → 返回 null 交给调用方回退。
  //          高德坐标为 GCJ-02，条目带 gcj: true，由 Location 层统一换算为 WGS84。
  // Photon 通道：photon.komoot.io（OSM 全球地名），坐标顺序 [lng, lat]，返回 WGS84（gcj: false）。
  // 查询失败或为空时返回空数组/空列表，不抛错。
  const SEARCH_TIMEOUT_MS = 8000; // 单通道 8s 超时，避免网络挂起时界面长时间无响应
  function fetchJsonWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return getJSON(url, controller.signal).finally(() => clearTimeout(timer));
  }
  function amapKeyReady() {
    return typeof AMAP_CONFIG !== 'undefined' && AMAP_CONFIG.key
      && String(AMAP_CONFIG.key).indexOf('__AMAP_') !== 0; // 占位符未注入视为不可用
  }
  async function searchLocationAmap(q) {
    if (!amapKeyReady()) return null;
    const url = `/_AMapService/v3/assistant/inputtips?${query({ key: AMAP_CONFIG.key, keywords: q, datatype: 'all', limit: 8 })}`;
    const data = await fetchJsonWithTimeout(url, SEARCH_TIMEOUT_MS);
    if (!data || data.status !== '1' || !Array.isArray(data.tips)) return null;
    return data.tips.map((tip) => {
      const [lon, lat] = String(tip.location || '').split(',').map(Number);
      const city = Array.isArray(tip.city) ? tip.city[0] : (tip.city || '');
      const region = [city, tip.district].filter(Boolean).join(' · ');
      return { name: tip.name || '', region, lat, lon, gcj: true };
    }).filter((item) => item.name && Number.isFinite(item.lat) && Number.isFinite(item.lon));
  }
  async function searchLocationPhoton(q) {
    const url = `https://photon.komoot.io/api/?${query({ q: q, limit: 5 })}`;
    const data = await fetchJsonWithTimeout(url, SEARCH_TIMEOUT_MS);
    return (data.features || []).map((feature) => {
      const p = feature.properties || {};
      const [lon, lat] = feature.geometry?.coordinates || [null, null];
      const region = [p.state, p.country].filter(Boolean).join(' · ');
      return { name: p.name || '', region, lat, lon, gcj: false };
    }).filter((item) => item.name && Number.isFinite(item.lat) && Number.isFinite(item.lon));
  }
  async function searchLocation(q) {
    const trimmed = String(q || '').trim();
    if (!trimmed) return [];
    try {
      const amapResults = await searchLocationAmap(trimmed);
      if (amapResults) return amapResults; // 高德成功（含空结果）即采用
    } catch { /* 代理不可用/超时/异常：回退 Photon */ }
    try {
      return await searchLocationPhoton(trimmed);
    } catch {
      return [];
    }
  }
  // 完整拉取（无缓存路径）：8 个天气请求 + 4 个 meta + 气溶胶 + 太阳方位云量扫描
  async function fetchBundleFresh(destination, startDate, endDate, signal, sunBearings) {
    const { lat, lon, marine } = destination;
    const [forecast, ecmwf, gfs, jma, cma, ensembleEcmwf, ensembleGfs, marineData, metaEcmwf, metaGfs, metaJma, metaCma, aerosol, sunPath] = await Promise.all([
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
      fetchAerosol(lat, lon, startDate, endDate, signal),
      sunBearings ? fetchSunPath(lat, lon, startDate, endDate, sunBearings, signal) : Promise.resolve(null),
    ]);
    return {
      forecast,
      deterministic: { 'ECMWF IFS': ecmwf, 'NOAA GFS': gfs, 'JMA GSM': jma, 'CMA GRAPES': cma },
      ensembles: { 'ECMWF IFS 集合': ensembleEcmwf, 'GFS 集合': ensembleGfs },
      marine: marineData,
      modelMeta: { 'ECMWF IFS': metaEcmwf, 'NOAA GFS': metaGfs, 'JMA GSM': metaJma, 'CMA GRAPES': metaCma },
      aerosol,
      sunPath,
    };
  }
  // 带缓存的入口：同一地点短时间重复查询，先查 EC meta（不计配额）判断模型是否出新数据，未更新直接读缓存
  async function fetchBundle(destination, startDate, endDate, signal, sunBearings) {
    const key = cacheKey(destination, startDate, endDate);
    const cached = cacheGet(key);
    if (cached) {
      const meta = await fetchModelMeta('ecmwf', signal); // Metadata API 不计请求限额
      const avail = meta && !meta.error ? Number(meta.last_run_availability_time) : NaN;
      if (Number.isFinite(avail) && avail > 0) {
        if (avail === cached.metaAvail) {
          return { ...cached.bundle, weatherVersion: cached.metaAvail, fromCache: true }; // 模型未更新 → 读缓存
        }
      } else if (Date.now() - cached.ts < CACHE_STALE_LIMIT_MS) {
        return { ...cached.bundle, weatherVersion: cached.metaAvail, fromCache: true }; // meta 查询失败：缓存 6 小时内直接使用
      }
      // meta 显示模型已更新，或缓存超过 6 小时 → 重新请求
    }
    const bundle = await fetchBundleFresh(destination, startDate, endDate, signal, sunBearings);
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
      return { ...merged, weatherVersion: cached.metaAvail, fromCache: true, partialFallback: true };
    }
    // 写入缓存：以 EC 集合所属模型的 last_run_availability_time 作为"数据版本"快照
    const metaEcmwf = bundle.modelMeta && bundle.modelMeta['ECMWF IFS'];
    const avail = metaEcmwf && !metaEcmwf.error ? Number(metaEcmwf.last_run_availability_time) : NaN;
    const weatherVersion = Number.isFinite(avail) && avail > 0 ? avail : 0;
    cacheSet(key, bundle, weatherVersion);
    return { ...bundle, weatherVersion };
  }
  return { fetchBundle, searchLocation };
})();
