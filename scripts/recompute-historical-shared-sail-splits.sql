-- =====================================================================
-- SailShare — recompute historical Shared/Cyprus splits under the
-- restored guest-weighted formula
-- =====================================================================
-- The formula fix (0051_restore_guest_weighted_cost_split.sql) only
-- changes how NEW writes are computed — fn_recompute_shared_booking_
-- participants only runs when a booking is created, edited, joined,
-- left, or has a participant added/removed. Any Shared/Cyprus booking
-- that was created or last touched while the OLD "guests are free,
-- equal split" formula was live (migrations 0040 through 0050) still
-- has its coins_charged_* values frozen at whatever that formula
-- computed — the fix does not retroactively touch them.
--
-- This only matters for bookings where the two formulas actually
-- disagree: if every participant on a sail brought the same number of
-- guests (0 guests each is the common case), an equal split and a
-- guest-weighted split produce the IDENTICAL number, so those rows are
-- already correct by coincidence. It only matters for a sail with
-- MULTIPLE participants where at least one brought a different number
-- of guests than another.
--
-- Run manually in the Supabase SQL Editor.
--
-- SECURITY / DATA WARNING — read before running Step 2:
-- This changes real historical coin balances for real people (refunds
-- the old charge, applies the new one, via the same fn_apply_coin_delta
-- path everything else uses — fully audited in coin_transactions same
-- as any other charge). It is not something to run without reviewing
-- Step 1's output first. A booking may also fail correction if a
-- participant's S-rule quota status has since changed (e.g. they've
-- since booked another future sail of that type) — Step 2 is written
-- to skip and report failures individually rather than abort the
-- whole batch, so a handful of failures don't block the rest.
-- =====================================================================


-- Step 1 — preview every affected booking before touching anything.
-- Only lists bookings where the two formulas would actually disagree
-- (multiple participants, unequal guest counts).
select
  b.id as booking_id,
  b.start_time,
  b.booking_type,
  bo.full_name as organizer_name,
  count(*) as participant_count,
  jsonb_agg(jsonb_build_object('partner', u.full_name, 'guests', bp.guest_count, 'currently_charged', bp.coins_charged)) as participants
from public.bookings b
join public.booking_participants bp on bp.booking_id = b.id
join public.users u on u.id = bp.user_id
join public.users bo on bo.id = b.user_id
where b.status <> 'Cancelled'
group by b.id, b.start_time, b.booking_type, bo.full_name
having count(*) > 1 and count(distinct bp.guest_count) > 1
order by b.start_time desc;


-- Step 2 — recompute and recharge every booking listed above, reusing
-- the exact same engine every other write already goes through
-- (fn_recompute_shared_booking_participants) so this isn't a separate,
-- untested charging path. Wrapped per-booking so one failure (e.g. a
-- quota conflict) doesn't abort the rest of the batch.
do $$
declare
  v_booking_id integer;
  v_participants jsonb;
begin
  for v_booking_id in
    select b.id
    from public.bookings b
    join public.booking_participants bp on bp.booking_id = b.id
    where b.status <> 'Cancelled'
    group by b.id
    having count(*) > 1 and count(distinct bp.guest_count) > 1
  loop
    select jsonb_agg(jsonb_build_object('user_id', bp.user_id, 'guest_count', bp.guest_count))
      into v_participants
      from public.booking_participants bp
      where bp.booking_id = v_booking_id;

    begin
      perform public.fn_recompute_shared_booking_participants(v_booking_id, v_participants);
      raise notice 'Corrected booking %', v_booking_id;
    exception when others then
      raise warning 'Failed to correct booking %: %', v_booking_id, sqlerrm;
    end;
  end loop;
end $$;
