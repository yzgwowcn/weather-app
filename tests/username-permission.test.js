const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'user.js'), 'utf8');
let profileData = null;
let profileError = null;
let writes = [];

const client = {
  rpc: async function (name) {
    assert.equal(name, 'username_taken');
    return { data: false, error: null };
  },
  from: function (table) {
    assert.equal(table, 'profiles');
    return {
      select: function () {
        return {
          eq: function () {
            return { maybeSingle: async function () { return { data: profileData, error: profileError }; } };
          },
        };
      },
      update: function (patch) {
        writes.push({ kind: 'update', value: patch });
        return { eq: async function (column, value) {
          writes[writes.length - 1].filter = { column: column, value: value };
          return { error: null };
        } };
      },
      insert: async function (row) {
        writes.push({ kind: 'insert', value: row });
        return { error: null };
      },
      upsert: function () {
        throw new Error('profiles 昵称保存不得使用 upsert');
      },
    };
  },
};

const sandbox = {
  Auth: {
    isReady: function () { return true; },
    getUser: function () { return { id: 'user-1' }; },
    getClient: function () { return client; },
  },
};
sandbox.window = sandbox;
const User = new Function('window', source + '\nreturn window.User;')(sandbox);

test('已有 profile 只更新 username，不请求更新 user_id', async function () {
  profileData = { username: '旧昵称' };
  profileError = null;
  writes = [];
  const result = await User.setUsername('新昵称2026');
  assert.equal(result.ok, true);
  assert.deepEqual(writes, [{
    kind: 'update',
    value: { username: '新昵称2026' },
    filter: { column: 'user_id', value: 'user-1' },
  }]);
});

test('确实没有 profile 时才插入 user_id 和 username', async function () {
  profileData = null;
  profileError = null;
  writes = [];
  const result = await User.setUsername('海南游客88');
  assert.equal(result.ok, true);
  assert.deepEqual(writes, [{
    kind: 'insert',
    value: { user_id: 'user-1', username: '海南游客88' },
  }]);
});

test('profile 查询失败时不误判为空记录，也不执行写入', async function () {
  profileData = null;
  profileError = { message: 'network error' };
  writes = [];
  const result = await User.setUsername('天气旅行者');
  assert.equal(result.ok, false);
  assert.equal(result.message, 'network error');
  assert.deepEqual(writes, []);
});
