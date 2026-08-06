# 🌤️ 海南天气旅行查询

面向海南旅游读者的**纯前端天气查询网页**：选择目的地（三亚·亚龙湾 / 陵水·清水湾 / 海棠湾·蜈支洲岛 / 万宁·神州半岛 / 后海·分界洲岛），查询未来 3/7/14 天天气与近海海况。

核心卖点（读者最关心）：
- **云量可视化**：每日云量条（蓝→灰渐变），一目了然
- **蓝海可见度判断**：按云量四档提示「云量低，蓝海绝佳 / 间或有云，蓝海可见 / 多云，海景一般 / 阴天，海景受限」
- **每日分时段**：上午/下午/傍晚/夜间四段聚合（云量、温度、降水概率/雨量、天气），今天+明天默认展开
- 少量阵雨不影响出行——时段级降水概率帮读者判断"能不能去海边"

- 数据源：[Open-Meteo](https://open-meteo.com/)（免费、无需 API Key、支持浏览器 CORS 直连）
- 技术栈：原生 HTML + CSS + Vanilla JS，零依赖、零后端
- 部署方式：GitHub 仓库 → Vercel 导入 → 挂载自定义域名（国内可访问）
- 数据口径：与 `weather-note-analysis` skill 的数据合约一致（时区 `Asia/Shanghai`、海洋网格 `cell_selection=sea`、时效分层提示）

> ⚠️ 本站为 Open-Meteo 模式指导，**非官方预警**。台风、大风、暴雨等场景请以中央气象台（[nmc.cn](https://www.nmc.cn)）、当地气象台、码头与景区通知为准。

## 本地运行

直接双击打开 `index.html` 即可（现代浏览器均支持 fetch + CORS）。

或起一个本地静态服务器：

```bash
npx serve .
# 或
python -m http.server 8080
```

## 部署到 Vercel（挂载自己的域名）

1. **推送 GitHub**：在 GitHub 新建仓库（如 `weather-app`），然后：

   ```bash
   cd weather-app
   git init
   git add -A
   git commit -m "feat: 最小可用原型 — 海南天气旅行查询网页"
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
├── index.html          # 页面骨架（移动端优先）
├── css/
│   └── style.css       # 暖色调响应式样式
├── js/
│   ├── config.js       # 预设目的地坐标 + 默认参数
│   ├── api.js          # Open-Meteo Forecast / Marine 封装
│   ├── render.js       # weather_code 中文映射 + 卡片渲染
│   └── app.js          # 主控制器（选择→查询→渲染）
├── assets/             # 预留（图标等）
└── README.md
```

## Phase 2 规划（后续迭代）

- [ ] **任意地点搜索**：接入 Open-Meteo Geocoding API，输入中文地名即可查询（不限于预设 5 地）
- [ ] **逐小时详情**：0-72h 折叠展开逐小时天气（温度/降雨/风）
- [ ] **「蓝海指数」综合评分**：云量 40% + 降水概率 30% + 风力 30% 的加权评分
- [ ] **台风/预警联动**：结果区提供中央气象台台风网（typhoon.nmc.cn）跳转链接，接入 CMA 中国模型参数
- [ ] **与小红书笔记联动**：页面顶部嵌入最新笔记链接，形成"笔记看分析 → 网页查实时"闭环
- [ ] **PWA 化**：`manifest.json` + Service Worker，读者可"添加到桌面"
- [ ] **行程建议**：按 skill 第 5 节逻辑生成通用出行提示

## 已知限制

- Open-Meteo 免费接口有频率限制（约 600 次/分钟），目前每次查询 1-2 个请求，无需处理；后续若加自动刷新需注意节流。
- 国内访问 Open-Meteo 偶有延迟，页面已带 Loading 提示；如需加速可后续加轻量代理或缓存。
