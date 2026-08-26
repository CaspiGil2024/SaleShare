-- =====================================================================
-- SailShare — stop fn_apply_partner_roster from touching user_wallets
-- =====================================================================
-- fn_apply_partner_roster() (0004/0010/0015) still had its pre-Michael's-
-- Method tail end: on every partner_roster sync (fired on nearly every
-- EditPartnerModal save, via trg_sync_roster_to_user), it overwrote
-- coins_midweek_day with the flat legacy partner_roster.balance number
-- and zeroed the other 3 columns — directly clobbering the real 4-type
-- allocation ensure_current_period()/fn_allocate_period_coins() now
-- own exclusively. Left unfixed, saving a partner's profile would
-- silently wipe their real coin balances.
--
-- Coin allocation is now entirely owned by the period-allocation flow
-- and the admin-adjustment RPC (0021-0027) — a roster edit (name,
-- phone, roles, is_active, is_frozen) has no business touching wallet
-- balances at all anymore. This migration removes that block from the
-- function; the legacy partner_roster.balance column itself is left
-- alone (still shown for partners with no account yet — see
-- PartnersPage.jsx), just no longer piped into a real wallet.
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
