-- =====================================================================
-- SailShare — critical/vessel-grounding notifications
-- =====================================================================
-- Two independent additions that work together:
--   1. users.receive_critical_updates — a partner's opt-in for
--      "vessel grounded/out-of-service" emails, same shape as
--      emails_enabled/receive_shared_sail_notifications (0037) and
--      gated by the same self-vs-admin field trigger.
--   2. maintenance_issues.is_grounding — flags a reported issue as a
--      "יאכטה מושבתת" event. Purely a data flag here; the actual
--      "notify everyone who opted in" email fires client-side from
--      MessagesPage.jsx's IssueCard.handleResolve when a grounding
--      issue is marked resolved (EmailJS is a browser SDK, same
--      reason every other notification in this app is a plain
--      function call rather than a DB trigger — see
--      src/lib/emailNotifications.js's header).
-- =====================================================================

alter table public.users add column if not exists receive_critical_updates boolean not null default false;

alter table public.maintenance_issues add column if not exists is_grounding boolean not null default false;

-- Extends trg_fn_enforce_users_field_gate (0037, last touched 0043) to
-- also gate receive_critical_updates the same way as the other two
-- self-service notification preferences — unrestricted for the account
-- owner, admin-only (can_edit_partners()) for anyone else's row.
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
      or NEW.receive_shared_sail_notifications is distinct from OLD.receive_shared_sail_notifications
      or NEW.receive_critical_updates is distinct from OLD.receive_critical_updates)
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
