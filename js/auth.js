// 认证模块：Supabase Auth 封装（注册/登录/退出/找回密码/邮箱确认/会话监听）
// 依赖：vendor/supabase.min.js（window.supabase）、js/config.js（SUPABASE_CONFIG）
// 用户唯一身份：Supabase auth.users.id（UID），后续收藏/偏好/订单等表统一用该 UID 关联
(function () {
  'use strict';

  // PKCE 双写 storage：localStorage 优先，cookie 兜底。
  // 默认 sessionStorage 按标签页隔离导致邮件确认链接（新标签打开）读不到 code_verifier；
  // localStorage 已覆盖同浏览器场景，cookie 兜底覆盖隐私模式/存储被清等场景。
  // 注意：两者都按 origin 隔离，邮件链接域名必须与注册页完全一致（含子域）。
  var pkceStorage = {
    getItem: function (key) {
      var v = null;
      try { v = localStorage.getItem(key); } catch (e) { /* 隐私模式可能抛错 */ }
      if (v) return v;
      var esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var m = document.cookie.match(new RegExp('(?:^|;)\\s*' + esc + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    },
    setItem: function (key, value) {
      try { localStorage.setItem(key, value); } catch (e) { /* 忽略 */ }
      var d = new Date();
      d.setTime(d.getTime() + 7 * 86400000); // 7 天，覆盖验证邮件有效期
      document.cookie = key + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
    },
    removeItem: function (key) {
      try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
      document.cookie = key + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;SameSite=Lax';
    },
  };

  function placeholder(v) {
    return typeof v === 'string' && v.indexOf('__SUPABASE_') === 0;
  }
  var isConfigured = typeof SUPABASE_CONFIG !== 'undefined'
    && SUPABASE_CONFIG.url && !placeholder(SUPABASE_CONFIG.url)
    && SUPABASE_CONFIG.anonKey && !placeholder(SUPABASE_CONFIG.anonKey);

  var client = null;
  if (isConfigured && typeof supabase !== 'undefined' && supabase.createClient) {
    // implicit 流程：确认/找回密码链接直接携带 token（URL hash），由 createClient 的
    // detectSessionInUrl 自动建立会话，不依赖 code_verifier 客户端存储——
    // PKCE 的 code_verifier 存在客户端存储中，邮件确认链接若在另一浏览器/内置 webview
    // （如 QQ 邮箱 APP）打开会读不到，报 "PKCE code verifier not found in storage"。
    // implicit 仅在邮箱确认这类一次性场景使用；token 处理后被 supabase-js 从 URL 移除。
    client = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: {
        flowType: 'implicit',
        persistSession: true,
        autoRefreshToken: true,
        storage: pkceStorage,
      },
    });
  }

  var currentUser = null;

  function notify() {
    document.dispatchEvent(new CustomEvent('auth-change', { detail: { user: currentUser } }));
  }

  function getClient() { return client; }
  function isReady() { return !!client; }
  function getUser() { return currentUser; }

  // 注册：返回 { ok, message }；开启邮箱确认时提示查收验证邮件
  async function signUp(email, password) {
    if (!client) return { ok: false, message: '认证未配置' };
    var { data, error } = await client.auth.signUp({
      email: email.trim().toLowerCase(),
      password: password,
      options: {
        emailRedirectTo: window.location.origin + '/auth/callback.html',
      },
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: '注册成功，请查收验证邮件并点击确认链接', user: data.user || null };
  }

  // 登录
  async function signIn(email, password) {
    if (!client) return { ok: false, message: '认证未配置' };
    var { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: password,
    });
    if (error) {
      if (/email not confirmed/i.test(error.message || '')) {
        return { ok: false, message: '邮箱尚未验证，请查收验证邮件并点击确认链接' };
      }
      return { ok: false, message: error.message };
    }
    return { ok: true, user: data.user };
  }

  // 退出登录
  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
  }

  // 找回密码：发送重置邮件
  async function resetPasswordForEmail(email) {
    if (!client) return { ok: false, message: '认证未配置' };
    var { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: window.location.origin + '/auth/callback.html',
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  // 回调处理：兼容三种情况
  // 1) implicit：URL hash 携带 token，createClient 的 detectSessionInUrl 自动建立会话（等待 10s）
  // 2) PKCE 旧链接：?code=... → exchangeCodeForSession
  // 3) 找回密码：type=recovery → 返回类型让页面显示改密表单
  async function handleCallback(url) {
    if (!client) return { ok: false, message: '认证未配置' };
    var params = new URLSearchParams(url.search);
    var type = params.get('type') || '';
    if (type === 'recovery') {
      // 等待 supabase-js 处理 hash token（detectSessionInUrl），recovery 需要已登录态才能改密
      var rs = await waitForSession(10000);
      if (!rs) return { ok: false, message: '重置链接无效或已过期，请重新发起找回密码' };
      return { ok: true, type: 'recovery' };
    }
    // implicit 确认链接：hash 带 access_token，优先等会话建立（detectSessionInUrl 异步处理）
    var sess = await waitForSession(10000);
    if (sess) return { ok: true, type: 'confirm' };
    // PKCE 旧链接兜底：query 带 code → exchangeCodeForSession
    var code = params.get('code');
    if (code) {
      var exchange = await client.auth.exchangeCodeForSession(code);
      if (exchange.error) return { ok: false, message: exchange.error.message };
      return { ok: true, type: 'confirm' };
    }
    return { ok: false, message: '链接无效或已过期，请重新操作' };
  }

  // 轮询等待会话就绪（implicit 流程 supabase-js 异步处理 URL hash token）
  function waitForSession(timeoutMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var timer = setInterval(function () {
        var s = client.auth.getSession();
        var session = s && s.data && s.data.session;
        if (session || Date.now() - start > timeoutMs) {
          clearInterval(timer);
          resolve(session || null);
        }
      }, 150);
    });
  }

  // 设置新密码（找回密码流程第二步）
  async function updatePassword(newPassword) {
    if (!client) return { ok: false, message: '认证未配置' };
    var { error } = await client.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  // 刷新当前用户（页面加载时恢复会话）
  async function refreshUser() {
    if (!client) return null;
    var { data } = await client.auth.getUser();
    currentUser = data.user || null;
    return currentUser;
  }

  // 初始化：恢复会话 + 订阅登录态变化（localStorage 持久化，刷新不掉线）
  (async function init() {
    if (!client) return;
    await refreshUser();
    notify();
    client.auth.onAuthStateChange(function (_event, session) {
      currentUser = session ? session.user : null;
      notify();
    });
  })();

  window.Auth = {
    isReady: isReady,
    getClient: getClient,
    getUser: getUser,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    resetPasswordForEmail: resetPasswordForEmail,
    handleCallback: handleCallback,
    updatePassword: updatePassword,
    refreshUser: refreshUser,
  };
})();
