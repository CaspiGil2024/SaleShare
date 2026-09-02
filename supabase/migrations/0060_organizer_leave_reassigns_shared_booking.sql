-- =====================================================================
-- SailShare — organizer of a Shared/Cyprus sailing can now leave
-- without cancelling, handing the "organizer" role to a remaining
-- partner instead
-- =====================================================================
-- Bug: fn_leave_shared_booking (0044) explicitly refused to let the
-- organizer leave ("המארגן/ת לא יכול/ה לעזוב... ניתן לבטל אותה") and
-- EditBookingModal.jsx's only organizer-facing exit was "ביטול ההפלגה"
-- (handleCancelSail -> bookings.status = 'Cancelled'), which cancels
-- the WHOLE sailing and fully refunds every partner still on it —
-- even when other partners are actively participating and have no
-- wish to lose the sailing. Reported as: organizer leaving destroys
-- the sail for everyone else instead of just stepping down.
--
-- Fix: fn_organizer_leave_shared_booking(p_booking_id) — a new,
-- organizer-only entry point:
--   - No other active participants left: behaves exactly like today's
--     cancel (nothing to hand the sail to — "leaving" IS cancelling
--     when you're the only one aboard). Returns 'cancelled'.
--   - One or more other active participants: the organizer's own
--     participant row is dropped and public.bookings.user_id is
--     reassigned to a remaining participant (the longest-standing one
--     by booking_participants.created_at — see caveat below), THEN
--     fn_recompute_shared_booking_participants runs across whoever's
--     left. That helper already does the right thing for coins here,
--     unchanged: it refunds every remaining participant's stored
--     charge in full (trg_fn_refund_participant_coins, fired by its
--     own `delete from booking_participants`) and recharges everyone
--     from scratch against the NEW total shares — which correctly
--     grows now that the ex-organizer's share is gone, exactly the
--     same "leaving recalculates everyone else's split" behavior
--     fn_leave_shared_booking already gives a non-organizer's
--     departure. No new charge/refund logic needed here, only who
--     ends up in the participant set the helper is called with. The
--     sail keeps its id, dates, and notes — nothing else changes.
--     Returns 'reassigned'.
--
-- Caveat (accepted, not fixed here): booking_participants.created_at
-- is NOT a reliable join-order history — fn_recompute_shared_booking_
-- participants deletes and reinserts EVERY participant row on every
-- single change (a join, a leave, even one partner editing their own
-- guest count), which resets every remaining row's created_at to that
-- moment. So "earliest created_at among the survivors" really means
-- "first in the participant list as of the most recent recompute", not
-- literally who has been aboard longest historically. It's still a
-- fully deterministic tiebreak (no schema for true join history exists
-- to do better), just not a strict seniority guarantee across multiple
-- edits.
-- =====================================================================

create or replace function public.fn_organizer_leave_shared_booking(p_booking_id integer)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
  v_participants jsonb;
  v_new_organizer uuid;
  v_remaining_count int;
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
  if v_booking.user_id <> v_caller then
    raise exception 'רק המארגן/ת יכול/ה לעזוב את ההפלגה בדרך זו.' using errcode = 'P0001';
  end if;
  if v_booking.start_time <= now() then
    raise exception 'לא ניתן לעזוב הפלגה שכבר החלה או הסתיימה.' using errcode = 'P0001';
  end if;

  select count(*) into v_remaining_count
    from public.booking_participants
    where booking_id = p_booking_id and user_id <> v_caller;

  if v_remaining_count = 0 then
    update public.bookings set status = 'Cancelled' where id = p_booking_id;
    return 'cancelled';
  end if;

  select user_id into v_new_organizer
    from public.booking_participants
    where booking_id = p_booking_id and user_id <> v_caller
    order by created_at asc
    limit 1;

  update public.bookings set user_id = v_new_organizer where id = p_booking_id;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'guest_count', guest_count)), '[]'::jsonb)
    into v_participants
    from public.booking_participants
    where booking_id = p_booking_id and user_id <> v_caller;

  perform public.fn_recompute_shared_booking_participants(p_booking_id, v_participants);

  return 'reassigned';
end;
$$;

revoke all on function public.fn_organizer_leave_shared_booking(integer) from public;
grant execute on function public.fn_organizer_leave_shared_booking(integer) to authenticated;
