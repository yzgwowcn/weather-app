// 账户面板：头部中部账户按钮（登录态 = 昵称 + 等级徽章 FREE/PRO/ULTRA）+ 下拉面板
// （账户详情：邮箱/用户名/等级；设置：默认城市、温度单位；退出登录）
// 依赖：js/auth.js（window.Auth）、js/user.js（window.User）、js/config.js（DESTINATIONS）
(function () {
  'use strict';

  var btn = document.getElementById('account-btn');
  var label = document.getElementById('account-label');
  var badge = document.getElementById('account-badge');
  var panel = document.getElementById('account-panel');
  var wrap = document.getElementById('account-wrap');
  var citySelect = document.getElementById('panel-city');
  var tempSelect = document.getElementById('panel-temp');
  var hint = document.getElementById('panel-hint');
  if (!btn || !panel) return;

  var PLAN_LABEL = { free: '免费版', pro: 'Pro', ultra: 'Ultra' };
  var PLAN_BADGE = { free: 'FREE', pro: 'PRO', ultra: 'ULTRA' };

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

  // 渲染按钮：未登录 = 「登录」；已登录 = 昵称 + 等级徽章（异步取 profile）
  function renderButton() {
    if (!isLoggedIn()) {
      label.textContent = '登录';
      badge.classList.add('hidden');
      return;
    }
    label.textContent = '我的账户';
    window.User.getProfile().then(function (r) {
      if (!isLoggedIn()) return; // 期间可能已退出
      var profile = r.ok ? r.profile : null;
      if (profile && profile.username) label.textContent = profile.username;
      var status = window.User.getPlanStatus(profile);
      badge.textContent = PLAN_BADGE[status.plan] || 'FREE';
      badge.className = 'plan-badge ' + (status.plan === 'ultra' ? 'ultra' : status.plan === 'pro' ? 'pro' : 'free');
      if (!panel.classList.contains('hidden')) renderPanel();
    });
  }

  // 渲染面板内容（详情 + 偏好当前值）
  function renderPanel() {
    var user = window.Auth.getUser();
    if (!user) return;
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
    btn.setAttribute('aria-expanded', 'true');
    renderPanel();
  }
  function closePanel() {
    panel.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
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
      renderButton();
    });
  }

  // ---- 事件 ----
  btn.addEventListener('click', function () {
    if (!isLoggedIn()) { window.location.href = 'auth.html'; return; }
    if (panel.classList.contains('hidden')) openPanel(); else closePanel();
  });
  // 点击面板外关闭
  document.addEventListener('click', function (e) {
    if (panel.classList.contains('hidden')) return;
    if (!wrap.contains(e.target)) closePanel();
  });
  citySelect.addEventListener('change', savePrefs);
  tempSelect.addEventListener('change', savePrefs);
  document.getElementById('panel-logout').addEventListener('click', function () {
    window.Auth.signOut().then(function () { closePanel(); renderButton(); });
  });
  // 登录/退出状态变化：刷新按钮并收起面板
  document.addEventListener('auth-change', function () { closePanel(); renderButton(); });

  // 默认城市下拉：填充预设目的地
  if (typeof DESTINATIONS !== 'undefined' && DESTINATIONS.length) {
    DESTINATIONS.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      citySelect.appendChild(opt);
    });
  }

  renderButton();
})();
