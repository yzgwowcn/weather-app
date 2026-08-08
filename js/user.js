// 用户数据模块：用户名（profiles）与收藏位置（favorites）
// 依赖：js/auth.js（window.Auth）、js/config.js（SUPABASE_CONFIG）
// 数据表：profiles / favorites（Supabase 建表，RLS 保护——用户仅能读写自己的行）
// 未注入 Supabase 配置或未登录时各方法返回 { ok: false, message }
(function () {
  'use strict';

  function sb() {
    if (!window.Auth || !window.Auth.isReady()) return null;
    return window.Auth.getClient();
  }

  function currentUser() {
    return window.Auth ? window.Auth.getUser() : null;
  }

  // ---- 用户名 ----
  // 校验规则：2-20 位中文/字母/数字/下划线（支持小红书昵称等中文用户名）
  function isValidUsername(name) {
    return typeof name === 'string' && /^[\u4e00-\u9fa5A-Za-z0-9_]{2,20}$/.test(name);
  }

  // 获取当前用户 profile（无记录返回 profile: null）
  async function getProfile() {
    var client = sb();
    var user = currentUser();
    if (!client) return { ok: false, message: '认证服务未配置' };
    if (!user) return { ok: false, message: '未登录' };
    var { data, error } = await client
      .from('profiles')
      .select('username, created_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    return { ok: true, profile: data || null };
  }

  // 检查用户名是否已被占用（RPC，security definer 全表查询）
  async function isUsernameTaken(name) {
    var client = sb();
    if (!client) return { ok: false, message: '认证服务未配置' };
    var { data, error } = await client.rpc('username_taken', { p_username: name });
    if (error) return { ok: false, message: error.message };
    return { ok: true, taken: !!data };
  }

  // 设置/更新用户名（创建或更新 profile 行；唯一约束 + RPC 双保险）
  async function setUsername(name) {
    var client = sb();
    var user = currentUser();
    if (!client) return { ok: false, message: '认证服务未配置' };
    if (!user) return { ok: false, message: '未登录' };
    if (!isValidUsername(name)) return { ok: false, message: '用户名需为 2-20 位中文/字母/数字/下划线' };
    var current = await getProfile();
    if (current.ok && current.profile && current.profile.username === name) {
      return { ok: true }; // 未变化
    }
    var taken = await isUsernameTaken(name);
    if (!taken.ok) return taken;
    if (taken.taken) return { ok: false, message: '该用户名已被占用' };
    var { error } = await client
      .from('profiles')
      .upsert({ user_id: user.id, username: name }, { onConflict: 'user_id' });
    if (error) {
      if (error.code === '23505') return { ok: false, message: '该用户名已被占用' };
      return { ok: false, message: error.message };
    }
    return { ok: true };
  }

  // ---- 收藏 ----
  // 收藏列表（按创建时间倒序）
  async function listFavorites() {
    var client = sb();
    var user = currentUser();
    if (!client) return { ok: false, message: '认证服务未配置' };
    if (!user) return { ok: false, message: '未登录' };
    var { data, error } = await client
      .from('favorites')
      .select('id, name, lat, lon, is_gcj, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) return { ok: false, message: error.message };
    return { ok: true, favorites: data || [] };
  }

  // 添加收藏（应用层查重：同名且坐标相近视为已收藏）
  async function addFavorite(item) {
    var client = sb();
    var user = currentUser();
    if (!client) return { ok: false, message: '认证服务未配置' };
    if (!user) return { ok: false, message: '未登录' };
    if (!item || typeof item.name !== 'string' || !item.name
      || typeof item.lat !== 'number' || typeof item.lon !== 'number') {
      return { ok: false, message: '收藏数据无效' };
    }
    var list = await listFavorites();
    if (list.ok) {
      var dup = list.favorites.some(function (f) {
        return f.name === item.name && Math.abs(f.lat - item.lat) < 0.001 && Math.abs(f.lon - item.lon) < 0.001;
      });
      if (dup) return { ok: false, message: '该位置已在收藏中' };
    }
    var { data, error } = await client
      .from('favorites')
      .insert({ user_id: user.id, name: item.name, lat: item.lat, lon: item.lon, is_gcj: !!item.is_gcj })
      .select('id, name, lat, lon, is_gcj, created_at');
    if (error) return { ok: false, message: error.message };
    return { ok: true, favorite: data && data[0] };
  }

  // 删除收藏（RLS 保证只能删自己的行）
  async function removeFavorite(id) {
    var client = sb();
    var user = currentUser();
    if (!client) return { ok: false, message: '认证服务未配置' };
    if (!user) return { ok: false, message: '未登录' };
    if (!id) return { ok: false, message: '收藏 ID 无效' };
    var { error } = await client
      .from('favorites')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  window.User = {
    isValidUsername: isValidUsername,
    getProfile: getProfile,
    isUsernameTaken: isUsernameTaken,
    setUsername: setUsername,
    listFavorites: listFavorites,
    addFavorite: addFavorite,
    removeFavorite: removeFavorite,
  };
})();
