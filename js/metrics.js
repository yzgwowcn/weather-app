// 晴好指标：以 ECMWF（EC）为主判断来源。
// 北京时间 08:00–18:00 口径：
//   - 出行条件 = 日间无"中雨及以上"时段（61/63/65/80/81/82）且遮蔽云量严格 <75% 且最大风速严格 <30 km/h；
//   - 遮蔽云量 = 低云均值 × 60% + 中云均值 × 40%（低云与中云对天色影响最大，高云仅供参考；海边/山区通用）；
//   - 雷阵雨（95/96/99）不阻断出行，但输出注意时段（合并连续雷雨小时）；
//   - EC 晴好率 = EC 集合（控制 + 50 扰动成员）按同一口径满足条件的比例；
//   - EC 主运行单独给出"适合 / 不适合"结论；
//   - GFS、JMA、CMA 仅作外部模型验证（分歧提示），不再与 EC 等权。
const Metrics = (() => {
  const DAY_START = 8;
  const DAY_END = 18;
  const THRESHOLDS = { lowMidCloud: 75, wind: 30, gustAlert: 40 };
  const LOW_WEIGHT = 0.6;
  const MID_WEIGHT = 0.4;
  // 中雨及以上（持续降水）：任一小时出现即阻断出行
  const BLOCKING_CODES = new Set([61, 63, 65, 80, 81, 82]);
  // 雷阵雨：不阻断，但提示注意时段
  const THUNDER_CODES = new Set([95, 96, 99]);
  const EXTERNAL_MODELS = ['NOAA GFS', 'JMA GSM', 'CMA GRAPES'];
  const EC_MAIN_NAME = 'ECMWF IFS';
  const EC_ENSEMBLE_NAME = 'ECMWF IFS 集合';
  // 成员一致性的概率集中区间（%）
  const ZONES = { high: 75, low: 25 };

  function dateFromTime(value) { return String(value).slice(0, 10); }
  function hourFromTime(value) { return Number(String(value).slice(11, 13)); }
  // 仅日间（08:00–18:00）索引分组
  function dayIndexes(hourly) {
    const groups = {};
    if (!hourly || !hourly.time) return groups;
    hourly.time.forEach((time, index) => {
      const hour = hourFromTime(time);
      if (hour >= DAY_START && hour < DAY_END) (groups[dateFromTime(time)] ||= []).push(index);
    });
    return groups;
  }
  // 全天 0–23 时索引分组（用于云图小时精度时间轴）
  function allDayIndexes(hourly) {
    const groups = {};
    if (!hourly || !hourly.time) return groups;
    hourly.time.forEach((time, index) => (groups[dateFromTime(time)] ||= []).push(index));
    return groups;
  }
  function toNumber(value) { return value == null ? null : Number(value); }
  function mean(values) {
    const finite = values.filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
  }
  function max(values) {
    const finite = values.filter(Number.isFinite);
    return finite.length ? Math.max(...finite) : null;
  }
  function maskOf(low, mid) {
    if (low == null || mid == null) return null;
    return low * LOW_WEIGHT + mid * MID_WEIGHT;
  }
  // 将连续小时合并为时段（如 [13,14,15] → [[13,15]]）
  function mergeHourRanges(hours) {
    const sorted = [...hours].sort((a, b) => a - b);
    const ranges = [];
    let start = null;
    let prev = null;
    sorted.forEach((hour) => {
      if (start == null) { start = hour; prev = hour; return; }
      if (hour === prev + 1) { prev = hour; return; }
      ranges.push([start, prev]);
      start = hour;
      prev = hour;
    });
    if (start != null) ranges.push([start, prev]);
    return ranges;
  }
  // 评估单日单源（控制成员 / 扰动成员 / 确定性运行）：返回晴好结论、天气码判定与分层云聚合。
  function evaluate(values) {
    const low = mean(values.low);
    const mid = mean(values.mid);
    const high = mean(values.high);
    const precipitationSum = values.precipitation.filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
    const windMean = mean(values.wind);
    const windMax = max(values.wind);
    const gustMax = max(values.gusts);
    if (low == null || mid == null || values.precipitation.filter(Number.isFinite).length < 6 || windMean == null) return null;
    const maskMean = maskOf(low, mid);
    // 天气码判定：weather_code 缺失时降级为不阻断（仅按云量与风判定）
    const codes = values.weatherCode.filter(Number.isFinite).map(Number);
    const blocked = codes.some((code) => BLOCKING_CODES.has(code));
    const thunderWindows = codes.length
      ? mergeHourRanges(values.hours.filter((_, index) => THUNDER_CODES.has(codes[index])))
      : [];
    // 短时大阵风提醒时段（日间阵风 ≥ 40 km/h 的连续时段，不参与出行判断）
    const gustWindows = values.gusts.length
      ? mergeHourRanges(values.hours.filter((_, index) => values.gusts[index] >= THRESHOLDS.gustAlert))
      : [];
    return {
      lowMean: low,
      midMean: mid,
      highMean: high,
      maskMean,
      precipitationSum,
      windMean,
      windMax,
      gustMax,
      gustWindows,
      blocked,
      thunderWindows,
      suitable: !blocked && maskMean < THRESHOLDS.lowMidCloud && windMean < THRESHOLDS.wind,
    };
  }
  function valuesForMember(hourly, indexes, suffix = '') {
    const key = (name) => `${name}${suffix}`;
    return {
      low: indexes.map((index) => toNumber(hourly[key('cloud_cover_low')]?.[index])),
      mid: indexes.map((index) => toNumber(hourly[key('cloud_cover_mid')]?.[index])),
      high: indexes.map((index) => toNumber(hourly[key('cloud_cover_high')]?.[index])),
      precipitation: indexes.map((index) => toNumber(hourly[key('precipitation')]?.[index])),
      wind: indexes.map((index) => toNumber(hourly[key('wind_speed_10m')]?.[index])),
      gusts: indexes.map((index) => toNumber(hourly[key('wind_gusts_10m')]?.[index])),
      weatherCode: indexes.map((index) => toNumber(hourly[key('weather_code')]?.[index])),
      hours: indexes.map((index) => hourFromTime(hourly.time[index])),
    };
  }
  // 从响应中推导可用成员后缀：''（控制成员）＋ '_memberNN'（扰动成员）
  function memberSuffixes(hourly) {
    const cloudMembers = Object.keys(hourly || {}).filter((key) => key.startsWith('cloud_cover_low_member'));
    const suffixes = [''].concat(cloudMembers.map((key) => key.slice('cloud_cover_low'.length)));
    return suffixes.filter((suffix) =>
      hourly[`cloud_cover_low${suffix}`] && hourly[`cloud_cover_mid${suffix}`] &&
      hourly[`cloud_cover_high${suffix}`] && hourly[`precipitation${suffix}`] && hourly[`wind_speed_10m${suffix}`]);
  }
  // 集合响应的日级晴好率：满足条件的成员比例
  function ensembleDaily(response) {
    if (!response || response.error || !response.hourly) return { error: response?.error || '未返回集合数据', days: {} };
    const groups = dayIndexes(response.hourly);
    const suffixes = memberSuffixes(response.hourly);
    const days = {};
    Object.entries(groups).forEach(([date, indexes]) => {
      const members = suffixes.map((suffix) => evaluate(valuesForMember(response.hourly, indexes, suffix))).filter(Boolean);
      if (!members.length) return;
      const suitable = members.filter((member) => member.suitable).length;
      days[date] = { probability: suitable / members.length * 100, total: members.length, suitable, members };
    });
    return { days };
  }
  // 确定性响应的日级结论（EC 主运行、外部模型共用）
  function deterministicDaily(response) {
    if (!response || response.error || !response.hourly) return { error: response?.error || '未返回模型数据', days: {} };
    const days = {};
    Object.entries(dayIndexes(response.hourly)).forEach(([date, indexes]) => {
      const result = evaluate(valuesForMember(response.hourly, indexes));
      if (result) days[date] = result;
    });
    return { days };
  }
  // EC 成员一致性：集合晴好率是否集中于高/低区间，以及主运行方向是否一致
  function memberConsistency(ecEnsemble, ecMain) {
    if (!ecEnsemble) {
      return { level: 'unavailable', text: '成员数据缺失', description: 'EC 成员数据没拿到，暂时无法判断大家看法是否一致，请稍后重试。' };
    }
    const p = ecEnsemble.probability;
    const highZone = p >= ZONES.high;
    const lowZone = p <= ZONES.low;
    if (highZone || lowZone) {
      if (!ecMain) return { level: 'medium', text: '主运行缺失', description: highZone ? '多数 EC 成员看好晴好，但主运行数据没拿到，建议稍后复核。' : '多数 EC 成员不看好晴好，但主运行数据没拿到，建议稍后复核。' };
      if ((highZone && ecMain.suitable) || (lowZone && !ecMain.suitable)) {
        return { level: 'high', text: 'EC 内部一致', description: highZone ? '多数 EC 成员都看好晴好，主运行也给出同样方向。' : '多数 EC 成员都不看好晴好，主运行方向一致。' };
      }
      return { level: 'low', text: '主运行与集合相反', description: highZone ? 'EC 成员大多看好晴好，但主运行看法相反，建议按保守判断。' : 'EC 成员大多不看好，但主运行给出适合结论，建议临近再确认。' };
    }
    return { level: 'medium', text: 'EC 内部有分歧', description: 'EC 成员看法分歧较大，晴好与否还不确定，建议临近出行再确认。' };
  }
  // 外部模型验证：GFS / JMA / CMA 对 EC 主方向的支持数、反对数与缺失来源。
  // 这是模型分歧提示，不是历史准确率证明。
  function externalVerdict(ecMain, modelSources, date) {
    const direction = ecMain ? ecMain.suitable : null;
    if (direction == null) {
      return { support: 0, oppose: 0, missing: [...EXTERNAL_MODELS], direction: null, note: 'EC 主运行缺失，无法进行外部验证。' };
    }
    let support = 0;
    let oppose = 0;
    const missing = [];
    EXTERNAL_MODELS.forEach((name) => {
      const source = modelSources.find((item) => item.name === name);
      const day = source && !source.error ? source.days[date] : null;
      if (!day) { missing.push(name); return; }
      if (day.suitable === direction) support += 1; else oppose += 1;
    });
    return { support, oppose, missing, direction, note: null };
  }
  // 天气状态机：以选中日的 EC 主运行数据驱动。页面底色恒为暖光晴底，
  // 各状态仅决定叠加氛围层；雷阵雨优先（晴雨结合 + 闪电）。
  function moodFor(ecMain) {
    if (!ecMain) return { mood: 'neutral', label: '数据待补充' };
    const thunder = ecMain.thunderWindows.length > 0;
    const rainy = ecMain.blocked;
    const windy = ecMain.windMean >= THRESHOLDS.wind;
    if (thunder) return { mood: 'thunder', label: '雷阵雨' };
    if (rainy && windy) return { mood: 'storm', label: '风雨' };
    if (rainy) return { mood: 'rain', label: '雨' };
    if (windy) return { mood: 'windy', label: '大风' };
    if (ecMain.maskMean >= THRESHOLDS.lowMidCloud) return { mood: 'cloudy', label: '多云' };
    return { mood: 'sunny', label: '晴' };
  }
  function buildAssessment(ensembleResponses, deterministicResponses, dates) {
    const ensembleSources = Object.entries(ensembleResponses).map(([name, response]) => ({ name, ...ensembleDaily(response) }));
    const modelSources = Object.entries(deterministicResponses).map(([name, response]) => ({ name, ...deterministicDaily(response) }));
    const ecMainSource = modelSources.find((source) => source.name === EC_MAIN_NAME);
    const ecEnsembleSource = ensembleSources.find((source) => source.name === EC_ENSEMBLE_NAME);
    return dates.reduce((all, date, index) => {
      const ecMain = ecMainSource && !ecMainSource.error ? ecMainSource.days[date] || null : null;
      const ecEnsemble = ecEnsembleSource && !ecEnsembleSource.error ? ecEnsembleSource.days[date] || null : null;
      const ensemble = ensembleSources.filter((source) => source.days[date]).map((source) => ({ name: source.name, ...source.days[date] }));
      const deterministic = modelSources.filter((source) => source.days[date]).map((source) => ({ name: source.name, ...source.days[date] }));
      const probability = ecEnsemble ? ecEnsemble.probability : null;
      // 集合反超：主运行不适合但 EC 集合晴好率 ≥75% 时依旧建议出行（主运行为少数派）
      const finalSuitable = ecMain ? (ecMain.suitable || (probability != null && probability >= 75)) : null;
      // 出行建议分级（确定性 vs 集合判读 + 预报时效），horizon = 距今天数
      const advice = travelAdvice({ main: ecMain, probability, horizon: index });
      all[date] = {
        date,
        probability,
        finalSuitable,
        advice,
        ec: { main: ecMain, ensemble: ecEnsemble, memberConsistency: memberConsistency(ecEnsemble, ecMain) },
        crossModel: externalVerdict(ecMain, modelSources, date),
        weatherMood: moodFor(ecMain),
        ensemble,
        deterministic,
        missingSources: [...ensembleSources, ...modelSources].filter((source) => source.error).map((source) => source.name),
      };
      return all;
    }, {});
  }
  // 云图小时序列：EC 确定性（默认视图）与综合预报（参考视图）各一条，全天 0–23 时精度。
  function cloudSeriesFor(response, dates) {
    if (!response || response.error || !response.hourly) return { source: response?.source || null, days: {} };
    const days = {};
    Object.entries(allDayIndexes(response.hourly)).forEach(([date, indexes]) => {
      if (!dates.includes(date)) return;
      days[date] = { points: indexes.map((index) => {
        const low = toNumber(response.hourly.cloud_cover_low?.[index]);
        const mid = toNumber(response.hourly.cloud_cover_mid?.[index]);
        return {
          time: response.hourly.time[index],
          hour: hourFromTime(response.hourly.time[index]),
          low,
          mid,
          high: toNumber(response.hourly.cloud_cover_high?.[index]),
          mask: maskOf(low, mid),
          precipitation: toNumber(response.hourly.precipitation?.[index]),
          wind: toNumber(response.hourly.wind_speed_10m?.[index]),
        };
      }) };
    });
    return { source: response.source, days };
  }
  function buildCloudSeries(ecResponse, forecastResponse, dates) {
    return {
      ec: cloudSeriesFor(ecResponse, dates),
      forecast: cloudSeriesFor(forecastResponse, dates),
    };
  }
  function buildGlassSeaForecast(forecastResponse, marineResponse, dates) {
    if (typeof GlassSea === 'undefined') return Object.fromEntries(dates.map((date) => [date, { level: 'unavailable', windows: [], availableHours: 0 }]));
    return GlassSea.build(forecastResponse?.hourly, marineResponse?.hourly, dates);
  }
  function formatPercent(value) { return value == null ? '—' : `${Math.round(value)}%`; }
  // 雷暴强度 0–1：决定闪电频率与质感（晴天短时雷雨低、阴雨长雷暴高）。
  // 由雷雨窗口覆盖小时数、遮蔽云量、累计降水与天气码加权合成。
  function thunderIntensity(day, main) {
    if (!main || !main.thunderWindows || !main.thunderWindows.length) return 0;
    const hours = main.thunderWindows.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
    const lengthFactor = Math.min(1, hours / 8);
    const cloudFactor = main.maskMean == null ? 0.5 : Math.min(1, Math.max(0.3, main.maskMean / 75));
    const rainFactor = main.precipitationSum == null ? 0.5 : Math.min(1, Math.max(0.4, main.precipitationSum / 10));
    const codeFactor = day.code >= 99 ? 1 : day.code >= 96 ? 0.9 : 0.75;
    return Math.min(1, lengthFactor * 0.55 + cloudFactor * 0.25 + rainFactor * 0.1 + codeFactor * 0.1);
  }
  // 出行建议分级：结合 ECMWF 确定性主运行与 ENS 集合概率分布（参照确定性 vs 集合的判读规则）：
  //  - 主运行 = 一个具体情景，集合 = 该情景的可信度；主运行与多数成员一致 → 可信度高；
  //  - 主运行是集合离群值 → 以集合概率为主，不采信确定性细节；
  //  - 集合自身分阵营（晴好率接近 50%）→ 低可预报性，应按概率理解而非平均云量；
  //  - 时效：0–48 h 主运行仍较可信；48 h 后主运行与集合冲突时偏向集合；5 天以后基本按概率/情景看。
  // horizon：距今天数（0 = 今天）。返回 { level, text, note }，level ∈ recommended/suitable/caution/watch/avoid/none。
  function travelAdvice({ main, probability, horizon }) {
    if (!main) return { level: 'none', text: '数据待补充', note: 'EC 主运行暂未返回，稍后重试，或先参考综合预报。' };
    const p = probability;
    const near = horizon <= 1;              // 0–48 h
    const far = horizon >= 5;               // 120 h+
    const pct = p == null ? '—' : `${Math.round(p)}%`;
    if (main.suitable) {
      if (p != null && p >= 75) return { level: 'recommended', text: '推荐出行', note: `主运行与集合多数成员一致（晴好率 ${pct}），把握较大。` };
      if (p != null && p >= 50) {
        if (near) return { level: 'suitable', text: '适合出行', note: '近两天主运行适合且集合过半支持；临近可结合卫星实况、雷达再确认。' };
        return { level: 'caution', text: '审慎出行', note: `主运行适合但集合支持仅 ${pct}，中远期细节应按概率/情景看，具体小时与云带边缘别太较真。` };
      }
      if (p != null) {
        if (near) return { level: 'caution', text: '审慎出行', note: `主运行适合但集合多数成员不看好（晴好率仅 ${pct}）；0–24 h 主运行仍较可信，建议结合实况确认。` };
        return { level: 'watch', text: '关注后续预报', note: `主运行是集合少数派（晴好率仅 ${pct}），不宜按确定性结论出行；以集合概率为主，关注临近起报。` };
      }
      if (near) return { level: 'suitable', text: '适合出行', note: '集合数据暂缺；近两天主运行判断仍可参考，出行前再看一眼实况更稳妥。' };
      return { level: 'caution', text: '审慎出行', note: '集合数据暂缺，主运行单看远期可信度有限，建议关注后续预报再定。' };
    }
    if (p != null && p >= 75) return { level: 'suitable', text: '适合出行', note: `集合晴好率 ${pct} 反超主运行（主运行为少数派），以集合为准；分歧仍在，出行前可再确认。` };
    if (p != null && p >= 50) return { level: 'caution', text: '审慎出行', note: `主运行不适合，但集合有 ${pct} 成员看好，两方分歧较大；建议临近再确认，或按保守判断。` };
    if (near) return { level: 'avoid', text: '不建议出行', note: p == null ? '主运行不适合且集合数据暂缺，不建议按当前预报出行。' : `主运行不适合，集合多数成员也不看好（晴好率仅 ${pct}）。` };
    return { level: 'watch', text: '关注后续预报', note: p == null ? '主运行不适合且集合数据暂缺，远期变化大，建议关注后续起报。' : `主运行与集合多数成员都不看好（晴好率仅 ${pct}），远期仍可关注临近更新。` };
  }
  return { THRESHOLDS, buildAssessment, buildCloudSeries, buildGlassSeaForecast, formatPercent, thunderIntensity, travelAdvice };
})();
