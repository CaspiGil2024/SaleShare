-- =====================================================================
-- SailShare 0062 — Shared/Cyprus sail cancellation is a first-class,
-- permission-checked RPC; an organizer who hands off the role is never
-- auto-re-elected, so a "deleted" sail can't resurrect itself
-- =====================================================================
-- Two reported bugs, one root cause: the organizer of a Shared/Cyprus
-- sail with other partners aboard had NO real "cancel the whole sail"
-- action. EditBookingModal.jsx's single destructive button routed every
-- organizer through fn_organizer_leave_shared_booking (0060), which only
-- ever HANDS OFF bookings.user_id to the earliest-joined remaining
-- participant — it never actually cancels once someone else is aboard.
--
--   #2 "Resurrection on deletion": Michael creates +1, Uri joins,
--      Michael steps down (0060 hands the title to Uri; Michael stays
--      aboard as a regular participant on purpose, so he's still charged
--      his share at settlement). Uri then hits "delete" — but that
--      button is really fn_organizer_leave_shared_booking, so it hands
--      the title straight back to Michael (oldest booking_participants.
--      created_at). The sail "comes back" as Michael-organizer + Uri
--      instead of being cancelled.
--   #3 "Delete rights after leaving": a partner who stepped down as
--      organizer must not be able to cancel the sail. Server-side this
--      was already true for a non-manager (RLS bookings_update_own is
--      auth.uid() = user_id; fn_organizer_leave checks user_id = caller)
--      — but there was no dedicated, clearly permission-checked cancel
--      entry point for the UI to call, and the ping-pong above re-elected
--      the stepped-down organizer anyway.
--
-- Fixes:
--   1. fn_cancel_shared_booking(p_booking_id) — sets status = 'Cancelled'
--      (the existing trg_fn_refund_participants_on_cancel refunds every
--      participant) ONLY for the CURRENT organizer (bookings.user_id) or
--      a manager. Permanent by construction: join/leave/settle/auto-
--      convert all already refuse a Cancelled sail, so nothing restores
--      it. Non-Shared/Cyprus bookings keep using the plain bookings
--      UPDATE path (owner-only RLS) — this RPC is Shared/Cyprus only.
--   2. booking_participants.stepped_down — set true on the row of an
--      organizer who hands off via fn_organizer_leave_shared_booking.
--      The handoff target is now picked
--        order by stepped_down asc, created_at asc
--      so a partner who already stepped down is only re-elected if
--      literally nobody else remains. 0060's "stays aboard, still
--      settled" behavior is otherwise unchanged; settlement
--      (fn_recompute_shared_booking_participants) is the only thing that
--      deletes + reinserts participant rows, and it only runs once
--      start_time has passed — by which point handoff is already blocked
--      — so the flag never needs to survive it.
-- =====================================================================


-- ---------------------------------------------------------------------
-- stepped_down flag
-- ---------------------------------------------------------------------
alter table public.booking_participants
  add column if not exists stepped_down boolean not null default false;


-- ---------------------------------------------------------------------
-- fn_cancel_shared_booking — the real "cancel this Shared/Cyprus sail
-- for everyone" action. Current organizer or manager only.
-- ---------------------------------------------------------------------
create or replace function public.fn_cancel_shared_booking(p_booking_id integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש כדי לבטל הפלגה.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'פעולה זו מיועדת להפלגות שותפים בלבד.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'הפלגה זו כבר בוטלה.' using errcode = 'P0001';
  end if;
  -- Only whoever bookings.user_id currently points at (i.e. the ACTIVE
  -- organizer — a partner who has since handed the role off no longer
  -- qualifies), or a manager.
  if v_booking.user_id <> v_caller and not public.is_manager() then
    raise exception 'רק המארגן/ת הנוכחי/ת של ההפלגה (או מנהל) יכול/ה לבטל אותה.' using errcode = 'P0001';
  end if;
  -- Matching UI guard exists too; kept here so a stale client can't slip
  -- a retroactive refund past the (trigger-enforced) rule with a less
  -- clear error.
  if v_booking.start_time <= now() then
    raise exception 'לא ניתן לבטל הפלגה שכבר החלה או הסתיימה.' using errcode = 'P0001';
  end if;

  update public.bookings set status = 'Cancelled' where id = p_booking_id;
end;
$$;

revoke all on function public.fn_cancel_shared_booking(integer) from public;
grant execute on function public.fn_cancel_shared_booking(integer) to authenticated;


-- ---------------------------------------------------------------------
-- fn_organizer_leave_shared_booking — unchanged from 0060 except:
--   * the departing organizer's own participant row is flagged
--     stepped_down = true, and
--   * the replacement organizer is chosen preferring a partner who has
--     NOT previously stepped down (order by stepped_down asc, then the
--     original created_at tiebreak), so the role can't ping-pong back
--     to someone who already left it.
-- Still coin-neutral; still returns 'cancelled' / 'reassigned'.
-- ---------------------------------------------------------------------
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

  update public.booking_participants
    set stepped_down = true
    where booking_id = p_booking_id and user_id = v_caller;

  select user_id into v_new_organizer
    from public.booking_participants
    where booking_id = p_booking_id and user_id <> v_caller
    order by stepped_down asc, created_at asc
    limit 1;

  update public.bookings set user_id = v_new_organizer where id = p_booking_id;
  -- Deliberately nothing else: the ex-organizer's own row (guest_count,
  -- coins_charged_*) is untouched — they remain a paying participant.

  return 'reassigned';
end;
$$;

revoke all on function public.fn_organizer_leave_shared_booking(integer) from public;
grant execute on function public.fn_organizer_leave_shared_booking(integer) to authenticated;
