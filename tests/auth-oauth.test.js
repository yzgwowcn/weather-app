// auth-oauth 回归测试：验证 OAuth 回跳会话建立的修复
// 覆盖：1) setSession 首败重试成功（快路径） 2) 慢网络（setSession 全败，detectSessionInUrl 12s 后完成 + 事件驱动立即返回）
//       3) 无 token 30s 超时 → 「链接无效或已过期」 4) 有 token 但最终超时 → 「登录确认超时（网络较慢）」
//       5) OAuth error 回跳立即返回中文错误 6) PKCE code 兜底路径
// 用假计时器控制时间推进，不依赖真实等待。
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---------- 假计时器 ----------
let now = 0;
let timers = [];
let nextId = 1;
function fakeSetTimeout(fn, ms) {
  const id = nextId++;
  timers.push({ id, fn, at: now + ms, interval: false, ms });
  return id;
}
function fakeSetInterval(fn, ms) {
  const id = nextId++;
  timers.push({ id, fn, at: now + ms, interval: true, ms });
  return id;
}
function fakeClear(id) {
  timers = timers.filter((t) => t.id !== id);
}
async function advance(ms) {
  const target = now + ms;
  // 每步先 flush 嵌套微任务链（await promise.catch(...) 等包装会延迟一个轮次才入队，
  // 只 flush 一次会漏掉其后注册的 timer），再执行到期回调
  let guard = 0;
  while (guard++ < 100000) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    let next = null;
    for (const t of timers) {
      if (t && t.at <= target && (!next || t.at < next.at)) next = t;
    }
    if (!next) break;
    now = next.at;
    if (next.interval) next.at += next.ms;
    else timers = timers.filter((t) => t !== next);
    next.fn();
  }
  now = target;
}
function resetClock() {
  now = 0;
  timers = [];
  nextId = 1;
}

// ---------- mock 环境 ----------
let currentSession = null;
let setSessionImpl = null;
let exchangeImpl = null;
const subscribers = [];

const fakeClient = {
  auth: {
    getSession: function () { return { data: { session: currentSession } }; },
    setSession: function (p) {
      return setSessionImpl ? setSessionImpl(p) : Promise.resolve({ data: { session: null }, error: { message: 'not implemented' } });
    },
    exchangeCodeForSession: function () {
      return exchangeImpl ? exchangeImpl() : Promise.resolve({ data: { session: null }, error: null });
    },
    onAuthStateChange: function (cb) {
      subscribers.push(cb);
      return { data: { subscription: { unsubscribe: function () {} } } };
    },
    getUser: async function () { return { data: { user: currentSession ? currentSession.user : null } }; },
    signOut: async function () {},
    signUp: async function () { return { data: {}, error: null }; },
    signInWithPassword: async function () { return { data: {}, error: null }; },
    verifyOtp: async function () { return { data: {}, error: null }; },
    resend: async function () { return { data: {}, error: null }; },
    resetPasswordForEmail: async function () { return { data: {}, error: null }; },
    updateUser: async function () { return { data: {}, error: null }; },
    signInWithOAuth: async function () { return { data: {}, error: null }; },
  },
};

global.window = global;
global.document = { cookie: '', dispatchEvent: function () {} };
global.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
global.CustomEvent = function (type, opts) { this.type = type; this.detail = opts && opts.detail; };
global.SUPABASE_CONFIG = { url: 'https://test.supabase.co', anonKey: 'test-anon-key' };
global.supabase = { createClient: function () { return fakeClient; } };
global.setTimeout = fakeSetTimeout;
global.setInterval = fakeSetInterval;
global.clearTimeout = fakeClear;
global.clearInterval = fakeClear;
global.Date.now = function () { return now; };

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');
const factory = new Function('window', 'document', 'localStorage', 'CustomEvent', 'SUPABASE_CONFIG', 'supabase', src + '\nreturn window.Auth;');
const Auth = factory(global.window, global.document, global.localStorage, global.CustomEvent, global.SUPABASE_CONFIG, global.supabase);

function reset() {
  resetClock();
  currentSession = null;
  setSessionImpl = null;
  exchangeImpl = null;
  subscribers.length = 0;
  // 重新注册 init 订阅（模拟新页面加载）
  Auth.refreshUser();
}

function sess(provider) {
  return {
    access_token: 'at',
    refresh_token: 'rt',
    user: { app_metadata: { provider: provider || 'google' } },
  };
}

