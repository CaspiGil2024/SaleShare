-- =====================================================================
-- SailShare — partner email notification preferences
-- =====================================================================
-- Same shape as default_calendar_view (0031/0033): lives on
-- public.users (account-level, not partner_roster), self-editable via
-- users_update_own, and admin-editable via the field-gate trigger from
-- 0033 (extended below to also cover these 2 new columns) so
-- EditPartnerModal.jsx can manage it for a partner without needing the
-- roster-sync pipeline.
-- =====================================================================

alter table public.users add column if not exists emails_enabled boolean not null default false;
alter table public.users add column if not exists receive_shared_sail_notifications boolean not null default false;

create or replace function public.trg_fn_enforce_users_field_gate()
returns trigger
language plpgsql
security definer set search_path = public
as $$
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

  if (NEW.full_name, NEW.email, NEW.phone, NEW.role, NEW.is_active, NEW.is_frozen, NEW.is_test_account)
     is distinct from (OLD.full_name, OLD.email, OLD.phone, OLD.role, OLD.is_active, OLD.is_frozen, OLD.is_test_account) then
    raise exception 'שינוי שדות אלה עבור שותף אחר חייב לעבור דרך ניהול שותפים (partner_roster).' using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;
