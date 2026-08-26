-- =====================================================================
-- SailShare — partner_roster edit permissions (soft/permanent delete)
-- =====================================================================
-- Business rule (2026-08-26): editing/management actions on the
-- partner roster (Edit, Freeze, Soft Delete, Permanent Delete, ...)
-- are restricted to treasurer, ceo, lab_tester, or maintenance role
-- holders. Notably NOT admin — that's the literal rule as given, not
-- an oversight on this file's part; flagged in the accompanying chat
-- message in case it wasn't intentional.
--
-- 0004 only ever granted a treasurer-only SELECT on partner_roster (no
-- write policy existed at all for anyone). Broadening SELECT to the
-- same 4-role set here too — a ceo/lab_tester/maintenance holder who
-- can't even see the roster couldn't act on the edit permission this
-- migration grants them, so the two would be self-contradictory left
-- as they were.
-- =====================================================================

create or replace function public.can_edit_partners()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('treasurer', 'ceo', 'lab_tester', 'maintenance')
  );
$$;

revoke all on function public.can_edit_partners() from public;
grant execute on function public.can_edit_partners() to authenticated;

drop policy if exists partner_roster_treasurer_select on public.partner_roster;
drop policy if exists partner_roster_managers_all on public.partner_roster;
create policy partner_roster_managers_all on public.partner_roster
  for all using (public.can_edit_partners()) with check (public.can_edit_partners());
