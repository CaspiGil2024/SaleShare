-- =====================================================================
-- NOTE (2026-08-26): unlike 0001/0002, this one's core assumptions held
-- up — public.users(id, full_name, email) and public.user_wallets
-- (user_id, period_id) all genuinely exist on the live DB. handle_new_
-- auth_user()'s CURRENT live body was replaced by 0004 (added a call to
-- fn_apply_partner_roster at the end) — 0004 is the up-to-date version
-- of this function; this file's body below is what it looked like
-- before that. See 0005_schema_reality_baseline.sql for the full
-- reconciliation notes.
-- =====================================================================
-- SailShare — Auto-provision public.users / user_wallets on sign-up
-- =====================================================================
-- Without this, a brand-new auth.users row (from email/password
-- sign-up OR a first-time Google OAuth sign-in) has no corresponding
-- public.users row. That breaks two things immediately:
--   1. The app has no full_name/role to display for the user.
--   2. trg_fn_enforce_s_rule() raises "no wallet exists for user"
--      on their very first booking attempt, since there's no
--      user_wallets row for the current period either.
-- =====================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;

  insert into public.user_wallets (user_id, period_id)
  select new.id, p.id
  from public.periods p
  where p.is_current = true
  on conflict (user_id, period_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
