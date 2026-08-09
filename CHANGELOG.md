# 更新日志

## v1.20（2026-08-09）

### 变更
- **用户设置新增「默认区域」**：账户面板可设置默认区域（未设置默认海南省 / 海南省 / 四川省），保存后**下次进入/登录自动切换**到所选区域（偏好优先于 localStorage 记忆；未设置则维持现状——localStorage 记忆上次手动切换，首访默认海南）；保存提示「下次进入/登录时自动切换」
- **数据库迁移 `supabase/migrations/005_user_preferences_default_region.sql`**：`user_preferences` 新增 `default_region` 列 + CHECK 白名单（`NULL`/`hainan`/`sichuan`），RLS 四策略与 GRANT 原样不动（列继承表级权限，无提权面）；**需在 Supabase Dashboard → SQL Editor 手动执行本文件**
- **地图选点视角随区域**：四川模式打开地图默认成都居中（zoom 7 可见全省），海南模式维持三亚视角；已打开过的地图实例在区域切换后自动调整视角
- **区域-城市偏好联动**：设置面板修改默认区域时「默认城市」下拉即时重建为对应区域城市，原选中城市跨区域不存在时自动回落「未设置」，避免「区域=四川、城市=海南」不一致偏好
- **安全加固**：`default_region` 仅接受字符串 `hainan`/`sichuan`（前端白名单 + 数据库 CHECK 双保险）；`default_city` 增加类型与 50 字长度上限防垃圾数据入库；偏好应用置位标志前置到请求发出前，阻断 init/auth-change 重复请求与在途回调覆盖用户显式切换
- 新增 `tests/user-plan.test.js` 用例：`default_region` 非法值拒绝 / 合法值入库与 null 清除 / 读取透传

## v1.19（2026-08-09）

### 变更
- **新增「四川省模式」**：顶栏左上角新增「切换到四川省」按钮（玻璃胶囊样式），点击后页面整体切换为四川天气判断——标题变「晴川 · 四川旅行天气判断」，首屏/顶栏/页脚/渲染层提示文案同步配套；再次点击可切回海南。模式经 `localStorage`（`regionMode`）记忆，回访自动恢复
- **四川预设目的地**（全部内陆，不查询海况）：成都·市区（默认）、四川大学·江安校区、四川大学·望江校区、乐山·乐山大佛、峨眉山、九寨沟、都江堰；账号面板「默认城市」下拉随区域切换重建
- **区域判定双轨**：`Location` 新增 `SICHUAN_BOX` / `isInSichuan` / `regionOf`，搜索/坐标/地图/收藏四入口的区域外提示（⚠ 非四川 / 非海南）随当前模式取对应文案
- **安全与竞态加固**：区域外判定统一走 `regionOf(...) !== CURRENT_REGION`（修复四川模式下搜索选点误报「非区域」）；区域切换置位 `defaultCityApplied` 阻止在途偏好回调覆盖目的地；`REGION_TEXTS` 为纯常量无用户输入路径
- 新增 `tests/location.test.js` 四川范围与 `regionOf` 边界用例

## v1.18（2026-08-09）

### 变更
- **地图选点搜索改为自绘下拉**：`#map-search` 不再依赖 `AMap.AutoComplete`（其联想请求必须经 `/_AMapService` 代理，任何环境异常都会静默无反应），改为复用 `Location.searchPlaces` 双通道（高德 REST 优先 + Photon 兜底）自绘结果列表，点击/Enter 选中后坐标换算回 GCJ-02 并地图定位；下拉 `z-index: 200` 高于高德地图控件
- **主搜索下拉层级修复**：`.workspace` 的 `backdrop-filter` 创建层叠上下文把内部 `z-index` 困在 0 层，收藏框/时间轴 DOM 靠后而覆盖搜索下拉；`.workspace` 提升 `z-index: 10`、`.location-search` 提升 `z-index: 30` 后下拉正常浮于其上
- **安全加固**：天空剖面/云量曲线的 `data-time` 属性与 tooltip 中的时间字段统一经 `escapeText`/`escapeHtml` 转义（防御纵深，外部 API 数据不直接拼接 HTML）
- 新增 `tests/map-search.check.js`：AMap stub 下端到端验证地图搜索全流程（金牛区→下拉→定位）与主搜索下拉不被遮挡

## v1.17（2026-08-09）

