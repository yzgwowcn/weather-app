const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

const index = read('index.html');
const account = read('account.html');
const auth = read('auth.html');
const panel = read('js/account-panel.js');
const user = read('js/user.js');
const migration = read('supabase/migrations/009_username_format.sql');

test('首页抽屉提供昵称编辑入口，缺少昵称时提供可关闭提醒', () => {
  assert.match(index, /id="panel-edit-username" href="account\.html\?edit=username"/);
  assert.match(index, /id="nickname-prompt"/);
  assert.match(index, /id="nickname-prompt-close"/);
  assert.match(index, /href="account\.html\?edit=username" class="nickname-prompt-action"/);
  assert.match(panel, /if \(!current \|\| current\.id !== user\.id \|\| !r\.ok\) return;/);
  assert.match(panel, /var missing = !\(r\.profile && r\.profile\.username\);/);
  assert.match(panel, /nicknameDismissedUserId = user \? user\.id : '';/);
});

test('昵称编辑链接会在账户页直接展开编辑区', () => {
  assert.match(account, /new URLSearchParams\(window\.location\.search\)\.get\('edit'\) === 'username'/);
  assert.match(account, /showUnameEdit\(\)/);
});

test('注册和修改昵称统一限制为 2-20 个中文、英文字母或数字', () => {
  assert.match(user, /\^\[\\u4e00-\\u9fa5A-Za-z0-9\]\{2,20\}\$/);
  assert.doesNotMatch(user, /A-Za-z0-9_/);
  assert.match(auth, /id="signup-username"[^>]+minlength="2"[^>]+maxlength="20"/);
  assert.match(account, /id="uname-input"[^>]+minlength="2"[^>]+maxlength="20"/);
  assert.match(migration, /char_length\(username\) BETWEEN 2 AND 20/);
  assert.match(migration, /username ~ U&'\^\[\\4E00-\\9FA5A-Za-z0-9\]\+\$'/);
  assert.match(migration, /NOT VALID/);
});
