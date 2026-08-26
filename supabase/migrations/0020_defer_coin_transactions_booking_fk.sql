-- =====================================================================
-- SailShare — fix: coin_transactions FK checked before the booking exists
-- =====================================================================
-- Live error confirmed via browser console: inserting a (non-Shared)
-- booking failed with a foreign-key violation —
-- "Key (related_booking_id)=(25) is not present in table bookings".
--
-- Root cause: trg_fn_charge_booking_coins (0014) is a BEFORE INSERT
-- trigger on bookings (it has to be — it also sets NEW.coins_charged
-- on the row being inserted, which only works from a BEFORE trigger).
-- For a real charge, it calls fn_apply_coin_delta(..., NEW.id), which
-- inserts into coin_transactions referencing that booking id. But
-- we're still inside bookings' own BEFORE INSERT trigger — the
-- bookings row hasn't actually been written to the table yet, only
-- NEW.id is known (assigned early from the identity sequence). The
-- coin_transactions.related_booking_id FK isn't deferrable, so it's
-- checked immediately and fails, since the referenced row genuinely
-- doesn't exist at that instant.
--
-- Fix: make that one FK DEFERRABLE INITIALLY DEFERRED, so it's checked
-- at end-of-transaction instead of immediately. By then the bookings
-- row (same statement, same transaction) has been written — the check
-- passes. If the transaction rolls back for any other reason, the
-- coin_transactions row rolls back with it, so there's no orphan risk;
-- this only changes *when* the check runs, not what it guarantees.
--
-- No application/trigger logic changes — this is a constraint-only fix.
-- =====================================================================

do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.coin_transactions'::regclass
    and contype = 'f'
    and pg_get_constraintdef(oid) like '%related_booking_id%';

  if v_constraint_name is null then
    raise exception 'Could not find the FK constraint on coin_transactions.related_booking_id — inspect pg_constraint manually.';
  end if;

  execute format(
    'alter table public.coin_transactions alter constraint %I deferrable initially deferred',
    v_constraint_name
  );
end $$;
