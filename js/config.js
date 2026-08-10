// 预设目的地（与 weather-note-analysis skill 及笔记覆盖区域一致）
// marine: true 表示该地点适合同时查询海况（乘船/浮潜/冲浪等）
const HAINAN_DESTINATIONS = [
  { id: 'sanya',    name: '三亚·亚龙湾',     lat: 18.224, lon: 109.512, marine: true  },
  { id: 'lingshui', name: '陵水·清水湾',     lat: 18.5,   lon: 110.03,  marine: true  },
  { id: 'haitang',  name: '海棠湾·蜈支洲岛', lat: 18.31,  lon: 109.73,  marine: true  },
  { id: 'wanning',  name: '万宁·神州半岛',   lat: 18.8,   lon: 110.39,  marine: true  },
  { id: 'houhai',   name: '后海·分界洲岛',   lat: 18.3,   lon: 109.72,  marine: true  },
];

// 四川省模式预设目的地：城市整体 / 高校校区 / 热门旅游目的地（全部内陆，marine: false 不查询海况）
const SICHUAN_DESTINATIONS = [
  { id: 'chengdu',    name: '成都·市区',         lat: 30.657, lon: 104.065, marine: false },
  { id: 'jiang-an',   name: '四川大学·江安校区', lat: 30.577, lon: 103.982, marine: false },
  { id: 'wangjiang',  name: '四川大学·望江校区', lat: 30.632, lon: 104.084, marine: false },
  { id: 'leshan',     name: '乐山·乐山大佛',     lat: 29.545, lon: 103.769, marine: false },
  { id: 'emeishan',   name: '峨眉山',            lat: 29.601, lon: 103.484, marine: false },
  { id: 'jiuzhaigou', name: '九寨沟',            lat: 33.262, lon: 103.918, marine: false },
  { id: 'dujiangyan', name: '都江堰',            lat: 31.007, lon: 103.619, marine: false },
];

// 区域模式：hainan（默认）| sichuan（顶栏「切换到四川省」按钮切换，localStorage 记忆）
// 默认目的地取各区域数组首项（海南·三亚 / 成都·市区）
const REGIONS = { hainan: HAINAN_DESTINATIONS, sichuan: SICHUAN_DESTINATIONS };
let CURRENT_REGION = 'hainan';

// 区域文案：标题/首屏/顶栏/页脚/渲染层提示随模式切换；天气判断算法跨区域通用
const REGION_TEXTS = {
  hainan: {
    label: '海南省',
    switchTo: '四川省',                       // 当前为海南时按钮文案：切换到四川省
    title: '晴海 · 海南旅行天气判断',
    metaDescription: '海南海边旅行 EC 主判断：EC 集合晴好率、分层云图与多模型交叉验证查询',
    eyebrow: 'WEATHER INTELLIGENCE · HAINAN',
    xhsBrand: '海南旅行天气判断',
    xhsAria: '我的小红书主页 · 海南旅行天气判断',
    introCopy: '以日间云量为主，结合降水、风力与各家模型的分歧，挑出海边适合出发的晴天窗口。',
    footer: [
      '以 ECMWF（EC）为主判断：EC 集合晴好率是 51 个成员满足页面条件的比例，GFS、JMA、CMA 仅作交叉验证，模型分歧不是历史准确率证明。',
      '台风、大风、暴雨、乘船与涉海活动，请以当地气象台、码头和景区通知为准。',
    ],
    skyNote: '海边天色重点看低云与中云，点击或悬停图表查看逐小时详情；高云仅供参考，不影响出行判断。浅色带为 08:00–18:00 白天时段。',
    seaTip: '海边天色重点看低云与中云影响最大，高云仅供参考。',
    regionTag: '⚠ 非海南',
    regionToast: '该地点不在海南范围内，预报数据仅供参考',
    regionNotice: '该地点不在海南范围内，预报数据仅供参考，出行请以当地气象台通知为准。',
  },
  sichuan: {
    label: '四川省',
    switchTo: '海南省',                       // 当前为四川时按钮文案：切换到海南省
    title: '晴川 · 四川旅行天气判断',
    metaDescription: '四川旅行天气 EC 主判断：EC 集合晴好率、分层云图与多模型交叉验证查询',
    eyebrow: 'WEATHER INTELLIGENCE · SICHUAN',
    xhsBrand: '四川旅行天气判断',
    xhsAria: '我的小红书主页 · 四川旅行天气判断',
    introCopy: '以日间云量为主，结合降水、风力与各家模型的分歧，挑出适合出发的晴好天气窗口。',
    footer: [
      '以 ECMWF（EC）为主判断：EC 集合晴好率是 51 个成员满足页面条件的比例，GFS、JMA、CMA 仅作交叉验证，模型分歧不是历史准确率证明。',
      '暴雨、山洪与地质灾害多发，山区及景区活动请以当地气象台、景区和交管通知为准。',
    ],
    skyNote: '川内天色重点看低云与中云，点击或悬停图表查看逐小时详情；高云仅供参考，不影响出行判断。浅色带为 08:00–18:00 白天时段。',
    seaTip: '川内天色重点看低云与中云影响最大，高云仅供参考。',
    regionTag: '⚠ 非四川',
    regionToast: '该地点不在四川省范围内，预报数据仅供参考',
    regionNotice: '该地点不在四川省范围内，预报数据仅供参考，出行请以当地气象台通知为准。',
  },
};

// 高德地图 JS API 配置（地图拖点选点功能）
// 获取方式：https://console.amap.com/ 创建应用 → 添加「Web端(JS API)」平台 → 复制 Key
// 安全密钥（jscode）不注入前端，由服务端代理 api/amap.mjs 注入
// 注意：key 为空时地图选点按钮自动禁用，不影响搜索与坐标选点功能
const AMAP_CONFIG = {
  key: '__AMAP_KEY__', // 构建时由 Vercel 环境变量 AMAP_KEY 替换
};

// Supabase Auth 配置（注册/登录/找回密码/邮箱确认）
// 获取方式：https://supabase.com/dashboard → Project Settings → API
// anon key 设计上可公开（配合 RLS 保护数据）；构建时由 Vercel 环境变量替换
const SUPABASE_CONFIG = {
  url: '__SUPABASE_URL__',           // 构建时由 Vercel 环境变量 SUPABASE_URL 替换
  anonKey: '__SUPABASE_ANON_KEY__',  // 构建时由 Vercel 环境变量 SUPABASE_ANON_KEY 替换
};

// Cloudflare Turnstile 人机验证（注册表单）
// 获取方式：https://dash.cloudflare.com → Turnstile → Add Site（Site Key 可公开）
const TURNSTILE_CONFIG = {
  siteKey: '__TURNSTILE_SITE_KEY__', // 构建时由 Vercel 环境变量 TURNSTILE_SITE_KEY 替换
};

// 默认展示未来 7 天（4-7 天属于"可能有变"窗口，符合 skill 时效规则）
const DEFAULT_DAYS = 7;

// 受众全在中国，统一使用上海时区
const TIMEZONE = 'Asia/Shanghai';

// 分时段定义（hour 为当天相对小时；夜间跨午夜用 end=30 表示次日 6 点）
const TIME_SLOTS = [
  { key: 'morning',   label: '🌅 上午', start: 6,  end: 12 },
  { key: 'afternoon', label: '☀️ 下午', start: 12, end: 18 },
  { key: 'evening',   label: '🌇 傍晚', start: 18, end: 22 },
  { key: 'night',     label: '🌙 夜间', start: 22, end: 30 }, // 22:00 → 次日 06:00
];
