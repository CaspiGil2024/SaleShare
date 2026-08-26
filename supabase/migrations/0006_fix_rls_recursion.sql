-- =====================================================================
-- SailShare — Fix: infinite recursion in treasurer-check RLS policies
-- =====================================================================
-- 0004 introduced several RLS policies (on periods, user_wallets,
-- bookings, and user_roles itself) that check treasurer membership via
-- an inline subquery against public.user_roles:
--
--   exists (select 1 from public.user_roles ur
--           where ur.user_id = auth.uid() and ur.role = 'treasurer')
--
-- user_roles_treasurer_write (defined ON user_roles) uses this exact
-- pattern against user_roles itself — a self-referencing policy. Any
-- query that touches user_roles (directly, or indirectly via one of
-- the other tables' treasurer-check subqueries) has to evaluate
-- user_roles's own RLS policies as part of resolving that subquery,
-- which pulls user_roles_treasurer_write back in — a real "infinite
-- recursion detected in policy" condition, not just a stylistic
-- concern. This is why SELECT (not just INSERT) on bookings started
-- returning 500s: evaluating bookings_treasurer_all's condition
-- touches user_roles, which re-triggers RLS evaluation on user_roles,
-- which includes the self-referencing policy.
--
-- Fix: move the membership check into a SECURITY DEFINER function.
-- Such a function runs with the privileges of its owner (here, the
-- role that applies this migration, i.e. Supabase's postgres role,
-- which has BYPASSRLS) — so its internal query against user_roles
-- bypasses row security entirely instead of re-entering these same
-- policies. This is the standard fix for this exact class of bug.
-- =====================================================================

create or replace function public.is_treasurer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'treasurer'
  );
$$;

revoke all on function public.is_treasurer() from public;
grant execute on function public.is_treasurer() to authenticated;


drop policy if exists user_roles_treasurer_write on public.user_roles;
create policy user_roles_treasurer_write on public.user_roles
  for all using (public.is_treasurer());

drop policy if exists periods_treasurer_write on public.periods;
create policy periods_treasurer_write on public.periods
  for all using (public.is_treasurer());

drop policy if exists wallets_select_own on public.user_wallets;
create policy wallets_select_own on public.user_wallets
  for select using (auth.uid() = user_id or public.is_treasurer());

drop policy if exists wallets_treasurer_write on public.user_wallets;
create policy wallets_treasurer_write on public.user_wallets
  for all using (public.is_treasurer());

drop policy if exists bookings_treasurer_all on public.bookings;
create policy bookings_treasurer_all on public.bookings
  for all using (public.is_treasurer());

drop policy if exists partner_roster_treasurer_select on public.partner_roster;
create policy partner_roster_treasurer_select on public.partner_roster
  for select using (public.is_treasurer());
