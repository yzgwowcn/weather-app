// 认证模块：Supabase Auth 封装（注册/登录/退出/找回密码/邮箱确认/会话监听）
// 依赖：vendor/supabase.min.js（window.supabase）、js/config.js（SUPABASE_CONFIG）
// 用户唯一身份：Supabase auth.users.id（UID），后续收藏/偏好/订单等表统一用该 UID 关联
(function () {
  'use strict';

  function placeholder(v) {
    return typeof v === 'string' && v.indexOf('__SUPABASE_') === 0;
  }
  var isConfigured = typeof SUPABASE_CONFIG !== 'undefined'
    && SUPABASE_CONFIG.url && !placeholder(SUPABASE_CONFIG.url)
    && SUPABASE_CONFIG.anonKey && !placeholder(SUPABASE_CONFIG.anonKey);

  var client = null;
  if (isConfigured && typeof supabase !== 'undefined' && supabase.createClient) {
    // PKCE 流程：确认/找回密码邮件链接带 code，由回调页 exchangeCodeForSession 换取会话
    client = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true },
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

  // 回调处理：PKCE code → 确认会话；type=recovery → 返回类型让页面显示改密表单
  async function handleCallback(url) {
    if (!client) return { ok: false, message: '认证未配置' };
    var params = new URLSearchParams(url.search);
    var code = params.get('code');
    if (code) {
      var exchange = await client.auth.exchangeCodeForSession(code);
      if (exchange.error) return { ok: false, message: exchange.error.message };
      return { ok: true, type: 'confirm' };
    }
    var type = params.get('type') || '';
    if (type === 'recovery') return { ok: true, type: 'recovery' };
    return { ok: false, message: '链接无效或已过期，请重新操作' };
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
