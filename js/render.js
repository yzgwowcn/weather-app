// 渲染层：消费 Metrics 输出的结构化日级结果（ec / crossModel / cloudSeries / weatherMood），
// 输出静态 HTML 与原生 SVG 图表。不持有请求细节，交互由 app.js 事件委托驱动。
// 天气图标统一使用 meteocons Lottie 动画（assets/lottie/*.json，由 js/icons.js 播放）；
// 雷雨徽章（14px 小图标）保持静态 SVG。
const WEATHER_META = {
  0: ['晴', 'clear-day'], 1: ['晴间多云', 'partly-cloudy-day'], 2: ['多云', 'cloudy'], 3: ['阴', 'overcast'],
  45: ['雾', 'fog'], 48: ['雾', 'fog'], 51: ['毛毛雨', 'drizzle'], 53: ['毛毛雨', 'drizzle'], 55: ['毛毛雨', 'drizzle'],
  61: ['小雨', 'rain'], 63: ['中雨', 'rain'], 65: ['大雨', 'rain'], 80: ['阵雨', 'rain'], 81: ['强阵雨', 'rain'], 82: ['暴雨', 'rain'],
  95: ['雷阵雨', 'thunderstorms'], 96: ['雷阵雨', 'thunderstorms'], 99: ['强雷阵雨', 'thunderstorms'],
};
function weatherIcon(code) { return `assets/lottie/${weatherMeta(code)[1]}.json`; }

// ---- 天气图标三段式：早（08–10）/ 中（11–13）/ 晚（14–17），每段取主导天气码 ----
const DAY_PERIODS = [
  { label: '早', hours: [8, 9, 10] },
  { label: '中', hours: [11, 12, 13] },
  { label: '晚', hours: [14, 15, 16, 17] },
];
// 取 forecast.hourly 中某日的三段小时天气码（与 metrics 日间口径一致）
function hourlyCodesFor(forecast, date) {
  const buckets = [[], [], []];
  if (!forecast?.hourly?.time) return buckets;
  forecast.hourly.time.forEach((time, index) => {
    if (time.slice(0, 10) !== date) return;
    const hour = Number(time.slice(11, 13));
    const code = Number(forecast.hourly.weather_code?.[index]);
    if (!Number.isFinite(code)) return;
    DAY_PERIODS.forEach((period, pi) => {
      if (period.hours.includes(hour)) buckets[pi].push(code);
    });
  });
  return buckets;
}
function dominantCode(codes) {
  if (!codes.length) return null;
  const count = {};
  codes.forEach((c) => { count[c] = (count[c] || 0) + 1; });
  return Number(Object.entries(count).sort((a, b) => b[1] - a[1])[0][0]);
}
function iconForCode(code, suitable) {
  const seg = ICON_SEGMENTS.find((s) => s.test(code));
  if (!seg) return 'clear-day';
  // 适合出行：优先晴天 / 晴间多云 / 晴间多云伴零星阵雨
  if (suitable) {
    if (seg.name === 'overcast') return 'partly-cloudy-day';
    if (seg.name === 'drizzle') return 'partly-cloudy-day-drizzle';
  }
  return seg.icon;
}
function lottieMarkup(buckets, cls, suitable, fallbackCode) {
  const slots = DAY_PERIODS.map((period, pi) => {
    const codes = buckets[pi] || [];
    const code = codes.length ? dominantCode(codes) : fallbackCode;
    const name = code == null ? 'clear-day' : iconForCode(code, suitable);
    return `<span class="icon-slot"><span class="icon-period">${period.label}</span><span class="weather-lottie ${cls}" data-lottie="${name}" aria-hidden="true"></span></span>`;
  }).join('');
  return `<span class="icon-group ${cls}">${slots}</span>`;
}
const ICON_SEGMENTS = [
  { test: (c) => c === 0, name: 'clear', icon: 'clear-day' },
  { test: (c) => c === 1 || c === 2, name: 'partly', icon: 'partly-cloudy-day' },
  { test: (c) => c === 3, name: 'overcast', icon: 'overcast' },
  { test: (c) => c === 45 || c === 48, name: 'fog', icon: 'fog' },
  { test: (c) => c >= 51 && c <= 55, name: 'drizzle', icon: 'drizzle' },
  { test: (c) => c >= 61 && c <= 82, name: 'rain', icon: 'rain' },
  { test: (c) => c >= 95, name: 'thunder', icon: 'thunderstorms' },
];

