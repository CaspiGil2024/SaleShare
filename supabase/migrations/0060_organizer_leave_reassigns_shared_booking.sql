-- =====================================================================
-- SailShare — organizer of a Shared/Cyprus sailing can now step down
-- without cancelling, handing the "organizer" role to a remaining
-- partner instead — they stay aboard as a regular participant
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
--   - No other active participants: behaves exactly like today's
--     cancel (nothing to hand the sail to — "leaving" IS cancelling
--     when you're the only one aboard). Returns 'cancelled'.
--   - One or more other active participants: ONLY public.bookings.
--     user_id is reassigned to a remaining participant (the longest-
--     standing one by booking_participants.created_at — see caveat
--     below). The departing organizer's own participant row, guest
--     count, and already-charged coins are left completely untouched
--     — they step down from the organizer TITLE but remain a full
--     participant on the sail, still on the hook at settlement like
--     anyone else (confirmed against a worked example: the ex-
--     organizer's coin deduction at sail-time settlement must still
--     reflect their own guest count). No coin_delta of any kind
--     happens here — this action is purely a change of who
--     bookings.user_id points at. Returns 'reassigned'.
--
-- Caveat (accepted, not fixed here): booking_participants.created_at
-- is not a perfect join-order history in every edge case (e.g. a row
-- touched by fn_reprice_all_participants_full — see the deferred-
-- settlement migration — keeps its original row and created_at, so
-- this is actually fine in the common case; it would only drift if
-- some future change starts deleting+reinserting participant rows on
-- every edit again). Still a fully deterministic tiebreak.
-- =====================================================================

create or replace function public.fn_organizer_leave_shared_booking(p_booking_id integer)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
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
  -- Deliberately nothing else: the ex-organizer's own row (guest_count,
  -- coins_charged_*) is untouched — see header.

  return 'reassigned';
end;
$$;

revoke all on function public.fn_organizer_leave_shared_booking(integer) from public;
grant execute on function public.fn_organizer_leave_shared_booking(integer) to authenticated;
