-- =====================================================================
-- *** DOES NOT MATCH THE LIVE DATABASE — see 0005_schema_reality_baseline.sql ***
-- Confirmed 2026-08-26: this file was never actually applied as written.
-- Live bookings/periods/user_wallets use integer ids (not uuid), text
-- columns (not the enums below), no coin columns on bookings, no
-- coin-calculation trigger, and different (real) No-Gap/S-Rule trigger
-- implementations. Read 0005 before assuming anything in this file
-- describes reality.
-- =====================================================================
-- SailShare — Phase 1: Core Schema & "Michael's Method" Enforcement
-- =====================================================================
-- Design notes (read before applying):
--
-- 1. TIMEZONE: all hour classification (night/day, weekend/midweek) is
--    computed in 'Asia/Jerusalem' local time, regardless of how the
--    client sends timestamptz values. Change the constant inside
--    fn_calculate_booking_coins() if the yacht operates elsewhere.
--
-- 2. BOUNDARIES (assumed, adjust if wrong):
--      Night  = 20:00 (incl.) .. 06:00 (excl.) local time
--      Weekend = Friday + Saturday (Israeli work week: Sun-Thu is midweek)
--
-- 3. HOUR ALIGNMENT: since 1 hour == 1 coin and the "No 1-Hour Gap"
--    rule is defined in whole hours, bookings are required to start
--    and end exactly on the hour. This is enforced by a CHECK
--    constraint (bookings_hour_aligned) — it isn't explicitly in the
--    spec but is a necessary consequence of it.
--
-- 4. SINGLE YACHT: the overlap-prevention EXCLUDE constraint assumes
--    one physical boat. If SailShare ever manages multiple yachts,
--    add a yacht_id column and include it in the exclusion constraint.
--
-- 5. OUT OF SCOPE for Phase 1 (deferred to later phases):
--      - Debiting/crediting wallet coin balances when a booking is
--        made/cancelled, and rejecting bookings on insufficient
--        balance (needs its own trigger once we agree on refund
--        semantics for cancellations).
--      - The "Last Minute" 60-minute registration window + auto-award
--        algorithm — this belongs in a Supabase Edge Function driven
--        by a scheduled job (pg_cron / cron trigger), not a DB trigger,
--        since it has to run 60 minutes after the fact.
--      - Periodic reconciliation of future_bookings_count as bookings
--        age past "now" without being cancelled (helper function
--        fn_recalculate_future_bookings_count is provided below for
--        a pg_cron job to call periodically).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto; -- gen_random_uuid()


-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.user_role as enum ('partner', 'treasurer');
create type public.booking_type as enum ('Private', 'Shared', 'Long');
create type public.booking_status as enum ('Confirmed', 'Pending_LastMinute', 'Cancelled');


-- ---------------------------------------------------------------------
-- users  (profile row, 1:1 with Supabase auth.users)
-- ---------------------------------------------------------------------
create table public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  email      text not null unique,
  role       public.user_role not null default 'partner',
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- periods  (20-week sharing periods, each with its own S-multiplier)
-- ---------------------------------------------------------------------
create table public.periods (
  id           uuid primary key default gen_random_uuid(),
  start_date   date not null,
  end_date     date not null,
  s_multiplier numeric not null check (s_multiplier > 0),
  is_current   boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint periods_valid_range check (end_date > start_date)
);

-- Only one period may be marked current at a time.
create unique index periods_only_one_current
  on public.periods (is_current)
  where is_current = true;


-- ---------------------------------------------------------------------
-- user_wallets  (per-user, per-period coin balances)
-- ---------------------------------------------------------------------
create table public.user_wallets (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  period_id             uuid not null references public.periods(id) on delete cascade,
  coins_weekend_day     numeric not null default 0,
  coins_weekend_night   numeric not null default 0,
  coins_midweek_day     numeric not null default 0,
  coins_midweek_night   numeric not null default 0,
  future_bookings_count int not null default 0 check (future_bookings_count >= 0),
  updated_at            timestamptz not null default now(),
  unique (user_id, period_id)
);