### 变更
- **地名搜索提速：高德优先 + Photon 兜底双通道**：`API.searchLocation` 在 Vercel 部署环境（`AMAP_KEY` 已注入）下优先走高德 inputtips（经 `/_AMapService` 代理，国内节点、中文地名全），失败/本地开发自动回退 Photon；两个通道均加 8s 超时（AbortController），杜绝网络挂起时界面长时间无响应；高德 GCJ-02 结果由 `Location.searchPlaces` 统一换算为 WGS84 后再判海南范围
- **地图搜索支持全国**：`AMap.AutoComplete` 去掉 `city: '海南'` 限制，可搜索任意地点（选中后地图自动定位）；搜索输入框 placeholder 由「搜索海南地点（高德 POI）」改为「搜索地点（如 三亚、金牛区）」，地图按钮与容器文案同步去「海南」限定
- **搜索过程反馈**：输入后立即显示「搜索中…」占位，防抖与请求期间界面不再表现为无响应

## v1.16（2026-08-08）

### 变更
- **用户侧请求缓存**：同一地点 + 预报范围短时间重复查询时，先用 Metadata API（不计请求限额）对比 EC 模型 `last_run_availability_time`——模型未出新数据直接读 localStorage 缓存（零天气请求），模型更新后自动重新拉取；meta 查询失败时缓存 6 小时内直接使用
- **配额耗尽兜底**：天气请求返回 `Daily API request limit exceeded` 时，自动用缓存中对应模型的数据补齐（局部降级），页面不空白；429 响应的 reason 透传为可读错误
- 缓存容量保护：最多保留 8 个地点的缓存，超出删最旧；隐私模式/存储不可用时静默降级为直接请求

## v1.15（2026-08-08）

### 变更
- **首屏两栏顶部对齐**：intro 从垂直居中改为两栏顶部平齐（左 eyebrow 与右说明首行对齐），消除左右高度不一致
- **移动端标题去标点**：「看见晴天，再出发。」在移动端隐藏标点，两行居中重心更正（桌面保留原文）
- **模型时效真实化**：「多久前更新」不再用请求时刻（曾显示 0 分钟前），改为 Open-Meteo Metadata API 的 `last_run_availability_time`（模型数据在 API 可用的时间）；meta 缺失时显示「—」，不影响天气数据与状态灯

## v1.14（2026-08-08）

### 变更
- **逐日判断回归单一大框**：去掉每日独立卡片，整个逐日列表合并为一个玻璃圆角大框（22px，与查询面板/EC 主结论同规格），行分隔线 + 选中高亮保留，减少框体层级与视觉疲劳
- **各模型数据时效表**：首屏数据来源区新增 ECMWF IFS / NOAA GFS / JMA GSM / CMA GRAPES 时效表——每行显示「更新到」（数据覆盖至 MM-DD HH:00）与「多久前」（拉取时刻距今）；模型请求失败该行红灯并显示「未返回」；live 状态灯呼吸动画（`prefers-reduced-motion` 自动关闭）
- **移动端头部适配**：小红书按钮禁止文字换行；<560px 隐藏品牌名只留 logo + 「我的小红书」，间距与内边距收紧；<380px 只留 logo 圆形胶囊

## v1.13（2026-08-08）

### 变更
- **首屏两栏铺开**：大屏（≥800px）intro 改为左标题右说明的两栏布局并整体居中；右侧新增数据来源状态（来源列表 + 数据更新时间，查询后绿点点亮、数据缺失红点提示，由 `app.js` 实时更新）；移动端回落单栏整体居中，<420px 隐藏 eyebrow 横线防挤压
- **小红书按钮文字**：「我的小红书」字号与品牌名统一为 13px、纯白 #fff、字重 700
- **README 精简**：部署流程压缩为 4 步要点；账户系统章节删除服务端依赖详细配置表与数据库字段明细，压缩为概要

## v1.12（2026-08-08）

