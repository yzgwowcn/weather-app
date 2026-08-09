// 账户面板：右上角汉堡入口 → 右侧抽屉（账户详情：邮箱/用户名/等级；设置：默认城市、温度单位；退出登录）
// 桌面端与移动端统一入口与交互；未登录展开显示登录引导。
// 依赖：js/auth.js（window.Auth）、js/user.js（window.User）、js/config.js（REGIONS/CURRENT_REGION）
(function () {
  'use strict';

  var hamburger = document.getElementById('account-hamburger');
  var mask = document.getElementById('panel-mask');
  var panel = document.getElementById('account-panel');
  var guestEl = document.getElementById('panel-guest');
  var userEl = document.getElementById('panel-user');
  var panelClose = document.getElementById('panel-close');
  var citySelect = document.getElementById('panel-city');
  var tempSelect = document.getElementById('panel-temp');
  var hint = document.getElementById('panel-hint');
  if (!hamburger || !panel) return;

  var PLAN_LABEL = { free: '免费版', pro: 'Pro', ultra: 'Ultra' };

  function isLoggedIn() {
    return !!(window.Auth && window.Auth.isReady && window.Auth.isReady() && window.Auth.getUser());
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function planText(status) {
    var t = PLAN_LABEL[status.plan] || '免费版';
    if (status.plan === 'pro' || status.plan === 'ultra') {
      t += ' · 至 ' + fmtDate(status.proExpiresAt);
    } else if (status.expired) {
      t = '免费版（' + (PLAN_LABEL[status.rawPlan] || '') + ' 已过期）';
    }
    return t;
  }

  // 渲染面板内容：未登录显示登录引导，已登录显示详情 + 设置
  function renderPanel() {
    var loggedIn = isLoggedIn();
    guestEl.classList.toggle('hidden', loggedIn);
    userEl.classList.toggle('hidden', !loggedIn);
    if (!loggedIn) return;
    var user = window.Auth.getUser();
    document.getElementById('panel-email').textContent = user.email || '—';
    document.getElementById('panel-username').textContent = '—';
    document.getElementById('panel-plan').textContent = '—';
    window.User.getProfile().then(function (r) {
      var profile = r.ok ? r.profile : null;
      if (!isLoggedIn()) return;
      document.getElementById('panel-username').textContent = (profile && profile.username) ? profile.username : '未设置';
      document.getElementById('panel-plan').textContent = planText(window.User.getPlanStatus(profile));
    });
    window.User.getPreferences().then(function (r) {
      if (!isLoggedIn()) return;
      var prefs = r.ok ? r.preferences : null;
      citySelect.value = (prefs && prefs.default_city) ? prefs.default_city : '';
      tempSelect.value = (prefs && prefs.temp_unit) ? prefs.temp_unit : 'celsius';
    });
    hint.className = 'panel-hint';
    hint.textContent = '';
  }

  function openPanel() {
    panel.classList.remove('hidden');
    hamburger.setAttribute('aria-expanded', 'true');
    if (mask) { mask.classList.remove('hidden'); mask.classList.add('show'); }
    renderPanel();
  }
  function closePanel() {
    panel.classList.add('hidden');
    hamburger.setAttribute('aria-expanded', 'false');
    if (mask) { mask.classList.add('hidden'); mask.classList.remove('show'); }
  }

  // 保存偏好（默认城市 / 温度单位），成功后通知首页
  function savePrefs() {
    hint.className = 'panel-hint';
    hint.textContent = '';
    window.User.savePreferences({
      default_city: citySelect.value || null,
      temp_unit: tempSelect.value,
    }).then(function (r) {
      if (!r.ok) {
        hint.className = 'panel-hint error';
        hint.textContent = r.message;
        return;
      }
      hint.className = 'panel-hint ok';
      hint.textContent = '已保存';
      document.dispatchEvent(new CustomEvent('pref-saved', { detail: { default_city: citySelect.value || '' } }));
    });
  }

  // ---- 事件 ----
  // 汉堡统一入口：未登录也展开面板（登录引导），不直接跳转
  hamburger.addEventListener('click', function () {
    if (panel.classList.contains('hidden')) openPanel(); else closePanel();
  });
  if (panelClose) panelClose.addEventListener('click', closePanel);
  // 点击面板外关闭（排除面板本体与汉堡）
  document.addEventListener('click', function (e) {
    if (panel.classList.contains('hidden')) return;
    if (!panel.contains(e.target) && !hamburger.contains(e.target)) closePanel();
  });
  citySelect.addEventListener('change', savePrefs);
  tempSelect.addEventListener('change', savePrefs);
  document.getElementById('panel-logout').addEventListener('click', function () {
    window.Auth.signOut().then(closePanel);
  });
  // 登录/退出状态变化：收起面板（内容在下次展开时重新渲染）
  document.addEventListener('auth-change', closePanel);

  // 默认城市下拉：填充当前区域预设目的地（区域切换后重建，保留原选中值）
  function fillCityOptions() {
    citySelect.innerHTML = '<option value="">未设置</option>';
    var list = (typeof REGIONS !== 'undefined' && CURRENT_REGION && REGIONS[CURRENT_REGION]) ? REGIONS[CURRENT_REGION] : [];
    list.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      citySelect.appendChild(opt);
    });
  }
  fillCityOptions();
  // 顶栏区域切换（region-change 由 app.js 派发）：重建下拉；跨区域不存在时回落「未设置」
  document.addEventListener('region-change', function () {
    var prev = citySelect.value;
    fillCityOptions();
    citySelect.value = prev;
  });
})();
