-- 002_user_tiers.sql — 用户等级/订阅底座 + 用户偏好表 + 注册自动建 profile
-- 执行方式：Supabase Dashboard SQL Editor 或 Management API database/query（本仓库开发流程用后者）
-- 幂等：所有 DDL 均可重复执行；已存在的对象/列/约束自动跳过。
-- 三档位：free / pro / ultra；pro 与 ultra 通过 pro_started_at/pro_expires_at 记录会员起始与到期时间。
-- ai_quota / ai_used 为远期 DeepSeek 等 AI 功能预留的额度底座（本期不启用逻辑）。

-- 1) profiles 扩展：等级、会员期、AI 额度
-- username 放开 NOT NULL：注册触发器只插 user_id 建行（避免占位用户名撞唯一约束），
--    用户未设置用户名时 profile 行存在但 username 为 NULL，前端显示「未设置」。
ALTER TABLE public.profiles ALTER COLUMN username DROP NOT NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'ultra'));
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pro_started_at timestamptz;       -- 会员起始时间（订阅开通时写入）
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pro_expires_at timestamptz;       -- 会员到期时间（订阅到期时写入）
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_quota integer NOT NULL DEFAULT 0;  -- AI 额度上限（DeepSeek 预留）
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_used integer NOT NULL DEFAULT 0;   -- 已用额度（DeepSeek 预留）

-- 2) user_preferences：默认城市 / 温度单位 / 出行偏好（jsonb 灵活扩展）
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  default_city text,                                   -- 默认城市（目的地 id 或名称）
  temp_unit   text NOT NULL DEFAULT 'celsius'
                CHECK (temp_unit IN ('celsius', 'fahrenheit')),
  travel_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,     -- 出行偏好（如 {"marine": true, "note": "..."}）
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS：用户仅能访问自己的行（auth.uid() = user_id）
DROP POLICY IF EXISTS "user_preferences_select_own" ON public.user_preferences;
CREATE POLICY "user_preferences_select_own" ON public.user_preferences
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_preferences_insert_own" ON public.user_preferences;
CREATE POLICY "user_preferences_insert_own" ON public.user_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_preferences_update_own" ON public.user_preferences;
CREATE POLICY "user_preferences_update_own" ON public.user_preferences
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_preferences_delete_own" ON public.user_preferences;
CREATE POLICY "user_preferences_delete_own" ON public.user_preferences
  FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;

-- 3) 注册自动建 profile：新用户（邮箱/OAuth）创建时插入一行（不覆盖已有行）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id) VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4) 存量用户回填：为已存在但无 profile 行的用户补建行（plan 默认 'free'）
INSERT INTO public.profiles (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
