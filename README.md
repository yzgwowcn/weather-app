# 晴海 · 海南旅行天气判断

面向海南旅游读者的**纯前端天气判断网页**：以 ECMWF（EC）为主判断来源，选择目的地（三亚·亚龙湾 / 陵水·清水湾 / 海棠湾·蜈支洲岛 / 万宁·神州半岛 / 后海·分界洲岛），查询未来 3/7/14 天天气与近海海况。

核心卖点（读者最关心）：
- **EC 主判断**：首屏直接给出 ECMWF 主运行的"适合出行 / 不建议出行"结论；EC 集合 51 个成员的晴好率（满足页面条件的成员比例）为页面主概率；GFS、JMA、CMA 仅作外部交叉验证，不再与 EC 等权抢占结论。
- **出行口径**：北京时间 08:00–18:00，只要不是阴雨天气且云层覆盖率特别高即可出行——日间无"中雨及以上"时段（61/63/65/80/81/82，毛毛雨/雾/阴不算）且遮蔽云量严格 <75% 且日间平均风速严格 <30 km/h（短时大阵风仅作提醒，不阻断出行；EC 集合晴好率 ≥75% 时即使主运行不适合也以集合为准建议出行）；**雷阵雨（95/96/99）不阻断出行**，但页面给出雷雨发生的注意时段（如 ⚡ 13:00–15:00 有雷阵雨，注意避雨）。
- **海边天色看低中云**：遮蔽云量 = 低云均值×60% + 中云均值×40%，低云与中云对海边天色影响最大；高云单独绘制与提示、不参与晴好率扣分。
- **EC 天空剖面**：原生 SVG 小时精度图表，低/中/高三条平滑曲线、白天时段浅色带、日界线与选中准星；悬停/触控/键盘查看逐小时三层云、加权遮蔽云量、降水与风速；14 天保持小时精度并可横向滚动；支持 EC / 综合预报视图切换。
- **两层一致性**：`EC 成员一致性`（集合晴好率是否集中于高/低区间 + 主运行方向是否一致）与 `外部模型验证`（GFS/JMA/CMA 支持数、反对数与缺失来源，明确为模型分歧提示）。
- **晴雨结合氛围界面**：页面底色恒为暖金阳光基调（晴天阳光偏多），按选中日 EC 数据叠加氛围层——cloudy 云影、windy 气流光带、storm 气流+雨、thunder 雨+闪电；雨滴为**本地 Canvas 特效**（`js/rain.js`，零依赖，参考雨特效 demo 的视觉语言：斜向雨滴 + 头部亮点 + 落地涟漪），雷阵雨闪电 2.8–6s 随机双闪；多层毛玻璃面板、细白描边、低饱和主题色；全部动效遵守 `prefers-reduced-motion`。
- **亚克力面板**：五个玻璃面板（查询区/EC 主结论/指标/交叉验证/日期条）为半透明亚克力质感（`backdrop-filter` 模糊 + 渐变描边 + 内高光），`body[data-mood]` 天气背景（阳光/云影/气流/雨+闪电）透出；无 WebGL/流体折射依赖。
- **图标 Lottie 动画**：天气图标使用 meteocons Lottie（`assets/lottie/`，lottie-web 本地化，`js/icons.js` 播放），hero/逐日卡片动态播放；图标按日间早-中-晚三段展示（早 08–10 / 中 11–13 / 晚 14–17，每段主导天气码 + 时段标签），适合出行时优先晴/晴间多云伴零星阵雨；雷雨徽章保持静态 SVG；顶部小红书入口使用官方 logo（`assets/xhs-logo.png`）。
- **日期先行**：具体日期选择（日期条）位于 EC 主结论上方，先选日期再看判断；预报范围（3/7/14 天）选择位于目的地下方。
- **近海海况**：保留海洋网格的浪高、周期与涌浪提示。

