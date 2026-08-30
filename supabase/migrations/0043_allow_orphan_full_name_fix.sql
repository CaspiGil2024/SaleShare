-- =====================================================================
-- SailShare — let a manager fix full_name for an orphan account
-- =====================================================================
-- trg_fn_enforce_users_field_gate (0033/0037) unconditionally blocks
-- ANY change to full_name/email/phone/role/is_active/is_frozen/
-- is_test_account on someone else's public.users row, full stop —
-- "must go through partner management (partner_roster)". That's
-- correct for a roster-tracked partner (roster IS the source of
-- truth), but it also blocks the one new legitimate case
-- PartnersPage.jsx now supports: fixing full_name for an "orphan"
-- account — someone who signed up directly (the old self-service flow,
-- since removed) and was never added to partner_roster at all, so
-- there's no roster row to correct it FROM and no sync mechanism ever
-- reaches them (see 0010's fix, which only helps roster-matched
-- accounts). Without this, that fix silently 403s.
--
-- Carve-out: a manager (can_edit_partners()) MAY change full_name for
-- another user's row, but ONLY when that email has no partner_roster
-- entry. Every other field, and every roster-tracked account's
-- full_name, still must go through partner_roster exactly as before.
-- =====================================================================

create or replace function public.trg_fn_enforce_users_field_gate()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_in_roster boolean;
begin
  if auth.uid() = NEW.id then
    return NEW; -- self-service: unrestricted (matches users_update_own's existing scope)
  end if;

  if (NEW.default_calendar_view is distinct from OLD.default_calendar_view
      or NEW.emails_enabled is distinct from OLD.emails_enabled
      or NEW.receive_shared_sail_notifications is distinct from OLD.receive_shared_sail_notifications)
     and not public.can_edit_partners() then
    raise exception 'אין לכם הרשאה לשנות הגדרה זו עבור שותף אחר.' using errcode = 'P0001';
  end if;

  if (NEW.email, NEW.phone, NEW.role, NEW.is_active, NEW.is_frozen, NEW.is_test_account)
     is distinct from (OLD.email, OLD.phone, OLD.role, OLD.is_active, OLD.is_frozen, OLD.is_test_account) then
    raise exception 'שינוי שדות אלה עבור שותף אחר חייב לעבור דרך ניהול שותפים (partner_roster).' using errcode = 'P0001';
  end if;

  if NEW.full_name is distinct from OLD.full_name then
    if not public.can_edit_partners() then
      raise exception 'אין לכם הרשאה לשנות שם עבור שותף אחר.' using errcode = 'P0001';
    end if;
    select exists(select 1 from public.partner_roster where lower(email) = lower(NEW.email)) into v_in_roster;
    if v_in_roster then
      raise exception 'שינוי שם עבור שותף ברשימת השותפים חייב לעבור דרך ניהול שותפים (partner_roster).' using errcode = 'P0001';
    end if;
  end if;

  return NEW;
end;
$$;
