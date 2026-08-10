-- 昵称仅允许 2-20 个中文、英文字母或数字。
-- NOT VALID 保留可能存在的历史昵称，但会立即阻止新的不合规写入；
-- 待历史数据确认/清理后可执行 VALIDATE CONSTRAINT。
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format_check
  CHECK (
    username IS NULL OR (
      char_length(username) BETWEEN 2 AND 20
      AND username ~ '^[一-龥A-Za-z0-9]+$'
    )
  ) NOT VALID;
