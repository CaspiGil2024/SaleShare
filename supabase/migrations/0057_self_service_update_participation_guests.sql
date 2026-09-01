-- =====================================================================
-- SailShare — a partner who already joined a Shared/Cyprus sailing had
-- no way to change their own guest count afterward
-- =====================================================================
-- fn_join_shared_booking sets a guest_count once, at join time.
-- Afterward, the only self-service actions available were leave
-- entirely (fn_leave_shared_booking) or nothing — there was no way to
-- add/remove a guest without leaving and rejoining (which also briefly
-- drops you from the sail and could lose your seat to the 9-person cap
-- in the meantime). This adds the missing self-service update, same
-- delete-then-recompute engine as every other participant-list change
-- (fn_recompute_shared_booking_participants), touching only the
-- caller's own guest_count and leaving everyone else's untouched.
-- =====================================================================

create or replace function public.fn_update_my_shared_participation_guests(
  p_booking_id integer,
  p_guest_count integer
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
    raise exception 'יש להתחבר מחדש כדי לעדכן את מספר האורחים.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'ניתן לעדכן מספר אורחים רק בהפלגות שותפים.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'הפלגה זו כבר בוטלה.' using errcode = 'P0001';
  end if;
  -- Same 7-day post-sailing window as join/leave/edit (0046).
  if now() > v_booking.start_time + interval '7 days' then
    raise exception 'עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר ולא ניתן לעדכן אורחים יותר.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = v_caller) then
    raise exception 'אינכם משתתפים בהפלגה זו.' using errcode = 'P0001';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'user_id', user_id,
      'guest_count', case when user_id = v_caller then greatest(coalesce(p_guest_count, 0), 0) else guest_count end
    )
  )
  into v_participants
  from public.booking_participants
  where booking_id = p_booking_id;

  perform public.fn_recompute_shared_booking_participants(p_booking_id, v_participants);
end;
$$;

revoke all on function public.fn_update_my_shared_participation_guests(integer, integer) from public;
grant execute on function public.fn_update_my_shared_participation_guests(integer, integer) to authenticated;
