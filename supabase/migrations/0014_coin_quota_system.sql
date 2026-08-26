-- =====================================================================
-- SailShare — Real quarterly coin quota + deduction system
-- =====================================================================
-- Decisions this implements (from chat, this is the first time real
-- coin deduction has existed anywhere in this project — 0001's design
-- explicitly deferred it, and it was never actually built):
--
--   1. S-Rule (future-booking-count cap) stays exactly as-is. This
--      migration adds a SEPARATE coin-balance check; a booking must
--      pass both.
--   2. Shared/Cyprus sails keep the mandatory-1-partner rule as-is
--      (built two turns ago). There is no "alone" rate — it's an
--      unreachable state by design, so it's not implemented.
--   3. periods now represents real calendar quarters (Jan1/Apr1/Jul1/
--      Oct1), each partner gets a 400-coin allowance per quarter.
--   4. Shared/Cyprus: EACH participant (including the organizer — see
--      client-side changes, which now inserts the organizer into
--      booking_participants too) pays 1 coin/hour from their OWN
--      wallet, individually, not one lump sum from the organizer.
--   5. Cancelling ANY booking (any type) refunds every coin that was
--      deducted for it — see trg_fn_charge_booking_coins (organizer,
--      non-shared types) and trg_fn_refund_participants_on_cancel
--      (every participant, Shared/Cyprus).
--   6. Every coin movement is logged to coin_transactions (who, when,
--      how much, why) — deductions, refunds, and quarterly grants
--      alike, all funneled through the single fn_apply_coin_delta
--      choke point plus one explicit log in the quarterly-grant path.
--
-- Rate model (Private/Dockside — the only types without a partner
-- list, so the only ones the day/weekend/night table can apply to):
--   night (20:00-08:00, any day)        -> 1 coin/hour  (highest priority)
--   weekend (Fri/Sat) or holiday, else  -> 10 coin/hour
--   everything else (weekday daytime)   -> 5 coin/hour
-- Maintenance: always 0. Shared/Cyprus: flat 1 coin/hour per
-- participant, no day/night/weekend variation (that's the rate
-- itself, not a category to classify hours into).
--
-- Coins live in coins_midweek_day (same "put it all in one bucket"
-- convention already established in 0004/fn_apply_partner_roster) —
-- the other 3 user_wallets columns stay 0 for quarter wallets created
-- here. Existing SUM-of-4-columns displays (Dashboard.jsx etc.) keep
-- working unchanged.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Holiday dates, synced from the client (Hebcal isn't callable from
-- inside a Postgres trigger) — see NewBookingModal.jsx/EditBookingModal.jsx,
-- which upsert into this right before submitting a booking.
-- ---------------------------------------------------------------------
create table if not exists public.israeli_holidays (
  holiday_date date primary key,
  holiday_type text not null check (holiday_type in ('holiday', 'eve'))
);

alter table public.israeli_holidays enable row level security;

drop policy if exists israeli_holidays_select_all on public.israeli_holidays;
create policy israeli_holidays_select_all on public.israeli_holidays
  for select using (auth.role() = 'authenticated');

-- Any authenticated user can upsert dates (this is public astronomical/
-- calendar data, not sensitive — same trust level as reading it).
drop policy if exists israeli_holidays_insert_any on public.israeli_holidays;
create policy israeli_holidays_insert_any on public.israeli_holidays
  for insert with check (auth.role() = 'authenticated');


-- ---------------------------------------------------------------------
-- Track exactly what was charged, so refunds reverse the real charge
-- instead of recomputing from (possibly since-changed) booking state.
-- ---------------------------------------------------------------------
alter table public.bookings
  add column if not exists coins_charged numeric not null default 0;

alter table public.booking_participants
  add column if not exists coins_charged numeric not null default 0;


