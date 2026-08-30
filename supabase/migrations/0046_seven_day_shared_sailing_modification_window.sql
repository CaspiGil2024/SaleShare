-- =====================================================================
-- SailShare — 7-day post-sailing modification window for Shared/Cyprus
-- =====================================================================
-- Supersedes 0045's "join anytime, no limit" with a bounded rule:
-- joining, leaving, and editing (date/time/notes/guest count) a
-- Shared/Cyprus sailing are all allowed up to 7 days after its
-- start_time; once that window closes, every one of those is strictly
-- blocked with a clear error. The window is measured from the
-- booking's own (pre-edit) start_time, so it can't be dodged by
-- rescheduling the sailing further into the future.
--
-- Scope: this only affects fn_join_shared_booking, fn_leave_shared_
-- booking, and fn_update_shared_booking (Shared/Cyprus only, by
-- construction — these RPCs already reject any other type). It does
-- NOT touch 0041's separate "no cancelling a past sailing" rule
-- (immediate, not a 7-day window, and applies to every booking type)
-- or creation (fn_create_shared_booking — creating a booking for a
-- past date remains allowed, unchanged).
-- =====================================================================

create or replace function public.fn_join_shared_booking(
  p_booking_id integer,
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
    raise exception 'יש להתחבר מחדש כדי להצטרף להפלגה.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'ניתן להצטרף רק להפלגות שותפים.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'לא ניתן להצטרף להפלגה שבוטלה.' using errcode = 'P0001';
  end if;
  if now() > v_booking.start_time + interval '7 days' then
    raise exception 'עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר ולא ניתן להצטרף אליה יותר.' using errcode = 'P0001';
  end if;
  if v_booking.user_id = v_caller then
    raise exception 'אתם המארגנים של הפלגה זו.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = v_caller) then
    raise exception 'אתם כבר משתתפים בהפלגה זו.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'guest_count', guest_count)), '[]'::jsonb)
    into v_participants
    from public.booking_participants where booking_id = p_booking_id;

  v_participants := v_participants
    || jsonb_build_array(jsonb_build_object('user_id', v_caller, 'guest_count', greatest(coalesce(p_guest_count, 0), 0)));

  perform public.fn_recompute_shared_booking_participants(p_booking_id, v_participants);
end;
$$;


create or replace function public.fn_leave_shared_booking(p_booking_id integer)
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
    raise exception 'יש להתחבר מחדש כדי לעזוב הפלגה.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'ניתן לעזוב רק הפלגות שותפים.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'הפלגה זו כבר בוטלה.' using errcode = 'P0001';
  end if;
  if v_booking.user_id = v_caller then
    raise exception 'המארגן/ת לא יכול/ה לעזוב את ההפלגה שלו/ה — ניתן לבטל אותה מתוך מסך העריכה.' using errcode = 'P0001';
  end if;
  if now() > v_booking.start_time + interval '7 days' then
    raise exception 'עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר ולא ניתן לעזוב אותה יותר.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = v_caller) then
    raise exception 'אינכם משתתפים בהפלגה זו.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'guest_count', guest_count)), '[]'::jsonb)
    into v_participants
    from public.booking_participants where booking_id = p_booking_id and user_id <> v_caller;

  perform public.fn_recompute_shared_booking_participants(p_booking_id, v_participants);
end;
$$;


create or replace function public.fn_update_shared_booking(
  p_booking_id integer,
  p_booking_type text,
  p_start timestamptz,
  p_end timestamptz,
  p_notes text,
  p_participants jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש כדי לערוך הזמנה.' using errcode = 'P0001';
  end if;
  if p_booking_type not in ('Shared', 'Cyprus') then
    raise exception 'סוג הזמנה לא תקין לפעולה זו.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההזמנה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.user_id <> v_caller and not public.is_manager() then
    raise exception 'אין לכם הרשאה לערוך הזמנה זו.' using errcode = 'P0001';
  end if;
  -- Measured from the booking's OWN (pre-edit) start_time, so the lock
  -- can't be dodged by rescheduling it further out.
  if now() > v_booking.start_time + interval '7 days' then
    raise exception 'עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר ולא ניתן לערוך אותה יותר.' using errcode = 'P0001';
  end if;

  update public.bookings
    set start_time = p_start, end_time = p_end, booking_type = p_booking_type, notes = p_notes, guests_count = 0
    where id = p_booking_id;

  perform public.fn_recompute_shared_booking_participants(p_booking_id, p_participants);
end;
$$;
