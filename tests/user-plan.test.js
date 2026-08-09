// user-plan 回归测试：getPlanStatus 三档判定（含过期降级与未知档位兜底）+ savePreferences 校验与 upsert
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---- mock window.Auth（getPlanStatus 纯函数；savePreferences 走 mock client）----
let mockUser = null;
let mockClient = null;
global.window = global;
global.Auth = {
  isReady: function () { return true; },
  getUser: function () { return mockUser; },
  getClient: function () { return mockClient; },
};

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'user.js'), 'utf8');
const factory = new Function('window', src + '\nreturn window.User;');
const User = factory(global.window);

const now = Date.now();
const future = new Date(now + 30 * 86400000).toISOString();
const past = new Date(now - 30 * 86400000).toISOString();

let passed = 0;
const cases = [];
function t(name, fn) { cases.push([name, fn]); }

// ---- getPlanStatus 分支 ----
t('无 profile → free', function () {
  const s = User.getPlanStatus(null);
  assert.strictEqual(s.plan, 'free');
  assert.strictEqual(s.rawPlan, 'free');
  assert.strictEqual(s.expired, false);
  assert.strictEqual(s.proExpiresAt, null);
});
t('pro 未过期 → pro', function () {
  const s = User.getPlanStatus({ plan: 'pro', pro_expires_at: future });
  assert.strictEqual(s.plan, 'pro');
  assert.strictEqual(s.expired, false);
  assert.strictEqual(s.proExpiresAt, future);
});
t('pro 已过期 → free + expired + rawPlan=pro', function () {
  const s = User.getPlanStatus({ plan: 'pro', pro_expires_at: past });
  assert.strictEqual(s.plan, 'free');
  assert.strictEqual(s.expired, true);
  assert.strictEqual(s.rawPlan, 'pro');
});
t('ultra 未过期 → ultra', function () {
  const s = User.getPlanStatus({ plan: 'ultra', pro_expires_at: future });
  assert.strictEqual(s.plan, 'ultra');
  assert.strictEqual(s.expired, false);
  assert.strictEqual(s.rawPlan, 'ultra');
});
t('ultra 已过期 → free + expired', function () {
  const s = User.getPlanStatus({ plan: 'ultra', pro_expires_at: past });
  assert.strictEqual(s.plan, 'free');
  assert.strictEqual(s.expired, true);
  assert.strictEqual(s.rawPlan, 'ultra');
});
t('free 无到期时间 → free 不 expired', function () {
  const s = User.getPlanStatus({ plan: 'free' });
  assert.strictEqual(s.plan, 'free');
  assert.strictEqual(s.expired, false);
});
t('未知档位 → 兜底 free 且 rawPlan 保留', function () {
  const s = User.getPlanStatus({ plan: 'gold' });
  assert.strictEqual(s.plan, 'free');
  assert.strictEqual(s.rawPlan, 'gold');
  assert.strictEqual(s.expired, false);
});
t('pro 无 pro_expires_at → 视为已过期', function () {
  const s = User.getPlanStatus({ plan: 'pro' });
  assert.strictEqual(s.plan, 'free');
  assert.strictEqual(s.expired, true);
});

// ---- savePreferences 校验与 upsert ----
t('default_region 非法值被拒（不触库）', async function () {
  mockUser = { id: 'u1' };
  mockClient = { from: function () { throw new Error('不应触库'); } };
  const r = await User.savePreferences({ default_region: 'beijing' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.message.indexOf('默认区域无效') !== -1, r.message);
});
t('default_region 合法值走 upsert 且 null 可清除', async function () {
  mockUser = { id: 'u1' };
  let rows = [];
  mockClient = {
    from: function (t) {
      assert.strictEqual(t, 'user_preferences');
      return {
        upsert: function (row, opts) { rows.push({ row: row, opts: opts }); return Promise.resolve({ error: null }); },
      };
    },
  };
  let r = await User.savePreferences({ default_region: 'sichuan', default_city: 'chengdu' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(rows[0].row.default_region, 'sichuan');
  assert.strictEqual(rows[0].row.default_city, 'chengdu');
  assert.strictEqual(rows[0].opts.onConflict, 'user_id');
  r = await User.savePreferences({ default_region: null });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(rows[1].row.default_region, null);
});
t('getPreferences 透传 default_region', async function () {
  mockUser = { id: 'u1' };
  let table = null;
  mockClient = {
    from: function (t) {
      table = t;
      return {
        select: function () { return this; },
        eq: function () { return this; },
        maybeSingle: function () {
          return Promise.resolve({
            data: { default_region: 'sichuan', default_city: 'chengdu', temp_unit: 'celsius', travel_prefs: {}, updated_at: '2026-08-09T00:00:00Z' },
            error: null,
          });
        },
      };
    },
  };
  const r = await User.getPreferences();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(table, 'user_preferences');
  assert.strictEqual(r.preferences.default_region, 'sichuan');
});
t('temp_unit 非法值被拒（不触库）', async function () {
  mockUser = { id: 'u1' };
  mockClient = { from: function () { throw new Error('不应触库'); } };
  const r = await User.savePreferences({ temp_unit: 'kelvin' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.message.indexOf('温度单位无效') !== -1, r.message);
});
t('savePreferences 合法值走 upsert', async function () {
  mockUser = { id: 'u1' };
  let called = null;
  mockClient = {
    from: function (t) {
      assert.strictEqual(t, 'user_preferences');
      return {
        upsert: function (row, opts) { called = { row: row, opts: opts }; return Promise.resolve({ error: null }); },
      };
    },
  };
  const r = await User.savePreferences({ temp_unit: 'fahrenheit', default_city: 'sanya' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(called.row.user_id, 'u1');
  assert.strictEqual(called.row.temp_unit, 'fahrenheit');
  assert.strictEqual(called.row.default_city, 'sanya');
  assert.strictEqual(called.opts.onConflict, 'user_id');
});
t('travel_prefs 非对象被拒', async function () {
  mockUser = { id: 'u1' };
  mockClient = { from: function () { throw new Error('不应触库'); } };
  const r = await User.savePreferences({ travel_prefs: 'oops' });
  assert.strictEqual(r.ok, false);
});
t('未登录 savePreferences 被拒', async function () {
  mockUser = null;
  const r = await User.savePreferences({ temp_unit: 'celsius' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.message.indexOf('未登录') !== -1, r.message);
});

(async function run() {
  for (const item of cases) {
    await item[1]();
    passed++;
    console.log('PASS', item[0]);
  }
  console.log(passed + '/' + cases.length + ' passed');
  process.exit(passed === cases.length ? 0 : 1);
})().catch(function (e) {
  console.error('FAIL:', e && e.message || e);
  process.exit(1);
});
