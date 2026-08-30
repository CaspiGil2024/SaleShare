-- =====================================================================
-- SailShare — block cancelling a sailing that has already started
-- =====================================================================
-- Cancelling a booking (status -> 'Cancelled') triggers a full coin
-- refund (trg_fn_refund_participants_on_cancel / the private-booking
-- refund trigger) — allowing that for a sailing whose start_time is
-- already in the past would let anyone get a free refund for a sail
-- that already happened. Creating a booking for a past date/time is
-- still allowed unchanged (retroactive record-keeping, e.g. logging a
-- sail that happened without a prior reservation) — only the
-- cancellation transition is blocked, and only once start_time has
-- passed. No manager/admin bypass: this is a strict rule, not a
-- permission-gated one.
-- =====================================================================

create or replace function public.trg_fn_block_past_cancellation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if OLD.status <> 'Cancelled' and NEW.status = 'Cancelled' and OLD.start_time <= now() then
    raise exception 'לא ניתן לבטל הפלגה שכבר החלה או הסתיימה.' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_block_past_cancellation on public.bookings;
create trigger trg_block_past_cancellation
  before update on public.bookings
  for each row execute function public.trg_fn_block_past_cancellation();
