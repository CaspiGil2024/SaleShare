-- =====================================================================
-- SailShare — admin override of a partner's calendar view preference
-- =====================================================================
-- default_calendar_view already exists on public.users (0031/0032) —
-- no new column needed. What's missing: the only UPDATE policy on
-- public.users is "you can update your own row" (users_update_own,
-- 0001) — an admin/manager trying to change ANOTHER partner's
-- preference from EditPartnerModal.jsx would be silently RLS-blocked.
--
-- Deliberately NOT routed through partner_roster (unlike full_name/
-- phone/roles/is_active/is_frozen, which sync roster -> users one-way
-- via fn_apply_partner_roster). default_calendar_view has TWO writers
-- by design — the partner themselves (self-service, switching views in
-- the calendar toolbar — see AuthProvider.jsx's updateDefaultCalendar-
-- View, added last session) and now an admin override here. Routing
-- this through the one-way roster sync would mean: partner picks
-- "month" on the calendar -> public.users updated directly -> roster
-- still shows the old value (roster was never touched) -> admin later
-- saves ANY unrelated Edit Partner change -> sync fires -> partner's
-- self-picked "month" gets silently overwritten back to the stale
-- roster value. Writing straight to public.users for this one field,
-- from both directions, avoids that whole class of drift/clobber.
--
-- Same layered pattern as 0015's partner_roster gates: a new
-- permissive RLS policy lets a manager's UPDATE through the door at
-- all (previously only "it's your own row" could), then a trigger
-- narrows what a NON-owner is actually allowed to touch on someone
-- else's row to just this one column.
-- =====================================================================

drop policy if exists users_update_by_manager on public.users;
create policy users_update_by_manager on public.users
  for update using (public.can_edit_partners()) with check (public.can_edit_partners());

create or replace function public.trg_fn_enforce_users_field_gate()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() = NEW.id then
    return NEW; -- self-service: unrestricted (matches users_update_own's existing scope)
  end if;

  if NEW.default_calendar_view is distinct from OLD.default_calendar_view
     and not public.can_edit_partners() then
    raise exception 'אין לכם הרשאה לשנות הגדרה זו עבור שותף אחר.' using errcode = 'P0001';
  end if;

  if (NEW.full_name, NEW.email, NEW.phone, NEW.role, NEW.is_active, NEW.is_frozen, NEW.is_test_account)
     is distinct from (OLD.full_name, OLD.email, OLD.phone, OLD.role, OLD.is_active, OLD.is_frozen, OLD.is_test_account) then
    raise exception 'שינוי שדות אלה עבור שותף אחר חייב לעבור דרך ניהול שותפים (partner_roster).' using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_users_field_gate on public.users;
create trigger trg_enforce_users_field_gate
  before update on public.users
  for each row execute function public.trg_fn_enforce_users_field_gate();