-- ---------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------
create table public.bookings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  start_time   timestamptz not null,
  end_time     timestamptz not null,
  booking_type public.booking_type not null,
  status       public.booking_status not null default 'Confirmed',

  -- Per-coin-type breakdown, auto-computed by trigger below.
  coins_weekend_day   numeric not null default 0,
  coins_weekend_night numeric not null default 0,
  coins_midweek_day   numeric not null default 0,
  coins_midweek_night numeric not null default 0,
  total_coins numeric generated always as (
    coins_weekend_day + coins_weekend_night + coins_midweek_day + coins_midweek_night
  ) stored,

  created_at timestamptz not null default now(),

  constraint bookings_valid_range check (end_time > start_time),
  constraint bookings_max_duration check (end_time - start_time <= interval '24 hours'),
  constraint bookings_hour_aligned check (
    date_trunc('hour', start_time) = start_time
    and date_trunc('hour', end_time) = end_time
  )
);

create index bookings_user_id_idx on public.bookings (user_id);
create index bookings_start_time_idx on public.bookings (start_time);

-- Prevent any overlapping active bookings on the (single) yacht.
-- Range types have native GiST support, so no extra extension is needed.
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    tstzrange(start_time, end_time, '[)') with &&
  ) where (status <> 'Cancelled');


-- =====================================================================
-- Coin calculation (supporting logic, used by the trigger below)
-- =====================================================================
create or replace function public.fn_calculate_booking_coins(
  p_start timestamptz,
  p_end   timestamptz
)
returns table (
  weekend_day   numeric,
  weekend_night numeric,
  midweek_day   numeric,
  midweek_night numeric
)
language plpgsql
as $$
declare
  v_tz          constant text := 'Asia/Jerusalem';
  v_hour_cursor timestamp;
  v_end_local   timestamp;
  v_dow         int;
  v_hour        int;
  v_is_weekend  boolean;
  v_is_night    boolean;
  v_wd numeric := 0;
  v_wn numeric := 0;
  v_md numeric := 0;
  v_mn numeric := 0;
begin
  v_hour_cursor := p_start at time zone v_tz;
  v_end_local   := p_end   at time zone v_tz;

  while v_hour_cursor < v_end_local loop
    v_dow  := extract(dow  from v_hour_cursor); -- Sun=0 .. Sat=6
    v_hour := extract(hour from v_hour_cursor);

    v_is_weekend := v_dow in (5, 6);            -- Friday, Saturday
    v_is_night   := v_hour >= 20 or v_hour < 6; -- 20:00-06:00

    if v_is_weekend and v_is_night then
      v_wn := v_wn + 1;
    elsif v_is_weekend and not v_is_night then
      v_wd := v_wd + 1;
    elsif not v_is_weekend and v_is_night then
      v_mn := v_mn + 1;
    else
      v_md := v_md + 1;
    end if;

    v_hour_cursor := v_hour_cursor + interval '1 hour';
  end loop;

  return query select v_wd, v_wn, v_md, v_mn;
end;
$$;


create or replace function public.trg_fn_set_booking_coins()
returns trigger
language plpgsql
as $$
declare
  v_coins record;
begin
  select * into v_coins
  from public.fn_calculate_booking_coins(NEW.start_time, NEW.end_time);

  NEW.coins_weekend_day   := v_coins.weekend_day;
  NEW.coins_weekend_night := v_coins.weekend_night;
  NEW.coins_midweek_day   := v_coins.midweek_day;
  NEW.coins_midweek_night := v_coins.midweek_night;

  return NEW;
end;
$$;

create trigger trg_set_booking_coins
  before insert or update of start_time, end_time on public.bookings
  for each row execute function public.trg_fn_set_booking_coins();


-- =====================================================================
-- RULE: No 1-Hour Gap (anti-fragmentation)
-- =====================================================================
-- A booking is rejected if it would leave *exactly* a 1-hour empty gap
-- between itself and the nearest adjacent active booking, on either
-- side. Gaps of other sizes (0h = touching, 2h, 3h, ...) are allowed.
-- True overlaps are already rejected by bookings_no_overlap above.
create or replace function public.trg_fn_enforce_no_gap_rule()
returns trigger
language plpgsql
as $$
declare
  v_prev_end   timestamptz;
  v_next_start timestamptz;
