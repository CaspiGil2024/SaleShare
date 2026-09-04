-- =====================================================================
-- SailShare 0063 — Shared/Cyprus sail §H: a withdrawal within 24h of
-- the sail is settled at the leaver's guest-weighted share instead of
-- being fully refunded
-- =====================================================================
-- Locked-in business rule (§H, "Cancellation / Leaving Rules"):
--   * MORE than 24h before start_time: leaving/being removed is a FULL
--     refund of the participant's provisional flat charge (§E). This is
--     the behavior every version since 0044 already had — the existing
--     BEFORE DELETE trigger (trg_fn_refund_participant_coins, 0023)
--     returns the whole stored coins_charged_* when the row is deleted.
--     UNCHANGED.
--   * LESS than 24h before start_time (but still before it): the
--     withdrawal is "treated as if sail time arrived immediately" — the
--     departing participant is settled right now at the SAME guest-
--     weighted proportional share fn_recompute_shared_booking_
--     participants (0051) would apply at normal sail-time settlement
--     (§F/§G), computed against the roster "just before their
--     departure" (i.e. with the leaver still counted). They are then
--     removed. The partners who REMAIN are not re-settled early — they
--     still settle once start_time passes (fn_settle_due_shared_
--     bookings), over the now-smaller roster. So total coins collected
--     for the sail need not sum to exactly `hours`: an early leaver
--     paid a share of the larger pie, the rest split the whole pie
--     among fewer — this is the intended, spec'd consequence of
--     "settle the leaver at the state just before they left".
--
-- Scope — this applies to a PARTICIPANT leaving the sail:
--   * fn_leave_shared_booking            (self-service leave)
--   * fn_admin_remove_shared_participant (organizer/admin removes a
--     specific partner) — same wallet treatment, so a partner can't
--     dodge the <24h share by asking the organizer to remove them.
-- It does NOT apply to:
--   * fn_organizer_leave_shared_booking — the ex-organizer STAYS aboard
--     as a paying participant (0060/0062); nothing is settled for them
--     until normal sail time. Its no-other-participants branch is a
--     whole-sail cancel (§2 "deleted"), not a withdrawal.
--   * fn_cancel_shared_booking — cancelling the WHOLE sail for everyone
--     stays a full refund to all (trg_fn_refund_participants_on_cancel),
--     blocked once start_time passes. A whole-sail cancellation is not
--     a "withdrawing participant".
--
-- The 0045/0046 windows are unchanged and still authoritative for
-- WHETHER a change is allowed at all (no join/leave after start_time;
-- guest-count edits up to 7 days past it). §H here only governs
-- refund-in-full vs. proportional-charge for a withdrawal that happens
-- before start_time.
-- =====================================================================


