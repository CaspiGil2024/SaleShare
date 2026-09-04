-- =====================================================================
-- SailShare 0064 — Private sail (הפלגה פרטית) §100: a SAME-DAY
-- cancellation is refunded proportionally to the whole hours left
-- until the sail starts, not in full
-- =====================================================================
-- Locked-in business rule:
--   * Cancelling a Private sail on an EARLIER calendar day than the
--     sail  -> full refund of the original charge (unchanged, every
--     version since 0022 behaved this way).
--   * Cancelling a Private sail ON THE SAME CALENDAR DAY (Asia/
--     Jerusalem local date, the timezone every other classification
--     rule in this project uses — fn_classify_hours, coinCalculator.js)
--     as its start_time  -> the partner is refunded only a proportional
--     slice of what they were charged, by the number of FULL hours left
--     until the sail's start_time, floored to a whole integer:
--
--         refund = full_charge * floor(remaining_hours) / 24
--
--     e.g. 4 full hours to go  -> 4/24 (one sixth) of the charge back;
--     the other 20/24 stays spent. Applied per coin type against the
--     stored coins_charged_* breakdown, so a sail spanning more than
--     one type is prorated type-by-type at the same ratio.
--
-- Scope: booking_type = 'Private' ONLY. Dockside and Maintenance
-- cancellations keep their full refund. Shared/Cyprus are untouched
-- here — their wallet treatment on a whole-sail cancel
-- (trg_fn_refund_participants_on_cancel) and on a withdrawal
-- (0063 §H) is unchanged. is_anchor Private sails are still Private and
-- are covered by this rule like any other Private sail.
--
-- Enforcement point: trg_fn_charge_booking_coins (last defined in
-- 0022), the BEFORE UPDATE OF ... status trigger that already owns the
-- Private/Dockside/Maintenance cancel refund. This migration is a
-- straight CREATE OR REPLACE of that one function — the trigger binding
-- (trg_charge_booking_coins, 0014) is unchanged. Only the
-- cancel-transition branch changes; the INSERT branch, the
-- already-Cancelled short-circuit, and the live time/type-change
-- rebill branch are copied verbatim from 0022.
--
-- A cancellation once start_time has passed is blocked entirely by
-- trg_fn_block_past_cancellation (0041) — which, being trigger
-- "trg_block_past_cancellation", fires before "trg_charge_booking_
-- coins" alphabetically — so remaining_hours is always > 0 in practice;
-- the greatest(0, …) clamp is defensive only.
-- =====================================================================

