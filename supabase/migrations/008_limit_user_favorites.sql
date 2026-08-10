-- 008_limit_user_favorites.sql — 每位用户最多 20 个收藏地点
-- 已于 2026-08-10 在生产项目 mgryvcdawdlomdztqvrl 通过 Management API 执行并验证。
--
-- 前端计数只能改善体验，无法阻止多标签页并发或直接调用 Data API。
-- 数据库 BEFORE INSERT 触发器按 user_id 获取事务级 advisory lock，再计数，
-- 保证同一用户的并发写入也不会同时越过上限。存量超过 20 行不会被删除，
-- 但在删减到 20 行以下前不能继续新增。
-- 幂等：可重复执行。

CREATE SCHEMA IF NOT EXISTS _admin;

CREATE OR REPLACE FUNCTION _admin.enforce_favorites_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 将同一用户的收藏新增串行化；不同用户仍可并发写入。
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.user_id::text, 20260810)
  );

  IF (
    SELECT pg_catalog.count(*)
    FROM public.favorites
    WHERE user_id = NEW.user_id
  ) >= 20 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'FAVORITES_LIMIT_REACHED',
      DETAIL = 'Each user can save at most 20 favorite locations.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION _admin.enforce_favorites_limit() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_favorites_limit ON public.favorites;
CREATE TRIGGER enforce_favorites_limit
  BEFORE INSERT ON public.favorites
  FOR EACH ROW
  EXECUTE FUNCTION _admin.enforce_favorites_limit();
