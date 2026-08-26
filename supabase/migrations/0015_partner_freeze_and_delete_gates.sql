-- =====================================================================
-- SailShare — Freeze / narrower Soft-Delete & Permanent-Delete gates
-- =====================================================================
-- New business rule (2026-08-26, same day as 0007/0008's "admin
-- deliberately excluded from general editing" rule — this migration
-- does NOT reverse that): Freeze and Soft Delete now require admin OR
-- treasurer specifically (NOT ceo/lab_tester/maintenance, even though
-- those roles still pass is_manager()/can_edit_partners() for
-- everything else). Permanent Delete requires admin ONLY (not even
-- treasurer). "Financial Freeze" is removed outright — see
-- PartnersPage.jsx, nothing server-side ever referenced it.
--
-- Enforcement is layered exactly like the rest of this project:
--   - RLS decides who can attempt an operation at all. admin isn't in
--     can_edit_partners(), so a NEW permissive policy admits admin
--     specifically (previously admin couldn't even SELECT partner_roster).
--   - A BEFORE UPDATE/DELETE trigger then does the field-level and
--     operation-level role check RLS can't express on its own: only
--     admin/treasurer may touch is_active or is_frozen, only admin may
--     DELETE, and anyone touching any OTHER field still needs the
--     original can_edit_partners() set — admin does not gain blanket
--     edit rights just by being let through the door here.
--   - Permanent delete cascades to the linked public.users row (email
--     match — partner_roster has no FK to it), which in turn cascades
--     to bookings/user_wallets/user_roles/coin_transactions/
--     booking_participants via their existing FKs. It CANNOT remove
--     the underlying auth.users login (needs the Admin API/service-role
--     key, deliberately not wired into the client — see chat) — the
--     account becomes orphaned (no profile) rather than fully gone.
--   - is_frozen and is_active (soft-delete) each independently block
--     new bookings and new booking_participants rows, both for making
--     a booking AND for being added to someone else's shared sail.
--     Nothing here retroactively touches bookings already on the
--     calendar.
-- =====================================================================


-- ---------------------------------------------------------------------
-- New role-check helpers, narrower than is_manager()/can_edit_partners().
-- ---------------------------------------------------------------------
create or replace function public.is_admin_or_treasurer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('admin', 'treasurer')
  );
$$;

revoke all on function public.is_admin_or_treasurer() from public;
grant execute on function public.is_admin_or_treasurer() to authenticated;


create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;


-- ---------------------------------------------------------------------
-- New columns.
-- ---------------------------------------------------------------------
alter table public.partner_roster add column if not exists is_frozen boolean not null default false;
alter table public.users          add column if not exists is_frozen boolean not null default false;


-- ---------------------------------------------------------------------
-- fn_apply_partner_roster: now also syncs is_frozen (same pattern as
-- is_active). Re-declared in full since it's create-or-replace, not
-- an ALTER — same signature as 0010's version.
-- ---------------------------------------------------------------------
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
-- RLS: let admin through the door for partner_roster (previously only
-- can_edit_partners()'s 4 roles could even SELECT it). The trigger
-- below is what actually limits what admin can do with that access.
-- ---------------------------------------------------------------------
drop policy if exists partner_roster_admin_freeze_delete on public.partner_roster;
create policy partner_roster_admin_freeze_delete on public.partner_roster
  for all using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- Field/operation-level role gate for partner_roster writes.
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_enforce_partner_roster_role_gates()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if not public.is_admin() then
      raise exception 'רק מנהל יכול למחוק שותף לצמיתות.' using errcode = 'P0001';
    end if;
    -- Cascades to bookings/user_wallets/user_roles/coin_transactions/
    -- booking_participants via their existing FKs to public.users.
    delete from public.users where lower(email) = lower(OLD.email);
    return OLD;
  end if;

  -- TG_OP = 'UPDATE'
  if (NEW.is_active is distinct from OLD.is_active) or (NEW.is_frozen is distinct from OLD.is_frozen) then
    if not public.is_admin_or_treasurer() then
      raise exception 'רק מנהל או גזבר יכולים להקפיא או להשבית שותף.' using errcode = 'P0001';
    end if;
  end if;

  if (NEW.full_name, NEW.email, NEW.phone, NEW.roles, NEW.balance)
     is distinct from (OLD.full_name, OLD.email, OLD.phone, OLD.roles, OLD.balance) then
    if not public.can_edit_partners() then
      raise exception 'אין לכם הרשאה לערוך את פרטי השותף.' using errcode = 'P0001';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_partner_roster_role_gates on public.partner_roster;
create trigger trg_enforce_partner_roster_role_gates
  before update or delete on public.partner_roster
  for each row execute function public.trg_fn_enforce_partner_roster_role_gates();


-- ---------------------------------------------------------------------
-- Frozen/inactive partners cannot create new bookings.
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_block_frozen_or_inactive_booking()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_frozen boolean;
  v_active boolean;
begin
  select is_frozen, is_active into v_frozen, v_active from public.users where id = NEW.user_id;

  if v_frozen then
    raise exception 'החשבון שלכם מוקפא. לא ניתן ליצור הזמנות חדשות בזמן הקפאה.' using errcode = 'P0001';
  end if;
  if v_active is false then
    raise exception 'החשבון שלכם אינו פעיל. לא ניתן ליצור הזמנות חדשות.' using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_block_frozen_or_inactive_booking on public.bookings;
create trigger trg_block_frozen_or_inactive_booking
  before insert on public.bookings
  for each row execute function public.trg_fn_block_frozen_or_inactive_booking();


-- ---------------------------------------------------------------------
-- Frozen/inactive partners cannot be added as a participant to anyone
-- else's shared sail either (covers Shared/Cyprus bookings, and the
-- organizer's own participant row on any booking type).
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_block_frozen_or_inactive_participant()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_frozen boolean;
  v_active boolean;
begin
  select is_frozen, is_active into v_frozen, v_active from public.users where id = NEW.user_id;

  if v_frozen then
    raise exception 'לא ניתן לצרף שותף מוקפא להפלגה.' using errcode = 'P0001';
  end if;
  if v_active is false then
    raise exception 'לא ניתן לצרף שותף לא פעיל להפלגה.' using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_block_frozen_or_inactive_participant on public.booking_participants;
create trigger trg_block_frozen_or_inactive_participant
  before insert on public.booking_participants
  for each row execute function public.trg_fn_block_frozen_or_inactive_participant();


-- ---------------------------------------------------------------------
-- Backfill: apply the roster (now including is_frozen, defaults false)
-- to every already-provisioned account. Idempotent.
-- ---------------------------------------------------------------------
do $$
declare
  v_user record;
begin
  for v_user in select id, email from public.users loop
    perform public.fn_apply_partner_roster(v_user.id, v_user.email);
  end loop;
end $$;
