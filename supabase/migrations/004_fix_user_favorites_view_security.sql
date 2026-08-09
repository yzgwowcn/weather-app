-- 004_fix_user_favorites_view_security.sql — 修复 user_favorites_view 安全漏洞（替代 003 中的视图）
-- 背景：003 创建的 public.user_favorites_view 被误授予 anon/authenticated 角色 ALL 权限
--       （relacl 实查为 anon=arwdDxtm, authenticated=arwdDxtm），而 PG15+ 视图默认以
--       定义者（postgres）权限执行（SECURITY DEFINER 语义），可完全绕过底层表 RLS。
--       结果：任何匿名访客经 PostgREST 查询该视图即可读取全部用户邮箱与收藏明细 ——
--       真实的数据泄露漏洞（Supabase Security Advisor 两个告警即由此而来）。
-- 修复策略：
--   1) 立即 REVOKE 旧视图上 anon/authenticated 的全部权限（止血）；
--   2) 视图迁出 public schema（PostgREST 仅暴露 public）至 _admin schema；
--   3) 以 WITH (security_invoker = true) 重建：视图按调用者权限执行（消除
--      "SECURITY DEFINER" 告警），任何授权角色的查询都受底层表 RLS 约束；
--   4) 仅对 service_role 授予 SELECT（管理端/SQL 用途），不向 anon/authenticated
--      开放（消除 "exposes auth.users" 告警）。
-- 幂等：可重复执行。
-- 注意：003_user_favorites_view.sql 已被本文件取代，请勿再执行 003（会重建 public 视图）。

-- 1) 止血：撤销 public 旧视图上的全部误授权（先撤权再删对象，保证任何失败路径下权限已收回）
REVOKE ALL ON public.user_favorites_view FROM anon;
REVOKE ALL ON public.user_favorites_view FROM authenticated;
REVOKE ALL ON public.user_favorites_view FROM PUBLIC;

-- 2) 管理专用 schema（PostgREST 不暴露；postgres 可随时查）
CREATE SCHEMA IF NOT EXISTS _admin;

-- 3) 删除旧视图，在 _admin 中以 security_invoker 语义重建（定义与 003 相同）
DROP VIEW IF EXISTS public.user_favorites_view;

CREATE OR REPLACE VIEW _admin.user_favorites_view
WITH (security_invoker = true)
AS
SELECT
  u.id                AS user_id,
  u.email             AS email,
  COUNT(f.id)         AS favorite_count,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',         f.id,
        'name',       f.name,
        'lat',        f.lat,
        'lon',        f.lon,
        'is_gcj',     f.is_gcj,
        'created_at', f.created_at
      )
      ORDER BY f.created_at DESC
    ) FILTER (WHERE f.id IS NOT NULL),
    '[]'::jsonb
  )                   AS favorites
FROM auth.users u
LEFT JOIN public.favorites f ON f.user_id = u.id
GROUP BY u.id, u.email
ORDER BY u.created_at ASC;

-- 4) 权限最小化：撤销默认 PUBLIC 授权，仅管理角色可查
REVOKE ALL ON _admin.user_favorites_view FROM PUBLIC;
GRANT USAGE ON SCHEMA _admin TO service_role;
GRANT SELECT ON _admin.user_favorites_view TO service_role;

-- 自检：以下查询应返回 0 行（无任何 anon/authenticated 授权残留）
-- SELECT c.relname, c.relacl::text FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE c.relname = 'user_favorites_view'
--   AND c.relacl::text LIKE '%anon=%';
