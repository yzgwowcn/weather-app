// 主控制器：维护选择状态与图表交互，协调多源请求，将归一化结果交给渲染层，
// 并把渲染层输出的 weatherMood 应用到页面背景状态机。
(() => {
  'use strict';
  const state = { dest: DESTINATIONS[0], days: DEFAULT_DAYS, bundle: null, selectedDate: null, skyView: 'ec', skyIndex: null };
  const destListEl = document.getElementById('dest-list');
  const daysGroupEl = document.getElementById('days-group');
  const queryBtnEl = document.getElementById('query-btn');
  const resultEl = document.getElementById('result');
  const loadingEl = document.getElementById('loading');

  function dateStr(offsetDays) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function renderDestButtons() {
    destListEl.innerHTML = DESTINATIONS.map((dest) => `
      <button type="button" class="dest-btn ${dest.id === state.dest.id ? 'active' : ''}" data-id="${dest.id}" aria-pressed="${dest.id === state.dest.id}">
        <span>${dest.name}</span>${dest.marine ? '<span class="dest-tag">近海</span>' : ''}
      </button>`).join('');
    destListEl.querySelectorAll('.dest-btn').forEach((button) => button.addEventListener('click', () => {
      state.dest = DESTINATIONS.find((dest) => dest.id === button.dataset.id);
      renderDestButtons();
    }));
  }
  function renderResult() {
    const oldScroll = resultEl.querySelector('.sky-scroll');
    const scrollLeft = oldScroll ? oldScroll.scrollLeft : 0;
    const oldRail = resultEl.querySelector('.date-rail');
    const railLeft = oldRail ? oldRail.scrollLeft : 0;
    resultEl.innerHTML = renderWeatherApp(state.bundle, state.dest, state.days, state.selectedDate, { skyView: state.skyView, skyIndex: state.skyIndex });
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
      // 恢复日期条滚动位置；选中日期时将其滚动到可视区域（居中），避免回到最左
      newRail.scrollLeft = railLeft;
      if (state.selectedDate) {
        const chip = newRail.querySelector(`[data-select-date="${state.selectedDate}"]`);
        chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
      }
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
      <strong>${d.time}</strong>
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
  async function query() {
    const start = dateStr(0);
    const end = dateStr(state.days - 1);
    queryBtnEl.disabled = true;
    loadingEl.classList.remove('hidden');
    resultEl.setAttribute('aria-busy', 'true');
    state.bundle = await API.fetchBundle(state.dest, start, end);
    state.selectedDate = null;
    state.skyIndex = null;
    loadingEl.classList.add('hidden');
    queryBtnEl.disabled = false;
    resultEl.removeAttribute('aria-busy');
    renderResult();
  }
  function init() {
    renderDestButtons();
    daysGroupEl.querySelectorAll('.days-btn').forEach((button) => button.addEventListener('click', () => {
      state.days = Number(button.dataset.days);
      daysGroupEl.querySelectorAll('.days-btn').forEach((item) => item.classList.toggle('active', item === button));
    }));
    queryBtnEl.addEventListener('click', query);

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

    // 悬停提示（鼠标移动不重渲染）
    resultEl.addEventListener('pointermove', (event) => {
      const hit = event.target.closest('.sky-hit');
      if (!hit) return;
      updateSkyCursor(hit.closest('[data-sky-chart]'), hit);
    });
    // 离开图表隐藏提示（pointerout 冒泡，relatedTarget 判断）
    resultEl.addEventListener('pointerout', (event) => {
      const chart = event.target.closest('[data-sky-chart]');
      if (chart && (!event.relatedTarget || !chart.contains(event.relatedTarget))) hideSkyCursor(chart);
    });
    // 触控/点击选中时刻：持久化准星
    resultEl.addEventListener('pointerdown', (event) => {
      const hit = event.target.closest('.sky-hit');
      if (!hit || !state.bundle) return;
      state.skyIndex = Number(hit.dataset.index);
      renderResult();
    });
    // 键盘焦点：左右方向键在小时刻度间移动
    resultEl.addEventListener('keydown', (event) => {
      const chart = event.target.closest('[data-sky-chart]');
      if (!chart || !state.bundle) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const hits = chart.querySelectorAll('.sky-hit');
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
    });

    query();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
