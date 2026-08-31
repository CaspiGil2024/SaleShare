-- =====================================================================
-- SailShare — the 9-person capacity trigger on bookings.guests_count
-- (0012) only fired on UPDATE, never on the initial INSERT
-- =====================================================================
-- trg_fn_enforce_booking_capacity_on_guests's own header (0012) claims
-- the cap is "enforced in two places, each a single-statement check
-- with no cross-transaction gap" — but its trigger was only ever
-- `before update of guests_count on bookings`, never `before insert`.
-- A brand-new Private/Dockside (or solo Shared/Cyprus) booking created
-- with an over-cap guests_count from the start — bypassing the
-- frontend's own check, e.g. a direct REST/RPC call — was never
-- validated server-side at all until its FIRST subsequent guests_count
-- update, if any.
--
-- The function body itself needs no change: on INSERT, NEW.id is
-- already populated (identity/serial defaults resolve before BEFORE
-- ROW triggers fire) and booking_participants can't yet have any row
-- referencing it, so v_participant_count correctly evaluates to 0 and
-- v_total correctly reduces to 1 (organizer) + guests_count — exactly
-- the frontend's own formula for these booking kinds. Just widen the
-- trigger's firing condition to include INSERT.
-- =====================================================================

drop trigger if exists trg_enforce_booking_capacity_on_guests on public.bookings;
create trigger trg_enforce_booking_capacity_on_guests
  before insert or update of guests_count on public.bookings
  for each row execute function public.trg_fn_enforce_booking_capacity_on_guests();
