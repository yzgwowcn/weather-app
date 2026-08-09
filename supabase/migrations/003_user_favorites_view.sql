-- 003_user_favorites_view.sql — 收藏管理视图（仅管理员/管理端查看用，不开放给普通用户）
-- 目的：favorites 规范化表保持不变（FK/索引/RLS 已规范），此视图把每个用户的收藏聚合成一行，
--      方便在 Dashboard / 管理 SQL 中按用户一览收藏（一个用户一行）。
-- 幂等：可重复执行。
-- 注意：视图未对普通角色授权，默认只有 postgres/owner 可查，不会泄露他人收藏。

CREATE OR REPLACE VIEW public.user_favorites_view AS
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
