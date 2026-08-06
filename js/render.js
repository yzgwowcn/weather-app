// 渲染层 v2：云量可视化 + 蓝海判断 + 每日分时段聚合
// 所有函数返回 HTML 字符串，由 app.js 插入 DOM

// WMO weather_code → emoji + 中文（Open-Meteo 官方码表）
const WEATHER_META = {
  0:  { emoji: '☀️', label: '晴' },
  1:  { emoji: '🌤️', label: '少云' },
  2:  { emoji: '⛅', label: '多云' },
  3:  { emoji: '☁️', label: '阴' },
  45: { emoji: '🌫️', label: '雾' },
  48: { emoji: '🌫️', label: '雾凇' },
  51: { emoji: '🌦️', label: '毛毛雨' },
  53: { emoji: '🌦️', label: '毛毛雨' },
  55: { emoji: '🌧️', label: '强毛毛雨' },
  56: { emoji: '🌧️', label: '冻毛毛雨' },
  57: { emoji: '🌧️', label: '强冻毛毛雨' },
  61: { emoji: '🌦️', label: '小雨' },
  63: { emoji: '🌧️', label: '中雨' },
  65: { emoji: '🌧️', label: '大雨' },
  66: { emoji: '🌧️', label: '冻雨' },
  67: { emoji: '🌧️', label: '强冻雨' },
  71: { emoji: '🌨️', label: '小雪' },
  73: { emoji: '🌨️', label: '中雪' },
  75: { emoji: '❄️', label: '大雪' },
  77: { emoji: '🌨️', label: '米雪' },
  80: { emoji: '🌦️', label: '阵雨' },
  81: { emoji: '🌧️', label: '强阵雨' },
  82: { emoji: '⛈️', label: '暴雨' },
  85: { emoji: '🌨️', label: '阵雪' },
  86: { emoji: '🌨️', label: '强阵雪' },
  95: { emoji: '⛈️', label: '雷阵雨' },
  96: { emoji: '⛈️', label: '雷阵雨+冰雹' },
  99: { emoji: '⛈️', label: '强雷阵雨+冰雹' },
};

// 降水类天气码（用于时段主导天气码优先显示）
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

// 时效分层（按 skill：0-72h 较确定 / 4-7 天可能有变 / 8-16 天仅趋势参考）
function horizonLabel(daysFromNow) {
  if (daysFromNow <= 3) return { text: '较确定', cls: 'ok' };
  if (daysFromNow <= 7) return { text: '可能有变', cls: 'warn' };
  return { text: '趋势参考', cls: 'far' };
}