### 变更
- **头部统一与品牌精简**：登录/我的账户入口改为与小红书按钮同款玻璃胶囊（同背景/描边/圆角/字号/悬停动效）；移除两按钮之间 "海南旅行天气判断 / Open-Meteo" 字样，品牌名并入小红书按钮（「海南旅行天气判断 · 我的小红书」）
- **收藏区重构**：删除"我的收藏"标题，收藏区加装与查询面板同规格的玻璃圆角框（22px），内部控件圆角统一为 10px（收藏此位置按钮、收藏列表项、收藏名称输入与确认/取消按钮），内联样式全部迁移为 CSS 类
- **lucide 图标统一**：引入本地化 `vendor/lucide.min.js`（v0.525.0），收藏地点 📍→map-pin、坐标按钮 📌→crosshair、收藏此位置 ☆→star、删除 ✕→x，与地图选点等图标风格统一
- **逐日判断独立圆角卡片**：每天卡片改为独立玻璃圆角卡片（15px，glass-border + 模糊 + 内高光），去掉列表分隔线，展开的逐小时曲线跟随卡片圆角裁剪
- **首屏排版优化**：eyebrow 加两侧渐变横线装饰；说明文案口语化改写（"挑出海边适合出发的晴天窗口"）；新增数据来源小字（EC 集合 51 成员 · GFS / JMA / CMA 交叉验证）

### 测试
- 无头结构检查（lucide 图标注入、圆角计算样式、无 emoji 残留、360px 移动端无横向溢出）；`tests/search.check.js` 端到端回归（搜索/坐标查询/GCJ 换算）

## v1.11（2026-08-07）

### 变更
- **风力口径：平均风判断 + 短时阵风提醒**：出行判断改用日间平均风速（`<30 km/h`），不再受最大阵风影响；日间阵风 ≥40 km/h 的连续时段生成提醒徽章（⚠ 14:00–16:00 有短时大阵风，含峰值）；hero 依据与指标卡"最大风速"改为"平均风速"
- **EC 集合反超主运行**：主运行不适合但 EC 集合晴好率 ≥75% 时依旧建议出行（主运行为少数派），basis 注明"以集合晴好率为准"；逐日卡片图标同步使用最终结论
- **晴蓝视觉分档（data-cloud）**：按日间遮蔽云量分 clear（<30%）/ partly（30–60%）/ cloudy（≥60%）三档驱动背景——clear 为大太阳 + 亮蓝天（光斑增强）、partly 过渡提亮、cloudy 现状灰蓝，拉开晴/晴间多云/多云间晴的区分度

### 测试
- `tests/metrics.test.js`：平均风速边界、阵风窗口（不阻断 + 时段 + 峰值）、集合反超（≥75% 反超 / <75% 不反超）用例；跨 realm 数组断言改 JSON 比较

## v1.10（2026-08-07）

### 变更
- **天气图标三段式（早-中-晚）**：hero 与逐日卡片图标改为固定三段展示（早 08–10 / 中 11–13 / 晚 14–17），每段取主导天气码生成图标并标注"早/中/晚"标签（适合出行映射保留：毛毛雨→晴间多云伴零星阵雨、阴→晴间多云）；移除按实际变化分段与箭头分隔
- **逐日卡片图标居右**：卡片 grid 调整为"日期 | 条件 | 概率 | 图标"（图标区居右），移动端为"日期 | 条件 | 图标"两行布局，图标缩小适配

### 测试
- `tests/render.smoke.js`：断言更新为三段式（icon-period、早/中/晚标签、卡片 3 slot）

## v1.9（2026-08-07）

### 变更
- **面板回滚为亚克力质感**：移除 FluidGlass 流体折射（`js/fluid-glass.js`、React 全家桶 import map、`#fluid-glass` 层），五个玻璃面板恢复 `backdrop-filter` 亚克力模糊（workspace 16px / ec-hero 18px / metric-grid 14px / cross-stat 12px / date-chip 10px，含 saturate）；`--glass` 底、`--glass-border` 描边、`--shadow` 投影恢复 v1.4 Liquid Glass 数值；移除面板 `text-shadow`（亚克力模糊已保证可读性）
- **页面回归零第三方依赖**：不再加载 esm.sh（React/@react-three/drei/three），仅本地 `lottie.min.js` + 业务 JS
- **天气背景完整可见**：`body[data-mood]` 状态机（sunny 阳光光斑 / cloudy 云影 / windy 气流 / rain·storm 雨 / thunder 雨+闪电）不再被玻璃层遮挡

### 保留（v1.6–v1.8 非质感改进）
- meteocons Lottie 动态图标与图标序列（适合出行映射、放大 64/42px）
- sky 滚动容器圆角遮罩、雷阵雨闪电质感与频率随天气

## v1.8（2026-08-07）

