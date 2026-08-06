// 渲染层：weather_code → 中文 + 图标 + 每日/海况卡片 HTML
// 所有函数返回 HTML 字符串，由 app.js 插入 DOM

// WMO weather_code 中文映射（参考 Open-Meteo 文档）
const WEATHER_CODE_MAP = {
  0: '晴', 1: '基本晴', 2: '少云', 3: '多云',
  45: '雾', 48: '雾凇',
  51: '毛毛雨', 53: '小雨', 55: '中雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '阵雨', 81: '强阵雨', 82: '暴雨', 85: '阵雪', 86: '强阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷阵雨伴冰雹',
};

// 天气图标（emoji，避免引入图标库）
function weatherIcon(code) {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '❓';
}

// 按 skill 时效规则：0-3 天较确定 / 4-7 天可能有变 / 8-16 天仅趋势参考
function horizonLabel(daysFromNow) {
  if (daysFromNow <= 3) return '较确定';
  if (daysFromNow <= 7) return '可能有变';
  return '趋势参考';
}

// 计算某日期（YYYY-MM-DD）距离今天的天数，用 UTC 解析避免时区偏移
function daysFromNow(dateStr) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const a = new Date(todayStr + 'T00:00:00Z');
  const b = new Date(dateStr + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// 每日天气卡片（未来 N 天）
function renderDailyCards(forecast, destName) {
  if (!forecast || forecast.error) {
    return `<p class="error">${forecast ? forecast.error : '无天气数据'}</p>`;
  }
  const daily = forecast.daily;
  if (!daily || !daily.time || daily.time.length === 0) {
    return '<p class="error">未返回天气数据</p>';
  }
  const cards = daily.time.map((d, i) => {
    const code = daily.weather_code[i];
    const days = daysFromNow(d);
    const horizon = horizonLabel(days);
    const weekday = weekdayCN(d);
    const rainProb = daily.precipitation_probability_max[i];
    const rainSum = daily.precipitation_sum[i];
    const probText = rainProb == null ? '—' : `${Math.round(rainProb)}%`;
    const rainText = rainSum == null ? '—' : `${rainSum.toFixed(1)} mm`;
    return `
      <div class="day-card">
        <div class="day-left">
          <div class="day-date">${d.slice(5)} <span class="weekday">${weekday}</span></div>
          <div class="day-horizon ${horizon === '较确定' ? 'ok' : horizon === '可能有变' ? 'warn' : 'far'}">${horizon}</div>
        </div>
        <div class="day-icon">${weatherIcon(code)}</div>
        <div class="day-mid">
          <div class="day-desc">${WEATHER_CODE_MAP[code] || '未知'}</div>
          <div class="day-temp">${Math.round(daily.temperature_2m_min[i])}° ~ ${Math.round(daily.temperature_2m_max[i])}°</div>
        </div>
        <div class="day-right">
          <div class="day-rain" title="降水概率 / 降水量">💧 ${probText} / ${rainText}</div>
          <div class="day-wind" title="最大风速 / 阵风 (km/h)">💨 ${Math.round(daily.wind_speed_10m_max[i])} / ${Math.round(daily.wind_gusts_10m_max[i])}</div>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="section">
      <h3>📍 ${destName} · 未来 ${daily.time.length} 天</h3>
      ${cards}
    </div>`;
}

// 近海海况卡片（海洋网格模式指导）
function renderMarineCards(marine, destName) {
  if (!marine || marine.error) {
    return `<div class="section marine"><h3>🌊 海况</h3><p class="error">${marine ? marine.error : '无海况数据'}</p></div>`;
  }
  const daily = marine.daily;
  if (!daily || !daily.time || daily.time.length === 0) {
    return '';
  }
  const cards = daily.time.map((d, i) => {
    const wave = daily.wave_height_max[i];
    if (wave == null) return '';
    const seaState = seaStateLabel(wave);
    return `
      <div class="day-card marine-card">
        <div class="day-left">
          <div class="day-date">${d.slice(5)} <span class="weekday">${weekdayCN(d)}</span></div>
        </div>
        <div class="day-icon">🌊</div>
        <div class="day-mid">
          <div class="day-desc">${seaState}</div>
          <div class="day-temp">浪高 ${wave.toFixed(2)} m</div>
        </div>
        <div class="day-right">
          <div class="day-rain">周期 ${daily.wave_period_max[i] == null ? '—' : daily.wave_period_max[i].toFixed(1) + ' s'}</div>
          <div class="day-rain">涌浪 ${daily.swell_wave_height_max[i] == null ? '—' : daily.swell_wave_height_max[i].toFixed(2) + ' m'}</div>
        </div>
      </div>`;
  }).filter(Boolean).join('');
  if (!cards) return '';
  return `
    <div class="section marine">
      <h3>🌊 ${destName} 近海海况</h3>
      ${cards}
      <p class="footnote">海洋数据为模式指导，非港口通告；乘船/浮潜/潜水请以当天码头与景区通知为准。</p>
    </div>`;
}

// 海况等级（近岸简化标准，仅供参考）
function seaStateLabel(wave) {
  if (wave < 0.5) return '平静';
  if (wave < 1.25) return '轻浪';
  if (wave < 2.5) return '中浪';
  return '大浪';
}

// 星期中文
function weekdayCN(dateStr) {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return names[new Date(dateStr + 'T00:00:00Z').getUTCDay()];
}
