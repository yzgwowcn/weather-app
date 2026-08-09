const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '006_lock_profile_entitlements.sql'),
  'utf8'
);

test('authenticated 只能写 profiles 的安全列', () => {
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.profiles FROM authenticated;/);
  assert.match(migration, /GRANT INSERT \(user_id, username\) ON TABLE public\.profiles TO authenticated;/);
  assert.match(migration, /GRANT UPDATE \(username\) ON TABLE public\.profiles TO authenticated;/);
  assert.doesNotMatch(migration, /GRANT UPDATE\s+ON TABLE public\.profiles TO authenticated;/);
});

test('anon 无 profiles 权限且权益字段有触发器保护', () => {
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.profiles FROM anon;/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION _admin\.guard_profile_entitlements\(\)/);
  for (const column of ['plan', 'pro_started_at', 'pro_expires_at', 'ai_quota', 'ai_used']) {
    assert.match(migration, new RegExp(`NEW\\.${column}`));
    assert.match(migration, new RegExp(`OLD\\.${column}`));
  }
  assert.match(migration, /CREATE TRIGGER guard_profile_entitlements/);
});

test('service_role 保留权益管理能力', () => {
  assert.match(migration, /GRANT ALL PRIVILEGES ON TABLE public\.profiles TO service_role;/);
});
