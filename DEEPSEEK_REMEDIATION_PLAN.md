# 晴海后续整改实施计划（供 DeepSeek 落地）

> 基线日期：2026-08-10
> 最高风险“普通用户可自行修改会员等级/额度”已由 `006_lock_profile_entitlements.sql` 修复。
> 实施原则：每一项先在测试项目验证，再部署生产；所有数据库变更必须新增幂等 migration，禁止只在 Dashboard 手工修改而不回写仓库。

## P1：接通 Supabase 原生 CAPTCHA

### 当前问题

网页先调用 `/api/verify-turnstile`，验证通过后再调用 `supabase.auth.signUp()`；但 Supabase Auth 的 CAPTCHA 保护未开启。攻击者可跳过网页，直接调用 `/auth/v1/signup`。

### 实施步骤

1. Supabase Dashboard → Authentication → Bot and Abuse Protection：
   - 开启 CAPTCHA；
   - Provider 选择 Cloudflare Turnstile；
   - 填入现有 Turnstile Secret。
2. 修改 `js/auth.js`：
   - `signUp(email, password)` 增加 `captchaToken` 参数；
   - 调用 `client.auth.signUp` 时传入 `options: { captchaToken }`。
3. 修改 `auth.html`：
   - Turnstile 成功后把 token 直接传给 `Auth.signUp`；
   - 注册请求完成后，无论成功失败都 reset Turnstile；
   - 避免一个 token 重复使用。
4. 评估 `/api/verify-turnstile`：
   - Supabase 原生验证上线并稳定后，可删除这层重复验证；
   - 若保留，只作为前置快速失败，不得把它视为最终安全边界。
5. 更新 `tests/verify-turnstile.test.mjs` 与 `tests/auth-oauth.test.js`，覆盖 token 透传、缺 token、token 重用失败。

### 验收

- 不带 `captchaToken` 直接调用 Supabase signup 必须失败。
- 正常页面注册、重发验证码、找回密码流程均可用。
- 非本站 Origin 继续被 `/api/verify-turnstile` 拒绝。

## P1：加强密码与邮件滥用保护

### 实施步骤

1. Supabase Authentication → Password Security：
   - 最短密码由 6 调整到至少 8；建议 10；
   - 至少要求字母和数字；
   - 套餐支持时开启 Leaked Password Protection。
2. 同步修改 `auth.html`、`auth/callback.html`：
   - `minlength` 与提示文案必须与服务端一致；
   - 注册页持续显示密码要求，不要只在提交失败后提示。
3. Authentication → Rate Limits：复核 `rate_limit_email_sent = 120` 是否符合阿里云 SMTP 配额和实际注册量；无明确容量依据时先降到保守值。
4. 增加注册、找回密码、重发验证码的失败文案映射，避免直接展示英文服务端错误。

### 验收

- 7 位密码、纯常见弱密码和已泄露密码按配置被拒绝。
- 前端要求与 Supabase 返回一致。
- 邮件突发请求触发 429 后页面有明确冷却提示。

## P1：收紧 SECURITY DEFINER 函数

### 当前告警

- `public.handle_new_user()`：anon/authenticated 可执行；
- `public.rls_auto_enable()`：anon/authenticated 可执行；
- `public.username_taken(text)`：anon/authenticated 可执行。

### 实施步骤

新增 migration：

```sql
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.username_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.username_taken(text) TO anon, authenticated;
```

继续保留两个触发器函数的 `SECURITY DEFINER` 和固定 `search_path`；它们由数据库触发器调用，不需要成为公开 RPC。`username_taken` 返回布尔值是产品必需能力，保留显式最小授权，并增加输入长度/格式限制及速率控制评估。

### 验收

- Supabase Security Advisor 不再报告前两个函数公开执行。
- 注册后仍会自动创建 profile。
- 用户名占用检查仍可用，不能返回邮箱、UID 或完整用户名列表。

## P2：优化 RLS 策略性能和角色范围

新增 migration，把三个表策略中的 `auth.uid()` 改为 `(select auth.uid())`，并明确 `TO authenticated`，不要让策略默认应用于 PUBLIC。

涉及：

- `profiles`：select / insert / update；
- `favorites`：select / insert / update / delete；
- `user_preferences`：select / insert / update / delete。

每个 UPDATE 策略同时写出 `USING` 和 `WITH CHECK`，即使 PostgreSQL 有默认回退规则，也保持审计可读性。

### 验收

- Performance Advisor 的 11 项 `auth_rls_initplan` 告警清零。
- 使用两个不同测试账号验证无法互读、互改、互删数据。

## P2：最小化其余表权限和数据约束

1. `favorites`：
   - anon 撤销全部权限；
   - authenticated 只保留 SELECT / INSERT / DELETE，若产品无编辑功能则不授 UPDATE；
   - 添加纬度 `-90..90`、经度 `-180..180`、有限数值检查；
   - 评估同用户、同坐标附近收藏的数据库唯一性约束。
2. `user_preferences`：
   - anon 撤销全部权限；
   - authenticated 只保留业务需要的 SELECT / INSERT / UPDATE / DELETE；
   - 为 `default_city` 添加数据库长度上限；
   - 限制 `travel_prefs` 必须为 JSON object 且设置合理体积上限。
3. 数据库网络：若无外部直连需求，收紧 `0.0.0.0/0` 和 `::/0`。
4. 生产 OAuth redirect allow list：确认不再需要时移除 localhost callback。

## P2：界面信息架构优化

### 手机首屏

- 目标尺寸：390×844 下必须看到目的地和主操作按钮。
- 手机端压缩 Hero 上下间距和标题尺寸。
- 四行模型时效默认折叠为一行“4/4 模型可用”，点击再展开详情。
- 主按钮可在查询面板底部使用短距离 sticky，但不得遮挡系统安全区。

### 时间文案

- `js/app.js` 中 `updateDataStatus()` 的“数据更新至”改为“预报覆盖至”。
- 模型表明确拆成“预报覆盖至”和“模型可用时间”，不要把 forecast end 与 run availability 混称为更新时间。

### 可读性与触控

- 主内容普通说明文字不低于 12px，核心状态不低于 13px。
- 手机主要交互目标建议至少 44px 高；次级紧凑控件也应保持足够间距。
- 提高玻璃面板底色不透明度与次级文字对比度。
- 减少日期导航、当天详情与逐日列表的重复信息；默认只展开选中日期。

## P3：恢复可复现的自动化验证

1. 在 `package.json` 固定开发依赖和脚本，不再依赖机器全局安装的 `playwright-core`。
2. 增加统一脚本，例如：

```json
{
  "scripts": {
    "test": "node --test tests/*.test.js tests/*.test.mjs",
    "test:e2e": "node tests/e2e.check.js && node tests/search.check.js && node tests/map-search.check.js",
    "test:css": "node tests/css.check.js"
  }
}
```

3. 修复 `tests/css.check.js` 与实际规则不一致的问题：当前测试宣称只禁止主内容 11px，却对整个 CSS 做字符串匹配。
4. CI 至少覆盖：单元测试、CSS 检查、桌面 1280×720、手机 390×844、未登录和登录两种状态。

## 推荐实施顺序

1. Supabase 原生 CAPTCHA；
2. 密码策略与邮件限流；
3. SECURITY DEFINER 函数权限；
4. RLS 性能与其余表最小权限；
5. 手机首屏和时间文案；
6. 自动化测试环境。

每完成一项，都应同步更新 `CHANGELOG.md`、相关 migration、README 配置说明和对应测试，随后再部署生产。