// 计算某日期（YYYY-MM-DD）距离今天的天数（UTC 解析避免时区偏移）
function daysFromNow(dateStr) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const a = new Date(todayStr + 'T00:00:00Z');
  const b = new Date(dateStr + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// 云量 → 蓝海可见度判断（读者最关心）
function blueSeaLabel(cloudPct) {
  if (cloudPct < 25) return { text: '☀️ 云量低，蓝海绝佳', cls: 'sea-great' };
  if (cloudPct < 50) return { text: '🌤️ 间或有云，蓝海可见', cls: 'sea-ok' };
  if (cloudPct < 75) return { text: '⛅ 多云，海景一般', cls: 'sea-mid' };
  return { text: '☁️ 阴天，海景受限', cls: 'sea-bad' };
}

// 云量可视化条（0-30% 蓝 → 60%+ 深灰，颜色随云量由蓝转灰）
function cloudBar(percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const hue = 200 - p * 1.2;
  const sat = Math.max(8, 100 - p * 0.6);
  const light = 72 - p * 0.25;
  return `<div class="cloud-bar"><div class="cloud-fill" style="width:${p}%;background:hsl(${hue},${sat}%,${light}%);"></div></div><span class="cloud-pct">${p}%</span>`;
}

// 分时段聚合：hourly 为 API 返回的小时数组，dayOffset 为第几天（0=今天）
// 夜间时段（22→30）跨午夜：h>=24 时取次日对应小时；数据不足的时段自动跳过
function aggregateSlot(hourly, dayOffset, slot) {
  const time = hourly.time;
  const reads = [];
  for (let h = slot.start; h < slot.end; h++) {
    const abs = dayOffset * 24 + h;
    if (abs >= time.length) continue;
    reads.push(abs);
  }
  if (reads.length === 0) return null;

  let cloudSum = 0, cloudCount = 0;
  let tempMin = Infinity, tempMax = -Infinity;
  let probMax = 0, rainSum = 0;
  const codeCount = {};
  for (const i of reads) {
    const c = hourly.cloud_cover[i];
    if (c != null) { cloudSum += c; cloudCount++; }
    const t = hourly.temperature_2m[i];
    if (t != null) { tempMin = Math.min(tempMin, t); tempMax = Math.max(tempMax, t); }
    const p = hourly.precipitation_probability[i];
    if (p != null) probMax = Math.max(probMax, p);
    rainSum += hourly.rain[i] || 0;
    const wc = hourly.weather_code[i];
    if (wc != null) codeCount[wc] = (codeCount[wc] || 0) + 1;
  }
  if (cloudCount === 0) return null;

  // 主导天气码：降水码优先（哪怕出现 1 次），其次取最频繁
  let rainCode = null, rainCnt = 0;
  let anyCode = null, anyCnt = 0;
  for (const [code, cnt] of Object.entries(codeCount)) {
    const c = Number(code);
    if (RAIN_CODES.has(c) && cnt > rainCnt) { rainCnt = cnt; rainCode = c; }
    if (cnt > anyCnt) { anyCnt = cnt; anyCode = c; }
  }
  const domCode = rainCode != null ? rainCode : anyCode;
  const meta = WEATHER_META[domCode] || { emoji: '❓', label: '未知' };
  const cloudAvg = Math.round(cloudSum / cloudCount);

  let desc = meta.label;
  if (RAIN_CODES.has(domCode)) {
    // 有雨时段：显示降水概率与雨量
    desc += ` ${Math.round(probMax)}%`;
    if (rainSum >= 0.1) desc += ` ${rainSum.toFixed(1)}mm`;
  } else if (probMax >= 30) {
    // 无雨时段：仅当降水概率较高时才提示
    desc += ` 降水${Math.round(probMax)}%`;
  }

  return {
    label: slot.label,
    emoji: meta.emoji,
    desc,
    cloudAvg,
    tempMin: Math.round(tempMin),
    tempMax: Math.round(tempMax),
  };
}

// 每日天气卡片（含云量条、蓝海判断、分时段折叠区）
function renderDailyCards(forecast, destName) {
  if (!forecast || forecast.error) {
    return `<p class="error">${forecast ? forecast.error : '无天气数据'}</p>`;
  }
  const daily = forecast.daily;
  const hourly = forecast.hourly;
  if (!daily || !daily.time || daily.time.length === 0) {
    return '<p class="error">未返回天气数据</p>';
  }
  const cards = daily.time.map((d, i) => {
    const meta = WEATHER_META[daily.weather_code[i]] || { emoji: '❓', label: '未知' };
    const cloudMean = daily.cloud_cover_mean[i];
    const sea = cloudMean != null ? blueSeaLabel(cloudMean) : null;
    const horizon = horizonLabel(daysFromNow(d));
    const prob = daily.precipitation_probability_max[i];
    const rainSum = daily.precipitation_sum[i];
    const probText = prob == null ? '—' : `${Math.round(prob)}%`;
    const rainText = rainSum == null ? '—' : `${rainSum.toFixed(1)} mm`;

    // 分时段（当天夜间跨午夜需要次日数据，最后一天自动截断）
    let slotsHtml = '';
    if (hourly && hourly.time) {
      const slots = TIME_SLOTS
        .map((s) => aggregateSlot(hourly, i, s))
        .filter(Boolean);
      if (slots.length) {
        slotsHtml = `
        <details class="slots" ${i <= 1 ? 'open' : ''}>
          <summary>分时段详情</summary>
          <div class="slot-grid">
            ${slots.map((s) => `
              <div class="slot">
                <div class="slot-label">${s.label}</div>
                <div class="slot-main">${s.emoji} ${s.desc}</div>
                <div class="slot-meta">云 ${s.cloudAvg}% · ${s.tempMin}°~${s.tempMax}°</div>
              </div>`).join('')}
          </div>
        </details>`;
      }
    }

    return `
      <div class="day-card">
        <div class="day-head">
          <div class="day-left">
            <div class="day-date">${d.slice(5)} <span class="weekday">${weekdayCN(d)}</span></div>
            <span class="day-horizon ${horizon.cls}">${horizon.text}</span>
          </div>
          <div class="day-icon">${meta.emoji}</div>
          <div class="day-mid">
            <div class="day-desc">${meta.label}</div>
            <div class="day-temp">${Math.round(daily.temperature_2m_min[i])}° ~ ${Math.round(daily.temperature_2m_max[i])}°</div>
          </div>
          <div class="day-right">
            <div class="day-rain" title="降水概率 / 降水量">💧 ${probText} / ${rainText}</div>
            <div class="day-wind" title="最大风速 / 阵风 (km/h)">💨 ${Math.round(daily.wind_speed_10m_max[i])} / ${Math.round(daily.wind_gusts_10m_max[i])}</div>
          </div>
        </div>
        ${cloudMean != null ? `
        <div class="day-cloud">
          <span class="cloud-label">云量</span>
          ${cloudBar(cloudMean)}
          ${sea ? `<span class="sea-badge ${sea.cls}">${sea.text}</span>` : ''}
        </div>` : ''}
        ${slotsHtml}
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
  if (!daily || !daily.time || daily.time.length === 0) return '';
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