-- ---------------------------------------------------------------------
-- fn_settle_departing_participant — settle ONE leaver at their guest-
-- weighted share of the sail as it stands right now, then drop their
-- row. Internal helper: only called from the two withdrawal RPCs below,
-- never granted to clients.
--
-- Order matters. The row is deleted FIRST so the existing BEFORE DELETE
-- trigger (trg_fn_refund_participant_coins) puts the leaver's full
-- provisional charge back on their wallet; the proportional debit just
-- after then lands against a wallet no longer carrying the full amount,
-- so there's no transient double-charge to trip the overdraft floor.
-- Net wallet effect: -(proportional share), exactly as if this one
-- participant had reached sail-time settlement early.
-- ---------------------------------------------------------------------
create or replace function public.fn_settle_departing_participant(
  p_booking_id integer,
  p_user_id uuid,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking record;
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
  v_total_shares numeric;
  v_leaver_shares numeric;
  v_share numeric;
  v_actor uuid := coalesce(p_actor_user_id, p_user_id);
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;

  -- Leaver's own weight (1 + their guests) and the TOTAL weight across
  -- everyone currently on the sail, the leaver included — "the state of
  -- the sail just before their departure" (§H).
  select 1 + guest_count into v_leaver_shares
    from public.booking_participants
    where booking_id = p_booking_id and user_id = p_user_id;
  if v_leaver_shares is null then
    raise exception 'השותף אינו משתתף בהפלגה זו.' using errcode = 'P0001';
  end if;

  select coalesce(sum(1 + guest_count), 0) into v_total_shares
    from public.booking_participants
    where booking_id = p_booking_id;

  select weekend_day, weekend_night, midweek_day, midweek_night
    into v_wd, v_wn, v_md, v_mn
    from public.fn_classify_hours(v_booking.start_time, v_booking.end_time);

  v_share := v_leaver_shares / nullif(v_total_shares, 0);
  if v_share is null then
    v_share := 1; -- sole participant edge case; unreachable from leave
  end if;

  -- 1. Drop the row — BEFORE DELETE trigger refunds the full provisional.
  delete from public.booking_participants
    where booking_id = p_booking_id and user_id = p_user_id;

  -- 2. Debit only the leaver's final guest-weighted share (same formula
  --    and 'participant_charge' reason as fn_recompute_shared_booking_
  --    participants uses at normal settlement). No quota check — leaving
  --    never increases anyone's future usage.
  if v_wd * v_share > 0 then perform public.fn_apply_coin_delta(p_user_id, 'weekend_day',   -(v_wd * v_share), 'participant_charge', p_booking_id, v_actor); end if;
  if v_wn * v_share > 0 then perform public.fn_apply_coin_delta(p_user_id, 'weekend_night', -(v_wn * v_share), 'participant_charge', p_booking_id, v_actor); end if;
  if v_md * v_share > 0 then perform public.fn_apply_coin_delta(p_user_id, 'midweek_day',   -(v_md * v_share), 'participant_charge', p_booking_id, v_actor); end if;
  if v_mn * v_share > 0 then perform public.fn_apply_coin_delta(p_user_id, 'midweek_night', -(v_mn * v_share), 'participant_charge', p_booking_id, v_actor); end if;
end;
$$;

revoke all on function public.fn_settle_departing_participant(integer, uuid, uuid) from public;


-- ---------------------------------------------------------------------
-- fn_leave_shared_booking — unchanged from 0061 except the final step:
-- within 24h of start_time, settle the caller at their share (§H)
-- instead of a plain full-refund delete.
-- ---------------------------------------------------------------------
create or replace function public.fn_leave_shared_booking(p_booking_id integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
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
    raise exception 'המארגן/ת לא יכול/ה לעזוב את ההפלגה כך — ניתן לעזוב מתוך מסך העריכה (התפקיד יועבר לשותף אחר).' using errcode = 'P0001';
  end if;
  if v_booking.start_time <= now() then
    raise exception 'לא ניתן לעזוב הפלגה שכבר החלה או הסתיימה.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = v_caller) then
    raise exception 'אינכם משתתפים בהפלגה זו.' using errcode = 'P0001';
  end if;

  if v_booking.start_time <= now() + interval '24 hours' then
    -- §H: less than 24h to go — treated as if sail time arrived. The
    -- leaver is charged their guest-weighted share of the sail as it
    -- stands now; no full refund.
    perform public.fn_settle_departing_participant(p_booking_id, v_caller);
  else
    -- More than 24h out — full refund (BEFORE DELETE trigger).
    delete from public.booking_participants where booking_id = p_booking_id and user_id = v_caller;
  end if;
end;
$$;

revoke all on function public.fn_leave_shared_booking(integer) from public;
grant execute on function public.fn_leave_shared_booking(integer) to authenticated;


-- ---------------------------------------------------------------------
-- fn_admin_remove_shared_participant — unchanged from 0061 except the
-- final step: a removal within 24h of (and before) start_time settles
-- that partner at their share (§H), same as if they'd left themselves.
-- A removal at/after start_time keeps the old plain-delete behavior
-- (this RPC has always allowed removal up to 7 days past start_time —
-- 0046 — and settlement there is handled by the sail-time sweep, not
-- here).
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

  if v_booking.start_time > now() and v_booking.start_time <= now() + interval '24 hours' then
    -- §H: within 24h and still before the sail — settle at their share.
    perform public.fn_settle_departing_participant(p_booking_id, p_user_id, v_caller);
  else
    -- >24h out (full refund) or already started (sweep handles it).
    delete from public.booking_participants where booking_id = p_booking_id and user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.fn_admin_remove_shared_participant(integer, uuid) from public;
grant execute on function public.fn_admin_remove_shared_participant(integer, uuid) to authenticated;
