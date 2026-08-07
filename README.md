# 晴海 · 海南旅行天气判断

面向海南旅游读者的**纯前端天气判断网页**：以 ECMWF（EC）为主判断来源，选择目的地（三亚·亚龙湾 / 陵水·清水湾 / 海棠湾·蜈支洲岛 / 万宁·神州半岛 / 后海·分界洲岛），查询未来 3/7/14 天天气与近海海况。

核心卖点（读者最关心）：
- **EC 主判断**：首屏直接给出 ECMWF 主运行的"适合出行 / 不建议出行"结论；EC 集合 51 个成员的晴好率（满足页面条件的成员比例）为页面主概率；GFS、JMA、CMA 仅作外部交叉验证，不再与 EC 等权抢占结论。
- **晴好率口径**：北京时间 08:00–18:00，有效遮蔽云量 = 低云均值×60% + 中云均值×40%，严格低于 50% 满足天空条件；高云单独绘制与提示、不参与扣分；日间累计降水严格 <1 mm、最大风速严格 <30 km/h 为必要条件。
- **EC 天空剖面**：原生 SVG 小时精度图表，低/中/高三条平滑曲线、白天时段浅色带、日界线与选中准星；悬停/触控/键盘查看逐小时三层云、加权遮蔽云量、降水与风速；14 天保持小时精度并可横向滚动；支持 EC / 综合预报视图切换。
- **两层一致性**：`EC 成员一致性`（集合晴好率是否集中于高/低区间 + 主运行方向是否一致）与 `外部模型验证`（GFS/JMA/CMA 支持数、反对数与缺失来源，明确为模型分歧提示）。
- **天气氛围界面**：页面背景按选中日 EC 数据切换 sunny / cloudy / rainy / windy / storm 状态（暖金光晕、雾化云影、雨线、气流光带，雨+大风优先风雨态）；多层毛玻璃面板、细白描边、低饱和主题色；全部动效为 CSS，遵守 `prefers-reduced-motion`。
- **近海海况**：保留海洋网格的浪高、周期与涌浪提示。

- 数据源：[Open-Meteo](https://open-meteo.com/)（免费、无需 API Key、支持浏览器 CORS 直连）
- 技术栈：原生 HTML + CSS + Vanilla JS，零依赖、零后端（图表为原生 SVG，无图表库）
- 部署方式：GitHub 仓库 → Vercel 导入 → 挂载自定义域名（国内可访问）
- 数据口径：时区 `Asia/Shanghai`、海洋网格 `cell_selection=sea`、时效分层提示

> ⚠️ 本站为 Open-Meteo 模式指导，**非官方预警**。"EC 更准确"是产品展示优先级，并非对所有地点、天气型和预报时效的准确率声明；晴好率反映集合成员分布，不是经过海南当地历史回测校准的真实发生率。台风、大风、暴雨等场景请以中央气象台（[nmc.cn](https://www.nmc.cn)）、当地气象台、码头与景区通知为准。

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
node tests/metrics.test.js    # 指标夹具测试（新口径边界：高云不扣分、加权 50%、1mm、30km/h、集合缺失、外部部分失败等）
node tests/render.smoke.js    # 渲染层冒烟（区块顺序、视图切换、准星）
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
├── index.html          # 页面骨架（移动端优先，body[data-mood] 初始 neutral）
├── css/
│   └── style.css       # 毛玻璃视觉系统 + 天气状态机 + reduced-motion + 响应式
├── js/
│   ├── config.js       # 预设目的地坐标 + 默认参数
│   ├── api.js          # 综合预报、多模型（含三层云）、集合预报与海况请求
│   ├── metrics.js      # EC 主结论、加权遮蔽、成员一致性、外部验证、云图序列、天气状态机
│   ├── render.js       # 首屏区块 + SVG 天空剖面 + 视图切换（只消费结构化日级结果）
│   └── app.js          # 主控制器（选择→查询→渲染 + 图表交互 + mood 应用）
├── tests/
│   ├── metrics.test.js # 无依赖指标夹具测试（node tests/metrics.test.js）
│   ├── render.smoke.js # 渲染层无依赖冒烟测试
│   └── e2e.check.js    # Playwright 端到端（真实 API）
├── assets/             # 预留（图标等）
└── README.md
```

## Phase 2 规划（后续迭代）

- [ ] **任意地点搜索**：接入 Open-Meteo Geocoding API，输入中文地名即可查询（不限于预设 5 地）
- [ ] **台风/预警联动**：结果区提供中央气象台台风网（typhoon.nmc.cn）跳转链接，接入 CMA 中国模型参数
- [ ] **与小红书笔记联动**：页面顶部嵌入最新笔记链接，形成"笔记看分析 → 网页查实时"闭环
- [ ] **PWA 化**：`manifest.json` + Service Worker，读者可"添加到桌面"
- [ ] **行程建议**：按 skill 第 5 节逻辑生成通用出行提示
- [ ] **低云/中云权重调参**：60/40 权重与 50% 阈值目前固定，后续可根据旅行反馈单独调整

## 已知限制

- Open-Meteo 免费接口有频率限制（约 600 次/分钟），目前每次查询 1-2 个请求，无需处理；后续若加自动刷新需注意节流。
- 国内访问 Open-Meteo 偶有延迟，页面已带 Loading 提示；如需加速可后续加轻量代理或缓存。
- ECMWF 免费接口的集合与主运行按约 5–15 天时效提供，第 8 天及以后仅作趋势参考（页面已提示）。
