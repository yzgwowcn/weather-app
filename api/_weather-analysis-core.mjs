// DeepSeek 天气分析的纯函数核心：预设点白名单、ECMWF 数据聚合、规则结论与输出校验。
// 服务端只接收 presetId；坐标和判断口径均以本文件为准，避免客户端伪造数据污染共享缓存。

export const ANALYSIS_VERSION = 'weather-v2';
export const DEEPSEEK_MODEL_DEFAULT = 'deepseek-v4-flash';
export const MODEL_META_URL = 'https://api.open-meteo.com/data/ecmwf_ifs025/static/meta.json';

export const PRESETS = Object.freeze({
  sanya: { name: '三亚·亚龙湾', lat: 18.224, lon: 109.512, region: 'hainan' },
  lingshui: { name: '陵水·清水湾', lat: 18.5, lon: 110.03, region: 'hainan' },
  haitang: { name: '海棠湾·蜈支洲岛', lat: 18.31, lon: 109.73, region: 'hainan' },
  wanning: { name: '万宁·神州半岛', lat: 18.8, lon: 110.39, region: 'hainan' },
  houhai: { name: '后海·分界洲岛', lat: 18.3, lon: 109.72, region: 'hainan' },
  chengdu: { name: '成都·市区', lat: 30.657, lon: 104.065, region: 'sichuan' },
  'jiang-an': { name: '四川大学·江安校区', lat: 30.577, lon: 103.982, region: 'sichuan' },
  wangjiang: { name: '四川大学·望江校区', lat: 30.632, lon: 104.084, region: 'sichuan' },
  leshan: { name: '乐山·乐山大佛', lat: 29.545, lon: 103.769, region: 'sichuan' },
  emeishan: { name: '峨眉山', lat: 29.601, lon: 103.484, region: 'sichuan' },
  jiuzhaigou: { name: '九寨沟', lat: 33.262, lon: 103.918, region: 'sichuan' },
  dujiangyan: { name: '都江堰', lat: 31.007, lon: 103.619, region: 'sichuan' },
});

const DAY_START = 8;
const DAY_END = 18;
const BLOCKING_CODES = new Set([61, 63, 65, 80, 81, 82]);
const THUNDER_CODES = new Set([95, 96, 99]);
const HOURLY = 'weather_code,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation,wind_speed_10m';

function finite(value) {
  const n = value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(values) {
  const list = values.filter(Number.isFinite);
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
}

function datePart(value) { return String(value).slice(0, 10); }
function hourPart(value) { return Number(String(value).slice(11, 13)); }

function dayGroups(hourly) {
  const groups = {};
  for (let index = 0; index < (hourly?.time || []).length; index += 1) {
    const time = hourly.time[index];
    const hour = hourPart(time);
    if (hour >= DAY_START && hour < DAY_END) (groups[datePart(time)] ||= []).push(index);
  }
  return groups;
}

function memberSuffixes(hourly) {
  const suffixes = [''].concat(Object.keys(hourly || {})
    .filter((key) => key.startsWith('cloud_cover_low_member'))
    .map((key) => key.slice('cloud_cover_low'.length)));
  return suffixes.filter((suffix) =>
    hourly[`cloud_cover_low${suffix}`] && hourly[`cloud_cover_mid${suffix}`] &&
    hourly[`cloud_cover_high${suffix}`] && hourly[`precipitation${suffix}`] &&
    hourly[`wind_speed_10m${suffix}`]);
}

function mergeHours(hours) {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const ranges = [];
  for (const hour of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && hour === last[1] + 1) last[1] = hour;
    else ranges.push([hour, hour]);
  }
  return ranges;
}

function evaluate(hourly, indexes, suffix = '') {
  const read = (key) => indexes.map((index) => finite(hourly[`${key}${suffix}`]?.[index]));
  const low = mean(read('cloud_cover_low'));
  const mid = mean(read('cloud_cover_mid'));
  const high = mean(read('cloud_cover_high'));
  const precipitation = read('precipitation').filter(Number.isFinite);
  const wind = read('wind_speed_10m');
  const codes = read('weather_code');
  if (low == null || mid == null || precipitation.length < 6 || mean(wind) == null) return null;
  const maskMean = low * 0.6 + mid * 0.4;
  const windMean = mean(wind);
  const blocked = codes.some((code) => BLOCKING_CODES.has(code));
  const thunderHours = indexes
    .filter((_, i) => THUNDER_CODES.has(codes[i]))
    .map((index) => hourPart(hourly.time[index]));
  return {
    maskMean,
    highMean: high,
    precipitationSum: precipitation.reduce((sum, value) => sum + value, 0),
    windMean,
    blocked,
    thunderWindows: mergeHours(thunderHours),
    suitable: !blocked && maskMean < 75 && windMean < 30,
  };
}