const SKY_LAYERS = [
  { key: 'low', cls: 'low', label: '低云' },
  { key: 'mid', cls: 'mid', label: '中云' },
  { key: 'high', cls: 'high', label: '高云' },
];

function weatherMeta(code) { return WEATHER_META[code] || ['天气变化', 'clear-day']; }
function weekdayCN(date) { return ['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T00:00:00Z`).getUTCDay()]; }
function dateLabel(date) { return `${date.slice(5, 7)}.${date.slice(8, 10)} · 周${weekdayCN(date)}`; }
function horizonText(index) { return index <= 2 ? '近期判断' : index <= 6 ? '留意变化' : '趋势参考'; }
function probabilityWord(value) {
  if (value == null) return '晴好率待补充';
  if (value >= 75) return '晴好把握大';
  if (value >= 50) return '有晴好窗口';
  if (value >= 25) return '晴好不稳定';
  return '晴好机会低';
}
function cloudWord(cloud) {
  if (cloud == null) return '—';
  if (cloud < 25) return '开阔少云';
  if (cloud < 45) return '云量适中';
  if (cloud < 70) return '云量偏多';
  return '厚云覆盖';
}
// 雷雨时段格式：[[13,15]] → "13:00–15:00"；[[8,8]] → "08:00"
function formatWindows(windows) {
  const pad = (hour) => String(hour).padStart(2, '0');
  return windows.map(([start, end]) => (start === end ? `${pad(start)}:00` : `${pad(start)}:00–${pad(end)}:00`)).join('、');
}
function dailyData(forecast, index) {
  const daily = forecast.daily;
  return {
    date: daily.time[index], code: daily.weather_code[index], cloud: daily.cloud_cover_mean[index], rain: daily.precipitation_sum[index],
    rainProbability: daily.precipitation_probability_max[index], wind: daily.wind_speed_10m_max[index], gust: daily.wind_gusts_10m_max[index],
    low: daily.temperature_2m_min[index], high: daily.temperature_2m_max[index],
  };
}
function metricTile(label, value, note, tone = '') {
  return `<div class="metric-tile ${tone}"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
}

// ---- SVG 天空剖面 ---------------------------------------------------------

// Catmull-Rom 转三次贝塞尔的光滑曲线路径
function smoothPath(points) {
  if (!points.length) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// 图表几何：小时精度时间轴，横轴为预报期内全部小时；8px/小时，宽画布横向滚动。
function skyGeometry(dates) {
  const H = 250;
  const PAD = { top: 16, right: 16, bottom: 32, left: 46 };
  const STEP = 8;
  const totalHours = dates.length * 24;
  const plotW = totalHours * STEP;
  const W = plotW + PAD.left + PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + i * STEP;
  const y = (v) => PAD.top + (100 - v) / 100 * plotH;
  return { H, PAD, STEP, totalHours, plotW, W, plotH, x, y };
}

function renderSkyChart(series, dates, skyIndex) {
  const g = skyGeometry(dates);
  const { H, PAD, W, plotH, x, y } = g;
  const parts = [];

  // 网格与 y 轴刻度
  [0, 25, 50, 75, 100].forEach((tick) => {
    parts.push(`<line class="sky-grid" x1="${PAD.left}" y1="${y(tick)}" x2="${W - PAD.right}" y2="${y(tick)}" />`);
    parts.push(`<text class="sky-axis" x="${PAD.left - 7}" y="${y(tick) + 3.5}">${tick}%</text>`);
  });

  // 白天时段浅色带（08:00–18:00）、日界线与日期标签
  dates.forEach((date, di) => {
    parts.push(`<rect class="sky-dayband" x="${x(di * 24 + 8)}" y="${PAD.top}" width="${10 * g.STEP}" height="${plotH}" />`);
    if (di > 0) parts.push(`<line class="sky-dateline" x1="${x(di * 24)}" y1="${PAD.top}" x2="${x(di * 24)}" y2="${PAD.top + plotH}" />`);
    parts.push(`<text class="sky-datelabel" x="${x(di * 24)}" y="${H - 8}">${date.slice(5).replace('-', '.')} 周${weekdayCN(date)}</text>`);
  });

  // 三层云曲线（高云虚线）
  const dots = [];
  SKY_LAYERS.forEach((layer) => {
    const segments = [[]];
    dates.forEach((date, di) => {
      const day = series.days[date];
      if (!day) return;
      day.points.forEach((p, hi) => {
        const v = p[layer.key];
        if (v == null) { segments.push([]); return; }
        segments[segments.length - 1].push({ x: x(di * 24 + hi), y: y(v) });
      });
    });
    segments.forEach((segment) => {
      if (segment.length > 1) parts.push(`<path class="sky-line ${layer.cls}" d="${smoothPath(segment)}" />`);
      if (segment.length === 1) dots.push(`<circle class="sky-dot ${layer.cls}" cx="${segment[0].x.toFixed(1)}" cy="${segment[0].y.toFixed(1)}" r="2.5" />`);
    });
  });
  parts.push(dots.join(''));

  // 选中时刻准星（跨渲染保留）
  if (skyIndex != null) {
    const di = Math.floor(skyIndex / 24);
    const hi = skyIndex % 24;
    const day = series.days[dates[di]];
    if (day && day.points[hi]) {
      const px = x(skyIndex);
      parts.push(`<line class="sky-crosshair-line" x1="${px}" y1="${PAD.top}" x2="${px}" y2="${PAD.top + plotH}" />`);
      SKY_LAYERS.forEach((layer) => {
        const v = day.points[hi][layer.key];
        if (v != null) parts.push(`<circle class="sky-dot ${layer.cls}" cx="${px}" cy="${y(v)}" r="3.5" />`);
      });
    }
  }

  // 不可见命中区：每个小时一条透明竖条，事件委托读取 dataset
  dates.forEach((date, di) => {
    const day = series.days[date];
    if (!day) return;
    day.points.forEach((p, hi) => {
      const i = di * 24 + hi;
      parts.push(`<line class="sky-hit" data-index="${i}" data-x="${x(i)}" data-time="${escapeText(p.time)}" data-hour="${p.hour}"
        data-low="${p.low ?? ''}" data-mid="${p.mid ?? ''}" data-high="${p.high ?? ''}"
        data-mask="${p.mask == null ? '' : p.mask.toFixed(1)}"
        data-precip="${p.precipitation == null ? '' : p.precipitation.toFixed(1)}"
        data-wind="${p.wind ?? ''}" x1="${x(i)}" y1="${PAD.top}" x2="${x(i)}" y2="${PAD.top + plotH}" />`);
    });
  });

  return `<svg class="sky-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="三层云量小时剖面图">${parts.join('')}</svg>`;
}

function renderSkySection(cloudSeries, dates, skyView, skyIndex) {
  const views = [
    { key: 'ec', label: 'EC', title: 'ECMWF IFS 确定性', series: cloudSeries.ec },
    { key: 'forecast', label: '综合预报', title: 'Open-Meteo 综合预报', series: cloudSeries.forecast },
  ];
  const panes = views.map((view) => `
    <div class="sky-view-pane" data-sky-view="${view.key}"${view.key !== skyView ? ' hidden' : ''}>
      <div class="sky-scroll">
        <div class="sky-chart" data-sky-chart tabindex="0" role="application" aria-label="${view.title}三层云量图，左右方向键移动准星">
          ${renderSkyChart(view.series, dates, view.key === skyView ? skyIndex : null)}
          <div class="sky-crosshair" aria-hidden="true"></div>
          <div class="sky-tooltip" role="status"></div>
        </div>
      </div>
      <p class="sky-source">${view.title} · 每小时一个数据点，横向滚动查看全部时段</p>
    </div>`).join('');
  const buttons = views.map((view) => `
    <button type="button" class="sky-view-btn ${view.key === skyView ? 'active' : ''}" data-sky-view="${view.key}" aria-pressed="${view.key === skyView}">${view.label}</button>`).join('');
  return `
  <section class="sky-section" aria-label="EC 天空剖面">
    <div class="section-heading sky-heading">
      <div><p class="section-kicker">EC SKY PROFILE</p><h2>天空剖面</h2></div>
      <div class="sky-switch" role="group" aria-label="云图数据源切换">${buttons}</div>
    </div>
    <p class="sky-note"><span class="legend low">低云</span><span class="legend mid">中云</span><span class="legend high">高云</span> · 海边天色重点看低云与中云，点击或悬停图表查看逐小时详情；高云仅供参考，不影响出行判断。浅色带为 08:00–18:00 白天时段。</p>
    ${panes}
  </section>`;
}

// ---- 首屏各区块 -----------------------------------------------------------

// 出行建议徽章样式映射（advice.level → 徽章 class）
const ADVICE_META = {
  recommended: { cls: 'good' },
  suitable: { cls: 'good' },
  caution: { cls: 'caution' },
  watch: { cls: 'watch' },
  avoid: { cls: 'bad' },
  none: { cls: 'none' },
};

function renderEcHero(day, assessment, destination) {
  const main = assessment.ec.main;
  const finalSuitable = assessment.finalSuitable === true;
  const ensembleOverturn = finalSuitable && main && !main.suitable;
  const [condition] = weatherMeta(day.code);
  const advice = assessment.advice || { level: 'none', text: '数据待补充', note: '' };
  const verdict = { text: advice.text, cls: (ADVICE_META[advice.level] || ADVICE_META.none).cls };
  const basis = main
    ? `遮蔽云量 ${Math.round(main.maskMean)}% · 累计降水 ${main.precipitationSum.toFixed(1)} mm · 平均风速 ${Math.round(main.windMean)} km/h`
    : 'EC 主运行暂未返回，页面依据综合预报示意。';
  const overturnNote = ensembleOverturn
    ? `EC 集合晴好率 ${Metrics.formatPercent(assessment.probability)}，主运行与集合方向相反，以集合晴好率为准。`
    : '';
  const thunder = main && main.thunderWindows.length
    ? `<p class="thunder-window"><img class="thunder-icon" src="assets/icons/lightning-bolt.svg" alt="" aria-hidden="true">${formatWindows(main.thunderWindows)} 有雷阵雨，注意避雨</p>` : '';
  const gust = main && main.gustWindows && main.gustWindows.length
    ? `<p class="gust-window">⚠ ${formatWindows(main.gustWindows)} 有短时大阵风（峰值 ${Math.round(main.gustMax)} km/h），注意防风</p>` : '';
  const consistency = assessment.ec.memberConsistency;
  return `
  <section class="ec-hero" data-mood="${assessment.weatherMood.mood}" data-cloud="${day.cloud < 30 ? 'clear' : day.cloud < 60 ? 'partly' : 'cloudy'}" data-thunder-intensity="${Metrics.thunderIntensity(day, main)}">
    <div class="ec-verdict">
      <p class="section-kicker">ECMWF 主运行 · 08:00–18:00 · ${destination.name}</p>
      <div class="verdict-row">${lottieMarkup(day.iconCodes ?? [[], [], []], 'weather-symbol', finalSuitable, day.code)}<h2>${verdict.text}</h2><span class="verdict-badge ${verdict.cls}">${verdict.text}</span></div>
      <p class="verdict-basis">${basis}。${condition}，${cloudWord(day.cloud)}。</p>
      ${advice.note ? `<p class="advice-note">${advice.note}</p>` : ''}
      ${overturnNote ? `<p class="overturn-note">${overturnNote}</p>` : ''}
      ${thunder}
      ${gust}
      <p class="sea-sky-tip">海边天色重点看低云与中云影响最大，高云仅供参考。</p>
    </div>
    <div class="ec-probability">
      <div class="probability-orb ${assessment.probability == null ? 'unavailable' : ''}">
        <svg class="prob-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="prob-track" cx="60" cy="60" r="50"></circle>
          <circle class="prob-arc" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="${Math.round(assessment.probability || 0)} 100" transform="rotate(-90 60 60)"></circle>
        </svg>
        <span>EC 集合晴好率</span><strong>${Metrics.formatPercent(assessment.probability)}</strong>
        <small>${assessment.ec.ensemble ? `${assessment.ec.ensemble.suitable}/${assessment.ec.ensemble.total} 成员满足` : '成员数据暂缺'}</small>
      </div>
      <span class="confidence-pill ${consistency.level}">${consistency.text}</span>
      <p class="consistency-desc">${consistency.description}</p>
    </div>
  </section>`;
}

function renderEcMetrics(assessment) {
  const main = assessment.ec.main;
  if (!main) {
    return `<section class="metric-grid" aria-label="判断依据"><div class="metric-tile"><span>遮蔽云量</span><strong>—</strong><small>EC 主运行暂缺</small></div></section>`;
  }
  return `<section class="metric-grid" aria-label="EC 主结论判断依据">
    ${metricTile('遮蔽云量', `${Math.round(main.maskMean)}%`, '低云与中云共同决定，数值越低天色越通透', 'cloud')}
    ${metricTile('累计降水', `${main.precipitationSum.toFixed(1)} mm`, '日间累计，1 mm 以内为宜')}
    ${metricTile('平均风速', `${Math.round(main.windMean)} km/h`, '日间平均，30 km/h 以内为宜')}
    ${metricTile('高云参考', main.highMean == null ? '—' : `${Math.round(main.highMean)}%`, '薄云与霞光参考，不参与扣分', 'high-cloud')}
  </section>`;
}

function renderCrossModel(assessment) {
  const { support, oppose, missing, direction, note } = assessment.crossModel;
  const models = assessment.deterministic;
  const rows = ['NOAA GFS', 'JMA GSM', 'CMA GRAPES'].map((name) => {
    const model = models.find((item) => item.name === name);
    if (!model) {
      const failed = assessment.missingSources.includes(name);
      return `<li><span>${name}</span><b class="caution">${failed ? '请求失败' : '数据不足'}</b><small>未参与验证</small></li>`;
    }
    const agree = direction != null && model.suitable === direction;
    return `<li><span>${name}</span><b class="${agree ? 'support' : 'caution'}">${agree ? '支持 EC' : '与 EC 分歧'}</b><small>遮蔽 ${Math.round(model.maskMean)}% · 雨 ${model.precipitationSum.toFixed(1)} mm · 风 ${Math.round(model.windMean)} km/h</small></li>`;
  }).join('');
  return `
  <section class="cross-section" aria-label="外部模型验证">
    <div class="section-heading"><p class="section-kicker">CROSS-CHECK</p><h2>外部模型验证</h2></div>
    <p class="cross-note">GFS、JMA、CMA 对 EC 主方向的交叉验证。这是模型分歧提示，不是历史准确率证明。</p>
    <div class="cross-stats">
      <div class="cross-stat support"><span>支持</span><b>${support}</b><small>与 EC 方向一致</small></div>
      <div class="cross-stat oppose"><span>反对</span><b>${oppose}</b><small>与 EC 方向相反</small></div>
      <div class="cross-stat missing"><span>缺失</span><b>${missing.length}</b><small>未返回或数据不足</small></div>
    </div>
    <ul class="cross-list">${rows}</ul>
    ${note ? `<p class="cross-warn">${note}</p>` : ''}
  </section>`;
}

function renderDayRail(days, selectedDate) {
  return `<nav class="date-rail" aria-label="选择查看日期">${days.map((day, index) => `
    <button type="button" class="date-chip ${day.date === selectedDate ? 'active' : ''}" data-select-date="${day.date}" aria-pressed="${day.date === selectedDate}">
      <span>${index === 0 ? '今天' : `周${weekdayCN(day.date)}`}</span><strong>${day.date.slice(5)}</strong><small>${Metrics.formatPercent(day.assessment.probability)}</small>
    </button>`).join('')}</nav>`;
}

// ---- 逐日卡片：当天逐小时云量曲线 -----------------------------------------

// 取综合预报 hourly 中某日全天各小时的云量与降雨（当前 API 粒度为 1 小时间隔，24 点/天）
function cloudCurve(forecast, date) {
  const h = forecast?.hourly;
  if (!h?.time) return [];
  const points = [];
  h.time.forEach((time, index) => {
    if (String(time).slice(0, 10) !== date) return;
    const num = (arr) => { const v = arr?.[index]; return v == null ? null : Number(v); };
    points.push({
      hour: Number(String(time).slice(11, 13)),
      time: String(time),
      low: num(h.cloud_cover_low),
      mid: num(h.cloud_cover_mid),
      precipitation: num(h.precipitation),
    });
  });
  return points;
}

// 当天逐小时曲线：低云/中云（左轴 %）+ 降雨柱状（高度按当天最大值归一化），固定像素宽横向滚动
function renderCloudCurve(points) {
  if (!points.length) return '<p class="cloud-curve-empty">当天逐小时云量数据暂缺。</p>';
  const STEP = 30; const H = 180;
  const PAD = { top: 14, right: 12, bottom: 26, left: 36 };
  const W = PAD.left + points.length * STEP + PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xc = (hour) => PAD.left + (hour + 0.5) * STEP;
  const y = (v) => PAD.top + (100 - v) / 100 * plotH;
  const maxPrecip = Math.max(0, ...points.map((p) => p.precipitation ?? 0));
  const parts = [];
  [0, 25, 50, 75, 100].forEach((tick) => {
    parts.push(`<line class="cloud-grid" x1="${PAD.left}" y1="${y(tick)}" x2="${W - PAD.right}" y2="${y(tick)}" />`);
    parts.push(`<text class="cloud-axis" x="${PAD.left - 6}" y="${y(tick) + 3.5}">${tick}</text>`);
  });
  // 白天时段（08–18）浅色带
  parts.push(`<rect class="cloud-dayband" x="${PAD.left + 8 * STEP}" y="${PAD.top}" width="${10 * STEP}" height="${plotH}" />`);
  // x 轴小时刻度（每 3 小时）
  [0, 3, 6, 9, 12, 15, 18, 21].forEach((hour) => {
    parts.push(`<text class="cloud-axis" x="${xc(hour)}" y="${H - 7}" text-anchor="middle">${String(hour).padStart(2, '0')}</text>`);
  });
  // 降雨柱状（归一化到当天最大降雨，精确数值在 tooltip 中展示）
  if (maxPrecip > 0) {
    points.forEach((p) => {
      if (p.precipitation == null || p.precipitation <= 0) return;
      const barW = 11;
      const barH = Math.max(2, p.precipitation / maxPrecip * plotH);
      parts.push(`<rect class="cloud-bar" x="${(xc(p.hour) - barW / 2).toFixed(1)}" y="${(PAD.top + plotH - barH).toFixed(1)}" width="${barW}" height="${barH.toFixed(1)}" />`);
    });
  }
  // 低云/中云曲线（高云与总云量不参与逐日判断，不展示）
  [['low', 'low'], ['mid', 'mid']].forEach(([key, cls]) => {
    const seg = points.filter((p) => p[key] != null).map((p) => ({ x: xc(p.hour), y: y(p[key]) }));
    if (seg.length > 1) parts.push(`<path class="cloud-line ${cls}" d="${smoothPath(seg)}" />`);
  });
  // 不可见命中区：每小时一条透明竖条，事件委托读取 dataset（与天空剖面一致）
  points.forEach((p, i) => {
    parts.push(`<line class="cloud-hit" data-index="${i}" data-x="${xc(p.hour)}" data-time="${escapeText(p.time)}" data-hour="${p.hour}"
      data-low="${p.low ?? ''}" data-mid="${p.mid ?? ''}" data-precip="${p.precipitation == null ? '' : p.precipitation.toFixed(1)}"
      x1="${xc(p.hour)}" y1="${PAD.top}" x2="${xc(p.hour)}" y2="${PAD.top + plotH}" />`);
  });
  return `<svg class="cloud-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="当天逐小时低云、中云与降雨量曲线（1 小时间隔，共 ${points.length} 点）">${parts.join('')}</svg>`;
}

function renderForecastCards(days, selectedDate, cloudCurves = {}) {
  return `<section class="forecast-section"><div class="section-heading"><p class="section-kicker">OUTLOOK</p><h2>逐日判断</h2></div>
    <div class="forecast-list">${days.map((day, index) => {
      const [condition] = weatherMeta(day.code);
      const active = day.date === selectedDate;
      const consistency = day.assessment.ec.memberConsistency;
      return `<article class="forecast-card ${active ? 'selected' : ''}">
        <button type="button" class="forecast-summary" data-select-date="${day.date}" aria-label="查看 ${dateLabel(day.date)} 的判断">
          <div class="forecast-date"><span>${index === 0 ? '今天' : dateLabel(day.date)}</span><small>${horizonText(index)}</small></div>
          ${lottieMarkup(day.iconCodes ?? [[], [], []], 'forecast-symbol', day.assessment.finalSuitable === true, day.code)}
          <div class="forecast-condition"><strong>${probabilityWord(day.assessment.probability)}</strong><span>${condition} · ${Math.round(day.low)}°–${Math.round(day.high)}°</span></div>
          <div class="forecast-probability"><b>${Metrics.formatPercent(day.assessment.probability)}</b><small>${consistency.text}</small></div>
        </button>
        ${active ? `<div class="forecast-detail"><div><span>遮蔽云量</span><b>${day.assessment.ec.main ? `${Math.round(day.assessment.ec.main.maskMean)}%` : '—'}</b></div><div><span>降水</span><b>${day.rain == null ? '—' : `${day.rain.toFixed(1)} mm`}</b></div><div><span>风速</span><b>${day.wind == null ? '—' : `${Math.round(day.wind)} km/h`}</b></div><p>${consistency.description}</p>${cloudCurves[day.date] ? `<div class="cloud-curve-wrap"><div class="cloud-curve-head"><span>当天逐小时低云 · 中云 · 降雨量</span><small>1 小时间隔 · ${cloudCurves[day.date].length} 点 · 综合预报</small></div><div class="cloud-scroll"><div class="cloud-chart" data-cloud-chart data-date="${day.date}" tabindex="0" role="application" aria-label="当天逐小时低云、中云与降雨量图，左右方向键移动准星">${renderCloudCurve(cloudCurves[day.date])}<div class="cloud-crosshair" aria-hidden="true"></div><div class="cloud-tooltip" role="status"></div></div></div><p class="cloud-note">低云与中云按百分比（左轴），降雨量为柱状（高度按当天最大值归一化），悬停或点击查看精确数值；横向滚动查看全部时段。</p><div class="cloud-curve-legend"><span class="legend-low">低云</span><span class="legend-mid">中云</span><span class="legend-precip">降雨量</span></div></div>` : ''}</div>` : ''}
      </article>`;
    }).join('')}</div></section>`;
}

function renderMarineCards(marine, destination) {
  if (!marine || marine.error || !marine.daily?.time?.length) return '';
  const cards = marine.daily.time.map((date, index) => {
    const wave = marine.daily.wave_height_max[index];
    if (wave == null) return '';
    const state = wave < 0.5 ? '平静' : wave < 1.25 ? '轻浪' : wave < 2.5 ? '中浪' : '大浪';
    return `<div class="marine-item"><span>${dateLabel(date)}</span><strong>${state}</strong><b>${wave.toFixed(1)} m</b></div>`;
  }).join('');
  return cards ? `<section class="marine-section"><div class="section-heading"><p class="section-kicker">NEARSHORE</p><h2>近海海况</h2></div><div class="marine-list">${cards}</div><p class="section-note">海况是海洋网格模式指导，乘船、潜水与浮潜请以当天码头和景区通知为准。</p></section>` : '';
}

// ---- 主入口：EC 主结论 → EC 晴好率与成员一致性 → 天空剖面 → 外部模型验证 → 逐日判断与海况 ----
// 目的地名称可能来自外部地理编码服务，统一转义后再进入模板（防 XSS）
function escapeText(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function renderWeatherApp(bundle, destination, requestedDays, selectedDate, ui = {}) {
  destination = { ...destination, name: escapeText(destination.name) };
  const forecast = bundle?.forecast;
  if (!forecast || forecast.error || !forecast.daily?.time?.length) return `<div class="error-card"><strong>暂时无法生成旅行判断</strong><p>${forecast?.error || '未返回综合预报数据，请稍后重试。'}</p></div>`;
  const dates = forecast.daily.time;
  const assessments = Metrics.buildAssessment(bundle.ensembles, bundle.deterministic, dates);
  const cloudSeries = Metrics.buildCloudSeries(bundle.deterministic['ECMWF IFS'], forecast, dates);
  const days = dates.map((date, index) => ({ ...dailyData(forecast, index), assessment: assessments[date], iconCodes: hourlyCodesFor(forecast, date) }));
  const cloudCurves = Object.fromEntries(dates.map((date) => [date, cloudCurve(forecast, date)]));
  const currentDate = days.some((day) => day.date === selectedDate) ? selectedDate : days[0].date;
  const selected = days.find((day) => day.date === currentDate);
  const skyView = ui.skyView === 'forecast' ? 'forecast' : 'ec';
  const skyIndex = ui.skyIndex;
  const farNotice = requestedDays > 7 ? '<p class="notice">第 8 天及以后仅适合作趋势参考，临近出行请再次更新。</p>' : '';
  const regionNotice = destination.outOfRegion ? '<p class="notice">该地点不在海南范围内，预报数据仅供参考，出行请以当地气象台通知为准。</p>' : '';
  return `${regionNotice}${farNotice}${renderDayRail(days, currentDate)}${renderEcHero(selected, selected.assessment, destination)}${renderEcMetrics(selected.assessment)}${renderSkySection(cloudSeries, dates, skyView, skyIndex)}${renderCrossModel(selected.assessment)}${renderForecastCards(days, currentDate, cloudCurves)}${renderMarineCards(bundle.marine, destination)}`;
}
