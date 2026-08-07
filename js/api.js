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

  const HOURLY = ['temperature_2m', 'precipitation', 'rain', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility'].join(',');
  const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max', 'sunrise', 'sunset', 'cloud_cover_mean', 'cloud_cover_max', 'cloud_cover_min'].join(',');
  const MODEL_HOURLY = ['weather_code', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation', 'wind_speed_10m'].join(',');
  const MARINE_HOURLY = ['wave_height', 'wind_wave_height', 'swell_wave_height', 'wave_direction', 'wave_period', 'swell_wave_period'].join(',');
  const MARINE_DAILY = 'wave_height_max,wave_period_max,swell_wave_height_max,swell_wave_period_max';

  function query(params) { return new URLSearchParams(params).toString(); }
  async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function safeRequest(url, source) {
    try {
      const data = await getJSON(url);
      return { ...data, source, fetchedAt: new Date().toISOString() };
    } catch (error) {
      return { error: `${source} 请求失败：${error.message}`, source, fetchedAt: new Date().toISOString() };
    }
  }
  function baseParams(lat, lon, startDate, endDate) {
    return { latitude: lat, longitude: lon, start_date: startDate, end_date: endDate, timezone: TIMEZONE };
  }

  function fetchForecast(lat, lon, startDate, endDate) {
    return safeRequest(`${FORECAST_URL}?${query({ ...baseParams(lat, lon, startDate, endDate), hourly: HOURLY, daily: DAILY })}`, '综合预报');
  }
  function fetchDeterministic(id, lat, lon, startDate, endDate) {
    const model = MODEL_ENDPOINTS[id];
    return safeRequest(`${model.url}?${query({ ...baseParams(lat, lon, startDate, endDate), hourly: MODEL_HOURLY })}`, model.label);
  }
  function fetchEnsemble(id, lat, lon, startDate, endDate) {
    const model = ENSEMBLE_MODELS[id];
    return safeRequest(`${ENSEMBLE_URL}?${query({ ...baseParams(lat, lon, startDate, endDate), hourly: MODEL_HOURLY, models: model.model })}`, model.label);
  }
  function fetchMarine(lat, lon, startDate, endDate) {
    return safeRequest(`${MARINE_URL}?${query({ ...baseParams(lat, lon, startDate, endDate), cell_selection: 'sea', hourly: MARINE_HOURLY, daily: MARINE_DAILY })}`, '近海海况');
  }
  async function fetchBundle(destination, startDate, endDate) {
    const { lat, lon, marine } = destination;
    const [forecast, ecmwf, gfs, jma, cma, ensembleEcmwf, ensembleGfs, marineData] = await Promise.all([
      fetchForecast(lat, lon, startDate, endDate),
      fetchDeterministic('ecmwf', lat, lon, startDate, endDate),
      fetchDeterministic('gfs', lat, lon, startDate, endDate),
      fetchDeterministic('jma', lat, lon, startDate, endDate),
      fetchDeterministic('cma', lat, lon, startDate, endDate),
      fetchEnsemble('ecmwf', lat, lon, startDate, endDate),
      fetchEnsemble('gfs', lat, lon, startDate, endDate),
      marine ? fetchMarine(lat, lon, startDate, endDate) : Promise.resolve(null),
    ]);
    return {
      forecast,
      deterministic: { 'ECMWF IFS': ecmwf, 'NOAA GFS': gfs, 'JMA GSM': jma, 'CMA GRAPES': cma },
      ensembles: { 'ECMWF IFS 集合': ensembleEcmwf, 'GFS 集合': ensembleGfs },
      marine: marineData,
    };
  }
  return { fetchBundle };
})();