### 变更
- **框体质感重做（参考 React Bits FluidGlass 官方组件）**：材质参数对齐官方配置（ior 1.15 / thickness 5 / chromaticAberration 0.1 / anisotropy 0.01）；**背景世界配色随天气状态变化**（sunny 暖金蓝 / cloudy 灰蓝 / windy 蓝绿 / rain·storm 深蓝灰 / thunder 紫金 / neutral 深蓝紫，MutationObserver 监听 `body[data-mood]` 热更新），面板折射不再发白（v1.7 明亮渐变导致）；面板白色底调低（`--glass-border`）、重投影减轻（`--shadow 0 18px 44px → 0 10px 28px`）、文字阴影减弱
- **天气图标序列**：hero 与逐日卡片按日间（08–17）小时天气码分段生成图标序列（最多 3 个/卡片 2 个，箭头分隔），展示"晴天转阵雨"等日内变化；**适合出行时**优先晴天/晴间多云，毛毛雨映射为"晴间多云伴零星阵雨"（`partly-cloudy-day-drizzle`）、阴天映射为晴间多云；新增 4 个组合 Lottie 图标（`assets/lottie/`）
- **图标放大**：hero 天气图标 44→64px、卡片 30→42px，卡片图标列改自适应

### 测试
- `tests/render.smoke.js`：新增图标序列断言（多图标 + 箭头 + 适合出行映射 + 卡片 ≤2 限制）

## v1.7（2026-08-07）

### 新增
- **天气图标 Lottie 化**：hero 与逐日卡片图标改用 meteocons Lottie 动画（`assets/lottie/*.json`，9 个），`lottie-web` 本地化（`vendor/lottie.min.js`），新增 `js/icons.js` 播放器（重渲染同步、reduced-motion 静态首帧）；雷雨徽章保持静态 SVG

### 变更（大修）
- **FluidGlass 采用官方技术栈重构**：`js/fluid-glass.js` 改为 React 19 + @react-three/fiber + @react-three/drei + maath + htm（esm.sh CDN import map，three 0.180 同源统一版本，消除双实例）；折射内容改为**明亮网站配色**（天蓝/暖金/淡紫渐变 + 亮色光斑），消除 v1.6 深色背景的"黑影"感；面板折射随鼠标流动改为采样位置偏移（`pos + uPointerTilt`），效果明显可见
- **天空剖面圆角遮罩**：`.sky-scroll` 滚动容器自带圆角 + 深色底（从 `.sky-svg` 迁移），滚动到最右也是圆角
- **雷阵雨闪电质感与频率**：多分支主干、分层泛白（全屏 + 云层区渐变）、双通道光晕、强雷暴三连闪、闪后余辉；闪电频率随雷暴强度变化——`Metrics.thunderIntensity`（雷雨窗口小时数/云量/降水/天气码加权）经 `data-thunder-intensity` 传给 `RainFX`，晴天短时雷雨 4.5–7s 低频、阴雨强雷暴 1.3–2.5s 高频

### 依赖
- `vendor/` 精简为仅 `lottie.min.js`（three 走 esm.sh）；`assets/icons/` 仅保留雷雨徽章 SVG

### 测试
- `tests/render.smoke.js`：图标断言改为 Lottie 容器（`data-lottie`）；`tests/css.check.js`：新增 sky-scroll 圆角断言

## v1.6（2026-08-07）

### 变更（可读性优化）
- **恢复天气背景**：`#fluid-glass` canvas 改为透明背景（不再显示全屏 FBO 渐变），`body[data-mood]` 天气状态机重新可见——晴天阳光光斑呼吸、多云云影、大风气流光带、雷阵雨闪电（`js/rain.js` Canvas 接管）
- **流体玻璃改为面板折射**：移除跟随鼠标的 `lens.glb` 透镜与全屏 quad；`.workspace / .ec-hero / .metric-grid / .cross-stat / .date-chip` 五个玻璃面板每个渲染为圆角折射 mesh（`MeshTransmissionMaterial`，ior 1.1 / thickness 5 / chromaticAberration 0.1，samples 6），位置/尺寸逐帧与 HTML 元素同步（滚动、重渲染、resize 均跟随）；折射方向随鼠标位置轻微流动（`uPointerTilt`，指数阻尼）——无透镜遮挡、不影响阅读
- **面板通透化**：五个折射面板去掉 `backdrop-filter` 模糊（模糊会盖掉折射层），底色透明度调低（`--glass` .055→.04）；新增轻量 `text-shadow` 补偿小字对比度；`site-header`/`sky-tooltip` 保留毛玻璃
- **依赖精简**：移除 `assets/3d/lens.glb`、`vendor/addons/`（GLTFLoader/DRACOLoader/BufferGeometryUtils）与 `vendor/draco/` 解码器，`vendor/` 仅保留 three.js 核心两文件

