-- =====================================================================
-- SailShare — diagnostic: did leaving a Shared/Cyprus sailing refund
-- exactly what the participant was originally charged?
-- =====================================================================
-- Run manually in the Supabase SQL Editor. Replace :booking_id below
-- with the actual bookings.id for the sailing in question (find it via
-- the Sailing Log page, or by matching organizer/start_time here).
--
-- What this shows: every coin_transactions row tied to this booking,
-- in order, per partner. For a participant who joined then left, you
-- should see a 'participant_charge' (negative delta) when they joined,
-- and a 'participant_refund' (positive delta) of the EXACT SAME
-- absolute amount, per coin_type, when they left — regardless of what
-- anyone's guest_count was at either moment. That's the design:
-- fn_recompute_shared_booking_participants always deletes every
-- current participant row (refunding exactly what's stored on it,
-- via trg_fn_refund_participant_coins) before re-charging whoever's
-- left at their newly-computed share — so leaving never recalculates
-- a refund from a live guest count, only from what was actually
-- charged. If the numbers below DON'T net out to zero for the partner
-- who left, that's the concrete evidence needed to pin down where the
-- mismatch actually happens.
-- =====================================================================

select
  t.created_at,
  coalesce(u.full_name, u.email) as partner,
  t.reason,
  t.coin_type,
  t.delta,
  t.related_booking_id
from public.coin_transactions t
join public.users u on u.id = t.user_id
where t.related_booking_id = :booking_id  -- <-- replace :booking_id with the real id
order by t.created_at, partner, t.coin_type;

-- Net delta per partner for this booking — should be 0 for anyone who
-- joined and later left with nothing else charged in between.
select
  coalesce(u.full_name, u.email) as partner,
  t.coin_type,
  sum(t.delta) as net_delta
from public.coin_transactions t
join public.users u on u.id = t.user_id
where t.related_booking_id = :booking_id  -- <-- replace :booking_id with the real id
group by partner, t.coin_type
having sum(t.delta) <> 0
order by partner, t.coin_type;
