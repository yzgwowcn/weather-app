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

  // 注册（开启邮箱确认 + 验证码邮件模板后）：发送注册验证码邮件，返回 { ok, needsConfirm, message }
  // needsConfirm=true 表示验证码已发出，用户需输入邮件中的验证码（verifyEmailOtp）完成注册
  async function signUp(email, password) {
    if (!client) return { ok: false, message: '认证未配置' };
    var { data, error } = await client.auth.signUp({
      email: email.trim().toLowerCase(),
      password: password,
    });
    if (error) return { ok: false, message: error.message };
    // 开启 Email Confirmations 后，signUp 不返回 session（用户未确认），仅发送验证码邮件
    if (data && data.session) return { ok: true, user: data.user || null }; // 兼容个别直接登录的配置
    return { ok: true, needsConfirm: true };
  }

  // 提交邮箱验证码完成注册（成功后自动建立会话，即已登录）
  // 验证码位数由 Supabase 项目决定（6 位或 8 位），此处不限制位数，仅交服务端校验
  async function verifyEmailOtp(email, token) {
    if (!client) return { ok: false, message: '认证未配置' };
    var { data, error } = await client.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: String(token).trim(),
      type: 'signup',
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true, user: (data && data.user) || null };
  }

  // 重新发送注册验证码（Supabase 对同一邮箱有 60 秒发送窗口限制）
  async function resendSignupCode(email) {
    if (!client) return { ok: false, message: '认证未配置' };
    var { error } = await client.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
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

  // 第三方 OAuth 登录（google / github）：跳转 Supabase 托管授权页，成功后回跳 auth/callback.html
  // 与 resetPasswordForEmail 的回调约定一致；supabase-js 成功时会自动跳转授权页（data.url）
  async function signInWithOAuth(provider) {
    if (!client) return { ok: false, message: '认证未配置' };
    var { data, error } = await client.auth.signInWithOAuth({
      provider: provider,
      options: {
        redirectTo: window.location.origin + '/auth/callback.html',
      },
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true, url: data && data.url };
  }

  // OAuth 失败回跳错误 → 中文提示（GoTrue 错误码与描述均可能变化，同时匹配两者）
  function oauthErrorText(code, description) {
    var text = (code + ' ' + description).toLowerCase();
    if (code === 'email_exists' || text.indexOf('already registered') !== -1) {
      return '该邮箱已注册，请直接使用邮箱密码登录';
    }
    if (code === 'access_denied' || text.indexOf('access denied') !== -1 || text.indexOf('cancelled') !== -1) {
      return '已取消授权，未完成登录';
    }
    if (text.indexOf('expired') !== -1 || text.indexOf('invalid') !== -1) {
      return '登录链接无效或已过期，请重新发起登录';
    }
    return description ? description : ('登录失败（' + code + '）');
  }

  // 回调处理：兼容四种情况
  // 0) OAuth 失败回跳：query 带 error / error_description（如邮箱已注册冲突）→ 立即返回中文错误，不等会话
  // 1) implicit：URL hash 携带 token，createClient 的 detectSessionInUrl 自动建立会话（等待 10s）
  // 2) PKCE 旧链接：?code=... → exchangeCodeForSession
  // 3) 找回密码：type=recovery → 返回类型让页面显示改密表单
  async function handleCallback(url) {
    if (!client) return { ok: false, message: '认证未配置' };
    var params = new URLSearchParams(url.search);
    var err = params.get('error');
    if (err) {
      // OAuth 失败回跳（如该邮箱已有密码账号）：立即返回，避免进入 10s 会话等待
      return { ok: false, message: oauthErrorText(err, params.get('error_description') || '') };
    }
    var type = params.get('type') || '';
    if (type === 'recovery') {
      // 等待 supabase-js 处理 hash token（detectSessionInUrl），recovery 需要已登录态才能改密
      var rs = await waitForSession(10000);
      if (!rs) return { ok: false, message: '重置链接无效或已过期，请重新发起找回密码' };
      return { ok: true, type: 'recovery' };
    }
    // implicit 确认链接：hash 带 access_token，优先等会话建立（detectSessionInUrl 异步处理）
    var sess = await waitForSession(10000);
    if (sess) {
      // app_metadata.provider 区分登录来源：google / github / email，供回调页决定跳转目标
      var provider = (sess.user && sess.user.app_metadata && sess.user.app_metadata.provider) || 'email';
      return { ok: true, type: 'confirm', provider: provider };
    }
    // PKCE 旧链接兜底：query 带 code → exchangeCodeForSession（邮箱确认场景，来源固定为 email）
    var code = params.get('code');
    if (code) {
      var exchange = await client.auth.exchangeCodeForSession(code);
      if (exchange.error) return { ok: false, message: exchange.error.message };
      return { ok: true, type: 'confirm', provider: 'email' };
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
    verifyEmailOtp: verifyEmailOtp,
    resendSignupCode: resendSignupCode,
    signInWithOAuth: signInWithOAuth,
    resetPasswordForEmail: resetPasswordForEmail,
    handleCallback: handleCallback,
    updatePassword: updatePassword,
    refreshUser: refreshUser,
  };
})();
