-- 用户偏好：默认区域（四川省 / 海南省）
-- 已登录用户设置后，下次进入/登录自动切换到所选区域；未设置（NULL）默认海南省。
-- 仅新增列 + CHECK 白名单约束；RLS 四策略与 GRANT 原样不动（列继承表级权限，无提权面）。
-- 已于 2026-08-09 在生产项目（mgryvcdawdlomdztqvrl）通过 Management API 执行完毕；
-- 本文件幂等（IF NOT EXISTS + 内联 CHECK 仅随 ADD COLUMN 生效），新环境仍可在 Supabase Dashboard → SQL Editor 执行（与 004 的部署约定一致）。

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS default_region text
  CHECK (default_region IS NULL OR default_region IN ('hainan', 'sichuan'));
