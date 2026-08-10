const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const calls = [];
const fakeClient = {
  auth: {
    resetPasswordForEmail: async (email, options) => { calls.push(['reset', email, options]); return { error: null }; },
    verifyOtp: async (payload) => { calls.push(['verify', payload]); return { data: { user: { id: 'u1' } }, error: null }; },
    updateUser: async (payload) => { calls.push(['update', payload]); return { error: null }; },
    getUser: async () => ({ data: { user: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => {},
  },
};
const windowMock = { location: { origin: 'https://weather.example' } };
const documentMock = { cookie: '', dispatchEvent() {} };
const localStorageMock = { getItem() { return null; }, setItem() {}, removeItem() {} };
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');
const factory = new Function('window', 'document', 'localStorage', 'CustomEvent', 'SUPABASE_CONFIG', 'supabase', source + '\nreturn window.Auth;');
const Auth = factory(
  windowMock,
  documentMock,
  localStorageMock,
  function CustomEvent() {},
  { url: 'https://test.supabase.co', anonKey: 'anon' },
  { createClient: () => fakeClient },
);

test('找回邮件规范化邮箱并保留旧链接回调兼容', async () => {
  calls.length = 0;
  assert.deepEqual(await Auth.resetPasswordForEmail(' User@Example.COM '), { ok: true });
  assert.equal(calls[0][0], 'reset');
  assert.equal(calls[0][1], 'user@example.com');
  assert.equal(calls[0][2].redirectTo, 'https://weather.example/auth/callback.html');
});

test('Recovery OTP 验证后才允许提交新密码', async () => {
  calls.length = 0;
  const verified = await Auth.verifyRecoveryOtp(' User@Example.COM ', ' 12345678 ');
  assert.equal(verified.ok, true);
  assert.deepEqual(calls[0], ['verify', { email: 'user@example.com', token: '12345678', type: 'recovery' }]);
  assert.deepEqual(await Auth.updatePassword('new-secret'), { ok: true });
  assert.deepEqual(calls[1], ['update', { password: 'new-secret' }]);
});
