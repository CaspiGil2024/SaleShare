-- =====================================================================
-- SailShare — fix: unbounded trigger recursion in roster→user sync
-- =====================================================================
-- Found during a DB-integrity review (2026-08-26), not from an
-- observed crash — flagging the reasoning so it isn't mistaken for a
-- confirmed incident.
--
-- trg_sync_roster_to_user (0010) is `after update on partner_roster`
-- with NO column restriction — it fires on every UPDATE statement
-- against any row, regardless of which column changed. Its function
-- calls fn_apply_partner_roster(), which ends with its own
-- `update partner_roster set applied_at = now() where email = ...` on
-- that SAME row. That nested update is itself a completely new UPDATE
-- statement, so it re-fires trg_sync_roster_to_user, which calls
-- fn_apply_partner_roster again, which issues the same nested update
-- again — recursion with no base case, for ANY partner_roster row that
-- has a matching signed-up public.users account (now true for most/all
-- of the 21 partners, post phone-password provisioning). This would
-- surface as "stack depth limit exceeded", aborting the whole
-- transaction — on a plain EditPartnerModal save, and on the new
-- Freeze/Soft-Delete actions in 0015 too, since they update the same
-- table the same way.
--
-- Fix: restrict the trigger to fire only on updates of the columns
-- that actually represent a real roster edit — full_name, email,
-- phone, roles, balance, is_active, is_test_account, is_frozen.
-- applied_at is deliberately excluded, which breaks the recursion at
-- its root (the nested update only ever touches applied_at) while
-- preserving every real sync scenario, Freeze/Soft-Delete included.
-- =====================================================================

drop trigger if exists trg_sync_roster_to_user on public.partner_roster;
create trigger trg_sync_roster_to_user
  after update of full_name, email, phone, roles, balance, is_active, is_test_account, is_frozen
  on public.partner_roster
  for each row execute function public.trg_fn_sync_roster_to_user();
