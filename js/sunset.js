// 朝晚霞机会（纯规则，不引入 AI）：取 EC 主运行的分层云量、沿太阳方位的实况云量扫描、
// CAMS 气溶胶与综合预报的温湿/能见度，评估日落（晚霞）/ 日出（朝霞）被低角度阳光染色的机会。
//
// 判定链：
//   1. 云底高度：按低/中/高云带的典型高度选层，低云为主时用抬升凝结高度修正。
//   2. 云幕距离：沿太阳方位每 25–100 km 取一个点，读同一时刻的总云量，取第一片成片云的方位距离。
//   3. 光线几何：由云底高度算出低角度阳光能达到的最远水平距离，再结合视线到云幕的曲率落差
//      得到云幕高度角，判断本地头顶是否落在受照范围内。
//   4. 光学：气溶胶沿「光线最低点 → 云底」的直弦积分指数消光廓线，得到透过率与云面染色；
//      颜色用 380–720nm 光谱 × CIE 1931 配色函数积分后转 sRGB。
//   5. 时间窗：远处云幕先在日落前 X 分钟起被染色，本地云幕在日落后余晖 Y 分钟结束。
// 全部函数为纯函数，可被 Node 直接 require 做单测。
const Sunset = (() => {
  const EARTH_RADIUS_KM = 6371;
  const LAYER_CLOUD_MIN = 12;      // 某层云量 ≥12% 视为该层有云（与 ec-hero 的分层口径一致）
  const DAY_LIMIT = 3;             // 逐小时预报只取最近 3 天：更远的云场细节不可信
  const MAX_BOUNDARY_KM = 600;     // 太阳方位扫描的最大距离
  const MIN_BOUNDARY_KM = 25;
  const AOD_MIN = 0.01;
  const AOD_MAX = 1.5;
  const BLH_DEFAULT_KM = 1.5;      // 边界层高度缺失时的兜底值（同时作为气溶胶标高）
  const SUN_ANGLE_RATE_DEG_MIN = 0.25; // 中低纬太阳高度角变化率（°/分钟），用于余晖时长估算
  const OZONE_KAPPA_PER_KM = 0.012;
  const OZONE_SCALE_KM = 8;
  const AEROSOL_ANGSTROM = 1.3;
  const SUN_TEMP_K = 5500;
  const RAIN_WINDOW_HOURS = 1;     // 取霞光前后各 1 小时内的最强降水作为雨幕罚分依据（逐小时数据，窗口过宽会误伤）

  // 层云典型云底高度（km）与"适宜被染色"的权重：中云最容易出火烧云，低云挡光、高云偏薄
  const LAYER_INFO = {
    high: { km: 7.0, weight: 0.8, name: '高云' },
    mid: { km: 3.6, weight: 1.0, name: '中云' },
    low: { km: 1.1, weight: 0.4, name: '低云' },
  };
  // 分档：与 ui 的 .sunset-* 配色类一一对应
  const BANDS = [
    { min: 88, label: '极佳', level: 'epic' },
    { min: 75, label: '很好', level: 'great' },
    { min: 60, label: '一般', level: 'fair' },
    { min: 45, label: '偏弱', level: 'weak' },
    { min: 30, label: '较差', level: 'poor' },
    { min: 0, label: '很低', level: 'poor' },
  ];
  // 日落线（晨昏线）地面移动速度：纬度 0–60°（每 5°）× 月份查表，单位 km/min
  const LAT_BANDS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  const TERMINATOR_TABLE = [
    [21.6, 22.6, 23.2, 22.9, 21.9, 21.3, 21.6, 22.5, 23.1, 22.9, 22, 21.3],
    [21.5, 22.5, 23.1, 22.8, 21.8, 21.2, 21.4, 22.4, 23.1, 22.8, 21.9, 21.2],
    [21.2, 22.3, 22.8, 22.5, 21.6, 20.9, 21.2, 22.1, 22.8, 22.6, 21.6, 20.9],
    [20.8, 21.8, 22.4, 22.1, 21.1, 20.4, 20.7, 21.6, 22.3, 22.1, 21.2, 20.5],
    [20.1, 21.2, 21.8, 21.4, 20.4, 19.7, 20, 21, 21.7, 21.5, 20.5, 19.8],
    [19.3, 20.4, 21, 20.6, 19.6, 18.9, 19.1, 20.2, 21, 20.7, 19.7, 18.9],
    [18.3, 19.4, 20.1, 19.7, 18.6, 17.8, 18.1, 19.2, 20, 19.8, 18.7, 17.9],
    [17.1, 18.3, 19, 18.6, 17.4, 16.6, 16.9, 18.1, 18.9, 18.7, 17.6, 16.7],
    [15.7, 17.1, 17.8, 17.3, 16.1, 15.1, 15.5, 16.8, 17.7, 17.4, 16.2, 15.3],
    [14.2, 15.6, 16.4, 15.9, 14.5, 13.5, 13.9, 15.3, 16.3, 16.1, 14.7, 13.7],
    [12.4, 14.1, 14.9, 14.4, 12.8, 11.6, 12.1, 13.7, 14.8, 14.5, 13.1, 11.9],
    [10.5, 12.4, 13.3, 12.7, 10.9, 9.5, 10, 11.9, 13.2, 12.9, 11.2, 9.8],
    [8.2, 10.5, 11.6, 10.9, 8.7, 6.8, 7.6, 10, 11.5, 11.1, 9.1, 7.4],
  ];

  // ---- 小工具 ----
  function finite(value) {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function lerp(value, inMin, inMax, outMin, outMax) {
    const ratio = clamp((value - inMin) / (inMax - inMin || 1), 0, 1);
    return outMin + ratio * (outMax - outMin);
  }
  function datePart(value) { return String(value).slice(0, 10); }
  // 把 "YYYY-MM-DDTHH:mm" 换成与浏览器时区无关的分钟数，便于跨数组对齐时刻
  function minuteStamp(value) {
    const matched = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!matched) return null;
    return Date.UTC(+matched[1], +matched[2] - 1, +matched[3], +matched[4], +matched[5]) / 60000;
  }
  function nearestIndex(times, target) {
    if (!Array.isArray(times) || !times.length) return null;
    const wanted = minuteStamp(target);
    if (wanted == null) return null;
    let best = null;
    let bestGap = Infinity;
    for (let i = 0; i < times.length; i += 1) {
      const stamp = minuteStamp(times[i]);
      if (stamp == null) continue;
      const gap = Math.abs(stamp - wanted);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    return best;
  }
  // 在时刻上加减分钟，输出 "HH:mm"（跨午夜自动回绕）
  function shiftClock(value, offsetMin) {
    const matched = String(value).match(/T(\d{2}):(\d{2})/);
    if (!matched) return '—';
    let total = Number(matched[1]) * 60 + Number(matched[2]) + Math.round(offsetMin);
    total = ((total % 1440) + 1440) % 1440;
    const hour = Math.floor(total / 60);
    const minute = total % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  function clockLabel(value) {
    const matched = String(value).match(/T(\d{2}):(\d{2})/);
    return matched ? `${matched[1]}:${matched[2]}` : '—';
  }

  // ---- 云底高度 ----
  // 抬升凝结高度：125 m/℃ × (气温 − 露点)。只在低云为主时用于修正典型云底高度。
  function liftingCondensationKm(tempC, dewC) {
    if (tempC == null || dewC == null) return null;
    const spread = tempC - dewC;
    if (spread >= 0.2 && spread <= 25) return clamp(0.125 * spread, 0.6, 3.0);
    return null;
  }
  // 选"最可能被染色"的一层云：存在云量 ≥12% 的层里，取 云量 × 适宜权重 最大者
  function cloudBase(low, mid, high, tempC, dewC) {
    const layers = [
      { key: 'high', cover: high },
      { key: 'mid', cover: mid },
      { key: 'low', cover: low },
    ].filter((layer) => layer.cover != null && layer.cover >= LAYER_CLOUD_MIN);
    if (!layers.length) return { km: null, layer: 'none', name: '晴空', source: '三层云量均低于 12%' };
    layers.sort((a, b) => b.cover * LAYER_INFO[b.key].weight - a.cover * LAYER_INFO[a.key].weight);
    const picked = layers[0];
    const info = LAYER_INFO[picked.key];
    if (picked.key === 'low') {
      const lcl = liftingCondensationKm(tempC, dewC);
      if (lcl != null) return { km: Number(lcl.toFixed(2)), layer: 'low', name: info.name, source: '低云 + 抬升凝结高度' };
    }
    return { km: info.km, layer: picked.key, name: info.name, source: `分层云量 · ${info.name}带` };
  }

  // ---- 几何 ----
  // 高度 H 的云底能被低角度阳光照亮的最大水平距离
  function glowReachKm(heightKm) {
    if (heightKm == null || heightKm <= 0) return 0;
    return 2 * Math.sqrt(2 * EARTH_RADIUS_KM * heightKm);
  }
  // 太阳沉到该高度角以下时，高度 H 的云底失去光照
  function litSunAngleDeg(heightKm) {
    if (heightKm == null || heightKm <= 0) return 0;
    return Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + heightKm)) * 180 / Math.PI;
  }
  // 视线到云幕的曲率落差修正后的云幕高度角
  function boundaryElevationDeg(heightKm, distanceKm) {
    if (heightKm == null) return null;
    const distance = Math.max(distanceKm || 0, 0.5);
    return Math.atan((heightKm - (distance * distance) / (2 * EARTH_RADIUS_KM)) / distance) * 180 / Math.PI;
  }
  // 晨昏线地面移动速度（km/min）：13 个纬度档 × 12 个月查表，高纬用解析式兜底
  function terminatorSpeed(lat, monthIndex) {
    const latitude = finite(lat) ?? 18.2;
    const month = clamp(Math.round(finite(monthIndex) ?? new Date().getMonth()), 0, 11);
    if (Math.abs(latitude) > 60) {
      return EARTH_RADIUS_KM * (2 * Math.PI / 1440) * Math.cos(clamp(latitude, -66, 66) * Math.PI / 180) * 0.82;
    }
    const target = clamp(latitude, 0, 60);
    let row = 0;
    while (row < LAT_BANDS.length - 2 && LAT_BANDS[row + 1] < target) row += 1;
    const ratio = (target - LAT_BANDS[row]) / (LAT_BANDS[row + 1] - LAT_BANDS[row] || 1);
    const lower = TERMINATOR_TABLE[row][month];
    const upper = TERMINATOR_TABLE[row + 1][month];
    return lower + (upper - lower) * ratio;
  }
  // 太阳方位/高度角（低精度天文式，误差 <0.5°，足够定扫描方位与抬升速率）
  function solarAngles(instant, lat, lon) {
    const days = instant.getTime() / 86400000 + 2440587.5 - 2451545.0;
    const meanLon = ((280.46 + 0.9856474 * days) % 360 + 360) % 360;
    const anomaly = ((357.528 + 0.9856003 * days) % 360) * Math.PI / 180;
    const eclipticLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * Math.PI / 180;
    const obliquity = (23.439 - 0.0000004 * days) * Math.PI / 180;
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
    const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
    let hourAngle = ((280.46061837 + 360.98564736629 * days + lon) % 360 + 360) % 360 - rightAscension * 180 / Math.PI;
    hourAngle = ((hourAngle + 180) % 360 + 360) % 360 - 180;
    const phi = lat * Math.PI / 180;
    const h = hourAngle * Math.PI / 180;
    const sinElevation = Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(h);
    const elevation = Math.asin(clamp(sinElevation, -1, 1)) * 180 / Math.PI;
    const cosAzimuth = (Math.sin(declination) - Math.sin(phi) * sinElevation) / (Math.cos(phi) * Math.cos(elevation * Math.PI / 180));
    let azimuth = Math.acos(clamp(cosAzimuth, -1, 1)) * 180 / Math.PI;
    if (hourAngle > 0) azimuth = 360 - azimuth;
    return { elevation, azimuth };
  }
  // 北京时间（UTC+8）某日的第 N 分钟对应的 UTC 时刻
  function beijingInstant(dateISO, minuteOfDay) {
    const [year, month, day] = String(dateISO).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) + minuteOfDay * 60000 - 8 * 3600000);
  }
  // 该日日出/日落的当地分钟数（5 分钟粗扫 + 二分细化），用于确定扫描方位角
  function daylightMinutes(dateISO, lat, lon) {
    const elevationAt = (minute) => solarAngles(beijingInstant(dateISO, minute), lat, lon).elevation;
    const refine = (lowMinute, highMinute) => {
      let low = lowMinute;
      let high = highMinute;
      for (let i = 0; i < 12; i += 1) {
        const mid = (low + high) / 2;
        if ((elevationAt(low) < 0) === (elevationAt(mid) < 0)) low = mid;
        else high = mid;
      }
      return Math.round((low + high) / 2);
    };
    let sunrise = null;
    let sunset = null;
    let previous = elevationAt(0);
    for (let minute = 5; minute <= 1440; minute += 5) {
      const current = elevationAt(minute);
      if (previous < 0 && current >= 0 && sunrise == null) sunrise = refine(minute - 5, minute);
      if (previous >= 0 && current < 0) sunset = refine(minute - 5, minute);
      previous = current;
    }
    return { sunrise, sunset };
  }
  function minuteToClock(minute) {
    const total = ((Math.round(minute) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  // 日落/日出时刻（本地时钟字符串），API 缺字段时也可用
  function eventTimes(dateISO, lat, lon) {
    if (lat == null || lon == null) return { sunrise: null, sunset: null };
    const { sunrise, sunset } = daylightMinutes(dateISO, lat, lon);
    return {
      sunrise: sunrise == null ? null : `${dateISO}T${minuteToClock(sunrise)}`,
      sunset: sunset == null ? null : `${dateISO}T${minuteToClock(sunset)}`,
    };
  }
  // 沿太阳方位扫描所需的方位角：取首日的日落/日出太阳方位
  function scanBearings(destination, dates) {
    const lat = finite(destination && destination.lat);
    const lon = finite(destination && destination.lon);
    const date = (dates && dates[0]) || null;
    if (lat == null || lon == null || !date) return null;
    const { sunrise, sunset } = daylightMinutes(date, lat, lon);
    if (sunrise == null || sunset == null) return null;
    return {
      sunset: solarAngles(beijingInstant(date, sunset), lat, lon).azimuth,
      sunrise: solarAngles(beijingInstant(date, sunrise), lat, lon).azimuth,
    };
  }
  // 有无扫描数据时的兜底：按总云量粗略折算云幕距离
  function boundaryDistanceKm(totalCloud) {
    const cover = clamp(finite(totalCloud) ?? 0, 0, 100);
    return Math.round(MAX_BOUNDARY_KM - (cover / 100) * (MAX_BOUNDARY_KM - MIN_BOUNDARY_KM));
  }
  // 沿太阳方位的云量序列 → 第一片成片云的方位距离
  function boundaryFromScan(distances, covers) {
    if (!Array.isArray(distances) || !Array.isArray(covers) || !covers.length) return null;
    const last = distances[Math.min(covers.length, distances.length) - 1];
    const local = covers[0] ?? 0;
    if (local >= 50) {
      // 本地已在云下：向太阳方向找云幕散开的边缘
      const threshold = Math.max(20, local * 0.5);
      for (let i = 1; i < covers.length; i += 1) {
        if ((covers[i] ?? 0) < threshold) return distances[i];
      }
      return last;
    }
    // 本地少云：找朝太阳方向第一段连续的成片云
    for (let i = 1; i < covers.length; i += 1) {
      const current = covers[i] ?? 0;
      const next = i + 1 < covers.length ? covers[i + 1] ?? 0 : current;
      if (current >= 40 && next >= 40) return distances[i];
    }
    return last;
  }

  // ---- 光学与配色 ----
  // 能见度 → 气溶胶光学厚度（气溶胶实测缺失时的兜底：Koschmieder 消光系数 × 边界层厚度）
  function aodFromVisibility(visibilityM, boundaryLayerKm) {
    const km = finite(visibilityM);
    if (km == null || km <= 0) return null;
    const scale = finite(boundaryLayerKm) ?? BLH_DEFAULT_KM;
    return clamp((3.912 / Math.max(km / 1000, 0.5)) * scale, AOD_MIN, AOD_MAX);
  }
  // 大气通透度：AOD 越大越浑浊（1 → 几乎无衰减，0 → 严重浑浊）
  function clarityFromAod(aod) {
    return clamp(Math.exp(-1.8 * (finite(aod) ?? 0.3)), 0.05, 1);
  }
  // 误差函数（Abramowitz–Stegun 7.1.26 近似），用于指数廓线的直弦积分
  function erf(value) {
    const sign = Math.sign(value);
    const x = Math.abs(value);
    const t = 1 / (1 + 0.3275911 * x);
    const poly = 1 - (0.254829592 * t - 0.284496736 * t * t + 1.421413741 * t ** 3 - 1.453152027 * t ** 4 + 1.061405429 * t ** 5) * Math.exp(-x * x);
    return sign * poly;
  }
  // 沿「光线最低点 → 云底」直弦积分指数衰减廓线，得到该段光学厚度
  function slantOpticalDepth(kappaPerKm, scaleKm, bottomKm, cloudKm) {
    if (!(cloudKm > 0)) return 0;
    const chord = Math.sqrt(2 * EARTH_RADIUS_KM * Math.max(cloudKm - bottomKm, 0.001));
    return kappaPerKm * Math.exp(-bottomKm / scaleKm) * Math.sqrt(Math.PI * EARTH_RADIUS_KM * scaleKm / 2)
      * erf(chord / Math.sqrt(2 * EARTH_RADIUS_KM * scaleKm));
  }
  function gaussian(x, mu, sigmaLeft, sigmaRight) {
    const sigma = x < mu ? sigmaLeft : sigmaRight;
    const t = (x - mu) / sigma;
    return Math.exp(-0.5 * t * t);
  }
  // CIE 1931 配色函数的多峰高斯拟合（Wyman 2013 简化式）
  const CMF_X = (nm) => 1.056 * gaussian(nm, 599.8, 37.9, 31) + 0.362 * gaussian(nm, 442, 16, 26.7) - 0.065 * gaussian(nm, 501.1, 20.4, 26.2);
  const CMF_Y = (nm) => 0.821 * gaussian(nm, 568.8, 46.9, 40.5) + 0.286 * gaussian(nm, 530.9, 16.3, 31.1);
  const CMF_Z = (nm) => 1.217 * gaussian(nm, 437, 11.8, 36) + 0.681 * gaussian(nm, 459, 26, 13.8);
  // 5500K 黑体光谱（普朗克定律，只取相对形状）
  function planck(nm, tempK) {
    const lambda = nm * 1e-9;
    return 1 / Math.pow(lambda, 5) / (Math.exp(6.626e-34 * 3e8 / (lambda * 1.381e-23 * tempK)) - 1);
  }
  function toHex(r, g, b) {
    const channel = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
    return `#${channel(r)}${channel(g)}${channel(b)}`;
  }
  // 光谱 → XYZ → sRGB：瑞利项（λ^-4）与气溶胶项（λ^-1.3）分别消光后积分
  function spectralColor(ozoneTau, aerosolTau) {
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    for (let nm = 380; nm <= 720; nm += 5) {
      const rayleigh = ozoneTau * Math.pow(550 / nm, 4);
      const aerosol = aerosolTau * Math.pow(550 / nm, AEROSOL_ANGSTROM);
      const weight = planck(nm, SUN_TEMP_K) * Math.exp(-(rayleigh + aerosol));
      sumX += weight * CMF_X(nm);
      sumY += weight * CMF_Y(nm);
      sumZ += weight * CMF_Z(nm);
    }
    const transmittance = Math.exp(-(ozoneTau + aerosolTau));
    if (!(sumY > 0)) return { r: 96, g: 78, b: 80, hex: '#604e50', transmittance: 0 };
    const total = sumX + sumY + sumZ || 1;
    const x = sumX / total;
    const y = sumY / total;
    const aerosolShare = aerosolTau / (ozoneTau + aerosolTau + 1e-6);
    const desaturate = clamp(0.6 * aerosolShare, 0, 0.75);   // 气溶胶越多越向暖灰靠（闷烧）
    const brightness = clamp(0.3 + 0.7 * Math.pow(transmittance, 0.3), 0.18, 1);
    let r = 3.2406 * (x / y) - 1.5372 - 0.4986 * ((1 - x - y) / y);
    let g = -0.9689 * (x / y) + 1.8758 + 0.0415 * ((1 - x - y) / y);
    let b = 0.0557 * (x / y) - 0.204 + 1.057 * ((1 - x - y) / y);
    r = (r * (1 - desaturate) + 1 * desaturate) * brightness;
    g = (g * (1 - desaturate) + 0.92 * desaturate) * brightness;
    b = (b * (1 - desaturate) + 0.72 * desaturate) * brightness;
    const gamma = (value) => (value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(Math.max(value, 0), 1 / 2.4) - 0.055);
    const red = Math.round(clamp(gamma(r), 0, 1) * 255);
    const green = Math.round(clamp(gamma(g), 0, 1) * 255);
    const blue = Math.round(clamp(gamma(b), 0, 1) * 255);
    return { r: red, g: green, b: blue, hex: toHex(red, green, blue), transmittance };
  }
  // 色名直接由渲染出来的色块反推色相：显示的颜色与文字永远一致，不会出现"写着橘红、色块却是灰"的情况。
  // 亮度同样取自色块本身（同一条渲染链已经把透过率折算进亮度），因此不会出现数值爆掉的情况。
  function describeColor(rgb) {
    const r = clamp(rgb.r / 255, 0, 1);
    const g = clamp(rgb.g / 255, 0, 1);
    const b = clamp(rgb.b / 255, 0, 1);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    let hue = 0;
    if (delta !== 0) {
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    const tone = lightness >= 0.74 ? '明亮' : lightness >= 0.56 ? '柔和' : lightness >= 0.4 ? '偏暗' : '昏暗';
    if (saturation < 0.3) return { name: '灰白 · 无霞', tone };
    let name;
    if (hue >= 46) name = '淡金 · 金黄';
    else if (hue >= 33) name = '橘黄';
    else if (hue >= 23) name = '橘色';
    else if (hue >= 15) name = '橘红';
    else if (hue >= 9) name = '深橘红';
    else name = '绛红';
    return { name, tone };
  }

  // ---- 降雨罚分 ----
  // 霞光依赖低角度阳光穿过近地大气：本地雨幕直接挡光，光路上的雨幕会让色彩发闷。
  // 逐小时降水最小非零档就是 0.1 mm，这种量级的"有雨"挡不住太阳，按无有效降水处理。
  function rainPenaltyOf(peakMm, weatherCode) {
    const mm = finite(peakMm) ?? 0;
    const code = finite(weatherCode) ?? 0;
    const group = Math.floor(code / 10);
    if (mm <= 0.2) {
      // 无有效降水：天气码只作提示，不扣分
      return { penalty: 0, level: 'none', label: '无有效降水', peakMm: mm };
    }
    let penalty;
    let level;
    let label;
    if (mm < 0.6) { penalty = 8; level = 'light'; label = '毛毛雨'; }
    else if (mm < 2.5) { penalty = 22; level = 'light'; label = '小雨'; }
    else if (mm < 8) { penalty = 40; level = 'moderate'; label = '中雨'; }
    else if (mm < 16) { penalty = 55; level = 'heavy'; label = '大雨'; }
    else { penalty = 70; level = 'extreme'; label = '暴雨'; }
    if (group === 8) penalty *= 0.6;                                  // 阵雨间歇性：留出雨隙机会
    if (group === 9) { penalty = Math.max(penalty, 55); label = '雷雨'; }
    if (group === 7) { penalty = Math.max(penalty, 40); label = '降雪'; }
    return { penalty: clamp(Math.round(penalty), 0, 75), level, label, peakMm: mm };
  }

  // ---- 取数 ----
  // 云量取 EC 主运行（与全站"EC 主判断"口径一致），缺失时回退综合预报
  function pickCloudHourly(bundle) {
    const ec = bundle && bundle.deterministic && bundle.deterministic['ECMWF IFS'];
    if (ec && !ec.error && ec.hourly && Array.isArray(ec.hourly.time) && ec.hourly.time.length) {
      return { hourly: ec.hourly, source: 'ECMWF IFS', label: 'EC 主运行' };
    }
    const forecast = bundle && bundle.forecast;
    if (forecast && !forecast.error && forecast.hourly && Array.isArray(forecast.hourly.time) && forecast.hourly.time.length) {
      return { hourly: forecast.hourly, source: '综合预报', label: '综合预报' };
    }
    return null;
  }
  function valueAt(hourly, key, index) {
    if (!hourly || index == null) return null;
    return finite(hourly[key] ? hourly[key][index] : null);
  }
  // 霞光前后 ±N 小时的峰值降水与最差天气码（雨幕挡光只看窗口内最强一刻）
  function rainWindow(hourly, centerIndex, halfHours) {
    if (!hourly || centerIndex == null || !Array.isArray(hourly.time)) return { peakMm: 0, weatherCode: 0 };
    const center = minuteStamp(hourly.time[centerIndex]);
    if (center == null) return { peakMm: 0, weatherCode: 0 };
    let peakMm = 0;
    let weatherCode = 0;
    for (let i = 0; i < hourly.time.length; i += 1) {
      const stamp = minuteStamp(hourly.time[i]);
      if (stamp == null || Math.abs(stamp - center) > halfHours * 60) continue;
      const mm = finite(hourly.precipitation ? hourly.precipitation[i] : null);
      if (mm != null && mm > peakMm) peakMm = mm;
      const code = finite(hourly.weather_code ? hourly.weather_code[i] : null);
      // 取"最严重"的天气码：数值越大越严重（Open-Meteo WMO 码按强度递增）
      if (code != null && code > weatherCode) weatherCode = code;
    }
    return { peakMm, weatherCode };
  }

  // ---- 单次事件评估（一次日落或一次日出） ----
  function evaluateEvent(context, mode) {
    const { modeLabel, eventTime, lat, monthIndex, cloudHourly, cloudSource, forecastHourly, sunPath, aerosolHourly } = context;
    if (!eventTime) return { available: false, mode, timeLabel: '—', note: '该日缺少日落/日出时刻' };
    // 云量与补充变量各自对齐到本事件时刻（日出/日落时刻不同，索引必须分别求）
    const cloudIndex = nearestIndex(cloudHourly && cloudHourly.time, eventTime);
    const layer = layerAt(cloudHourly, cloudIndex);
    const forecastIndex = forecastHourly ? nearestIndex(forecastHourly.time, eventTime) : null;
    const tempC = forecastIndex == null ? null : valueAt(forecastHourly, 'temperature_2m', forecastIndex);
    const dewC = forecastIndex == null ? null : valueAt(forecastHourly, 'dew_point_2m', forecastIndex);
    const visibilityM = forecastIndex == null ? null : valueAt(forecastHourly, 'visibility', forecastIndex);
    const blhRaw = forecastIndex == null ? null : valueAt(forecastHourly, 'boundary_layer_height', forecastIndex);
    const blhKm = blhRaw == null ? BLH_DEFAULT_KM : clamp(blhRaw / 1000, 0.3, 4);
    const low = finite(layer.low);
    const mid = finite(layer.mid);
    const high = finite(layer.high);
    const base = cloudBase(low, mid, high, tempC, dewC);
    const total = finite(layer.total) ?? (low == null && mid == null && high == null ? 0 : Math.max(low ?? 0, mid ?? 0, high ?? 0));
    const rain = rainWindow(forecastHourly || cloudHourly, forecastIndex == null ? cloudIndex : forecastIndex, RAIN_WINDOW_HOURS);
    const rainInfo = rainPenaltyOf(rain.peakMm, rain.weatherCode);
    // 气溶胶：优先用 CAMS 实测 AOD，缺失时按能见度反演
    const aerosolIndex = aerosolHourly ? nearestIndex(aerosolHourly.time, eventTime) : null;
    const measuredAod = aerosolIndex == null ? null : valueAt(aerosolHourly, 'aerosol_optical_depth', aerosolIndex);
    const aod = clamp(measuredAod != null ? measuredAod : (aodFromVisibility(visibilityM, blhKm) ?? 0.3), AOD_MIN, AOD_MAX);
    const clarity = clarityFromAod(aod);
    const speed = terminatorSpeed(lat, monthIndex);

    const heightKm = base.km;
    const clearSky = heightKm == null;
    const reachKm = glowReachKm(heightKm);
    // 云幕距离：沿太阳方位的云量扫描结果；扫描缺失时按总云量兜底
    let distanceKm = null;
    if (sunPath && sunPath.covers && sunPath.covers[mode] && Array.isArray(sunPath.times)) {
      const scanIndex = nearestIndex(sunPath.times, eventTime);
      if (scanIndex != null) {
        const series = sunPath.covers[mode].map((values) => values[scanIndex] ?? 0);
        distanceKm = boundaryFromScan(sunPath.distances, series);
      }
    }
    const scanned = distanceKm != null;
    const scanMaxKm = sunPath && Array.isArray(sunPath.distances) && sunPath.distances.length
      ? sunPath.distances[sunPath.distances.length - 1]
      : MAX_BOUNDARY_KM;
    // 扫到最远处仍没有成片云：距离取扫描上限，标记为"超出范围"
    const capped = scanned && distanceKm >= scanMaxKm;
    if (!scanned) distanceKm = boundaryDistanceKm(total);
    // 云幕距离 / 可照距离：≤1 表示本地头顶在可照区内，≤1.6 表示向日侧天空仍有染色云
    const reachRatio = distanceKm / Math.max(reachKm, 1);
    const hasLocal = !clearSky && reachRatio <= 1;
    const hasFar = !clearSky && reachRatio <= 1.6;
    // 阴蔽因子：低云主导 + 能见度差 → 视线被云幕挡住
    const visKm = visibilityM == null ? null : visibilityM / 1000;
    const overcast = clamp(
      0.6 * ((0.65 * (low ?? 0) + 0.25 * (mid ?? 0) + 0.1 * (high ?? 0)) / 100)
      + 0.15 * (visKm == null ? 0 : clamp((10 - visKm) / 8, 0, 1)),
      0,
      1,
    );

    // 光学：气溶胶沿"光线最低点 → 云底"的直弦消光，臭氧作为背景瑞利项，
    // 结果直接渲染成色块（hex + 色名 + 明暗），色名与亮度都取自同一个色块，不会自相矛盾。
    const bottomKm = Math.max(heightKm == null ? 0 : heightKm - (distanceKm * distanceKm) / (2 * EARTH_RADIUS_KM), 0);
    const aerosolTau = slantOpticalDepth((aod / BLH_DEFAULT_KM), BLH_DEFAULT_KM, bottomKm, heightKm ?? 0);
    const ozoneTau = slantOpticalDepth(OZONE_KAPPA_PER_KM, OZONE_SCALE_KM, bottomKm, heightKm ?? 0);
    const color = spectralColor(ozoneTau, aerosolTau);
    const described = clearSky ? { name: '晴空无色', tone: '无' } : describeColor(color);

    // ---- 评分 ----
    let score = 48;
    score += (clarity - 0.5) * 38;
    // 几何项：云幕距离相对可照距离的比值决定本地是否被照亮
    if (!clearSky && reachRatio <= 1) {
      // 在可照区内：越靠内侧，本地被照亮的时间越长
      const insetMin = (reachKm - distanceKm) / (2 * speed);
      if (insetMin > 5) score += 6;
      if (insetMin > 10) score += 4;
    } else if (!clearSky) {
      score -= Math.round(clamp(4 + (reachRatio - 1) * 35, 4, 26));
    }
    score -= rainInfo.penalty;
    score -= Math.round(overcast * 24);
    if ((low ?? 0) > 92) score -= 25;
    if (distanceKm < 40) score -= 8;
    if (heightKm != null && heightKm > 4) score += 6;
    if (aod < 0.08) score += 6;
    else if (aod <= 0.28) score += 3;
    else if (aod > 1) score -= 12;
    else if (aod > 0.55) score -= 7;
    const midHigh = Math.max(mid ?? 0, high ?? 0);
    if (!clearSky && midHigh >= 35 && midHigh <= 85 && (low ?? 0) < 35) {
      score += clamp(Math.round(12 - Math.abs(midHigh - 55) * 0.18), 3, 12);
    }
    if (clearSky) score = 0;
    score = clamp(Math.round(score), 0, 100);

    // ---- 时间窗 ----
    // 远处云幕先在日出/日落前 leadMin 起被染色，本地云幕在事件后 trailMin 内保留余晖
    const leadMin = clamp(distanceKm / (2 * speed), 0, 45);
    const litAngle = litSunAngleDeg(heightKm ?? 0);
    const trailMin = hasLocal ? clamp(litAngle / SUN_ANGLE_RATE_DEG_MIN, 0, 15) : 0;
    const startOffset = mode === 'sunrise' ? -(leadMin + trailMin) : -leadMin;
    const endOffset = mode === 'sunrise' ? clamp(trailMin, 0, 8) : trailMin;

    const band = clearSky
      ? { min: 0, label: '无霞', level: 'none' }
      : BANDS.find((item) => score >= item.min) || BANDS[BANDS.length - 1];

    return {
      available: true,
      mode,
      modeLabel,
      timeLabel: clockLabel(eventTime),
      score,
      label: band.label,
      level: band.level,
      color: {
        hex: clearSky ? '#5b6373' : color.hex,
        name: described.name,
        tone: described.tone,
      },
      cloud: { low, mid, high, total },
      cloudBaseKm: heightKm,
      cloudBaseLayer: base.layer,
      cloudBaseName: base.name,
      cloudBaseSource: base.source,
      boundaryKm: distanceKm,
      boundaryScanned: scanned,
      boundaryCapped: capped,
      boundaryMaxKm: scanMaxKm,
      boundaryElevationDeg: clearSky ? null : boundaryElevationDeg(heightKm, distanceKm),
      glowReachKm: Math.round(reachKm),
      hasLocal,
      hasFar,
      clarity,
      aod,
      aodSource: measuredAod != null ? 'CAMS' : '能见度反演',
      boundaryLayerKm: blhKm,
      overcast,
      source: cloudSource,
      window: {
        startOffset: Math.round(startOffset),
        endOffset: Math.round(endOffset),
        startLabel: shiftClock(eventTime, startOffset),
        endLabel: shiftClock(eventTime, endOffset),
        durationMin: Math.round(endOffset - startOffset),
      },
      rain: rainInfo,
      notes: buildNotes({ clearSky, hasLocal, hasFar, heightKm, distanceKm, reachKm, aod, clarity, rainInfo, low, mid, high, mode, source: cloudSource, capped, scanMaxKm }),
    };
  }

  // 说明文案：把扣分/加分的关键原因讲清楚，避免只给一个分数
  function buildNotes(input) {
    const notes = [];
    const { clearSky, hasLocal, hasFar, heightKm, distanceKm, reachKm, aod, clarity, rainInfo, low, mid, high, mode, source, capped, scanMaxKm } = input;
    const dirWord = mode === 'sunrise' ? '日出' : '日落';
    const word = `${dirWord}方向`;
    if (clearSky) {
      notes.push(`三层云量都低于 ${LAYER_CLOUD_MIN}%，天空没有可被染色的云幕，${mode === 'sunrise' ? '朝' : '晚'}霞基本不会出现。`);
      return notes;
    }
    const elevation = boundaryElevationDeg(heightKm, distanceKm);
    const layerWord = heightKm < 2.2 ? '低云' : heightKm < 5 ? '中云' : '高云';
    if (capped) {
      notes.push(`朝${word} ${scanMaxKm} km 内没有成片云，只能看到零散的染色云。`);
    } else if (!hasFar) {
      notes.push(`云幕距本地约 ${Math.round(distanceKm)} km，超出该云底高度可被照亮的 ${Math.round(reachKm)} km，${word}看不到成片火烧云。`);
    } else if (!hasLocal) {
      notes.push(`本地头顶未被照亮（云幕 ${Math.round(distanceKm)} km ＞ 可照距离 ${Math.round(reachKm)} km），但${word}天空仍可能见到染色云。`);
    } else if (elevation < 0) {
      notes.push(`云幕在可照距离内，但按 ${layerWord} ${heightKm} km 算已落到地平线以下（被地球曲率挡住），肉眼看到的主要是更高处被染色的云。`);
    } else {
      notes.push(`云幕在可照距离内（${Math.round(distanceKm)} km ＜ ${Math.round(reachKm)} km），高度角约 ${elevation.toFixed(1)}°，本地头顶有机会被低角度阳光染红。`);
    }
    if (elevation >= 0 && hasLocal) {
      notes.push(`云幕高度角约 ${elevation.toFixed(1)}°，肉眼可直接看到云底被染色。`);
    }
    notes.push(`云底高度按${layerWord}取 ${heightKm} km（${source || '分层云量'}），可照距离 ${Math.round(reachKm)} km。`);
    if (aod >= 0.55) notes.push(`气溶胶偏多（AOD≈${aod.toFixed(2)}），大气通透度 ${Math.round(clarity * 100)}%，色彩会偏闷。`);
    else if (aod <= 0.28) notes.push(`气溶胶较少（AOD≈${aod.toFixed(2)}），通透度 ${Math.round(clarity * 100)}%，色彩层次更好。`);
    if (rainInfo.penalty > 0) notes.push(`前后两小时有${rainInfo.label}（峰值约 ${rainInfo.peakMm.toFixed(1)} mm/h），雨幕会挡住低角度阳光。`);
    if ((low ?? 0) > 92) notes.push('低云几乎铺满天空，地平线方向被云幕压住。');
    if (Math.max(mid ?? 0, high ?? 0) >= 35 && (low ?? 0) < 35) notes.push('中高云量适中，属于最容易出火烧云的云况。');
    return notes;
  }

  // ---- 逐日汇总 ----
  function layerAt(cloudHourly, index) {
    if (!cloudHourly || index == null) return { low: null, mid: null, high: null, total: null, index: null };
    return {
      low: valueAt(cloudHourly, 'cloud_cover_low', index),
      mid: valueAt(cloudHourly, 'cloud_cover_mid', index),
      high: valueAt(cloudHourly, 'cloud_cover_high', index),
      total: valueAt(cloudHourly, 'cloud_cover', index),
      index,
    };
  }

  // build(bundle, destination, dates)：返回 { source, label, days: { date: { sunset, sunrise } } }
  // 只覆盖 dates 的前 DAY_LIMIT 天（逐小时预报的云场细节在 3 天外不可信）。
  function build(bundle, destination, dates) {
    const picked = pickCloudHourly(bundle);
    const result = { source: picked ? picked.source : null, label: picked ? picked.label : null, days: {}, limit: DAY_LIMIT };
    if (!picked || !Array.isArray(dates) || !dates.length) return result;
    const forecast = bundle.forecast;
    const daily = forecast && !forecast.error ? forecast.daily : null;
    const forecastHourly = forecast && !forecast.error ? forecast.hourly : null;
    const aerosolHourly = bundle.aerosol && !bundle.aerosol.error ? bundle.aerosol.hourly : null;
    const sunPath = bundle.sunPath && !bundle.sunPath.error ? bundle.sunPath : null;
    const lat = finite(destination && destination.lat);
    const lon = finite(destination && destination.lon);

    dates.slice(0, DAY_LIMIT).forEach((date, index) => {
      // 日落/日出时刻优先用预报返回值，缺失时按经纬度本地推算
      const fallback = eventTimes(date, lat, lon);
      const sunsetTime = (daily && Array.isArray(daily.sunset) ? daily.sunset[index] : null) || fallback.sunset;
      const sunriseTime = (daily && Array.isArray(daily.sunrise) ? daily.sunrise[index] : null) || fallback.sunrise;
      const monthIndex = Number(String(date).slice(5, 7)) - 1;
      const base = {
        cloudHourly: picked.hourly,
        cloudSource: picked.source,
        forecastHourly,
        aerosolHourly,
        sunPath,
        lat,
        monthIndex,
      };
      result.days[date] = {
        date,
        sunset: evaluateEvent({ ...base, eventTime: sunsetTime, modeLabel: '晚霞' }, 'sunset'),
        sunrise: evaluateEvent({ ...base, eventTime: sunriseTime, modeLabel: '朝霞' }, 'sunrise'),
      };
    });
    return result;
  }

  function modeLabel(mode) { return mode === 'sunrise' ? '朝霞' : '晚霞'; }

  return {
    DAY_LIMIT,
    LAYER_CLOUD_MIN,
    build,
    modeLabel,
    scanBearings,
    eventTimes,
    // 以下导出供测试与调试使用
    solarAngles,
    glowReachKm,
    litSunAngleDeg,
    boundaryDistanceKm,
    boundaryFromScan,
    terminatorSpeed,
    aodFromVisibility,
    clarityFromAod,
    spectralColor,
    describeColor,
    rainPenaltyOf,
    cloudBase,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sunset;