create or replace function public.trg_fn_charge_booking_coins()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
  v_refund_ratio numeric;
  v_remaining_full_hours numeric;
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'Cancelled' or NEW.booking_type in ('Shared', 'Cyprus', 'Maintenance') then
      NEW.coins_charged_weekend_day := 0;
      NEW.coins_charged_weekend_night := 0;
      NEW.coins_charged_midweek_day := 0;
      NEW.coins_charged_midweek_night := 0;
      NEW.coins_charged := 0;
      return NEW;
    end if;

    select weekend_day, weekend_night, midweek_day, midweek_night
      into v_wd, v_wn, v_md, v_mn
      from public.fn_classify_hours(NEW.start_time, NEW.end_time);

    if v_wd > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'weekend_day', -v_wd, 'booking_charge', NEW.id); end if;
    if v_wn > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'weekend_night', -v_wn, 'booking_charge', NEW.id); end if;
    if v_md > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'midweek_day', -v_md, 'booking_charge', NEW.id); end if;
    if v_mn > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'midweek_night', -v_mn, 'booking_charge', NEW.id); end if;

    NEW.coins_charged_weekend_day := v_wd;
    NEW.coins_charged_weekend_night := v_wn;
    NEW.coins_charged_midweek_day := v_md;
    NEW.coins_charged_midweek_night := v_mn;
    NEW.coins_charged := v_wd + v_wn + v_md + v_mn;
    return NEW;
  end if;

  -- TG_OP = 'UPDATE'
  if OLD.status <> 'Cancelled' and NEW.status = 'Cancelled' then
    -- §100 — Private sail, same-day cancellation: refund only
    --   full_charge * floor(remaining_hours) / 24
    -- per coin type. Any other case (Private cancelled on an earlier
    -- day, or Dockside/Maintenance) keeps the full refund (ratio = 1).
    v_refund_ratio := 1;
    if OLD.booking_type = 'Private'
       and (OLD.start_time at time zone 'Asia/Jerusalem')::date
             = (now() at time zone 'Asia/Jerusalem')::date then
      v_remaining_full_hours := greatest(
        0, floor(extract(epoch from (OLD.start_time - now())) / 3600.0)
      );
      v_refund_ratio := least(1, v_remaining_full_hours / 24.0);
    end if;

    if v_refund_ratio > 0 then
      if OLD.coins_charged_weekend_day > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'weekend_day', OLD.coins_charged_weekend_day * v_refund_ratio, 'booking_refund', NEW.id); end if;
      if OLD.coins_charged_weekend_night > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'weekend_night', OLD.coins_charged_weekend_night * v_refund_ratio, 'booking_refund', NEW.id); end if;
      if OLD.coins_charged_midweek_day > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'midweek_day', OLD.coins_charged_midweek_day * v_refund_ratio, 'booking_refund', NEW.id); end if;
      if OLD.coins_charged_midweek_night > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'midweek_night', OLD.coins_charged_midweek_night * v_refund_ratio, 'booking_refund', NEW.id); end if;
    end if;

    NEW.coins_charged_weekend_day := 0;
    NEW.coins_charged_weekend_night := 0;
    NEW.coins_charged_midweek_day := 0;
    NEW.coins_charged_midweek_night := 0;
    NEW.coins_charged := 0;
    return NEW;
  end if;

  if NEW.status = 'Cancelled' then
    return NEW;
  end if;

  if OLD.coins_charged_weekend_day > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'weekend_day', OLD.coins_charged_weekend_day, 'booking_refund', NEW.id); end if;
  if OLD.coins_charged_weekend_night > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'weekend_night', OLD.coins_charged_weekend_night, 'booking_refund', NEW.id); end if;
  if OLD.coins_charged_midweek_day > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'midweek_day', OLD.coins_charged_midweek_day, 'booking_refund', NEW.id); end if;
  if OLD.coins_charged_midweek_night > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'midweek_night', OLD.coins_charged_midweek_night, 'booking_refund', NEW.id); end if;

  if NEW.booking_type in ('Shared', 'Cyprus', 'Maintenance') then
    NEW.coins_charged_weekend_day := 0;
    NEW.coins_charged_weekend_night := 0;
    NEW.coins_charged_midweek_day := 0;
    NEW.coins_charged_midweek_night := 0;
    NEW.coins_charged := 0;
  else
    select weekend_day, weekend_night, midweek_day, midweek_night
      into v_wd, v_wn, v_md, v_mn
      from public.fn_classify_hours(NEW.start_time, NEW.end_time);
    if v_wd > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'weekend_day', -v_wd, 'booking_charge', NEW.id); end if;
    if v_wn > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'weekend_night', -v_wn, 'booking_charge', NEW.id); end if;
    if v_md > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'midweek_day', -v_md, 'booking_charge', NEW.id); end if;
    if v_mn > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'midweek_night', -v_mn, 'booking_charge', NEW.id); end if;
    NEW.coins_charged_weekend_day := v_wd;
    NEW.coins_charged_weekend_night := v_wn;
    NEW.coins_charged_midweek_day := v_md;
    NEW.coins_charged_midweek_night := v_mn;
    NEW.coins_charged := v_wd + v_wn + v_md + v_mn;
  end if;

  return NEW;
end;
$$;
