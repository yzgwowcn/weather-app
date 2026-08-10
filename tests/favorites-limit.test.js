const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '008_limit_user_favorites.sql'),
  'utf8',
);
const userSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'user.js'), 'utf8');

test('数据库在 INSERT 前强制每位用户最多 20 个收藏', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION _admin\.enforce_favorites_limit\(\)/);
  assert.match(migration, /BEFORE INSERT ON public\.favorites/);
  assert.match(migration, /WHERE user_id = NEW\.user_id[\s\S]*>= 20/);
  assert.match(migration, /MESSAGE = 'FAVORITES_LIMIT_REACHED'/);
});

test('同一用户并发新增由事务级 advisory lock 串行化', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /hashtextextended\(NEW\.user_id::text, 20260810\)/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(migration, /REVOKE ALL ON FUNCTION _admin\.enforce_favorites_limit\(\) FROM PUBLIC/);
});

test('前端提供 20 个上限的快速检查与数据库错误友好提示', () => {
  assert.match(userSource, /var MAX_FAVORITES = 20;/);
  assert.match(userSource, /list\.favorites\.length >= MAX_FAVORITES/);
  assert.match(userSource, /FAVORITES_LIMIT_REACHED/);
  assert.match(userSource, /最多收藏 20 个地点/);
});
