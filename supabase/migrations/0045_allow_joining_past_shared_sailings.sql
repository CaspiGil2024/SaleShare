-- =====================================================================
-- SailShare — allow joining a Shared/Cyprus sailing after start_time
-- =====================================================================
-- Reverses part of 0044: fn_join_shared_booking blocked joining once
-- the sailing's start_time had passed. Per explicit product decision,
-- partners must be able to join (or be added to) a shared sailing
-- even after it's already happened — the start_time <= now() check is
-- removed entirely, no replacement bound.
--
-- Deliberately scoped to joining only:
--   - fn_leave_shared_booking's own past-time block is untouched (not
--     part of this request, and a different fairness question —
--     retroactively un-joining after being charged for a sail that
--     already happened, vs. retroactively joining one).
--   - 0041's general "no cancelling a past sailing" block is untouched.
--   - The S-rule/capacity checks inside fn_recompute_shared_booking_
--     participants are untouched — only the explicit time guard clause
--     is removed.
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
