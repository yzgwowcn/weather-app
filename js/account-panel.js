// 账户面板：右上角汉堡入口 → 右侧抽屉（账户详情：邮箱/昵称/等级；设置：默认城市、温度单位；退出登录）
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
  var regionSelect = document.getElementById('panel-region');
  var tempSelect = document.getElementById('panel-temp');
  var hint = document.getElementById('panel-hint');
  var editUsernameLink = document.getElementById('panel-edit-username');
  var nicknamePrompt = document.getElementById('nickname-prompt');
  var nicknamePromptClose = document.getElementById('nickname-prompt-close');
  if (!hamburger || !panel) return;

  var PLAN_LABEL = { free: '免费版', pro: 'Pro', ultra: 'Ultra' };
  var nicknameCheckedUserId = '';
  var nicknameDismissedUserId = '';

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

  function hideNicknamePrompt() {
    if (nicknamePrompt) nicknamePrompt.classList.add('hidden');
  }

  // 每次重新进入页面或重新登录后检查一次。关闭只对本次页面会话生效，
  // 下次进入仍会提醒；资料请求失败时不把“未知”误判为“未设置”。
  function checkNicknamePrompt(user) {
    if (!user || !window.User || nicknameCheckedUserId === user.id) return;
    nicknameCheckedUserId = user.id;
    window.User.getProfile().then(function (r) {
      var current = isLoggedIn() ? window.Auth.getUser() : null;
      if (!current || current.id !== user.id || !r.ok) return;
      var missing = !(r.profile && r.profile.username);
      if (missing && nicknameDismissedUserId !== user.id && nicknamePrompt) {
        nicknamePrompt.classList.remove('hidden');
      } else {
        hideNicknamePrompt();
      }
    });
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
      if (editUsernameLink) editUsernameLink.textContent = (profile && profile.username) ? '修改昵称' : '设置昵称';
      document.getElementById('panel-plan').textContent = planText(window.User.getPlanStatus(profile));
    });
    window.User.getPreferences().then(function (r) {
      if (!isLoggedIn()) return;
      var prefs = r.ok ? r.preferences : null;
      if (regionSelect) regionSelect.value = (prefs && prefs.default_region) ? prefs.default_region : '';
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

  // 保存偏好（默认区域 / 默认城市 / 温度单位），成功后通知首页
  // 默认区域按需求「下次进入/登入自动切换」：本次会话不立即切换，仅入库
  function savePrefs() {
    hint.className = 'panel-hint';
    hint.textContent = '';
    window.User.savePreferences({
      default_region: regionSelect ? (regionSelect.value || null) : undefined,
      default_city: citySelect.value || null,
      temp_unit: tempSelect.value,
    }).then(function (r) {
      if (!r.ok) {
        hint.className = 'panel-hint error';
        hint.textContent = r.message;
        return;
      }
      hint.className = 'panel-hint ok';
      hint.textContent = (regionSelect && regionSelect.value) ? '已保存，默认区域将在下次进入/登录时自动切换' : '已保存';
      document.dispatchEvent(new CustomEvent('pref-saved', {
        detail: {
          default_city: citySelect.value || '',
          default_region: regionSelect ? (regionSelect.value || '') : '',
        },
      }));
    });
  }

  // ---- 事件 ----
  // 汉堡统一入口：未登录也展开面板（登录引导），不直接跳转
  hamburger.addEventListener('click', function () {
    if (panel.classList.contains('hidden')) openPanel(); else closePanel();
  });
  if (panelClose) panelClose.addEventListener('click', closePanel);
  if (nicknamePromptClose) nicknamePromptClose.addEventListener('click', function () {
    var user = isLoggedIn() ? window.Auth.getUser() : null;
    nicknameDismissedUserId = user ? user.id : '';
    hideNicknamePrompt();
  });
  // 点击面板外关闭（排除面板本体与汉堡）
  document.addEventListener('click', function (e) {
    if (panel.classList.contains('hidden')) return;
    if (!panel.contains(e.target) && !hamburger.contains(e.target)) closePanel();
  });
  citySelect.addEventListener('change', savePrefs);
  // 默认区域变更：立即重建城市下拉为所选区域（未设置→当前会话区域），避免「区域=四川、城市=海南」不一致偏好；
  // 原选中城市在新区域不存在时自动回落「未设置」，随后一并保存
  if (regionSelect) regionSelect.addEventListener('change', function () {
    var prev = citySelect.value;
    fillCityOptions(regionSelect.value || undefined);
    citySelect.value = prev;
    savePrefs();
  });
  tempSelect.addEventListener('change', savePrefs);
  document.getElementById('panel-logout').addEventListener('click', function () {
    window.Auth.signOut().then(closePanel);
  });
  // 登录/退出状态变化：收起面板，并在资料确认缺少昵称时提醒。
  document.addEventListener('auth-change', function (e) {
    closePanel();
    var user = e.detail && e.detail.user ? e.detail.user : null;
    if (!user) {
      nicknameCheckedUserId = '';
      nicknameDismissedUserId = '';
      hideNicknamePrompt();
      return;
    }
    checkNicknamePrompt(user);
  });

  // 默认城市下拉：填充指定区域（缺省用当前会话区域）的预设目的地；区域切换后重建，保留原选中值
  function fillCityOptions(region) {
    var r = region || ((typeof CURRENT_REGION !== 'undefined' && CURRENT_REGION) || 'hainan');
    citySelect.innerHTML = '<option value="">未设置</option>';
    var list = (typeof REGIONS !== 'undefined' && REGIONS[r]) ? REGIONS[r] : [];
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