function adviceFor(main, probability, horizon) {
  if (!main) return { level: 'none', text: '数据待补充', finalSuitable: null };
  const near = horizon <= 1;
  if (main.suitable) {
    if (probability != null && probability >= 75) return { level: 'recommended', text: '推荐出行', finalSuitable: true };
    if (probability != null && probability >= 50) return { level: near ? 'suitable' : 'caution', text: near ? '适合出行' : '审慎出行', finalSuitable: true };
    if (probability != null) return { level: near ? 'caution' : 'watch', text: near ? '审慎出行' : '关注后续预报', finalSuitable: true };
    return { level: near ? 'suitable' : 'caution', text: near ? '适合出行' : '审慎出行', finalSuitable: true };
  }
  if (probability != null && probability >= 75) return { level: 'suitable', text: '适合出行', finalSuitable: true };
  if (probability != null && probability >= 50) return { level: 'caution', text: '审慎出行', finalSuitable: false };
  return { level: near ? 'avoid' : 'watch', text: near ? '不建议出行' : '关注后续预报', finalSuitable: false };
}

export function summarizeWeather(mainResponse, ensembleResponse) {
  if (!mainResponse?.hourly || !ensembleResponse?.hourly) throw new Error('EC_DATA_INCOMPLETE');
  const mainGroups = dayGroups(mainResponse.hourly);
  const ensembleGroups = dayGroups(ensembleResponse.hourly);
  const suffixes = memberSuffixes(ensembleResponse.hourly);
  if (suffixes.length < 2) throw new Error('EC_ENSEMBLE_INCOMPLETE');
  const days = Object.keys(mainGroups).sort().map((date, horizon) => {
    const main = evaluate(mainResponse.hourly, mainGroups[date]);
    const memberIndexes = ensembleGroups[date];
    const members = memberIndexes ? suffixes.map((suffix) => evaluate(ensembleResponse.hourly, memberIndexes, suffix)).filter(Boolean) : [];
    const suitableMembers = members.filter((member) => member.suitable).length;
    const probability = members.length ? suitableMembers / members.length * 100 : null;
    const advice = adviceFor(main, probability, horizon);
    const mainOpposed = main && probability != null &&
      ((probability >= 75 && !main.suitable) || (probability <= 25 && main.suitable));
    const membersSplit = probability != null && probability > 25 && probability < 75;
    return {
      date,
      horizon,
      verdict: advice.text,
      verdictLevel: advice.level,
      finalSuitable: advice.finalSuitable,
      mainSuitable: main?.suitable ?? null,
      maskMean: main?.maskMean == null ? null : Math.round(main.maskMean),
      highCloudMean: main?.highMean == null ? null : Math.round(main.highMean),
      precipitationMm: main?.precipitationSum == null ? null : Number(main.precipitationSum.toFixed(1)),
      windKmh: main?.windMean == null ? null : Math.round(main.windMean),
      blockingRain: main?.blocked ?? null,
      thunderWindows: main?.thunderWindows || [],
      ensembleProbability: probability == null ? null : Math.round(probability),
      ensembleSuitable: suitableMembers,
      ensembleTotal: members.length,
      mainEnsembleConflict: main && probability != null ? main.suitable !== (probability >= 50) : null,
      // 只在确有冲突时携带短标记，避免一致日期增加提示词 token。
      ecDisagreement: mainOpposed ? 'main_opposed' : membersSplit ? 'members_split' : undefined,
    };
  }).filter((day) => day.mainSuitable != null && day.ensembleTotal > 0);
  // 不理想日期预先标出最近一个规则结论更好的备选日，模型无需自行扫描和复述整段数据。
  days.forEach((day, index) => {
    const poor = ['caution', 'watch', 'avoid'].includes(day.verdictLevel);
    const better = poor ? days.slice(index + 1).find((candidate) =>
      ['recommended', 'suitable'].includes(candidate.verdictLevel)) : null;
    day.nextBetterDate = better?.date || null;
    day.nextBetterVerdict = better?.verdict || null;
  });
  return days;
}

