// Open-Meteo API 封装
// 数据为模式指导，非官方预警；查询字段对齐 weather-note-analysis skill 的 references/open-meteo.md
const API = (() => {
  const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

  // 陆地：小时级（温度/降水/天气码/风/云量/能见度）
  const HOURLY = [
    'temperature_2m', 'apparent_temperature', 'precipitation',
    'precipitation_probability', 'rain', 'showers', 'weather_code',
    'wind_speed_10m', 'wind_gusts_10m', 'cloud_cover', 'visibility',
  ].join(',');
  // 陆地：日级
  const DAILY = [
    'weather_code', 'temperature_2m_max', 'temperature_2m_min',
    'precipitation_sum', 'precipitation_probability_max',
    'wind_speed_10m_max', 'wind_gusts_10m_max', 'sunrise', 'sunset',
  ].join(',');
  // 海洋：小时级（波高/涌浪/周期/方向）
  const MARINE_HOURLY = [
    'wave_height', 'wind_wave_height', 'swell_wave_height',
    'wave_direction', 'wave_period', 'swell_wave_period',
  ].join(',');
  // 海洋：日级最大值
  const MARINE_DAILY = 'wave_height_max,wave_period_max,swell_wave_height_max,swell_wave_period_max';

  function qs(params) {
    return new URLSearchParams(params).toString();
  }

  async function getJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  // 陆地天气：未来 N 天（Open-Meteo 免费支持未来 16 天）
  async function fetchForecast(lat, lon, startDate, endDate) {
    const url = `${FORECAST_URL}?${qs({
      latitude: lat,
      longitude: lon,
      start_date: startDate,
      end_date: endDate,
      timezone: TIMEZONE,
      hourly: HOURLY,
      daily: DAILY,
    })}`;
    try {
      return await getJSON(url);
    } catch (e) {
      return { error: `天气数据请求失败：${e.message}` };
    }
  }

  // 近海海况：海洋网格（cell_selection=sea），模式指导非港口通告
  async function fetchMarine(lat, lon, startDate, endDate) {
    const url = `${MARINE_URL}?${qs({
      latitude: lat,
      longitude: lon,
      start_date: startDate,
      end_date: endDate,
      timezone: TIMEZONE,
      cell_selection: 'sea',
      hourly: MARINE_HOURLY,
      daily: MARINE_DAILY,
    })}`;
    try {
      return await getJSON(url);
    } catch (e) {
      return { error: `海况数据请求失败：${e.message}` };
    }
  }

  return { fetchForecast, fetchMarine };
})();
