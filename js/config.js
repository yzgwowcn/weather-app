// 预设目的地（与 weather-note-analysis skill 及笔记覆盖区域一致）
// marine: true 表示该地点适合同时查询海况（乘船/浮潜/冲浪等）
const DESTINATIONS = [
  { id: 'sanya',    name: '三亚·亚龙湾',     lat: 18.224, lon: 109.512, marine: false },
  { id: 'lingshui', name: '陵水·清水湾',     lat: 18.5,   lon: 110.03,  marine: false },
  { id: 'haitang',  name: '海棠湾·蜈支洲岛', lat: 18.31,  lon: 109.73,  marine: false },
  { id: 'wanning',  name: '万宁·神州半岛',   lat: 18.8,   lon: 110.39,  marine: false },
  { id: 'houhai',   name: '后海·分界洲岛',   lat: 18.3,   lon: 109.72,  marine: true  },
];

// 高德地图 JS API 配置（地图拖点选点功能）
// 获取方式：https://console.amap.com/ 创建应用 → 添加「Web端(JS API)」平台 → 复制 Key
// 安全密钥（jscode）不注入前端，由服务端代理 api/amap.mjs 注入
// 注意：key 为空时地图选点按钮自动禁用，不影响搜索与坐标选点功能
const AMAP_CONFIG = {
  key: '__AMAP_KEY__', // 构建时由 Vercel 环境变量 AMAP_KEY 替换
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
