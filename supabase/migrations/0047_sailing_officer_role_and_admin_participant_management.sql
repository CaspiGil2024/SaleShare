-- =====================================================================
-- SailShare — rename lab_tester -> sailing_officer with full admin
-- privileges, plus organizer/admin explicit add/remove of shared-sail
-- participants
-- =====================================================================
-- PART 1 — role rename + privilege grant
--
-- ALTER TYPE ... RENAME VALUE is atomic and transaction-safe (unlike
-- ADD VALUE): every existing user_roles.role and partner_roster.roles[]
-- entry currently 'lab_tester' becomes 'sailing_officer' automatically,
-- no data UPDATE needed. Every SQL function that hardcoded the string
-- 'lab_tester' MUST be updated in the same migration — after the
-- rename, 'lab_tester' is no longer a valid literal for this enum at
-- all, so a stale reference would error at runtime, not just misbehave.
--
-- Per explicit product decision, sailing_officer now has the SAME
-- privileges as admin everywhere — is_admin() and is_admin_or_
-- treasurer() both include it. This is a real, meaningful privilege
-- escalation from what lab_tester had (previously: general partner
-- editing only, NOT freeze/soft-delete/hard-delete/admin coin
-- adjustments) — flagging plainly since it's a wide grant, exactly as
-- asked for.
--
-- PART 2 — organizer/admin can explicitly add or remove a specific
-- partner on an existing Shared/Cyprus sailing (not just the existing
-- self-service join/leave). Scoped deliberately narrow: the ORGANIZER
-- themselves, or is_admin() (admin/sailing_officer) — NOT the broader
-- is_manager() set (treasurer/ceo/maintenance don't gain this). Same
-- 7-day post-sailing window as everything else in 0046, same
-- fn_recompute_shared_booking_participants underneath.
-- =====================================================================

alter type public.partner_role rename value 'lab_tester' to 'sailing_officer';

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('treasurer', 'ceo', 'sailing_officer', 'maintenance')
  );
$$;

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
      and ur.role in ('treasurer', 'ceo', 'sailing_officer', 'maintenance')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role in ('admin', 'sailing_officer')
  );
$$;

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
      and ur.role in ('admin', 'treasurer', 'sailing_officer')
  );
$$;


-- ---------------------------------------------------------------------
-- fn_admin_add_shared_participant — organizer or admin adds a SPECIFIC
-- partner (not self-service; see fn_join_shared_booking for that).
-- ---------------------------------------------------------------------
create or replace function public.fn_admin_add_shared_participant(
  p_booking_id integer,
  p_user_id uuid,
  p_guest_count integer default 0
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
  v_participants jsonb;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש כדי לנהל משתתפים.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'ניתן להוסיף משתתפים רק להפלגות שותפים.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'לא ניתן להוסיף משתתף להפלגה שבוטלה.' using errcode = 'P0001';
  end if;
  if v_booking.user_id <> v_caller and not public.is_admin() then
    raise exception 'רק המארגן/ת או מנהל יכולים להוסיף משתתפים להפלגה זו.' using errcode = 'P0001';
  end if;
  if now() > v_booking.start_time + interval '7 days' then
    raise exception 'עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר ולא ניתן להוסיף משתתפים יותר.' using errcode = 'P0001';
  end if;
  if p_user_id = v_booking.user_id then
    raise exception 'המארגן/ת כבר משתתפ/ת בהפלגה.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = p_user_id) then
    raise exception 'שותף זה כבר משתתף בהפלגה.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'guest_count', guest_count)), '[]'::jsonb)
    into v_participants
    from public.booking_participants where booking_id = p_booking_id;

  v_participants := v_participants
    || jsonb_build_array(jsonb_build_object('user_id', p_user_id, 'guest_count', greatest(coalesce(p_guest_count, 0), 0)));

  perform public.fn_recompute_shared_booking_participants(p_booking_id, v_participants);
end;
$$;

revoke all on function public.fn_admin_add_shared_participant(integer, uuid, integer) from public;
grant execute on function public.fn_admin_add_shared_participant(integer, uuid, integer) to authenticated;


-- ---------------------------------------------------------------------
-- fn_admin_remove_shared_participant — organizer or admin removes a
-- SPECIFIC partner. The organizer can't be removed this way (cancel
-- the whole sailing instead, from the edit screen).
-- ---------------------------------------------------------------------
create or replace function public.fn_admin_remove_shared_participant(
  p_booking_id integer,
  p_user_id uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
  v_participants jsonb;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש כדי לנהל משתתפים.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'ניתן להסיר משתתפים רק מהפלגות שותפים.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'הפלגה זו כבר בוטלה.' using errcode = 'P0001';
  end if;
  if v_booking.user_id <> v_caller and not public.is_admin() then
    raise exception 'רק המארגן/ת או מנהל יכולים להסיר משתתפים מהפלגה זו.' using errcode = 'P0001';
  end if;
  if p_user_id = v_booking.user_id then
    raise exception 'לא ניתן להסיר את המארגן/ת — ניתן לבטל את ההפלגה מתוך מסך העריכה.' using errcode = 'P0001';
  end if;
  if now() > v_booking.start_time + interval '7 days' then
    raise exception 'עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר ולא ניתן להסיר משתתפים יותר.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = p_user_id) then
    raise exception 'שותף זה אינו משתתף בהפלגה.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'guest_count', guest_count)), '[]'::jsonb)
    into v_participants
    from public.booking_participants where booking_id = p_booking_id and user_id <> p_user_id;

  perform public.fn_recompute_shared_booking_participants(p_booking_id, v_participants);
end;
$$;

revoke all on function public.fn_admin_remove_shared_participant(integer, uuid) from public;
grant execute on function public.fn_admin_remove_shared_participant(integer, uuid) to authenticated;
