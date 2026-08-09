-- 006_lock_profile_entitlements.sql — 阻止普通用户自行修改会员等级与额度
--
-- 背景：profiles 的 RLS 只能限制“修改自己的行”，不能限制“允许修改哪些列”。
-- authenticated 角色原先拥有表级 INSERT / UPDATE 权限，因此登录用户可绕过前端，
-- 直接把自己的 plan、会员有效期或 AI 额度改成任意允许值。
--
-- 修复：
--   1) anon 不再访问 profiles；
--   2) authenticated 仅可 SELECT，并仅可 INSERT(user_id, username)、UPDATE(username)；
--   3) _admin 触发器作为纵深防御，即使未来误恢复宽泛表权限，也拒绝普通角色篡改权益列；
--   4) service_role 保留完整管理权限，注册触发器 handle_new_user 仍以所有者权限正常建 profile。
--
-- 幂等：REVOKE / GRANT、CREATE OR REPLACE FUNCTION、DROP TRIGGER IF EXISTS 均可重复执行。

REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.profiles FROM authenticated;

GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT INSERT (user_id, username) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (username) ON TABLE public.profiles TO authenticated;

GRANT ALL PRIVILEGES ON TABLE public.profiles TO service_role;

CREATE SCHEMA IF NOT EXISTS _admin;

CREATE OR REPLACE FUNCTION _admin.guard_profile_entitlements()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND ROW(
       NEW.plan,
       NEW.pro_started_at,
       NEW.pro_expires_at,
       NEW.ai_quota,
       NEW.ai_used
     ) IS DISTINCT FROM ROW(
       OLD.plan,
       OLD.pro_started_at,
       OLD.pro_expires_at,
       OLD.ai_quota,
       OLD.ai_used
     ) THEN
    RAISE EXCEPTION 'profile entitlement fields are server-managed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION _admin.guard_profile_entitlements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _admin.guard_profile_entitlements() TO service_role;

DROP TRIGGER IF EXISTS guard_profile_entitlements ON public.profiles;
CREATE TRIGGER guard_profile_entitlements
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION _admin.guard_profile_entitlements();

NOTIFY pgrst, 'reload schema';

-- 生产执行后的只读自检：
-- SELECT
--   has_table_privilege('authenticated', 'public.profiles', 'SELECT') AS can_select,
--   has_table_privilege('authenticated', 'public.profiles', 'UPDATE') AS table_update_blocked,
--   has_column_privilege('authenticated', 'public.profiles', 'username', 'UPDATE') AS can_update_username,
--   has_column_privilege('authenticated', 'public.profiles', 'plan', 'UPDATE') AS cannot_update_plan;
-- 期望：true, false, true, false。
