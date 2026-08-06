// 主控制器：目的地选择 → 查询 → 渲染
(() => {
  'use strict';

  const state = { dest: DESTINATIONS[0], days: DEFAULT_DAYS };

  // DOM 引用
  const destListEl = document.getElementById('dest-list');
  const daysGroupEl = document.getElementById('days-group');
  const queryBtnEl = document.getElementById('query-btn');
  const resultEl = document.getElementById('result');
  const loadingEl = document.getElementById('loading');

  // YYYY-MM-DD（本地时区；受众为国内用户即北京时间）
  function dateStr(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 渲染目的地选择按钮
  function renderDestButtons() {
    destListEl.innerHTML = DESTINATIONS.map((d) => `
      <button type="button" class="dest-btn ${d.id === state.dest.id ? 'active' : ''}" data-id="${d.id}">
        <span class="dest-name">${d.name}</span>
        ${d.marine ? '<span class="dest-tag">含海况</span>' : ''}
      </button>`).join('');
    destListEl.querySelectorAll('.dest-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.dest = DESTINATIONS.find((d) => d.id === btn.dataset.id);
        renderDestButtons();
      });
    });
  }

  // 时效警告条（按 skill：8 天以上仅趋势参考）
  function renderHorizonWarning(days) {
    if (days > 7) {
      return `<div class="notice warn">⚠️ 查询范围超过 7 天：8 天及以后属远期预报，仅作趋势参考，出行前请复核最新预报与官方预警。</div>`;
    }
    return `<div class="notice info">ℹ️ 数据为 Open-Meteo 模式指导（约 0-16 天时效），非官方预警；4 天及以后的降雨窗口可能变动。</div>`;
  }

  // 查询主流程
  async function query() {
    const { lat, lon, marine, name } = state.dest;
    const days = state.days;
    const start = dateStr(0);
    const end = dateStr(days - 1);

    resultEl.innerHTML = '';
    loadingEl.classList.remove('hidden');

    // 并行请求陆地 + 海况（如适用）
    const [forecast, marineData] = await Promise.all([
      API.fetchForecast(lat, lon, start, end),
      marine ? API.fetchMarine(lat, lon, start, end) : Promise.resolve(null),
    ]);

    loadingEl.classList.add('hidden');
    resultEl.innerHTML =
      renderHorizonWarning(days) +
      renderDailyCards(forecast, name) +
      (marine ? renderMarineCards(marineData, name) : '');
  }

  // 初始化
  function init() {
    renderDestButtons();
    // 天数按钮组：点击切换天数并高亮
    daysGroupEl.querySelectorAll('.days-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.days = Number(btn.dataset.days);
        daysGroupEl.querySelectorAll('.days-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    queryBtnEl.addEventListener('click', query);
    query(); // 首次加载即查询默认目的地
  }

  document.addEventListener('DOMContentLoaded', init);
})();
