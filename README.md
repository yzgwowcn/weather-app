# 晴海 · 海南旅行天气判断

面向海南旅游读者的**纯前端天气判断网页**：以 ECMWF（EC）为主判断来源，选择目的地（三亚·亚龙湾 / 陵水·清水湾 / 海棠湾·蜈支洲岛 / 万宁·神州半岛 / 后海·分界洲岛），查询未来 3/7/14 天天气与近海海况。

核心卖点（读者最关心）：
- **EC 主判断**：首屏直接给出 ECMWF 主运行的"适合出行 / 不建议出行"结论；EC 集合 51 个成员的晴好率（满足页面条件的成员比例）为页面主概率；GFS、JMA、CMA 仅作外部交叉验证，不再与 EC 等权抢占结论。
- **出行口径**：北京时间 08:00–18:00，只要不是阴雨天气且云层覆盖率特别高即可出行——日间无"中雨及以上"时段（61/63/65/80/81/82，毛毛雨/雾/阴不算）且遮蔽云量严格 <75% 且日间平均风速严格 <30 km/h（短时大阵风仅作提醒，不阻断出行；EC 集合晴好率 ≥75% 时即使主运行不适合也以集合为准建议出行）；**雷阵雨（95/96/99）不阻断出行**，但页面给出雷雨发生的注意时段（如 ⚡ 13:00–15:00 有雷阵雨，注意避雨）。
- **海边天色看低中云**：遮蔽云量 = 低云均值×60% + 中云均值×40%，低云与中云对海边天色影响最大；高云单独绘制与提示、不参与晴好率扣分。
- **EC 天空剖面**：原生 SVG 小时精度图表，低/中/高三条平滑曲线、白天时段浅色带、日界线与选中准星；悬停/触控/键盘查看逐小时三层云、加权遮蔽云量、降水与风速；14 天保持小时精度并可横向滚动；支持 EC / 综合预报视图切换。
- **两层一致性**：`EC 成员一致性`（集合晴好率是否集中于高/低区间 + 主运行方向是否一致）与 `外部模型验证`（GFS/JMA/CMA 支持数、反对数与缺失来源，明确为模型分歧提示）。
- **DeepSeek 解释（预设点）**：仅 12 个内置目的地在 ECMWF 数据版本更新后生成一次共享分析；数值与出行等级仍由规则引擎决定，DeepSeek 只解释原因、不确定性和行动建议。晴好且一致的日期保持精炼；审慎/关注/不建议日期，以及主运行与集合相反或集合成员分歧较大的日期，重点展开双方信号、当前结论依据和可执行备选方案。海南海边阴晴以低中云遮蔽为主，高云只辅助说明日照通透感和海水显色；海南预设点额外解释规则算出的玻璃海候选时段。搜索、地图与坐标自选点仍不调用 AI。
- **海南玻璃海候选（含海边自选点）**：全部海南预设点，以及搜索、地图、坐标或收藏得到且距 Marine 返回海格中心不超过 20 km 的海南自选点，结合 EC 逐小时低中云、降水、10 米风和 Open-Meteo Marine 有效浪高（`wave_height`）/风浪/涌浪给出 08:00–18:00 候选时段；海南内陆自选点不展示海况。较佳候选要求遮蔽≤50%、风≤12 km/h、有效浪高≤0.5 m、风浪≤0.2 m、涌浪≤0.5 m；可关注放宽至 70%、16 km/h、0.8/0.3/0.7 m。高云不单独否决；结果不判断水质、岸边浪花和瞬时涌浪，不替代码头或景区实况。
- **AI 缓存自动瘦身**：新分析成功落库后自动删除同一预设点的旧模型版本及旧提示词版本，因此正常状态约为每个预设点一行，不随历史起报无限堆积。
- **晴雨结合氛围界面**：页面底色恒为暖金阳光基调（晴天阳光偏多），按选中日 EC 数据叠加氛围层——cloudy 云影、windy 气流光带、storm 气流+雨、thunder 雨+闪电；雨滴为**本地 Canvas 特效**（`js/rain.js`，零依赖，参考雨特效 demo 的视觉语言：斜向雨滴 + 头部亮点 + 落地涟漪），雷阵雨闪电 2.8–6s 随机双闪；多层毛玻璃面板、细白描边、低饱和主题色；全部动效遵守 `prefers-reduced-motion`。
- **区域示意地图背景**：海南/四川两省风格化轮廓 SVG（`index.html` 内嵌，取自阿里 DataV GeoAtlas 公开简化数据）随区域模式切换，目的地光点高亮当前选中（呼吸动画 + 名称标签）；**两级 LOD**——选择预设目的地后背景平滑放大过渡到其所在市/县精细轮廓（8 个市/县级区划，光点重新定位），点击地图空白或切换区域恢复省全景；自定义选点（搜索/地图选点/坐标）在省全景上显示定位光点；地图层位于日照层与天气氛围层之间，云影/雨滴/光带自然覆盖其上；切换时平移滑入模拟「随定位移动」；移动端退为弱背景水印。**合规注记：风格化示意轮廓，非标准政区图，不涉审图号与九段线**（海南仅展示主岛）。
- **亚克力面板**：五个玻璃面板（查询区/EC 主结论/指标/交叉验证/日期条）为半透明亚克力质感（`backdrop-filter` 模糊 + 渐变描边 + 内高光），`body[data-mood]` 天气背景（阳光/云影/气流/雨+闪电）透出；无 WebGL/流体折射依赖。
- **图标 Lottie 动画**：天气图标使用 meteocons Lottie（`assets/lottie/`，lottie-web 本地化，`js/icons.js` 播放），hero/逐日卡片动态播放；图标按日间早-中-晚三段展示（早 08–10 / 中 11–13 / 晚 14–17，每段主导天气码 + 时段标签），适合出行时优先晴/晴间多云伴零星阵雨；雷雨徽章保持静态 SVG；顶部小红书入口使用官方 logo（`assets/xhs-logo.png`）。
- **日期先行**：具体日期选择（日期条）位于 EC 主结论上方，先选日期再看判断；预报范围（3/7/14 天）选择位于目的地下方。
- **近海海况**：海南预设点与海南自选点均使用 Open-Meteo Marine 海洋网格的逐小时浪高、风浪和涌浪；远期无数据时明确显示待补充。

