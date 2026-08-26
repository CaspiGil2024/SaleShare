-- =====================================================================
-- SailShare — Fix: full_name was never synced from partner_roster
-- =====================================================================
-- fn_apply_partner_roster() (0004) updates phone/is_active/
-- is_test_account/role on public.users, but never full_name. So
-- whatever the sign-up trigger's fallback set full_name to (the email
-- prefix, split_part(email, '@', 1), when no name was supplied at
-- sign-up) has stayed there permanently, even though partner_roster
-- has had the real name the whole time. That's why completion
-- messages, dashboards, etc. show something like "caspigil" instead
-- of "Gil Caspi".
--
-- Two fixes:
--   1. fn_apply_partner_roster() now also sets full_name.
--   2. A new trigger re-runs it whenever partner_roster changes, so an
--      edit via EditPartnerModal propagates to public.users
--      immediately instead of only applying at initial sign-up.
-- The backfill at the bottom fixes every already-provisioned account
-- right now (this is what actually corrects Gil Caspi's display name
-- today, not just future ones).
-- =====================================================================

create or replace function public.fn_apply_partner_roster(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_roster    public.partner_roster%rowtype;
  v_period_id public.periods.id%type;
  v_role      public.partner_role;
begin
  select * into v_roster from public.partner_roster where lower(email) = lower(p_email);
  if not found then
    return;
  end if;

  update public.users
    set full_name       = v_roster.full_name,
        phone           = v_roster.phone,
        is_active       = v_roster.is_active,
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

  select id into v_period_id from public.periods where is_current = true limit 1;
  if v_period_id is not null then
    update public.user_wallets
      set coins_midweek_day   = v_roster.balance,
          coins_weekend_day   = 0,
          coins_weekend_night = 0,
          coins_midweek_night = 0
      where user_id = p_user_id and period_id = v_period_id;
  end if;

  update public.partner_roster set applied_at = now() where lower(email) = lower(p_email);
end;
$$;


-- ---------------------------------------------------------------------
-- Keep public.users in sync whenever partner_roster is edited
-- (e.g. via EditPartnerModal), not just at initial sign-up.
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_sync_roster_to_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from public.users where lower(email) = lower(NEW.email);
  if v_user_id is not null then
    perform public.fn_apply_partner_roster(v_user_id, NEW.email);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_roster_to_user on public.partner_roster;
create trigger trg_sync_roster_to_user
  after update on public.partner_roster
  for each row execute function public.trg_fn_sync_roster_to_user();


-- ---------------------------------------------------------------------
-- Backfill: re-apply the roster (now including full_name) to every
-- already-provisioned account. Idempotent — safe to run more than once.
-- ---------------------------------------------------------------------
do $$
declare
  v_user record;
begin
  for v_user in select id, email from public.users loop
    perform public.fn_apply_partner_roster(v_user.id, v_user.email);
  end loop;
end $$;