-- ---------------------------------------------------------------------
-- Audit log: every coin movement, ever. Append-only — no UPDATE/DELETE
-- policy for anyone (matches checklist_submissions' pattern). Only
-- written by SECURITY DEFINER functions below, which bypass RLS for
-- their own inserts regardless.
-- ---------------------------------------------------------------------
create table if not exists public.coin_transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  period_id           integer not null references public.periods(id) on delete cascade,
  delta               numeric not null, -- positive = credit/refund/allowance, negative = deduction
  reason              text not null check (
    reason in ('quarterly_allowance', 'booking_charge', 'booking_refund', 'participant_charge', 'participant_refund')
  ),
  related_booking_id  integer references public.bookings(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists coin_transactions_user_id_idx on public.coin_transactions (user_id);
create index if not exists coin_transactions_created_at_idx on public.coin_transactions (created_at);

alter table public.coin_transactions enable row level security;

drop policy if exists coin_transactions_select on public.coin_transactions;
create policy coin_transactions_select on public.coin_transactions
  for select using (auth.uid() = user_id or public.is_manager());


-- ---------------------------------------------------------------------
-- Ensures a periods row exists for the CURRENT calendar quarter (Jan1/
-- Apr1/Jul1/Oct1 boundaries) and that every partner has a user_wallets
-- row for it with the 400-coin allowance (logged to coin_transactions
-- as 'quarterly_allowance'). Cheap in the common case — only does the
-- backfill work the first time it's called after a quarter rolls over.
-- ---------------------------------------------------------------------
create or replace function public.ensure_current_quarter_period()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_quarter_start date := date_trunc('quarter', now())::date;
  v_quarter_end   date := (date_trunc('quarter', now()) + interval '3 months')::date;
  v_period_id     integer;
  v_prev_s        integer;
begin
  select id into v_period_id
  from public.periods
  where start_date = v_quarter_start
  limit 1;

  if v_period_id is not null then
    -- Make sure it's the one marked current (handles a quarter
    -- rollover mid-transaction cleanly).
    update public.periods set is_current = (id = v_period_id);
    return v_period_id;
  end if;

  -- First touch of a new quarter: carry forward the previous period's
  -- s_multiplier (S-Rule's own setting) rather than silently resetting
  -- it to some default.
  select s_multiplier into v_prev_s from public.periods where is_current = true limit 1;

  update public.periods set is_current = false where is_current = true;

  insert into public.periods (start_date, end_date, s_multiplier, is_current)
  values (v_quarter_start, v_quarter_end, coalesce(v_prev_s, 1), true)
  returning id into v_period_id;

  -- Backfill every partner's wallet for the new quarter with the
  -- 400-coin allowance, and log one 'quarterly_allowance' transaction
  -- per partner actually granted (the "returning" from the wallet
  -- insert only yields rows that weren't already there — on conflict
  -- do nothing skips, and doesn't log, anyone somehow already granted).
  with newly_granted as (
    insert into public.user_wallets (user_id, period_id, coins_midweek_day, coins_weekend_day, coins_weekend_night, coins_midweek_night)
    select u.id, v_period_id, 400, 0, 0, 0
    from public.users u
    on conflict (user_id, period_id) do nothing
    returning user_id
  )
  insert into public.coin_transactions (user_id, period_id, delta, reason)
  select user_id, v_period_id, 400, 'quarterly_allowance' from newly_granted;

  return v_period_id;
end;
$$;

revoke all on function public.ensure_current_quarter_period() from public;
grant execute on function public.ensure_current_quarter_period() to authenticated;


-- ---------------------------------------------------------------------
-- Applies a coin delta (negative = deduct, positive = refund) to a
-- user's CURRENT-quarter wallet, and logs it to coin_transactions.
-- Locks the wallet row (for update) so two concurrent bookings by the
-- same partner can't both slip past a balance check that's already
-- stale by the time either commits — more robust than the S-Rule's
-- live COUNT(*) check here, since a single balance column can be
-- locked directly (there's nothing equivalent to lock for a COUNT).
-- ---------------------------------------------------------------------
create or replace function public.fn_apply_coin_delta(
  p_user_id uuid,
  p_delta numeric,
  p_reason text,
  p_related_booking_id integer default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_period_id integer;
  v_current   numeric;
begin
  v_period_id := public.ensure_current_quarter_period();

  insert into public.user_wallets (user_id, period_id, coins_midweek_day, coins_weekend_day, coins_weekend_night, coins_midweek_night)
  values (p_user_id, v_period_id, 400, 0, 0, 0)
  on conflict (user_id, period_id) do nothing;

  select coins_midweek_day into v_current
  from public.user_wallets
  where user_id = p_user_id and period_id = v_period_id
  for update;

  if p_delta < 0 and v_current + p_delta < 0 then
    raise exception
      'אין מספיק מטבעות ברבעון הנוכחי. יתרה: %, נדרש: %.',
      v_current, abs(p_delta)
      using errcode = 'P0001';
  end if;

  update public.user_wallets
    set coins_midweek_day = coins_midweek_day + p_delta
    where user_id = p_user_id and period_id = v_period_id;

  insert into public.coin_transactions (user_id, period_id, delta, reason, related_booking_id)
  values (p_user_id, v_period_id, p_delta, p_reason, p_related_booking_id);
end;
$$;

revoke all on function public.fn_apply_coin_delta(uuid, numeric, text, integer) from public;
grant execute on function public.fn_apply_coin_delta(uuid, numeric, text, integer) to authenticated;


-- ---------------------------------------------------------------------
-- Standard (Private/Dockside) hourly rate table: night beats weekend/
-- holiday beats weekday. Asia/Jerusalem local time, matching every
-- other date/time rule in this project.
-- ---------------------------------------------------------------------
create or replace function public.fn_calculate_standard_cost(p_start timestamptz, p_end timestamptz)
returns numeric
language plpgsql
security definer set search_path = public
as $$
declare
  v_tz          constant text := 'Asia/Jerusalem';
  v_cursor      timestamp;
  v_end_local   timestamp;
  v_dow         int;
  v_hour        int;
  v_date        date;
  v_is_night    boolean;
  v_is_weekend  boolean;
  v_is_holiday  boolean;
  v_total       numeric := 0;
begin
  v_cursor    := p_start at time zone v_tz;
  v_end_local := p_end   at time zone v_tz;

  while v_cursor < v_end_local loop
    v_dow  := extract(dow  from v_cursor);
    v_hour := extract(hour from v_cursor);
    v_date := v_cursor::date;

    v_is_night   := v_hour >= 20 or v_hour < 8; -- 20:00-08:00
    v_is_weekend := v_dow in (5, 6);
    v_is_holiday := exists (
      select 1 from public.israeli_holidays h
      where h.holiday_date = v_date and h.holiday_type in ('holiday', 'eve')
    );

    if v_is_night then
      v_total := v_total + 1;
    elsif v_is_weekend or v_is_holiday then
      v_total := v_total + 10;
    else
      v_total := v_total + 5;
    end if;

    v_cursor := v_cursor + interval '1 hour';
  end loop;

  return v_total;
end;
$$;


-- ---------------------------------------------------------------------
-- bookings: charge/refund/adjust the ORGANIZER for Private/Dockside
-- only. Shared/Cyprus bookings always carry coins_charged = 0 here —
-- their real charging happens per-participant, in booking_participants
-- below (the organizer is now inserted into that table too — see
-- NewBookingModal.jsx/EditBookingModal.jsx).
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_charge_booking_coins()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_new_cost numeric;
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'Cancelled' or NEW.booking_type in ('Shared', 'Cyprus', 'Maintenance') then
      NEW.coins_charged := 0;
      return NEW;
    end if;
    v_new_cost := public.fn_calculate_standard_cost(NEW.start_time, NEW.end_time);
    perform public.fn_apply_coin_delta(NEW.user_id, -v_new_cost, 'booking_charge', NEW.id);
    NEW.coins_charged := v_new_cost;
    return NEW;
  end if;

  -- TG_OP = 'UPDATE'
  if OLD.status <> 'Cancelled' and NEW.status = 'Cancelled' then
    if OLD.coins_charged > 0 then
      perform public.fn_apply_coin_delta(OLD.user_id, OLD.coins_charged, 'booking_refund', NEW.id);
    end if;
    NEW.coins_charged := 0;
    return NEW;
  end if;

  if NEW.status = 'Cancelled' then
    return NEW; -- already cancelled, nothing to (re)charge
  end if;

  -- Live (non-cancelled) booking whose time/type changed: refund the
  -- old stored charge, then charge fresh under the new state.
  if OLD.coins_charged > 0 then
    perform public.fn_apply_coin_delta(OLD.user_id, OLD.coins_charged, 'booking_refund', NEW.id);
  end if;

  if NEW.booking_type in ('Shared', 'Cyprus', 'Maintenance') then
    NEW.coins_charged := 0;
  else
    v_new_cost := public.fn_calculate_standard_cost(NEW.start_time, NEW.end_time);
    perform public.fn_apply_coin_delta(NEW.user_id, -v_new_cost, 'booking_charge', NEW.id);
    NEW.coins_charged := v_new_cost;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_charge_booking_coins on public.bookings;
create trigger trg_charge_booking_coins
  before insert or update of start_time, end_time, booking_type, status on public.bookings
  for each row execute function public.trg_fn_charge_booking_coins();


-- ---------------------------------------------------------------------
-- booking_participants: flat 1 coin/hour per participant, charged
-- individually from their own wallet. Covers Shared/Cyprus organizer
-- AND partners alike, since the client now inserts the organizer as a
-- participant row too.
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_charge_participant_coins()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking  record;
  v_cost     numeric;
begin
  select start_time, end_time, status into v_booking
  from public.bookings where id = NEW.booking_id;

  if v_booking.status = 'Cancelled' then
    NEW.coins_charged := 0;
    return NEW;
  end if;

  v_cost := extract(epoch from (v_booking.end_time - v_booking.start_time)) / 3600.0 * 1;
  perform public.fn_apply_coin_delta(NEW.user_id, -v_cost, 'participant_charge', NEW.booking_id);
  NEW.coins_charged := v_cost;
  return NEW;
end;
$$;

drop trigger if exists trg_charge_participant_coins on public.booking_participants;
create trigger trg_charge_participant_coins
  before insert on public.booking_participants
  for each row execute function public.trg_fn_charge_participant_coins();


create or replace function public.trg_fn_refund_participant_coins()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if OLD.coins_charged > 0 then
    perform public.fn_apply_coin_delta(OLD.user_id, OLD.coins_charged, 'participant_refund', OLD.booking_id);
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_refund_participant_coins on public.booking_participants;
create trigger trg_refund_participant_coins
  before delete on public.booking_participants
  for each row execute function public.trg_fn_refund_participant_coins();


-- ---------------------------------------------------------------------
-- Cancelling a Shared/Cyprus booking (any booking, in fact — this
-- fires regardless of type) needs to refund every attached participant
-- too, not just the (already-zero, for Shared/Cyprus) organizer-level
-- charge handled in trg_fn_charge_booking_coins above. Together, these
-- two triggers mean: cancelling ANY booking of ANY type refunds every
-- coin that was deducted for it.
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_refund_participants_on_cancel()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_participant record;
begin
  if OLD.status <> 'Cancelled' and NEW.status = 'Cancelled' then
    for v_participant in
      select user_id, coins_charged from public.booking_participants where booking_id = NEW.id
    loop
      if v_participant.coins_charged > 0 then
        perform public.fn_apply_coin_delta(v_participant.user_id, v_participant.coins_charged, 'participant_refund', NEW.id);
      end if;
    end loop;
    update public.booking_participants set coins_charged = 0 where booking_id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_refund_participants_on_cancel on public.bookings;
create trigger trg_refund_participants_on_cancel
  before update of status on public.bookings
  for each row execute function public.trg_fn_refund_participants_on_cancel();