- 数据源：[Open-Meteo](https://open-meteo.com/)（免费、无需 API Key、支持浏览器 CORS 直连）
- 技术栈：原生 HTML + CSS + Vanilla JS（图表为原生 SVG，雨效为原生 Canvas，无图表库）；仅本地化 lottie-web（`vendor/lottie.min.js`，用于天气图标动画），无任何第三方网络请求，利于国内访问 Vercel 的加载速度
- 部署方式：GitHub 仓库 → Vercel 导入 → 挂载自定义域名（国内可访问）
- 数据口径：时区 `Asia/Shanghai`、海洋网格 `cell_selection=sea`、时效分层提示

> ⚠️ 本站为 Open-Meteo 模式指导，**非官方预警**。"EC 更准确"是产品展示优先级，并非对所有地点、天气型和预报时效的准确率声明；晴好率反映集合成员分布，不是经过海南当地历史回测校准的真实发生率。台风、大风、暴雨等场景请以中央气象台（[nmc.cn](https://www.nmc.cn)）、当地气象台、码头与景区通知为准。

## 更新日志

版本演进记录见 [CHANGELOG.md](CHANGELOG.md)。

## 本地运行

直接双击打开 `index.html` 即可（现代浏览器均支持 fetch + CORS）。

或起一个本地静态服务器：

```bash
npx serve .
# 或
python -m http.server 8080
```

## 测试

```bash
node tests/metrics.test.js    # 指标夹具测试（中雨阻断、毛毛雨/雾不阻断、雷雨时段合并、75% 边界、缺失降级等）
node tests/render.smoke.js    # 渲染层冒烟（区块顺序、视图切换、准星、雷雨徽章）
node tests/css.check.js       # CSS 状态机结构检查（mood 选择器、闪电关键帧、reduced-motion）
NODE_PATH="$(npm root -g)" node tests/e2e.check.js   # 端到端（真实 API + Playwright，桌面/移动/reduced-motion）
```

## 部署到 Vercel（挂载自己的域名）

1. **推送 GitHub**：在 GitHub 新建仓库（如 `weather-app`），然后：

   ```bash
   cd weather-app
   git init
   git add -A
   git commit -m "feat: EC 主判断 + 分层云图 + 天气氛围界面"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/weather-app.git
   git push -u origin main
   ```

2. **Vercel 导入**：登录 [vercel.com](https://vercel.com) → **Add New → Project → Import Git Repository** → 选择刚推送的仓库。
   - 纯静态项目，无需任何构建设置（Framework Preset 选 Other / 直接默认即可）。
   - 点击 **Deploy**，稍等即获得 `https://weather-app.vercel.app`。

3. **挂载自定义域名**：Vercel 项目 → **Settings → Domains** → 输入你的域名（如 `weather.example.com`），按提示在域名服务商处配置 DNS：
   - 主域名：添加 `A` 记录指向 `76.76.21.21`；
   - 子域名：添加 `CNAME` 记录指向 `cname.vercel-dns.com`。
   - 等待 DNS 生效（通常几分钟到几小时），Vercel 自动签发 HTTPS 证书。

4. **后续更新**：每次本地改动 `git push` 后，Vercel 自动重新部署，无需手动操作。

## 目录结构

```
weather-app/
├── index.html          # 页面骨架（移动端优先，body[data-mood] 初始 neutral；importmap 指向本地 vendor）
├── css/
│   └── style.css       # 毛玻璃视觉系统 + 天气状态机 + reduced-motion + 响应式
├── js/
│   ├── config.js       # 预设目的地坐标 + 默认参数
│   ├── api.js          # 综合预报、多模型（含三层云）、集合预报与海况请求
│   ├── metrics.js      # EC 主结论、加权遮蔽、成员一致性、外部验证、云图序列、天气状态机
│   ├── render.js       # 首屏区块 + SVG 天空剖面 + 视图切换（只消费结构化日级结果）
│   ├── rain.js         # Canvas 雨滴特效（雨滴/涟漪/闪电，零依赖）
│   ├── fluid-glass.js  # 流体玻璃背景（reactbits FluidGlass 的 vanilla three.js 移植）
│   └── app.js          # 主控制器（选择→查询→渲染 + 图表交互 + mood/雨效应用）
├── vendor/             # 本地化 lottie-web 播放器（lottie.min.js）
├── assets/
│   ├── lottie/         # meteocons Lottie 天气动画（基础 + 组合：partly-cloudy-day-drizzle 等）
│   ├── icons/          # 雷雨徽章静态 SVG（lightning-bolt）
│   ├── xhs-logo.png    # 小红书官方 logo
│   └── favicon.svg     # 站点图标
├── tests/
│   ├── metrics.test.js # 无依赖指标夹具测试（node tests/metrics.test.js）
│   ├── render.smoke.js # 渲染层无依赖冒烟测试
│   ├── css.check.js    # CSS 状态机结构检查
│   └── e2e.check.js    # Playwright 端到端（真实 API）
└── README.md
```

## Phase 2 规划（后续迭代）

- [ ] **任意地点搜索**：接入 Open-Meteo Geocoding API，输入中文地名即可查询（不限于预设 5 地）
- [ ] **台风/预警联动**：结果区提供中央气象台台风网（typhoon.nmc.cn）跳转链接，接入 CMA 中国模型参数
- [ ] **与小红书笔记联动**：页面顶部嵌入最新笔记链接，形成"笔记看分析 → 网页查实时"闭环
- [ ] **PWA 化**：`manifest.json` + Service Worker，读者可"添加到桌面"
- [ ] **行程建议**：按 skill 第 5 节逻辑生成通用出行提示
- [ ] **低云/中云权重调参**：60/40 权重与 75% 阈值目前固定，后续可根据旅行反馈单独调整

## 地图选点配置（可选）

地图拖点选点使用高德 JS API 2.0（面向国内用户，地名数据合规），需要自行申请 Key：

1. 打开 [高德开放平台控制台](https://console.amap.com/) 并登录；
2. 创建应用 → 添加「**Web端(JS API)**」平台；
3. 复制 **Key** 与 **安全密钥（jscode）**，填入 `js/config.js`：

```js
const AMAP_CONFIG = {
  key: '你的高德 Key',
  securityJsCode: '你的安全密钥',
};
```

- `key` 为空时，「🗺️ 地图选点」按钮自动禁用，不影响搜索、手动坐标与预设目的地功能。
- 地图交互：点击地图放置 Marker（可拖动微调），拖动停止后自动逆地理编码显示地名；支持地图内 POI 搜索与「使用当前位置」。
- 高德坐标（GCJ-02）会自动转换为 WGS84 后再请求 Open-Meteo 天气（`js/location.js` 内置迭代逆转换，精度 <1 米）。
- 高德 JS API 通过 `webapi.amap.com` CDN 条件加载，仅在配置 Key 后引入；免费配额有限，生产使用请关注控制台用量。

## 已知限制

- Open-Meteo 免费接口有频率限制（约 600 次/分钟），目前每次查询 1-2 个请求，无需处理；后续若加自动刷新需注意节流。
- 国内访问 Open-Meteo 偶有延迟，页面已带 Loading 提示；如需加速可后续加轻量代理或缓存。
- ECMWF 免费接口的集合与主运行按约 5–15 天时效提供，第 8 天及以后仅作趋势参考（页面已提示）。
