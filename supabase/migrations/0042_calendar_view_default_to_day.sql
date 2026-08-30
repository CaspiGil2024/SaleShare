-- =====================================================================
-- SailShare — calendar view default: week -> day (today)
-- =====================================================================
-- Same shape as 0032 (which set the default to 'week'): only changes
-- the COLUMN DEFAULT used for newly-provisioned accounts (handle_new_
-- auth_user's insert into public.users relies on it, same as before).
-- Deliberately does NOT touch existing rows — a partner who already
-- has an explicit saved preference (whether 'day', 'week', or 'month')
-- keeps it; this only changes what a brand-new partner starts on.
-- =====================================================================

alter table public.users alter column default_calendar_view set default 'day';