export function shanghaiDateRange(now = new Date(), days = 14) {
  const start = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + days - 1);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

export function weatherUrls(preset, start, end) {
  const base = { latitude: preset.lat, longitude: preset.lon, start_date: start, end_date: end, timezone: 'Asia/Shanghai', hourly: HOURLY };
  const main = new URL('https://api.open-meteo.com/v1/ecmwf');
  Object.entries(base).forEach(([key, value]) => main.searchParams.set(key, String(value)));
  const ensemble = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
  Object.entries({ ...base, models: 'ecmwf_ifs025' }).forEach(([key, value]) => ensemble.searchParams.set(key, String(value)));
  return { main: main.toString(), ensemble: ensemble.toString() };
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text && text.length <= max ? text : null;
}

export function validateAnalyses(payload, expectedDates) {
  const source = payload && Array.isArray(payload.analyses) ? payload.analyses : null;
  if (!source) throw new Error('AI_INVALID_OUTPUT');
  const expected = new Set(expectedDates);
  const seen = new Set();
  const analyses = [];
  for (const item of source) {
    const date = typeof item?.date === 'string' ? item.date : '';
    const summary = cleanText(item?.summary, 80);
    const reason = cleanText(item?.reason, 180);
    const uncertainty = cleanText(item?.uncertainty, 140);
    const advice = cleanText(item?.advice, 140);
    if (!expected.has(date) || seen.has(date) || !summary || !reason || !uncertainty || !advice) continue;
    seen.add(date);
    analyses.push({ date, summary, reason, uncertainty, advice });
  }
  if (analyses.length !== expected.size) throw new Error('AI_INVALID_OUTPUT');
  return analyses.sort((a, b) => a.date.localeCompare(b.date));
}

export function deepSeekRequest(preset, modelVersion, days, model = DEEPSEEK_MODEL_DEFAULT) {
  const system = [
    '你是旅行天气解释器，只解释程序已经计算出的结论，不得改变 verdict、数值或安全口径。',
    '使用简洁自然的中文，面向普通游客。雷阵雨只是避雨提醒，不自动否定出行；中雨及以上、遮蔽云量和平均风速按输入结论解释。不要机械复述所有数字。',
    '按需控制详略：仅当 verdictLevel 为 caution/watch/avoid，或输入含 ecDisagreement 时展开；其余 recommended/suitable 保持精炼。展开时明确真正拖累出行的因素及数值、风险意味着什么，并给出可执行的改期/室内安排/临近复核建议。',
    'ecDisagreement=main_opposed 表示主运行与高度集中的集合方向相反；ecDisagreement=members_split 表示成员晴好率处于 25%–75% 分歧区。必须结合 mainSuitable、ensembleProbability 和最终 verdict 解释双方各自表达什么、程序为何给出当前结论，以及应按保守方案还是临近复核；不得把集合概率说成降雨概率或历史准确率。',
    '若不理想日期提供 nextBetterDate，只可把该日期作为备选并注明仍需临近更新；没有该字段时不得编造更好日期。除 thunderWindows 外，输入没有逐小时时段，不得编造降雨开始或结束时间。',
    '不得声称这是官方预警或历史准确率，不得编造输入中没有的天气、景区开放或交通信息。',
    '必须输出 json，格式为 {"analyses":[{"date":"YYYY-MM-DD","summary":"...","reason":"...","uncertainty":"...","advice":"..."}]}。',
    '每个输入日期必须恰好输出一项。无 ecDisagreement 的 recommended/suitable：summary≤35字、reason≤50字、uncertainty≤35字、advice≤35字；caution/watch/avoid 或含 ecDisagreement：summary≤55字、reason≤120字、uncertainty≤80字、advice≤90字。',
  ].join('\n');
  const user = JSON.stringify({ destination: preset.name, modelVersion, timezone: 'Asia/Shanghai', days });
  return {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    thinking: { type: 'disabled' },
    temperature: 0.2,
    max_tokens: 3800,
    response_format: { type: 'json_object' },
    stream: false,
  };
}
