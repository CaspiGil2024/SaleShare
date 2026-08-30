-- =====================================================================
-- SailShare — first-login forced password change flag
-- =====================================================================
-- Supports moving off Google OAuth to a single email+password login,
-- with existing partners bootstrapped onto a temporary password (their
-- own phone number — see scripts/provision-phone-passwords.sql, run
-- manually and separately since it touches auth.users and real
-- people's phone numbers, unlike this file it is NOT idempotent-safe
-- to bundle into a normal migration run).
--
-- No RLS/trigger change needed: the only UPDATE policy on public.users
-- is "you can update your own row" (users_update_own, 0001), and
-- trg_fn_enforce_users_field_gate (0033/0037) already lets a
-- self-service update (auth.uid() = NEW.id) through unrestricted — so
-- AuthProvider.jsx's changePassword() can clear this flag on itself
-- the same way it already writes default_calendar_view/emails_enabled.
-- =====================================================================

alter table public.users
  add column if not exists must_change_password boolean not null default false;
