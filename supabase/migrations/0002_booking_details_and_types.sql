-- =====================================================================
-- *** DOES NOT MATCH THE LIVE DATABASE — see 0005_schema_reality_baseline.sql ***
-- Confirmed 2026-08-26: booking_type is plain text on the live DB, not
-- an enum (this file's entire enum-swap below never actually applied).
-- The coin-column changes here also don't apply — bookings has no
-- coin_* columns and no coin-calculation trigger at all live.
-- =====================================================================
-- SailShare — Phase: Booking form fields & revised booking_type set
-- =====================================================================
-- The "New Booking" modal introduced 4 concrete booking categories
-- that don't line up with the original booking_type enum
-- ('Private','Shared','Long'):
--   - Private      (שייט פרטי)              — full hourly coin cost
--   - Shared       (שייט שותפים)            — cost split among partners
--   - Dockside     (רתיקה / שימוש ברציף)    — 1 coin/hr, same as Private
--   - Maintenance  (תחזוקה)                 — blocks the boat, 0 coins
--
-- 'Long' is dropped (nothing in the approved UI spec maps to it); any
-- existing 'Long' rows are remapped to 'Dockside' as the closest
-- equivalent. This is a dev-stage schema change (no production data),
-- done via the standard "swap the enum type" pattern since Postgres
-- can't drop enum values in place.
-- =====================================================================

begin;

alter type public.booking_type rename to booking_type_old;

create type public.booking_type as enum ('Private', 'Shared', 'Dockside', 'Maintenance');

alter table public.bookings
  alter column booking_type type public.booking_type
  using (
    case booking_type::text
      when 'Long' then 'Dockside'
      else booking_type::text
    end
  )::public.booking_type;

drop type public.booking_type_old;

commit;


-- ---------------------------------------------------------------------
-- New form fields
-- ---------------------------------------------------------------------
alter table public.bookings
  add column notes text,
  add column guests_count int not null default 0 check (guests_count between 0 and 7);


-- ---------------------------------------------------------------------
-- Maintenance bookings charge 0 coins regardless of the hours they span.
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_set_booking_coins()
returns trigger
language plpgsql
as $$
declare
  v_coins record;
begin
  if NEW.booking_type = 'Maintenance' then
    NEW.coins_weekend_day := 0;
    NEW.coins_weekend_night := 0;
    NEW.coins_midweek_day := 0;
    NEW.coins_midweek_night := 0;
    return NEW;
  end if;

  select * into v_coins
  from public.fn_calculate_booking_coins(NEW.start_time, NEW.end_time);

  NEW.coins_weekend_day   := v_coins.weekend_day;
  NEW.coins_weekend_night := v_coins.weekend_night;
  NEW.coins_midweek_day   := v_coins.midweek_day;
  NEW.coins_midweek_night := v_coins.midweek_night;

  return NEW;
end;
$$;

-- Re-fire coin calculation when booking_type flips to/from Maintenance,
-- not just when the time range changes.
drop trigger if exists trg_set_booking_coins on public.bookings;
create trigger trg_set_booking_coins
  before insert or update of start_time, end_time, booking_type on public.bookings
  for each row execute function public.trg_fn_set_booking_coins();


-- ---------------------------------------------------------------------
-- Maintenance bookings don't count against the partner's S-Rule quota
-- (they're an operational block, not a personal leisure booking).
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_enforce_s_rule()
returns trigger
language plpgsql
as $$
declare
  v_period_id    uuid;
  v_s_multiplier numeric;
  v_max_bookings numeric;
  v_wallet_count int;
begin
  if NEW.status not in ('Confirmed', 'Pending_LastMinute')
     or NEW.start_time <= now()
     or NEW.booking_type = 'Maintenance' then
    return NEW;
  end if;

  select id, s_multiplier into v_period_id, v_s_multiplier
  from public.periods
  where is_current = true
  limit 1;

  if v_period_id is null then
    raise exception 'S-Rule check failed: no current period is configured.';
  end if;

  select future_bookings_count into v_wallet_count
  from public.user_wallets
  where user_id = NEW.user_id and period_id = v_period_id
  for update;

  if v_wallet_count is null then
    raise exception 'S-Rule check failed: no wallet exists for user % in the current period.', NEW.user_id;
  end if;

  v_max_bookings := v_s_multiplier * 4;

  if v_wallet_count + 1 > v_max_bookings then
    raise exception
      'S-Rule violation: you already have % future bookings, the maximum for this period is % (S=%).',
      v_wallet_count, v_max_bookings, v_s_multiplier
      using errcode = 'P0001';
  end if;

  update public.user_wallets
    set future_bookings_count = future_bookings_count + 1,
        updated_at = now()
    where user_id = NEW.user_id and period_id = v_period_id;

  return NEW;
end;
$$;

create or replace function public.trg_fn_release_s_rule_slot()
returns trigger
language plpgsql
as $$
declare
  v_period_id uuid;
begin
  if OLD.status in ('Confirmed', 'Pending_LastMinute')
     and NEW.status = 'Cancelled'
     and OLD.start_time > now()
     and OLD.booking_type <> 'Maintenance' then

    select id into v_period_id from public.periods where is_current = true limit 1;

    if v_period_id is not null then
      update public.user_wallets
        set future_bookings_count = greatest(future_bookings_count - 1, 0),
            updated_at = now()
        where user_id = NEW.user_id and period_id = v_period_id;
    end if;
  end if;

  return NEW;
end;
$$;
