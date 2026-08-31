-- =====================================================================
-- SailShare — auto-reclassify a Shared sailing that ended up solo (no
-- other partner ever joined) as Private, scanning the past 2 weeks
-- =====================================================================
-- Cyprus already has an equivalent rule (fn_auto_cancel_solo_cyprus_
-- sailings, 0044) — but Cyprus is CANCELLED when solo because Cyprus
-- requires at least one other partner by its own business rule. Shared
-- has no such requirement (0040/0051: a solo Shared sail already charges
-- exactly like a Private sail of the same duration — v_share degrades to
-- 1 when there's only one participant), so a Shared sailing that stayed
-- solo isn't wrong to have happened, just mislabeled for reporting/
-- stats purposes once it's in the past and nobody's going to join it
-- anymore. This relabels it instead of cancelling it.
--
-- Scope: booking_type = 'Shared' (not Cyprus — see above), not already
-- Cancelled, start_time in the past but within the last 14 days (an
-- older solo Shared sailing is left alone — this is a recent-data
-- cleanup sweep, not a full historical rewrite), and exactly one
-- booking_participants row (the organizer, nobody else ever joined).
--
-- Coin-accounting: deliberately does NOT skip the normal charge/refund
-- triggers — it performs the same conversion EditBookingModal.jsx's
-- handleSave already does manually for a Shared->Private switch, just
-- in the OPPOSITE order from that client-side path and for a real
-- reason: DELETE the solo booking_participants row FIRST, THEN UPDATE
-- booking_type. Deleting first means trg_fn_enforce_booking_capacity_
-- on_guests (0012/0052 — now checked on both insert and update of
-- guests_count) counts 0 existing participant rows when the UPDATE sets
-- bookings.guests_count, instead of double-counting the same person
-- once via their (soon-to-be-deleted) participant row AND once via the
-- new flat guests_count — which would false-positive reject an
-- otherwise-valid organizer+8-guests solo sailing as "over capacity".
--
-- The charge/refund math still nets out correctly regardless of order:
-- the DELETE's trg_fn_refund_participant_coins refunds exactly what
-- this solo participant was charged under the Shared formula; the
-- UPDATE's trg_fn_charge_booking_coins then sees a Shared booking's
-- OLD.coins_charged_* were always 0 (Shared charges live on
-- booking_participants, never on the bookings row itself) and charges
-- the NEW Private amount fresh via fn_classify_hours. Since a solo
-- participant's share is 1 (equal to the full fn_classify_hours
-- breakdown — see 0051's header), the refund exactly offsets the fresh
-- charge — net balance unchanged, only the label and bookkeeping shape
-- change. No manual fn_apply_coin_delta calls needed; the existing
-- triggers already do this correctly.
-- =====================================================================

create or replace function public.fn_auto_convert_solo_shared_sailings_to_private()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking record;
  v_guest_count int;
  v_count integer := 0;
begin
  for v_booking in
    select b.id
    from public.bookings b
    where b.booking_type = 'Shared'
      and b.status <> 'Cancelled'
      and b.start_time <= now()
      and b.start_time >= now() - interval '14 days'
      and (select count(*) from public.booking_participants bp where bp.booking_id = b.id) = 1
  loop
    select coalesce(guest_count, 0) into v_guest_count
      from public.booking_participants where booking_id = v_booking.id;

    -- Delete BEFORE update — see header comment on why the order matters
    -- for the capacity trigger.
    delete from public.booking_participants where booking_id = v_booking.id;

    update public.bookings
      set booking_type = 'Private', guests_count = v_guest_count
      where id = v_booking.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.fn_auto_convert_solo_shared_sailings_to_private() from public;
grant execute on function public.fn_auto_convert_solo_shared_sailings_to_private() to authenticated;
