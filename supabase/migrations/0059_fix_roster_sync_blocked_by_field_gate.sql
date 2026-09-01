-- =====================================================================
-- SailShare — fix: partner_roster -> users sync was blocked by the very
-- field-gate trigger that tells you to use partner_roster
-- =====================================================================
-- trg_fn_enforce_users_field_gate (0033/0037/0043) unconditionally
-- blocks any non-self change to full_name/email/phone/role/is_active/
-- is_frozen/is_test_account on public.users, with the error "must go
-- through ניהול שותפים (partner_roster)". But fn_apply_partner_roster
-- (0004+, last touched 0028) — the SECURITY DEFINER function that
-- trg_sync_roster_to_user (0018) calls automatically whenever an admin
-- saves a partner_roster edit — writes exactly those same fields
-- (full_name, phone, is_active, is_frozen, is_test_account, role) onto
-- the matching public.users row. auth.uid() inside that sync is still
-- the ADMIN who saved the edit (SECURITY DEFINER elevates the
-- function's table privileges, it does NOT change what auth.uid()
-- resolves to), not the target partner's id — so
-- "auth.uid() = NEW.id" was false for every admin edit of ANOTHER
-- partner's roles/phone/status, which is the normal case for partner
-- management. The trigger was blocking its own prescribed fix path:
-- reported as "שינוי שדות אלה עבור שותף אחר חייב לעבור דרך ניהול
-- שותפים (partner_roster)" when saving from EditPartnerModal.jsx.
--
-- Fix: same narrow-bypass-via-transaction-local-GUC pattern already
-- used for trg_fn_block_past_cancellation's auto-cancel bypass (0044) —
-- fn_apply_partner_roster sets a flag right before its own UPDATE, and
-- the field gate exits immediately (before any of its checks) whenever
-- that flag is set. Scoped to just this one function's own UPDATE
-- statement (set_config's third argument 'true' = transaction-local,
-- and PL/pgSQL functions run inside the caller's transaction), so it
-- can't leak into becoming a general bypass for anything else.
-- =====================================================================

create or replace function public.fn_apply_partner_roster(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_roster    public.partner_roster%rowtype;
  v_role      public.partner_role;
begin
  select * into v_roster from public.partner_roster where lower(email) = lower(p_email);
  if not found then
    return;
  end if;

  perform set_config('sailshare.roster_sync', 'true', true);

  update public.users
    set full_name       = v_roster.full_name,
        phone           = v_roster.phone,
        is_active       = v_roster.is_active,
        is_frozen       = v_roster.is_frozen,
        is_test_account = v_roster.is_test_account,
        role = case
          when 'treasurer'::public.partner_role = any(v_roster.roles) then 'treasurer'
          else 'partner'
        end
    where id = p_user_id;

  delete from public.user_roles where user_id = p_user_id;
  foreach v_role in array v_roster.roles loop
    insert into public.user_roles (user_id, role) values (p_user_id, v_role)
      on conflict do nothing;
  end loop;

  update public.partner_roster set applied_at = now() where lower(email) = lower(p_email);
end;
$$;


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

  if coalesce(current_setting('sailshare.roster_sync', true), 'false') = 'true' then
    return NEW; -- legitimate partner_roster -> users sync (fn_apply_partner_roster) — see header
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
