// 用户数据模块：昵称（profiles.username）与收藏位置（favorites）
// 依赖：js/auth.js（window.Auth）、js/config.js（SUPABASE_CONFIG）
// 数据表：profiles / favorites（Supabase 建表，RLS 保护——用户仅能读写自己的行）
// 未注入 Supabase 配置或未登录时各方法返回 { ok: false, message }
(function () {
  'use strict';
  var MAX_FAVORITES = 20;

  function sb() {
    if (!window.Auth || !window.Auth.isReady()) return null;
    return window.Auth.getClient();
  }

  function currentUser() {
    return window.Auth ? window.Auth.getUser() : null;
  }

  // ---- 昵称 ----
  // 校验规则：2-20 位中文/字母/数字，不允许空格、下划线或其他特殊符号。
  function isValidUsername(name) {
    return typeof name === 'string' && /^[\u4e00-\u9fa5A-Za-z0-9]{2,20}$/.test(name);
  }

  // 获取当前用户 profile（无记录返回 profile: null）
  async function getProfile() {
    var client = sb();
    var user = currentUser();
    if (!client) return { ok: false, message: '认证服务未配置' };
    if (!user) return { ok: false, message: '未登录' };
    var { data, error } = await client
      .from('profiles')
      .select('username, created_at, plan, pro_started_at, pro_expires_at, ai_quota, ai_used')
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
    if (!isValidUsername(name)) return { ok: false, message: '昵称需为 2-20 个中文、英文字母或数字，不得包含空格或特殊符号' };
    var current = await getProfile();
    if (current.ok && current.profile && current.profile.username === name) {
      return { ok: true }; // 未变化
    }
    var taken = await isUsernameTaken(name);
    if (!taken.ok) return taken;
    if (taken.taken) return { ok: false, message: '该昵称已被占用' };
    var { error } = await client
      .from('profiles')
      .upsert({ user_id: user.id, username: name }, { onConflict: 'user_id' });
    if (error) {
      if (error.code === '23505') return { ok: false, message: '该昵称已被占用' };
      if (error.code === '23514') return { ok: false, message: '昵称需为 2-20 个中文、英文字母或数字，不得包含空格或特殊符号' };
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

  // 添加收藏（应用层查重：同名且坐标相近视为已收藏；名称 1-15 字）
  async function addFavorite(item) {
    var client = sb();
    var user = currentUser();
    if (!client) return { ok: false, message: '认证服务未配置' };
    if (!user) return { ok: false, message: '未登录' };
    if (!item || typeof item.name !== 'string') return { ok: false, message: '收藏数据无效' };
    var name = item.name.trim();
    if (!name) return { ok: false, message: '收藏名称不能为空' };
    if (name.length > 15) return { ok: false, message: '收藏名称不能超过 15 字' };
    if (typeof item.lat !== 'number' || typeof item.lon !== 'number') return { ok: false, message: '收藏数据无效' };
    var list = await listFavorites();
    if (list.ok) {
      if (list.favorites.length >= MAX_FAVORITES) {
        return { ok: false, message: '每位用户最多收藏 20 个地点，请先删除不需要的收藏' };
      }
      var dup = list.favorites.some(function (f) {
        return f.name === name && Math.abs(f.lat - item.lat) < 0.001 && Math.abs(f.lon - item.lon) < 0.001;
      });
      if (dup) return { ok: false, message: '该位置已在收藏中' };
    }
    var { data, error } = await client
      .from('favorites')
      .insert({ user_id: user.id, name: name, lat: item.lat, lon: item.lon, is_gcj: !!item.is_gcj })
      .select('id, name, lat, lon, is_gcj, created_at');
    if (error) {
      if (error.message && error.message.indexOf('FAVORITES_LIMIT_REACHED') !== -1) {
        return { ok: false, message: '每位用户最多收藏 20 个地点，请先删除不需要的收藏' };
      }
      if (error.code === '23514') return { ok: false, message: '收藏名称不能超过 15 字' }; // 数据库 CHECK 兜底
      return { ok: false, message: error.message };
    }
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

  // ---- 等级 / 会员状态 ----
  // 三档位：free / pro / ultra。pro 与 ultra 需在 pro_expires_at 有效期内才算生效，
  // 过期自动按免费处理；rawPlan 保留原始档位、expired 标记过期状态，供页面展示「已过期」。
  function getPlanStatus(profile) {
    var plan = (profile && profile.plan) || 'free';
    var rawPlan = plan;
    var expired = false;
    // 未知档位兜底为 free（rawPlan 保留原始值便于排查）
    if (plan !== 'free' && plan !== 'pro' && plan !== 'ultra') plan = 'free';
    var expiresAt = profile && profile.pro_expires_at ? new Date(profile.pro_expires_at) : null;
    if ((plan === 'pro' || plan === 'ultra') && (!expiresAt || expiresAt.getTime() <= Date.now())) {
      expired = true;
      plan = 'free';
    }
    return {
      plan: plan,
      rawPlan: rawPlan,
      expired: expired,
      proExpiresAt: profile ? (profile.pro_expires_at || null) : null,
    };
  }

  // ---- 用户偏好 ----
  // 读取偏好（无记录返回 preferences: null）
  async function getPreferences() {
    var client = sb();
    var user = currentUser();
    if (!client) return { ok: false, message: '认证服务未配置' };
    if (!user) return { ok: false, message: '未登录' };
    var { data, error } = await client
      .from('user_preferences')
      .select('default_region, default_city, temp_unit, travel_prefs, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    return { ok: true, preferences: data || null };
  }

  // 保存偏好（部分更新，upsert 自动建行；RLS 保证只能写自己的行）
  async function savePreferences(prefs) {
    var client = sb();
    var user = currentUser();
    if (!client) return { ok: false, message: '认证服务未配置' };
    if (!user) return { ok: false, message: '未登录' };
    if (!prefs || typeof prefs !== 'object') return { ok: false, message: '偏好数据无效' };
    var patch = {};
    if ('default_region' in prefs) {
      // 默认区域白名单：null 清除；仅字符串 hainan / sichuan 合法（与数据库 CHECK 约束一致，双保险）
      if (prefs.default_region == null) {
        patch.default_region = null;
      } else if (typeof prefs.default_region !== 'string' || (prefs.default_region !== 'hainan' && prefs.default_region !== 'sichuan')) {
        return { ok: false, message: '默认区域无效' };
      } else {
        patch.default_region = prefs.default_region;
      }
    }
    if ('default_city' in prefs) {
      // 默认城市：null 清除；仅接受有限长度字符串，防垃圾数据入库（有效 ID 由下游按当前区域查表兜底）
      if (prefs.default_city == null) {
        patch.default_city = null;
      } else if (typeof prefs.default_city !== 'string' || prefs.default_city.length > 50) {
        return { ok: false, message: '默认城市无效' };
      } else {
        patch.default_city = prefs.default_city;
      }
    }
    if ('temp_unit' in prefs) {
      var tu = String(prefs.temp_unit);
      if (tu !== 'celsius' && tu !== 'fahrenheit') return { ok: false, message: '温度单位无效' };
      patch.temp_unit = tu;
    }
    if ('travel_prefs' in prefs) {
      if (typeof prefs.travel_prefs !== 'object' || prefs.travel_prefs === null || Array.isArray(prefs.travel_prefs)) {
        return { ok: false, message: '出行偏好数据无效' };
      }
      patch.travel_prefs = prefs.travel_prefs;
    }
    if (!Object.keys(patch).length) return { ok: true };
    patch.updated_at = new Date().toISOString();
    var { error } = await client
      .from('user_preferences')
      .upsert(Object.assign({ user_id: user.id }, patch), { onConflict: 'user_id' });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  window.User = {
    isValidUsername: isValidUsername,
    getProfile: getProfile,
    isUsernameTaken: isUsernameTaken,
    setUsername: setUsername,
    getPlanStatus: getPlanStatus,
    getPreferences: getPreferences,
    savePreferences: savePreferences,
    listFavorites: listFavorites,
    addFavorite: addFavorite,
    removeFavorite: removeFavorite,
  };
})();