let passed = 0;
const cases = [];

// 用例 1：setSession 首次网络失败、重试成功（快路径，~1s 返回，provider=google）
cases.push(async function () {
  reset();
  let calls = 0;
  setSessionImpl = async function () {
    calls++;
    if (calls === 1) return { data: null, error: { message: 'network' } };
    currentSession = sess('google');
    return { data: { session: currentSession }, error: null };
  };
  const p = Auth.handleCallback({ search: '', hash: '#access_token=at&refresh_token=rt' });
  await advance(1100); // 推进 sleep(1000) → 重试成功
  const r = await p;
  assert.strictEqual(r.ok, true, 'case1: ok');
  assert.strictEqual(r.type, 'confirm', 'case1: type');
  assert.strictEqual(r.provider, 'google', 'case1: provider');
  assert.strictEqual(calls, 2, 'case1: 重试了一次');
});

// 用例 2：慢网络——setSession 全部失败，detectSessionInUrl 12s 后才完成并触发 SIGNED_IN → 事件驱动立即返回（不等 30s）
cases.push(async function () {
  reset();
  setSessionImpl = async function () { return { data: null, error: { message: 'network' } }; };
  const p = Auth.handleCallback({ search: '', hash: '#access_token=at&refresh_token=rt' });
  await advance(2100); // 两次 setSession + sleep 耗尽 → 进入 waitForSession
  await advance(9900); // 推进到 12s（模拟慢网络）
  currentSession = sess('github'); // detectSessionInUrl 此刻完成
  subscribers.slice().forEach(function (cb) { cb('SIGNED_IN', currentSession); });
  const r = await p;
  assert.strictEqual(r.ok, true, 'case2: ok');
  assert.strictEqual(r.provider, 'github', 'case2: provider');
});

// 用例 3：无 token 无 code，30s 超时 → 链接无效
cases.push(async function () {
  reset();
  const p = Auth.handleCallback({ search: '', hash: '' });
  await advance(30200);
  const r = await p;
  assert.strictEqual(r.ok, false, 'case3: !ok');
  assert.ok(r.message.indexOf('链接无效或已过期') !== -1, 'case3: message=' + r.message);
});

// 用例 4：有 token 但一直未建成会话，30s 超时 → 网络超时提示（不再误报链接无效）
cases.push(async function () {
  reset();
  setSessionImpl = async function () { return { data: null, error: { message: 'network' } }; };
  const p = Auth.handleCallback({ search: '', hash: '#access_token=at&refresh_token=rt' });
  // waitForSession 在 now≈1000（setSession 重试 sleep 后）才开始计时，需推进 31s+ 才能越过 30s 超时
  await advance(31200);
  const r = await p;
  assert.strictEqual(r.ok, false, 'case4: !ok');
  assert.ok(r.message.indexOf('登录确认超时') !== -1, 'case4: message=' + r.message);
});

// 用例 5：OAuth error 回跳（邮箱已注册冲突）→ 立即返回中文错误，不进入等待
cases.push(async function () {
  reset();
  let waited = false;
  const origWait = fakeSetInterval;
  const p = Auth.handleCallback({ search: '?error=email_exists&error_description=User+already+registered', hash: '' });
  // 同步路径：不 await，立即返回（error 分支无任何 timer）
  const r = await p;
  assert.strictEqual(r.ok, false, 'case5: !ok');
  assert.strictEqual(r.message, '该邮箱已注册，请直接使用邮箱密码登录', 'case5: message');
  void origWait; void waited;
});

// 用例 6：PKCE code 兜底路径 → provider 固定 email（需先等 waitForSession 30s 超时才会走 code 分支）
cases.push(async function () {
  reset();
  exchangeImpl = async function () { return { data: { session: sess('email') }, error: null }; };
  const p = Auth.handleCallback({ search: '?code=some-code', hash: '' });
  await advance(30200); // 越过 waitForSession 30s 超时 → 走 exchangeCodeForSession 分支
  const r = await p;
  assert.strictEqual(r.ok, true, 'case6: ok');
  assert.strictEqual(r.provider, 'email', 'case6: provider=email');
});

(async function run() {
  for (const c of cases) {
    await c();
    passed++;
    console.log('PASS case ' + passed);
  }
  console.log(passed + '/' + cases.length + ' passed');
  process.exit(passed === cases.length ? 0 : 1);
})().catch(function (e) {
  console.error('FAIL:', e && e.message || e);
  process.exit(1);
});
