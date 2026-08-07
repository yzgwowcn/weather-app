# 更新日志

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
