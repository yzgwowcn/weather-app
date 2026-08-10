// 海南近海“玻璃海候选”纯规则：只标记模式条件较配合的逐小时时段，不承诺现场水质或镜面效果。
// 同一文件同时供浏览器经典脚本和 Node/Vercel CommonJS 依赖使用，保证前后端阈值一致。
const GlassSea = (() => {
  const DAY_START = 8;
  const DAY_END = 18;
  const BLOCKING_CODES = new Set([61, 63, 65, 80, 81, 82]);
  const LIMITS = Object.freeze({
    excellent: { mask: 50, precipitation: 0.1, wind: 12, wave: 0.5, windWave: 0.2, swell: 0.5 },
    possible: { mask: 70, precipitation: 0.1, wind: 16, wave: 0.8, windWave: 0.3, swell: 0.7 },
  });

  function finite(value) {
    const number = value == null ? NaN : Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function rounded(value, digits = 1) {
    return value == null ? null : Number(value.toFixed(digits));
  }
  function datePart(value) { return String(value).slice(0, 10); }
  function hourPart(value) { return Number(String(value).slice(11, 13)); }
  function distanceKm(lat1, lon1, lat2, lon2) {
    const values = [lat1, lon1, lat2, lon2].map(finite);
    if (values.some((value) => value == null)) return null;
    const [aLat, aLon, bLat, bLon] = values.map((value) => value * Math.PI / 180);
    const dLat = bLat - aLat;
    const dLon = bLon - aLon;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function isNearSeaGrid(lat, lon, marineResponse, maxKm = 20) {
    const distance = distanceKm(lat, lon, marineResponse?.latitude, marineResponse?.longitude);
    return distance != null && distance <= maxKm;
  }
  function within(point, limits) {
    return point.mask <= limits.mask && point.precipitation <= limits.precipitation &&
      point.wind <= limits.wind && point.wave <= limits.wave && point.windWave <= limits.windWave &&
      point.swell <= limits.swell && !BLOCKING_CODES.has(point.weatherCode);
  }
  function windowFrom(points) {
    return {
      level: points.every((point) => point.level === 'excellent') ? 'excellent' : 'possible',
      startHour: points[0].hour,
      endHour: points[points.length - 1].hour,
      maxWaveM: rounded(Math.max(...points.map((point) => point.wave))),
      maxWindWaveM: rounded(Math.max(...points.map((point) => point.windWave))),
      maxSwellM: rounded(Math.max(...points.map((point) => point.swell))),
      maxWindKmh: Math.round(Math.max(...points.map((point) => point.wind))),
      highCloudMean: Math.round(points.reduce((sum, point) => sum + point.high, 0) / points.length),
    };
  }
  function merge(points) {
    const windows = [];
    let group = [];
    for (const point of points) {
      const previous = group[group.length - 1];
      if (previous && (point.hour !== previous.hour + 1 || point.level !== previous.level)) {
        windows.push(windowFrom(group));
        group = [];
      }
      group.push(point);
    }
    if (group.length) windows.push(windowFrom(group));
    return windows;
  }
  function hourLabel(window) {
    const start = String(window.startHour).padStart(2, '0') + ':00';
    if (window.startHour === window.endHour) return `${start}前后`;
    return `${start}–${String(window.endHour).padStart(2, '0')}:00`;
  }
  function build(weatherHourly, marineHourly, dates = []) {
    const wanted = new Set(dates);
    const results = Object.fromEntries(dates.map((date) => [date, { level: 'unavailable', windows: [], availableHours: 0 }]));
    if (!weatherHourly?.time || !marineHourly?.time) return results;
    const marineIndexes = new Map(marineHourly.time.map((time, index) => [String(time), index]));
    const candidates = {};
    const availability = {};
    weatherHourly.time.forEach((rawTime, weatherIndex) => {
      const time = String(rawTime);
      const date = datePart(time);
      const hour = hourPart(time);
      if (!wanted.has(date) || hour < DAY_START || hour >= DAY_END) return;
      const marineIndex = marineIndexes.get(time);
      if (marineIndex == null) return;
      const low = finite(weatherHourly.cloud_cover_low?.[weatherIndex]);
      const mid = finite(weatherHourly.cloud_cover_mid?.[weatherIndex]);
      const point = {
        date, hour,
        mask: low == null || mid == null ? null : low * 0.6 + mid * 0.4,
        high: finite(weatherHourly.cloud_cover_high?.[weatherIndex]) ?? 0,
        precipitation: finite(weatherHourly.precipitation?.[weatherIndex]),
        wind: finite(weatherHourly.wind_speed_10m?.[weatherIndex]),
        weatherCode: finite(weatherHourly.weather_code?.[weatherIndex]) ?? 0,
        wave: finite(marineHourly.wave_height?.[marineIndex]),
        windWave: finite(marineHourly.wind_wave_height?.[marineIndex]),
        swell: finite(marineHourly.swell_wave_height?.[marineIndex]),
      };
      if ([point.mask, point.precipitation, point.wind, point.wave, point.windWave, point.swell].some((value) => value == null)) return;
      availability[date] = (availability[date] || 0) + 1;
      point.level = within(point, LIMITS.excellent) ? 'excellent' : within(point, LIMITS.possible) ? 'possible' : null;
      if (point.level) (candidates[date] ||= []).push(point);
    });
    dates.forEach((date) => {
      const availableHours = availability[date] || 0;
      if (!availableHours) return;
      const windows = merge(candidates[date] || []);
      results[date] = {
        level: windows.some((window) => window.level === 'excellent') ? 'excellent' : windows.length ? 'possible' : 'none',
        windows,
        availableHours,
      };
    });
    return results;
  }
  function compact(day) {
    if (!day) return { level: 'unavailable', windows: [] };
    return {
      level: day.level,
      windows: day.windows.map((window) => ({
        time: hourLabel(window), level: window.level, waveM: window.maxWaveM,
        windWaveM: window.maxWindWaveM, swellM: window.maxSwellM,
        windKmh: window.maxWindKmh, highCloud: window.highCloudMean,
      })),
    };
  }
  return { LIMITS, build, compact, hourLabel, distanceKm, isNearSeaGrid };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GlassSea;