### 测试
- `tests/css.check.js` 断言更新：`saturate(1.5)` 检查替换为"折射面板不得使用 backdrop-filter"

## v1.5（2026-08-07）

### 新增
- 天气图标统一为 **meteocons fill 风格**（`@meteocons/svg-static`，MIT）：hero 天气符号、逐日卡片、雷雨徽章全部替换为本地化 SVG（`assets/icons/`），与 WMO 天气码一一映射
- **流体玻璃背景**（`js/fluid-glass.js`）：reactbits.dev FluidGlass（lens 模式）的 vanilla three.js 移植——`lens.glb` 透镜跟随鼠标，`MeshTransmissionMaterial` 折射 + 三通道 chromatic aberration（ior 1.1 / scale 0.15 / chromaticAberration 0.1，与 demo 参数一致），折射内容为网站暖金蓝背景渐变 + 柔和光斑；three.js 0.180 全部本地化（`vendor/`，含 Draco 解码器）；`prefers-reduced-motion` 降级为静态单帧
- 小红书入口换用官方 logo（`assets/xhs-logo.png`），胶囊底色改为深色玻璃，避免红上加红
- 网站 favicon（`assets/favicon.svg`，品牌蓝圆 + 太阳）

### 优化
- 页面层叠重构：背景（-1）→ 流体玻璃（0）→ 雨滴层（1）→ 内容（2）

## v1.4（2026-08-07）

### 新增
- 顶部小红书主页链接（品牌红渐变玻璃胶囊 + SVG 图标，新标签打开）
- 本地仓库规范：`.gitattributes`（LF 统一）、`.gitignore` 完善、本更新日志

### 优化
- 日期条滚动条与云层覆盖率图表统一为沉浸式细滚动条（thin + 半透明白）
- 一致性用语通俗化："成员一致/集合分散/主运行反向" → "EC 内部一致 / EC 内部有分歧 / 主运行与集合相反"，描述同步口语化
- 苹果 Liquid Glass 质感：渐变描边（padding-box/border-box 双背景）、顶部内高光、`backdrop-filter` 加 `saturate`，圆角略增
- 全局字号与对比度提升：11px 小字全部消除（11→12px、12→13px），`--muted`/`--ink` 提亮

### 修复
- 点击特定日期后日期条回到最左边的问题（滚动位置恢复 + 选中日期居中可见）

## v1.3（2026-08-07）

### 新增
- 日期选择上移至"是否建议出行"（EC 主结论）上方；天数长度选择保留在目的地下方
- `js/rain.js` Canvas 雨滴特效（零依赖）：斜向雨滴 + 头部亮点 + 落地涟漪；雷阵雨闪电 2.8–6s 随机双闪，`rain/storm/thunder` 状态自动启停，`prefers-reduced-motion` 不启动
- 移除 CSS 雨线与闪电关键帧，由 Canvas 接管

## v1.2（2026-08-07）

### 变更
- 出行口径放宽：日间无"中雨及以上"时段（61/63/65/80/81/82）且遮蔽云量严格 <75% 且风速 <30 km/h 即可出行；毛毛雨/雾/阴不阻断
- 雷阵雨（95/96/99）不阻断出行，hero 显示注意时段徽章（⚡ 13:00–15:00 有雷阵雨）
- 天气状态机扩展 thunder > storm > rain > windy > cloudy > sunny，页面恒为暖金晴底 + 叠加氛围层
- 明示海边天色重点看低云与中云（60/40 加权），高云仅供参考

## v1.1（2026-08-07）

### 新增
- EC 主判断：主运行"适合/不适合"结论 + EC 集合 51 成员晴好率；GFS/JMA/CMA 降为外部交叉验证
- 晴好率口径：08:00–18:00，遮蔽云量 = 低云×60% + 中云×40%（阈值 <50%，v1.2 起放宽为 <75%）
- EC 天空剖面：原生 SVG 三层云小时精度曲线、悬停/触控/键盘交互、EC/综合视图切换
- 两层一致性：EC 成员一致性 + 外部模型验证（支持/反对/缺失统计）
- 天气响应式毛玻璃界面（v1.3 起为暖金晴底 + 状态叠加）
- 指标夹具测试 + 渲染冒烟 + Playwright 端到端验证

## v1.0（2026-08-07）

- 最小可用原型：目的地选择、3/7/14 天查询、综合预报晴好概率、近海海况
