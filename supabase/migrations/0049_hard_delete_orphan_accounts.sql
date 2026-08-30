-- =====================================================================
-- SailShare — permanent delete for orphan (non-roster) accounts
-- =====================================================================
-- The existing hard-delete (0015's trg_fn_enforce_partner_roster_role_
-- gates, fired by `delete from partner_roster`) only works for
-- roster-tracked partners — it's keyed off a partner_roster row, which
-- an orphan account (signed up directly via the old self-service flow,
-- never added to the roster — see PartnersPage.jsx's "לא ברשימת
-- שותפים" badge) doesn't have. This adds the equivalent for orphans:
-- same admin-only restriction, same cascade (public.users -> bookings/
-- user_wallets/user_roles/coin_transactions/booking_participants via
-- existing FKs), same limitation as the roster path already has — it
-- CANNOT remove the underlying auth.users login (needs the Admin API/
-- service-role key, not available to this client-side app); the auth
-- account becomes orphaned-with-no-profile rather than fully gone,
-- exactly like the roster hard-delete already behaves.
--
-- Deliberately refuses to touch a roster-tracked account — that one
-- has its own dedicated, already-audited path (delete the
-- partner_roster row instead), so this only ever needs to reason about
-- accounts with no roster row at all, not risk two different deletion
-- routes disagreeing on the same account type.
-- =====================================================================

create or replace function public.fn_admin_hard_delete_orphan_user(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_email text;
begin
  if not public.is_admin() then
    raise exception 'רק מנהל יכול למחוק שותף לצמיתות.' using errcode = 'P0001';
  end if;

  select email into v_email from public.users where id = p_user_id;
  if v_email is null then
    raise exception 'החשבון לא נמצא.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.partner_roster where lower(email) = lower(v_email)) then
    raise exception 'שותף זה נמצא ברשימת השותפים — יש למחוק אותו דרך רשימת השותפים הרגילה.' using errcode = 'P0001';
  end if;

  delete from public.users where id = p_user_id;
end;
$$;

revoke all on function public.fn_admin_hard_delete_orphan_user(uuid) from public;
grant execute on function public.fn_admin_hard_delete_orphan_user(uuid) to authenticated;