begin
  if NEW.status = 'Cancelled' then
    return NEW;
  end if;

  select max(end_time) into v_prev_end
  from public.bookings
  where status <> 'Cancelled'
    and id <> NEW.id
    and end_time <= NEW.start_time;

  select min(start_time) into v_next_start
  from public.bookings
  where status <> 'Cancelled'
    and id <> NEW.id
    and start_time >= NEW.end_time;

  if v_prev_end is not null and NEW.start_time - v_prev_end = interval '1 hour' then
    raise exception
      'No-Gap Rule violation: this booking would leave exactly a 1-hour empty gap after the previous booking (which ends at %). Either start at % (no gap) or push the start out further.',
      v_prev_end, v_prev_end
      using errcode = 'P0001';
  end if;

  if v_next_start is not null and v_next_start - NEW.end_time = interval '1 hour' then
    raise exception
      'No-Gap Rule violation: this booking would leave exactly a 1-hour empty gap before the next booking (which starts at %). Either end at % (no gap) or pull the end in further.',
      v_next_start, v_next_start
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

create trigger trg_enforce_no_gap_rule
  before insert or update of start_time, end_time, status on public.bookings
  for each row execute function public.trg_fn_enforce_no_gap_rule();


-- =====================================================================
-- RULE: "S" Rule (max future bookings = s_multiplier * 4)
-- =====================================================================
-- Counts against the quota: any Confirmed / Pending_LastMinute booking
-- whose start_time is still in the future. The user's wallet row for
-- the current period is locked (FOR UPDATE) before checking, so two
-- simultaneous booking attempts by the same partner can't both slip
-- past the limit.
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
  if NEW.status not in ('Confirmed', 'Pending_LastMinute') or NEW.start_time <= now() then
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

create trigger trg_enforce_s_rule
  before insert on public.bookings
  for each row execute function public.trg_fn_enforce_s_rule();


-- Release the quota slot immediately on cancellation (if it was still
-- counted as a future booking at the time it's cancelled).
create or replace function public.trg_fn_release_s_rule_slot()
returns trigger
language plpgsql
as $$
declare
  v_period_id uuid;
begin
  if OLD.status in ('Confirmed', 'Pending_LastMinute')
     and NEW.status = 'Cancelled'
     and OLD.start_time > now() then

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

create trigger trg_release_s_rule_slot
  before update of status on public.bookings
  for each row execute function public.trg_fn_release_s_rule_slot();


-- Helper for periodic reconciliation (e.g. a nightly pg_cron job), so
-- slots that "expire" simply because start_time passed (without a
-- cancellation) get freed up too.
create or replace function public.fn_recalculate_future_bookings_count(
  p_user_id   uuid,
  p_period_id uuid
)
returns void
language plpgsql
as $$
begin
  update public.user_wallets w
  set future_bookings_count = (
        select count(*) from public.bookings b
        where b.user_id = p_user_id
          and b.status in ('Confirmed', 'Pending_LastMinute')
          and b.start_time > now()
      ),
      updated_at = now()
  where w.user_id = p_user_id and w.period_id = p_period_id;
end;
$$;


-- =====================================================================
-- Row Level Security (baseline — will likely be refined in Phase 2/3)
-- =====================================================================
alter table public.users        enable row level security;
alter table public.periods      enable row level security;
alter table public.user_wallets enable row level security;
alter table public.bookings     enable row level security;

-- users: profile names/emails are visible to all logged-in partners
-- (needed to show "who booked what" on the shared calendar); only the
-- owner can edit their own row.
create policy users_select_all on public.users
  for select using (auth.role() = 'authenticated');
create policy users_update_own on public.users
  for update using (auth.uid() = id);

-- periods: readable by everyone; only treasurers can create/modify.
create policy periods_select_all on public.periods
  for select using (auth.role() = 'authenticated');
create policy periods_treasurer_write on public.periods
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'treasurer')
  );

-- wallets: a partner can see only their own balance; treasurers see all.
create policy wallets_select_own on public.user_wallets
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'treasurer')
  );
create policy wallets_treasurer_write on public.user_wallets
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'treasurer')
  );

-- bookings: the whole calendar is shared/visible; a partner can only
-- insert/update their own bookings; treasurers can manage all.
create policy bookings_select_all on public.bookings
  for select using (auth.role() = 'authenticated');
create policy bookings_insert_own on public.bookings
  for insert with check (auth.uid() = user_id);
create policy bookings_update_own on public.bookings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy bookings_treasurer_all on public.bookings
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'treasurer')
  );
