const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'auth.html'), 'utf8');
const callbackHtml = fs.readFileSync(path.join(__dirname, '..', 'auth', 'callback.html'), 'utf8');

test('登录、注册、找回密码均提供可访问的密码显隐按钮', () => {
  for (const id of ['login-password', 'signup-password', 'signup-password2', 'forgot-password', 'forgot-password2']) {
    assert.match(html, new RegExp(`data-password-toggle="${id}"`));
  }
  assert.match(html, /aria-label="显示密码"/);
  assert.match(html, /button\.setAttribute\('aria-label', show \? '隐藏密码' : '显示密码'\)/);
  assert.match(callbackHtml, /data-password-toggle="new-password"/);
  assert.match(callbackHtml, /data-password-toggle="new-password2"/);
});

test('找回密码严格按资料、8 位验证码、验证、改密顺序执行', () => {
  for (const id of ['forgot-email', 'forgot-password', 'forgot-password2', 'forgot-code', 'forgot-code-submit']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="forgot-code"[\s\S]*maxlength="8"[\s\S]*pattern="\[0-9\]\{8\}"/);
  assert.match(html, /if \(!\/\^\\d\{8\}\$\/\.test\(code\)\)/);
  assert.ok(html.indexOf('Auth.verifyRecoveryOtp(forgotEmail, code)') < html.indexOf('Auth.updatePassword(forgotNewPassword)'));
  assert.doesNotMatch(html, /localStorage[\s\S]*forgotNewPassword|forgotNewPassword[\s\S]*localStorage/);
});
