// 主控制器：维护选择状态与图表交互，协调多源请求，将归一化结果交给渲染层，
// 并把渲染层输出的 weatherMood 应用到页面背景状态机。
(() => {
  'use strict';
  const state = { region: readRegion(), dest: null, days: DEFAULT_DAYS, bundle: null, selectedDate: null, skyView: 'ec', skyIndex: null, cloudPick: null, customDest: null };
  state.dest = currentDestinations()[0];
  const destListEl = document.getElementById('dest-list');
  const daysGroupEl = document.getElementById('days-group');
  const queryBtnEl = document.getElementById('query-btn');
  const regionToggleEl = document.getElementById('region-toggle');
  const resultEl = document.getElementById('result');
  const loadingEl = document.getElementById('loading');
  const searchInputEl = document.getElementById('location-search');
  const searchResultsEl = document.getElementById('search-results');
  const coordToggleEl = document.getElementById('coord-toggle');
  const coordInputEl = document.getElementById('coord-input');
  const coordLatEl = document.getElementById('coord-lat');
  const coordLonEl = document.getElementById('coord-lon');
  const coordGcjEl = document.getElementById('coord-is-gcj');
  const coordConfirmEl = document.getElementById('coord-confirm');
  const mapPanelEl = document.getElementById('map-panel');
  const mapBtnEl = document.getElementById('map-btn');
  const mapCloseEl = document.getElementById('map-close');
  const mapContainerEl = document.getElementById('map-container');
  const mapSearchEl = document.getElementById('map-search');
  const mapSearchResultsEl = document.getElementById('map-search-results');
  const mapPickNameEl = document.getElementById('map-pick-name');
  const mapCoordsEl = document.getElementById('map-coords');
  const mapLocateEl = document.getElementById('map-locate');
  const mapConfirmEl = document.getElementById('map-confirm');
  const mapCancelEl = document.getElementById('map-cancel');
  let searchItems = [];
  let requestSeq = 0;
  let abortController = null;

  // ---- 区域模式：海南（默认）/ 四川，localStorage 记忆，顶栏按钮切换 ----
  const REGION_STORAGE_KEY = 'regionMode';
  function readRegion() {
    try {
      return localStorage.getItem(REGION_STORAGE_KEY) === 'sichuan' ? 'sichuan' : 'hainan';
    } catch (e) { return 'hainan'; } // 存储不可用：回落默认区域
  }
  function currentDestinations() { return REGIONS[state.region]; }

  // 应用当前区域文案（标题/meta/eyebrow/首屏/顶栏/页脚/按钮），供初始化与切换共用
  function applyRegionTexts() {
    const t = REGION_TEXTS[state.region];
    document.title = t.title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t.metaDescription);
    const eyebrow = document.querySelector('.eyebrow');
    if (eyebrow) eyebrow.innerHTML = `<span class="eyebrow-line" aria-hidden="true"></span>${t.eyebrow}<span class="eyebrow-line" aria-hidden="true"></span>`;
    const introCopy = document.querySelector('.intro-copy');
    if (introCopy) introCopy.textContent = t.introCopy;
    const xhsBrand = document.querySelector('.xhs-brand');
    if (xhsBrand) xhsBrand.textContent = t.xhsBrand;
    const xhsLink = document.querySelector('.xhs-link');
    if (xhsLink) xhsLink.setAttribute('aria-label', t.xhsAria);
    const footers = document.querySelectorAll('.footer p');
    if (footers.length >= 2) {
      footers[0].textContent = t.footer[0];
      footers[1].textContent = t.footer[1];
    }
    if (regionToggleEl) {
      regionToggleEl.textContent = '切换到' + t.switchTo;
      regionToggleEl.setAttribute('aria-label', '切换到' + t.switchTo);
    }
  }
  function switchRegion(next) {
    if (next === state.region || !REGIONS[next]) return;
    state.region = next;
    CURRENT_REGION = next;
    // 切换即显式进入该区域默认状态：阻止在途偏好回调覆盖目的地（竞态防护）
    savedPrefsApplied = true;
    try { localStorage.setItem(REGION_STORAGE_KEY, next); } catch (e) { /* 存储不可用：仅本次会话生效 */ }
    // 切换后进入该区域默认目的地（成都·市区 / 三亚·亚龙湾），清除自定义选点
    state.dest = REGIONS[next][0];
    state.customDest = null;
    applyRegionTexts();
    renderDestButtons();
    // 通知账号面板刷新「默认城市」下拉选项
    document.dispatchEvent(new CustomEvent('region-change', { detail: { region: next } }));
    query();
  }

  function toast(message) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('visible'), 2600);
  }

  // ---- 登录门槛：未登录仅可查 3/7 天，点击 14 天时 toast 提示登录（不再禁用，保证点击可感知） ----
  function isLoggedIn() {
    return !!(window.Auth && window.Auth.isReady && window.Auth.isReady() && window.Auth.getUser());
  }
  function applyDayAccess() {
    const loggedIn = isLoggedIn();
    daysGroupEl.querySelectorAll('.days-btn').forEach((button) => {
      if (Number(button.dataset.days) >= 14) {
        button.title = loggedIn ? '' : '登录后可查看 14 天预报';
        button.setAttribute('aria-disabled', String(!loggedIn));
      }
    });
    // 异常状态防御：未登录时若选中 14 天则强制回退 7 天
    if (!loggedIn && state.days >= 14) {
      state.days = 7;
      daysGroupEl.querySelectorAll('.days-btn').forEach((item) => item.classList.toggle('active', Number(item.dataset.days) === 7));
    }
  }

  // ---- 登录偏好：默认区域 + 默认城市（auth 异步就绪后经 auth-change 触发）----
  // 优先级：偏好区域 > localStorage 记忆；偏好未设置时保持现状（未设置即默认海南省）
  let savedPrefsApplied = false;
  function applySavedPrefs() {
    if (savedPrefsApplied) return;
    if (!isLoggedIn()) return;
    savedPrefsApplied = true; // 在请求发出前置位：无论成败只应用一次，同时阻断 init/auth-change 重复请求与在途回调覆盖显式切换
    window.User.getPreferences().then(function (r) {
      if (!r.ok || !r.preferences) return;
      let changed = false;
      const region = r.preferences.default_region;
      if ((region === 'hainan' || region === 'sichuan') && region !== state.region) {
        state.region = region;
        CURRENT_REGION = region;
        try { localStorage.setItem(REGION_STORAGE_KEY, region); } catch (e) { /* 存储不可用：仅本次生效 */ }
        state.dest = REGIONS[region][0];
        state.customDest = null;
        applyRegionTexts();
        changed = true;
      }
      const dest = currentDestinations().find((d) => d.id === r.preferences.default_city);
      if (dest && dest.id !== state.dest.id) {
        state.dest = dest;
        changed = true;
      }
      if (changed) {
        renderDestButtons();
        document.dispatchEvent(new CustomEvent('region-change', { detail: { region: state.region } }));
        query();
      }
    });
  }

  function dateStr(offsetDays) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function renderDestButtons() {
    const customBtn = state.customDest
      ? `<button type="button" class="dest-btn custom ${state.dest.id === 'custom' ? 'active' : ''}" data-id="custom" aria-pressed="${state.dest.id === 'custom'}">
          <span>${escapeHtml(state.customDest.name)}</span><span class="dest-tag">自定义</span>
        </button>` : '';
    destListEl.innerHTML = currentDestinations().map((dest) => `
      <button type="button" class="dest-btn ${dest.id === state.dest.id ? 'active' : ''}" data-id="${dest.id}" aria-pressed="${dest.id === state.dest.id}">
        <span>${dest.name}</span>${dest.marine ? '<span class="dest-tag">近海</span>' : ''}
      </button>`).join('') + customBtn;
    destListEl.querySelectorAll('.dest-btn').forEach((button) => button.addEventListener('click', () => {
      state.dest = button.dataset.id === 'custom' ? { ...state.customDest } : currentDestinations().find((dest) => dest.id === button.dataset.id);
      renderDestButtons();
    }));
    // 目的地变化通知（地图背景光点高亮等订阅方）；所有目的地变更路径都经 renderDestButtons 汇聚
    document.dispatchEvent(new CustomEvent('dest-change'));
  }
  function closeSearchResults() {
    searchResultsEl.classList.add('hidden');
    searchResultsEl.innerHTML = '';
  }
  async function handleSearchInput() {
    const q = searchInputEl.value.trim();
    if (!q) { closeSearchResults(); return; }
    // 请求发出前先给出反馈（防抖 + 网络请求期间），避免界面看起来"没反应"
    searchResultsEl.innerHTML = '<li class="search-empty">搜索中…</li>';
    searchResultsEl.classList.remove('hidden');
    const results = await Location.searchPlaces(q); // 防抖集中在 Location 层
    if (searchInputEl.value.trim() !== q) return; // 过期响应不再覆盖新输入与结果
    searchItems = results;
    if (!searchItems.length) {
      searchResultsEl.innerHTML = '<li class="search-empty">未找到相关地点，换个关键词试试，或使用「坐标」手动输入</li>';
      searchResultsEl.classList.remove('hidden');
      return;
    }
    searchResultsEl.innerHTML = searchItems.map((item, index) => `
      <li role="option" class="search-item" data-index="${index}">
        <span class="search-item-name">${escapeHtml(item.name)}</span>
        ${item.region ? `<span class="search-item-region">${escapeHtml(item.region)}</span>` : ''}
        <span class="search-item-coord">${Location.coordLabel(item.lat, item.lon)}</span>
        ${item.inRegion === state.region ? '' : `<span class="search-item-tag">${REGION_TEXTS[state.region].regionTag}</span>`}
      </li>`).join('');
    searchResultsEl.classList.remove('hidden');
  }
  function selectSearchItem(index) {
    const item = searchItems[index];
    if (!item) return;
    if (item.inRegion !== state.region) toast(REGION_TEXTS[state.region].regionToast);
    state.customDest = { id: 'custom', name: item.name, lat: item.lat, lon: item.lon, marine: false, outOfRegion: item.inRegion !== state.region };
    state.dest = state.customDest;
    searchInputEl.value = '';
    closeSearchResults();
    renderDestButtons();
    query();
  }
  // 收藏功能接入点：获取当前选中位置（预设目的地/自定义）
  window.__getCurrentDest = function () {
    return { name: state.dest.name, lat: state.dest.lat, lon: state.dest.lon, is_gcj: false };
  };
  // 收藏功能接入点：选中收藏项 → 设为当前目的地并立即查询（收藏为主动保存，区域外同样给出提示）
  window.__WeatherSelectDest = function (name, lat, lon) {
    state.customDest = { id: 'custom', name: name, lat: lat, lon: lon, marine: false, outOfRegion: Location.regionOf(lat, lon) !== state.region };
    state.dest = state.customDest;
    renderDestButtons();
    query();
  };
  // 各模型数据时效表：模型名（状态灯：正常绿 / error 红）· 更新到（hourly 末项）· 多久前（Metadata API 的 last_run_availability_time 距今）
  function renderModelTable() {
    const wrap = document.getElementById('model-table');
    if (!wrap) return;
    const det = state.bundle && state.bundle.deterministic;
    if (!det) {
      wrap.innerHTML = '<div class="model-row placeholder"><span>查询后显示各模型数据时效</span></div>';
      return;
    }
    const meta = state.bundle && state.bundle.modelMeta;
    const now = Date.now();
    const rows = ['ECMWF IFS', 'NOAA GFS', 'JMA GSM', 'CMA GRAPES'].map(function (name) {
      const m = det[name];
      if (!m || m.error || !m.hourly || !m.hourly.time || !m.hourly.time.length) {
        return '<div class="model-row dead"><span class="model-name"><i class="status-dot" aria-hidden="true"></i>' + name + '</span><span class="model-upto">未返回</span><span class="model-ago">—</span></div>';
      }
      const last = String(m.hourly.time[m.hourly.time.length - 1]).slice(5, 16).replace('T', ' ');
      // "多久前更新" = 模型数据在 API 可用的时间（last_run_availability_time，Unix 秒）距今
      let ago = '—';
      const mMeta = meta && meta[name];
      const avail = mMeta && !mMeta.error ? Number(mMeta.last_run_availability_time) : NaN;
      if (Number.isFinite(avail) && avail > 0) {
        const mins = Math.max(0, Math.round((now / 1000 - avail) / 60));
        ago = mins < 60 ? mins + ' 分钟前' : Math.floor(mins / 60) + ' 小时前';
      }
      return '<div class="model-row live"><span class="model-name"><i class="status-dot" aria-hidden="true"></i>' + name + '</span><span class="model-upto">' + last + '</span><span class="model-ago">' + ago + '</span></div>';
    });
    wrap.innerHTML = rows.join('');
  }
  // 首屏数据来源状态：未查询 / 更新至（取 hourly 最后时间戳）/ 暂不可用
  function updateDataStatus() {
    const el = document.getElementById('data-status');
    if (!el) return;
    const f = state.bundle && state.bundle.forecast;
    const ok = f && !f.error && f.hourly && f.hourly.time && f.hourly.time.length;
    el.classList.toggle('live', !!ok);
    el.classList.toggle('dead', !!(f && f.error));
    const textEl = el.querySelector('.status-text');
    if (!textEl) return;
    if (!ok) {
      textEl.textContent = f && f.error ? '数据：暂不可用' : '数据：尚未查询';
    } else {
      const last = String(f.hourly.time[f.hourly.time.length - 1]).slice(0, 16).replace('T', ' ');
      textEl.textContent = '数据更新至 ' + last + '（北京时间）';
    }
    renderModelTable();
  }
  function renderResult() {
    const oldScroll = resultEl.querySelector('.sky-scroll');
    const scrollLeft = oldScroll ? oldScroll.scrollLeft : 0;
    const oldRail = resultEl.querySelector('.date-rail');
    const railLeft = oldRail ? oldRail.scrollLeft : 0;
    resultEl.innerHTML = renderWeatherApp(state.bundle, state.dest, state.days, state.selectedDate, { skyView: state.skyView, skyIndex: state.skyIndex });
    updateDataStatus();
    const mood = resultEl.querySelector('[data-mood]')?.dataset.mood || 'neutral';
    document.body.dataset.mood = mood;
    // 云量分档（clear/partly/cloudy）驱动背景晴蓝视觉
    const cloudBand = resultEl.querySelector('[data-cloud]')?.dataset.cloud;
    if (cloudBand) document.body.dataset.cloud = cloudBand;
    // 雨滴特效：rain/storm/thunder 启动（thunder 额外开闪电，强度随雷暴数据）；reduced-motion 不启动
    if (mood === 'rain' || mood === 'storm' || mood === 'thunder') {
      const heroEl = resultEl.querySelector('[data-mood]');
      const intensity = Number(heroEl?.dataset.thunderIntensity);
      RainFX.start({ lightning: mood === 'thunder', intensity: Number.isFinite(intensity) ? intensity : 0.5 });
    } else {
      RainFX.stop();
    }
    const newScroll = resultEl.querySelector('.sky-scroll');
    if (newScroll) newScroll.scrollLeft = scrollLeft;
    const newRail = resultEl.querySelector('.date-rail');
    if (newRail) {
      // 恢复日期条横向滚动位置；选中日期时仅横向居中该 chip（只滚动 rail 容器，
      // 不调用 scrollIntoView，避免页面被纵向滚回顶部）
      newRail.scrollLeft = railLeft;
      if (state.selectedDate) {
        const chip = newRail.querySelector(`[data-select-date="${state.selectedDate}"]`);
        if (chip) {
          newRail.scrollLeft = Math.max(0, chip.offsetLeft - (newRail.clientWidth - chip.offsetWidth) / 2);
        }
      }
    }
    // 恢复持久选中时刻的详情浮层（点击/键盘选中后跨重渲染保留）
    if (state.skyIndex != null) {
      const chart = resultEl.querySelector('.sky-view-pane:not([hidden]) [data-sky-chart]');
      const hit = chart?.querySelector(`.sky-hit[data-index="${state.skyIndex}"]`);
      if (hit) updateSkyCursor(chart, hit);
    }
    // 恢复云量曲线持久选中（仅当展开区日期匹配时）
    if (state.cloudPick) {
      const cloudChart = resultEl.querySelector(`.cloud-chart[data-date="${state.cloudPick.date}"]`);
      const cloudHit = cloudChart?.querySelector(`.cloud-hit[data-index="${state.cloudPick.index}"]`);
      if (cloudHit) updateCloudCursor(cloudChart, cloudHit);
    }
  }
  // 悬停/触控提示：更新图表准星与数值卡，不触发整页重渲染
  function updateSkyCursor(chart, hit) {
    const crosshair = chart.querySelector('.sky-crosshair');
    const tooltip = chart.querySelector('.sky-tooltip');
    if (!crosshair || !tooltip) return;
    const x = Number(hit.dataset.x);
    const d = hit.dataset;
    crosshair.style.transform = `translateX(${x}px)`;
    crosshair.classList.add('visible');
    const fmt = (value, unit) => (value === '' ? '—' : `${value}${unit}`);
    tooltip.innerHTML = `
      <strong>${escapeHtml(d.time)}</strong>
      <span>低云 <b>${fmt(d.low, '%')}</b></span>
      <span>中云 <b>${fmt(d.mid, '%')}</b></span>
      <span>高云 <b>${fmt(d.high, '%')}</b></span>
      <span>遮蔽 <b>${fmt(d.mask, '%')}</b></span>
      <span>降水 <b>${fmt(d.precip, ' mm')}</b></span>
      <span>风速 <b>${fmt(d.wind, ' km/h')}</b></span>`;
    const chartRect = chart.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth;
    const left = Math.min(Math.max(x, tooltipWidth / 2 + 6), chartRect.width - tooltipWidth / 2 - 6);
    tooltip.style.left = `${left}px`;
    tooltip.classList.add('visible');
  }
  function hideSkyCursor(chart) {
    chart.querySelector('.sky-crosshair')?.classList.remove('visible');
    chart.querySelector('.sky-tooltip')?.classList.remove('visible');
  }
  // 悬停/触控提示：云量曲线准星与数值卡（低云/中云/降雨量），不触发整页重渲染
  function updateCloudCursor(chart, hit) {
    const crosshair = chart.querySelector('.cloud-crosshair');
    const tooltip = chart.querySelector('.cloud-tooltip');
    if (!crosshair || !tooltip) return;
    const x = Number(hit.dataset.x);
    const d = hit.dataset;
    crosshair.style.transform = `translateX(${x}px)`;
    crosshair.classList.add('visible');
    const fmt = (value, unit) => (value === '' ? '—' : `${value}${unit}`);
    tooltip.innerHTML = `
      <strong>${escapeHtml(d.time)}</strong>
      <span>低云 <b>${fmt(d.low, '%')}</b></span>
      <span>中云 <b>${fmt(d.mid, '%')}</b></span>
      <span>降雨 <b>${fmt(d.precip, ' mm')}</b></span>`;
    const chartRect = chart.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth;
    const left = Math.min(Math.max(x, tooltipWidth / 2 + 6), chartRect.width - tooltipWidth / 2 - 6);
    tooltip.style.left = `${left}px`;
    tooltip.classList.add('visible');
  }
  function hideCloudCursor(chart) {
    chart.querySelector('.cloud-crosshair')?.classList.remove('visible');
    chart.querySelector('.cloud-tooltip')?.classList.remove('visible');
  }
  function openMapPanel() {
    if (!Location.isAMapReady()) {
      toast('高德地图未加载：请在 js/config.js 配置 AMAP_CONFIG.key 后刷新');
      return;
    }
    mapPanelEl.classList.add('open');
    mapPanelEl.setAttribute('aria-hidden', 'false');
    mapBtnEl.disabled = true;
    Location.initMap(mapContainerEl, {
      onUI: (pick) => {
        mapPickNameEl.textContent = pick && pick.name
          ? `${pick.name}${pick.region ? ' · ' + pick.region : ''}`
          : '点击地图放置选点标记，可拖动 Marker 微调';
        mapCoordsEl.textContent = pick ? `WGS84 ${Location.coordLabel(pick.lat_wgs, pick.lng_wgs)}（供天气查询）` : '—';
        mapConfirmEl.disabled = !pick;
      },
    });
    Location.bindMapSearch(mapSearchEl, mapSearchResultsEl);
  }
  function closeMapPanel() {
    mapPanelEl.classList.remove('open');
    mapPanelEl.setAttribute('aria-hidden', 'true');
    mapBtnEl.disabled = !Location.isAMapReady();
    Location.clearMapSearch(mapSearchEl, mapSearchResultsEl);
  }
  function confirmMapPick() {
    const pick = Location.getMapPick();
    if (!pick) { toast('请先在地图上放置选点标记'); return; }
    const name = pick.name ? `${pick.name}（地图选点）` : Location.formatCoordName(pick.lat_wgs, pick.lng_wgs);
    const outOfRegion = Location.regionOf(pick.lat_wgs, pick.lng_wgs) !== state.region;
    if (outOfRegion) toast(REGION_TEXTS[state.region].regionToast);
    state.customDest = { id: 'custom', name, lat: pick.lat_wgs, lon: pick.lng_wgs, marine: false, outOfRegion, source: 'map' };
    state.dest = state.customDest;
    closeMapPanel();
    renderDestButtons();
    query();
  }
  async function locateCurrent() {
    const pos = await Location.getCurrentPosition();
    if (!pos.ok) { toast('定位失败或已拒绝，请检查浏览器定位权限'); return; }
    Location.focusMapPick(pos.lng_gcj, pos.lat_gcj, 12);
  }
  async function query() {
    // 登录门槛守卫：未登录时 14 天请求强制回退 7 天
    if (!isLoggedIn() && state.days >= 14) {
      state.days = 7;
      applyDayAccess();
    }
    const start = dateStr(0);
    const end = dateStr(state.days - 1);
    const seq = ++requestSeq;
    // 并发控制：取消上一次未完成的查询，仅最新一次结果可写入
    abortController?.abort();
    abortController = new AbortController();
    queryBtnEl.disabled = true;
    loadingEl.textContent = `正在汇集 ${state.dest.name} 附近的模型数据`;
    loadingEl.classList.remove('hidden');
    resultEl.setAttribute('aria-busy', 'true');
    const bundle = await API.fetchBundle(state.dest, start, end, abortController.signal);
    if (seq !== requestSeq) return; // 过期响应丢弃
    state.bundle = bundle;
    state.selectedDate = null;
    state.skyIndex = null;
    state.cloudPick = null;
    loadingEl.classList.add('hidden');
    queryBtnEl.disabled = false;
    resultEl.removeAttribute('aria-busy');
    renderResult();
  }
  function init() {
    CURRENT_REGION = state.region;
    applyRegionTexts();
    renderDestButtons();
    applyDayAccess();
    applySavedPrefs();
    // 登录状态变化（登录/退出）：刷新 14 天门槛；登录后应用默认区域与默认城市（auth.js 异步初始化完成后触发）
    document.addEventListener('auth-change', function (e) {
      applyDayAccess();
      if (e.detail && e.detail.user) applySavedPrefs();
    });
    // 设置面板保存默认城市后：立即切换目的地并重新查询
    document.addEventListener('pref-saved', (e) => {
      const city = e.detail && e.detail.default_city;
      if (!city) return;
      const dest = currentDestinations().find((d) => d.id === city);
      if (!dest) return;
      state.dest = dest;
      renderDestButtons();
      query();
    });
    daysGroupEl.querySelectorAll('.days-btn').forEach((button) => button.addEventListener('click', () => {
      // 登录门槛：未登录点击 14 天 → toast 提示，不切换
      if (Number(button.dataset.days) >= 14 && !isLoggedIn()) {
        toast('登录后可查看 14 天预报');
        return;
      }
      state.days = Number(button.dataset.days);
      daysGroupEl.querySelectorAll('.days-btn').forEach((item) => item.classList.toggle('active', item === button));
    }));
    queryBtnEl.addEventListener('click', query);
    // 区域切换：海南 ⇄ 四川（按钮文案随模式互切）
    if (regionToggleEl) regionToggleEl.addEventListener('click', () => switchRegion(state.region === 'hainan' ? 'sichuan' : 'hainan'));

    // 地点搜索：防抖由 Location.searchPlaces 内部管理（300ms），点击结果选中并立即查询
    searchInputEl.addEventListener('input', () => {
      if (!searchInputEl.value.trim()) { closeSearchResults(); return; }
      handleSearchInput();
    });
    searchInputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { searchInputEl.value = ''; closeSearchResults(); }
    });
    // 手动经纬度选点：展开/收起、校验与确认（支持高德 GCJ-02 坐标自动换算）
    coordToggleEl.addEventListener('click', () => {
      const show = coordInputEl.classList.toggle('hidden');
      coordToggleEl.setAttribute('aria-expanded', String(!show));
    });
    coordConfirmEl.addEventListener('click', () => {
      const lat = Number(coordLatEl.value);
      const lon = Number(coordLonEl.value);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
        toast('请输入有效经纬度（纬度 -90~90，经度 -180~180）');
        return;
      }
      const [wgsLon, wgsLat] = coordGcjEl.checked ? Location.gcj02ToWgs84(lon, lat) : [lon, lat];
      const name = Location.formatCoordName(wgsLat, wgsLon);
      const outOfRegion = Location.regionOf(wgsLat, wgsLon) !== state.region;
      if (outOfRegion) toast(REGION_TEXTS[state.region].regionToast);
      state.customDest = { id: 'custom', name, lat: wgsLat, lon: wgsLon, marine: false, outOfRegion };
      state.dest = state.customDest;
      searchInputEl.value = '';
      closeSearchResults();
      renderDestButtons();
      query();
    });
    // 地图选点：打开/关闭/确认/定位（高德 JS API，需配置 key）
    const enableMapBtn = () => { if (Location.isAMapReady()) mapBtnEl.disabled = false; };
    document.addEventListener('amap-ready', enableMapBtn);
    mapBtnEl.addEventListener('click', openMapPanel);
    mapCloseEl.addEventListener('click', closeMapPanel);
    mapCancelEl.addEventListener('click', closeMapPanel);
    mapConfirmEl.addEventListener('click', confirmMapPick);
    mapLocateEl.addEventListener('click', locateCurrent);
    mapPanelEl.addEventListener('click', (event) => { if (event.target === mapPanelEl) closeMapPanel(); });
    // 地图图层切换（标准 / 卫星）
    mapPanelEl.addEventListener('click', (event) => {
      const layerBtn = event.target.closest('[data-layer]');
      if (!layerBtn || !Location.isAMapReady()) return;
      Location.setMapLayer(layerBtn.dataset.layer);
      mapPanelEl.querySelectorAll('.map-layer-btn').forEach((btn) => {
        const active = btn === layerBtn;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
    });
    enableMapBtn();
    searchResultsEl.addEventListener('click', (event) => {
      const itemEl = event.target.closest('.search-item');
      if (itemEl) selectSearchItem(Number(itemEl.dataset.index));
    });
    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('.location-search')) closeSearchResults();
    });

    // 点击委托：日期选择与天空剖面视图切换
    resultEl.addEventListener('click', (event) => {
      const viewBtn = event.target.closest('[data-sky-view]');
      if (viewBtn) {
        state.skyView = viewBtn.dataset.skyView;
        renderResult();
        return;
      }
      const target = event.target.closest('[data-select-date]');
      if (!target || !state.bundle) return;
      state.selectedDate = target.dataset.selectDate;
      renderResult();
    });

    // 悬停提示（鼠标移动不重渲染）：天空剖面与云量曲线共用委托
    resultEl.addEventListener('pointermove', (event) => {
      const hit = event.target.closest('.sky-hit');
      if (hit) { updateSkyCursor(hit.closest('[data-sky-chart]'), hit); return; }
      const cloudHit = event.target.closest('.cloud-hit');
      if (cloudHit) updateCloudCursor(cloudHit.closest('[data-cloud-chart]'), cloudHit);
    });
    // 离开图表隐藏提示（未点击选中时隐藏；点击选中后详情保留，直到切换日期/视图）
    resultEl.addEventListener('pointerout', (event) => {
      const chart = event.target.closest('[data-sky-chart]');
      if (chart && state.skyIndex == null && (!event.relatedTarget || !chart.contains(event.relatedTarget))) hideSkyCursor(chart);
      const cloudChart = event.target.closest('[data-cloud-chart]');
      if (cloudChart && state.cloudPick == null && (!event.relatedTarget || !cloudChart.contains(event.relatedTarget))) hideCloudCursor(cloudChart);
    });
    // 触控/点击选中时刻：持久化准星并直接显示详情（不整页重渲染，移动端点击即见）
    resultEl.addEventListener('pointerdown', (event) => {
      const hit = event.target.closest('.sky-hit');
      if (hit && state.bundle) {
        state.skyIndex = Number(hit.dataset.index);
        updateSkyCursor(hit.closest('[data-sky-chart]'), hit);
        return;
      }
      const cloudHit = event.target.closest('.cloud-hit');
      if (cloudHit && state.bundle) {
        const cloudChart = cloudHit.closest('[data-cloud-chart]');
        state.cloudPick = { date: cloudChart.dataset.date, index: Number(cloudHit.dataset.index) };
        updateCloudCursor(cloudChart, cloudHit);
      }
    });
    // 键盘焦点：左右方向键在小时刻度间移动（天空剖面与云量曲线）
    resultEl.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (!state.bundle) return;
      const skyChart = event.target.closest('[data-sky-chart]');
      if (skyChart) {
        event.preventDefault();
        const hits = skyChart.querySelectorAll('.sky-hit');
        if (!hits.length) return;
        const current = state.skyIndex == null ? 0 : state.skyIndex;
        const next = event.key === 'ArrowRight' ? Math.min(hits.length - 1, current + 1) : Math.max(0, current - 1);
        state.skyIndex = next;
        renderResult();
        const newChart = resultEl.querySelector('[data-sky-chart]');
        newChart?.focus();
        const newHits = newChart?.querySelectorAll('.sky-hit') || [];
        if (newHits[next]) {
          const scroll = newChart.closest('.sky-scroll');
          if (scroll) scroll.scrollLeft = Math.max(0, Number(newHits[next].dataset.x) - scroll.clientWidth / 2);
        }
        return;
      }
      const cloudChart = event.target.closest('[data-cloud-chart]');
      if (cloudChart) {
        event.preventDefault();
        const hits = cloudChart.querySelectorAll('.cloud-hit');
        if (!hits.length) return;
        const current = state.cloudPick && state.cloudPick.date === cloudChart.dataset.date ? state.cloudPick.index : 0;
        const next = event.key === 'ArrowRight' ? Math.min(hits.length - 1, current + 1) : Math.max(0, current - 1);
        state.cloudPick = { date: cloudChart.dataset.date, index: next };
        renderResult();
        const newChart = resultEl.querySelector(`.cloud-chart[data-date="${state.cloudPick.date}"]`);
        newChart?.focus();
        const newHits = newChart?.querySelectorAll('.cloud-hit') || [];
        if (newHits[next]) {
          const scroll = newChart.closest('.cloud-scroll');
          if (scroll) scroll.scrollLeft = Math.max(0, Number(newHits[next].dataset.x) - scroll.clientWidth / 2);
        }
      }
    });

    query();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