- 数据源：[Open-Meteo](https://open-meteo.com/)（免费、无需 API Key、支持浏览器 CORS 直连）
- 技术栈：原生 HTML + CSS + Vanilla JS（图表为原生 SVG，雨效为原生 Canvas，无图表库）；仅本地化 lottie-web（`vendor/lottie.min.js`，用于天气图标动画），无任何第三方网络请求，利于国内访问 Vercel 的加载速度
- 部署方式：GitHub 仓库 → Vercel 导入 → 挂载自定义域名（国内可访问）
- 数据口径：时区 `Asia/Shanghai`、海洋网格 `cell_selection=sea`、时效分层提示

> ⚠️ 本站为 Open-Meteo 模式指导，**非官方预警**。"EC 更准确"是产品展示优先级，并非对所有地点、天气型和预报时效的准确率声明；晴好率反映集合成员分布，不是经过海南当地历史回测校准的真实发生率。台风、大风、暴雨等场景请以中央气象台（[nmc.cn](https://www.nmc.cn)）、当地气象台、码头与景区通知为准。
>
> 🗺️ 页面地图为风格化示意轮廓（阿里 DataV GeoAtlas 公开简化数据本地化），**非标准政区图**，不代表精确行政区划边界，不涉审图号与九段线；海南仅展示主岛。

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

## 部署到 Vercel

1. 代码推送到 GitHub 仓库（`git push origin master`）。
2. [vercel.com](https://vercel.com) → **Add New → Project** → 导入该仓库；纯静态项目无需构建设置，直接 **Deploy** 即可。
3. **Settings → Domains** 挂载自定义域名，按提示在域名服务商处配置 DNS，Vercel 自动签发 HTTPS 证书。
4. 之后每次本地 `git push`，Vercel 自动重新部署。

### DeepSeek 天气解释配置

先在 Supabase SQL Editor 执行 `supabase/migrations/007_weather_ai_analyses.sql`，再在 Vercel 配置以下仅服务端环境变量：

| Name | 用途 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API Key；仅由 `api/weather-analysis.mjs` 读取 |
| `DEEPSEEK_MODEL` | 可选，默认 `deepseek-v4-flash` |
| `SUPABASE_SECRET_KEY` | 推荐：Supabase `sb_secret_...` 服务端密钥；共享分析缓存读写，严禁注入前端 |
| `SUPABASE_SERVICE_ROLE_KEY` | 兼容旧项目的 legacy service-role JWT；配置了新 secret key 时无需设置 |
| `ALLOWED_ORIGINS` | 生产站点 host 白名单，建议必配 |

`SUPABASE_URL` 已用于现有账户构建配置，同时也会由服务端函数读取。缺少任一服务端密钥时，AI 接口返回不可用，页面自动保留原规则分析。管理访问令牌（`sbp_...`）只用于 CLI/Management API，不可替代 `SUPABASE_SERVICE_ROLE_KEY`。

`api/weather-analysis.mjs` 在 `vercel.json` 中配置 90 秒函数上限，其中 DeepSeek 最多等待 70 秒，剩余时间用于结果校验和 Supabase 写回。Vercel 当前默认启用 Fluid Compute；若项目手动关闭了该功能且套餐只允许 60 秒，请先在项目 Functions 设置中重新启用 Fluid Compute，避免部署配置或长请求被截断。

## 目录结构

```
weather-app/
├── index.html          # 页面骨架（移动端优先，body[data-mood] 初始 neutral；importmap 指向本地 vendor）
├── auth.html           # 登录 / 注册（含 Cloudflare Turnstile 人机验证）/ 找回密码
├── account.html        # 最简账户页（邮箱 + UID + 退出登录）
├── auth/
│   └── callback.html   # 邮箱确认与找回密码回调（PKCE code → 会话；recovery → 设置新密码）
├── api/
│   ├── amap.mjs        # 高德 REST API 服务端代理（Vercel Function，serviceHost 代理，服务端注入 jscode）
│   ├── weather-analysis.mjs  # 预设点 DeepSeek 分析（EC 数据版本触发 + Supabase 共享缓存）
│   └── verify-turnstile.mjs  # Cloudflare Turnstile 服务端验证（Vercel Function，secret 仅服务端）
├── css/
│   └── style.css       # 毛玻璃视觉系统 + 天气状态机 + reduced-motion + 响应式
├── js/
│   ├── config.js       # 预设目的地坐标 + 默认参数 + AMAP/SUPABASE/TURNSTILE 构建注入配置
│   ├── auth.js         # Supabase Auth 封装（注册/登录/退出/找回密码/会话监听，window.Auth）
│   ├── api.js          # 综合预报、多模型（含三层云）、集合预报与海况请求
│   ├── ai-analysis.js  # 预设点 AI 结果请求；自选点禁用并回退规则文案
│   ├── metrics.js      # EC 主结论、加权遮蔽、成员一致性、外部验证、云图序列、天气状态机
│   ├── render.js       # 首屏区块 + SVG 天空剖面 + 视图切换（只消费结构化日级结果）
│   ├── rain.js         # Canvas 雨滴特效（雨滴/涟漪/闪电，零依赖）
│   ├── fluid-glass.js  # 流体玻璃背景（reactbits FluidGlass 的 vanilla three.js 移植）
│   └── app.js          # 主控制器（选择→查询→渲染 + 图表交互 + mood/雨效应用）
├── vendor/             # 本地化第三方库（lottie.min.js、supabase.min.js）
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

## 地图选点配置（可选，Vercel 环境变量注入）

地图拖点选点使用高德 JS API 2.0（面向国内用户，地名数据合规）。**Key 与安全密钥都不写入仓库**：仓库内 `js/config.js` 只保留 `__AMAP_KEY__` 占位符，部署时由 Vercel 环境变量注入（`npm run build` → `node inject-env.js` 完成替换）；安全密钥 `AMAP_SECRET`（jscode）仅由服务端 `api/amap.mjs` 通过 `process.env.AMAP_SECRET` 读取，不进入任何静态 HTML/JS/CSS 文件。

### ① 申请高德 Key

1. 打开 [高德开放平台控制台](https://console.amap.com/) 并登录；
2. 创建应用 → 添加「**Web端(JS API)**」平台；
3. 在**域名白名单**填入：`localhost`、`127.0.0.1`、`*.vercel.app`、你的自定义域名（如有）；
4. 记录 **Key**（32 位字符串）与**安全密钥 jscode**（"安全模式"中获取）。

### ② 配置 Vercel 环境变量

Vercel Dashboard → 项目 → Settings → Environment Variables，新增：

| Name | Value |
|---|---|
| `AMAP_KEY` | 高德 JS API Key（32 位，构建时注入前端 `js/config.js`） |
| `AMAP_SECRET` | 高德安全密钥 jscode（仅服务端 `api/amap.mjs` 通过 `process.env` 读取） |
| `ALLOWED_ORIGINS` | 可选。逗号分隔的站点 host 列表（如 `your-app.vercel.app,www.your-domain.com`），配置后 `/_AMapService` 与 `/api/verify-turnstile` 仅受理来自这些站点的请求；**未配置时放行但输出警告日志**，生产环境建议配置 |

Build Command 设为 `npm run build`（或保持默认，Vercel 检测到 `package.json` 的 build 脚本会自动执行）。

### ③ 行为说明

- 两个变量**都必须配置**：高德 JS API 2.0 的新 Key 强制要求 jscode，缺省会报 `INVALID_USER_SCODE`。
- 未配置环境变量时（本地开发 / 构建时无 env），占位符被替换为空字符串，「🗺️ 地图选点」按钮自动禁用，不影响搜索、手动坐标与预设目的地功能。
- 地图交互：点击地图放置 Marker（可拖动微调），拖动停止后自动逆地理编码显示地名；支持地图内 POI 搜索与「使用当前位置」。
- 高德坐标（GCJ-02）会自动转换为 WGS84 后再请求 Open-Meteo 天气（`js/location.js` 内置迭代逆转换，精度 <1 米）。
- 安全模式采用高德官方推荐的 **serviceHost 服务端代理**：前端 `window._AMapSecurityConfig = { serviceHost: window.location.origin + '/_AMapService' }`，JS API 的 Geocoder / AutoComplete / Geolocation 等 REST 请求经 `vercel.json` rewrite 转发到 `api/amap.mjs`（Vercel Function），由服务端注入 `jscode` 后代理到 `https://restapi.amap.com/`；安全密钥不再以明文出现在任何静态文件中。
- 代理防护：仅接受 GET/HEAD；path 白名单仅放行前端实际用到的轻量接口（`v3/geocode/*`、`v3/assistant/inputtips`、`v3/place/*`、`v3/geolocation`、`v3/ip`），其余路径 400；配置 `ALLOWED_ORIGINS` 后按 Origin/Referer 校验来源，非白名单来源 403（防止代理被第三方当免费高德通道消耗配额/费用）。
- 高德 JS API 通过 `webapi.amap.com` CDN 条件加载，仅在注入真实 Key 后引入；免费配额有限，生产使用请关注控制台用量。

## 账户系统（Supabase Auth + Resend + Cloudflare Turnstile）

注册/登录/退出/找回密码/邮箱确认，用户唯一身份为 **Supabase `user_id`（UID，UUID）**——后续收藏城市、用户偏好、AI 对话、DeepSeek 用量、Pro 权限、支付订单等表统一用该 UID 关联，**不用邮箱作为数据库主键**。注册用户 A/B 各自得到独立 UID，登录状态互不影响。

注册流程：`注册 → Turnstile 人机验证 → Supabase 创建用户（未确认）→ 阿里云 SMTP 发送数字验证码邮件 → 输入验证码（verifyOtp）→ 验证通过自动登录`。

### ① 服务端依赖（一次性）

需要三个外部服务，按官方引导注册即可：**Supabase**（认证 + 数据库，SMTP 指向阿里云邮件推送）、**阿里云邮件推送 DirectMail**（认证验证码邮件发送通道）、**Cloudflare Turnstile**（注册人机验证）。

### ② 配置 Vercel 环境变量

在「地图选点配置」的变量之外，追加：

| Name | Value | 说明 |
|---|---|---|
| `SUPABASE_URL` | `https://<项目号>.supabase.co` | 前端公开，构建时注入 `js/config.js` |
| `SUPABASE_ANON_KEY` | `sb_publishable_...` 或 `eyJ...` anon key | 前端公开（配合 RLS 保护数据） |
| `TURNSTILE_SITE_KEY` | Turnstile Site Key（`0x4...`） | 前端公开，构建时注入 |
| `CLOUDFLARE_TURNSTILE_SECRET` | Turnstile Secret Key | **仅服务端** `api/verify-turnstile.mjs` 读取，不进静态文件 |

### ③ 行为说明

- 页面：`auth.html`（登录/注册/找回密码三态）、`account.html`（邮箱 + 用户名 + UID + 退出）、`auth/callback.html`（找回密码回调）。
- 认证使用 supabase-js（`vendor/supabase.min.js` 本地化，implicit 流程，会话 localStorage 持久化，刷新不掉线）。
- 注册流程：邮箱 + 密码（可选用户名）→ Turnstile 人机验证 → `supabase.auth.signUp()` 发送验证码邮件（**已开启邮箱确认**，未确认用户无法登录）→ 页面切到第二步输入邮件中的验证码 → `verifyOtp` 验证通过即登录；找回密码仍走邮件链接。
- 注册表单带 Turnstile：前端拿到 token → `POST /api/verify-turnstile`（Vercel Function 用服务端 Secret Key 调 Cloudflare siteverify）→ 通过后才执行 `supabase.auth.signUp()`；Secret Key 不出现在任何静态文件或日志。
- 未配置环境变量时（本地开发），认证入口按钮保留但表单禁用并提示"认证服务未配置"，不影响天气查询等既有功能。
- 数据安全：所有用户表开启 **RLS** 并按 `user_id = auth.uid()` 配置策略；`profiles` 进一步使用列级权限，仅允许登录用户写入 `username`，会员等级、有效期与额度只能由可信服务端管理。anon key 才可安全暴露于前端。
- 管理端聚合视图 `user_favorites_view` 已迁至非 API 暴露的 `_admin` schema 并以 `security_invoker` 语义重建，**仅 `service_role` 可查**（SQL Editor 可直接 `SELECT * FROM _admin.user_favorites_view;`）；历史问题：public 下的旧视图曾因被误授 anon/authenticated 权限而可绕过 RLS 泄露全部用户邮箱/收藏，修复详见 `supabase/migrations/004_fix_user_favorites_view_security.sql`（003 已废弃，勿再执行）。

### ④ 用户数据表（profiles / favorites，已在 Supabase 建好）

- `profiles`：用户名（注册时可选填，账户页可修改）；`favorites`：收藏位置（名称 + 坐标 + 是否高德坐标），每位用户最多 20 个。
- 两张表均开启 RLS，按 `user_id = auth.uid()` 隔离；`profiles` 的登录用户写权限仅限 `username`，不能自行修改会员等级、有效期或额度；`username_taken` RPC 做用户名占用检查。
- 收藏上限由 `supabase/migrations/008_limit_user_favorites.sql` 的数据库触发器强制执行，并用事务级 advisory lock 防止多标签页或直接调用 API 并发越限；前端计数仅用于提前给出友好提示。该迁移已于 2026-08-10 部署至生产 Supabase。
- 读写封装在 `js/user.js`（`window.User`）：`getProfile / setUsername / listFavorites / addFavorite / removeFavorite`；收藏项点击即设为当前目的地并查询。

### ⑤ 验证码注册 · Supabase 控制台配置清单（一次性）

- **Authentication → Providers → Email**：开启 **Confirm email**；OTP Expiry 建议 300 秒（5 分钟，官方建议 ≤3600）。
- **Authentication → Emails → SMTP Settings**：启用 **Custom SMTP**（内置邮件服务全项目仅 2 封/小时，必须自配 SMTP 才能解除限流）：
  - Host `smtpdm.aliyun.com` / Port `465` / SMTP User 与 Sender email 均为阿里云发信地址（如 `noreply@你的域名.com`）/ Password 为阿里云邮件推送的 SMTP 密码。
- **Authentication → Email Templates → Confirm signup**：模板改为显示验证码（`{{ .Token }}`，位数由 Supabase 项目决定，6/8 位均支持），例如：
  ```html
  <h2>欢迎注册晴海</h2>
  <p>您的邮箱验证码是:</p>
  <h1 style="letter-spacing:4px;">{{ .Token }}</h1>
  <p>验证码 5 分钟内有效,请勿泄露给他人。</p>
  ```
- **Authentication → Rate Limits**（可选）：`rate_limit_otp`（OTP 发送）默认 30/小时，多人注册场景可调高至 60；同一邮箱 60 秒内只能重发一次（前端 60s 倒计时已对齐）。
- 验证码位数不写死在代码里：前端校验 4~10 位纯数字，实际位数以服务端为准。

## 已知限制

- Open-Meteo 免费接口有频率限制（约 600 次/分钟），目前每次查询 1-2 个请求，无需处理；后续若加自动刷新需注意节流。
- 国内访问 Open-Meteo 偶有延迟，页面已带 Loading 提示；如需加速可后续加轻量代理或缓存。
- ECMWF 免费接口的集合与主运行按约 5–15 天时效提供，第 8 天及以后仅作趋势参考（页面已提示）。
