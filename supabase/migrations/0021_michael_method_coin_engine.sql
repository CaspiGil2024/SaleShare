-- =====================================================================
-- SailShare — Michael's Method: real 4-coin-type engine (§10/20/50/60/80)
-- =====================================================================
-- Implements the CORE of the official spec (Michael_Boat_Time_Sharing_
-- July2026_1.3.pdf), sections §10/20/30/40/50/60/70/80 only. Deferred
-- per the document's OWN text ("partners will vote and decide before
-- this system is implemented"): §110 overdraft, §120 transfers, §130
-- rollover — none of that is built here. §100 (cancellation/refund
-- state machine) and §140's UI are a separate follow-up too; this
-- migration only adds the is_anchor flag + its S-rule exemption and
-- 2/year cap, not a dedicated booking flow.
--
-- Anchor date for the first 20*S-week period: Jan 1 of the current
-- year (2026-08-26 decision, confirmed by the user — "תאריך תחילת
-- השנה"). Periods chain forward from whatever the latest period's
-- end_date is, rather than being recomputed from a fixed anchor each
-- time, so a variable S (period length = 20*S weeks) doesn't produce
-- misaligned boundaries if S ever changes between periods.
--
-- user_wallets' 4 coin columns (coins_weekend_day/night,
-- coins_midweek_day/night) already existed in the schema (unused,
-- always 0, since 0014 put everything in one bucket) — this migration
-- is what finally makes them real. They're being converted from
-- integer to numeric here: §40's proportional guest-weighted split
-- (e.g. "a quarter coin per hour" for 4 partners) requires fractional
-- balances, which integer columns can't hold.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Wallets: integer -> numeric (fractional balances needed for §40).
-- ---------------------------------------------------------------------
alter table public.user_wallets alter column coins_weekend_day type numeric using coins_weekend_day::numeric;
alter table public.user_wallets alter column coins_weekend_night type numeric using coins_weekend_night::numeric;
alter table public.user_wallets alter column coins_midweek_day type numeric using coins_midweek_day::numeric;
alter table public.user_wallets alter column coins_midweek_night type numeric using coins_midweek_night::numeric;


-- ---------------------------------------------------------------------
-- coin_transactions: needs to record WHICH of the 4 coin types moved.
-- ---------------------------------------------------------------------
alter table public.coin_transactions add column if not exists coin_type text;
alter table public.coin_transactions
  add constraint coin_transactions_coin_type_check
  check (coin_type in ('weekend_day', 'weekend_night', 'midweek_day', 'midweek_night'));


-- ---------------------------------------------------------------------
-- bookings / booking_participants: per-type charge breakdown, so a
-- booking spanning e.g. both day and night hours can be refunded
-- correctly type-by-type. coins_charged is kept as the sum of the 4 —
-- ReportsPage.jsx, xlsxExport.js, and CoinsPage.jsx all already read it
-- as a single total and keep working unchanged.
-- ---------------------------------------------------------------------
alter table public.bookings add column if not exists coins_charged_weekend_day numeric not null default 0;
alter table public.bookings add column if not exists coins_charged_weekend_night numeric not null default 0;
alter table public.bookings add column if not exists coins_charged_midweek_day numeric not null default 0;
alter table public.bookings add column if not exists coins_charged_midweek_night numeric not null default 0;

alter table public.booking_participants add column if not exists coins_charged_weekend_day numeric not null default 0;
alter table public.booking_participants add column if not exists coins_charged_weekend_night numeric not null default 0;
alter table public.booking_participants add column if not exists coins_charged_midweek_day numeric not null default 0;
alter table public.booking_participants add column if not exists coins_charged_midweek_night numeric not null default 0;

-- §40: a shared sail's cost splits by each participant's OWN guest
-- count (a guest increases the relative share of whoever brought them)
-- — guests were previously a single flat count on the booking with no
-- owner, which can't express that. This is per-participant instead.
alter table public.booking_participants add column if not exists guest_count integer not null default 0;

-- §140: anchor sailings — exempt from the S-rule (enforced below /
-- in 0022), still cost coins normally. Only meaningful for a
-- Private-type booking (a personal significant-event sail).
alter table public.bookings add column if not exists is_anchor boolean not null default false;
alter table public.bookings drop constraint if exists bookings_is_anchor_private_only;
alter table public.bookings add constraint bookings_is_anchor_private_only
  check (not is_anchor or booking_type = 'Private');


-- ---------------------------------------------------------------------
-- Classifies an hour range into the 4 coin types. Day/night boundary
-- (20:00-08:00) and weekend/holiday classification match the existing
-- convention used everywhere else in this project (fn_calculate_
-- standard_cost, coinCalculator.js) — Asia/Jerusalem local time,
-- Friday/Saturday + public.israeli_holidays. Reused for BOTH a single
-- booking's cost breakdown AND a whole period's total-hours allocation
-- (§20) — same classification, just a longer range.
-- ---------------------------------------------------------------------
create or replace function public.fn_classify_hours(p_start timestamptz, p_end timestamptz)
returns table(weekend_day numeric, weekend_night numeric, midweek_day numeric, midweek_night numeric)
language plpgsql
security definer set search_path = public
as $$
declare
  v_tz constant text := 'Asia/Jerusalem';
  v_cursor timestamp;
  v_end_local timestamp;
  v_dow int;
  v_hour int;
  v_date date;
  v_is_night boolean;
  v_is_weekend boolean;
  v_wd numeric := 0;
  v_wn numeric := 0;
  v_md numeric := 0;
  v_mn numeric := 0;
begin
  v_cursor := p_start at time zone v_tz;
  v_end_local := p_end at time zone v_tz;

  while v_cursor < v_end_local loop
    v_dow := extract(dow from v_cursor);
    v_hour := extract(hour from v_cursor);
    v_date := v_cursor::date;

    v_is_night := v_hour >= 20 or v_hour < 8;
    v_is_weekend := v_dow in (5, 6) or exists (
      select 1 from public.israeli_holidays h
      where h.holiday_date = v_date and h.holiday_type in ('holiday', 'eve')
    );

    if v_is_weekend and v_is_night then v_wn := v_wn + 1;
    elsif v_is_weekend then v_wd := v_wd + 1;
    elsif v_is_night then v_mn := v_mn + 1;
    else v_md := v_md + 1;
    end if;

    v_cursor := v_cursor + interval '1 hour';
  end loop;

  return query select v_wd, v_wn, v_md, v_mn;
end;
$$;


-- ---------------------------------------------------------------------
-- Applies a delta to ONE specific coin-type wallet column and logs it.
-- Overdraft is deliberately NOT allowed here (§110 is deferred pending
-- the partners' vote) — a deduction that would go negative still
-- raises, same as before.
-- ---------------------------------------------------------------------
create or replace function public.fn_apply_coin_delta(
  p_user_id uuid,
  p_coin_type text,
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
  v_current numeric;
  v_type_label text;
begin
  v_period_id := public.ensure_current_period();

  insert into public.user_wallets (user_id, period_id, coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night)
  values (p_user_id, v_period_id, 0, 0, 0, 0)
  on conflict (user_id, period_id) do nothing;

  v_type_label := case p_coin_type
    when 'weekend_day' then 'סופ"ש יום'
    when 'weekend_night' then 'סופ"ש לילה'
    when 'midweek_day' then 'אמצ"ש יום'
    when 'midweek_night' then 'אמצ"ש לילה'
    else null
  end;
  if v_type_label is null then
    raise exception 'סוג מטבע לא ידוע: %', p_coin_type using errcode = 'P0001';
  end if;

  if p_coin_type = 'weekend_day' then
    select coins_weekend_day into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    if p_delta < 0 and v_current + p_delta < 0 then
      raise exception 'אין מספיק מטבעות מסוג %. יתרה: %, נדרש: %.', v_type_label, v_current, abs(p_delta) using errcode = 'P0001';
    end if;
    update public.user_wallets set coins_weekend_day = coins_weekend_day + p_delta where user_id = p_user_id and period_id = v_period_id;
  elsif p_coin_type = 'weekend_night' then
    select coins_weekend_night into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    if p_delta < 0 and v_current + p_delta < 0 then
      raise exception 'אין מספיק מטבעות מסוג %. יתרה: %, נדרש: %.', v_type_label, v_current, abs(p_delta) using errcode = 'P0001';
    end if;
    update public.user_wallets set coins_weekend_night = coins_weekend_night + p_delta where user_id = p_user_id and period_id = v_period_id;
  elsif p_coin_type = 'midweek_day' then
    select coins_midweek_day into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    if p_delta < 0 and v_current + p_delta < 0 then
      raise exception 'אין מספיק מטבעות מסוג %. יתרה: %, נדרש: %.', v_type_label, v_current, abs(p_delta) using errcode = 'P0001';
    end if;
    update public.user_wallets set coins_midweek_day = coins_midweek_day + p_delta where user_id = p_user_id and period_id = v_period_id;
  else -- midweek_night
    select coins_midweek_night into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    if p_delta < 0 and v_current + p_delta < 0 then
      raise exception 'אין מספיק מטבעות מסוג %. יתרה: %, נדרש: %.', v_type_label, v_current, abs(p_delta) using errcode = 'P0001';
    end if;
    update public.user_wallets set coins_midweek_night = coins_midweek_night + p_delta where user_id = p_user_id and period_id = v_period_id;
  end if;

  insert into public.coin_transactions (user_id, period_id, coin_type, delta, reason, related_booking_id)
  values (p_user_id, v_period_id, p_coin_type, p_delta, p_reason, p_related_booking_id);
end;
$$;

revoke all on function public.fn_apply_coin_delta(uuid, text, numeric, text, integer) from public;
grant execute on function public.fn_apply_coin_delta(uuid, text, numeric, text, integer) to authenticated;


-- ---------------------------------------------------------------------
-- §20: grants each partner their share of a period's total hours per
-- type, split evenly across every partner (count(*) from public.users
-- — same population 0014's allocation already used, test accounts
-- included, unchanged precedent). Fractional (not floored): "exactly
-- enough to cover all hours" is more precisely honored by an exact
-- split than by rounding down and leaving a remainder uncovered.
-- ---------------------------------------------------------------------
create or replace function public.fn_allocate_period_coins(p_period_id integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_period record;
  v_partner_count integer;
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
  v_per_wd numeric; v_per_wn numeric; v_per_md numeric; v_per_mn numeric;
  v_user record;
begin
  select * into v_period from public.periods where id = p_period_id;

  select count(*) into v_partner_count from public.users;
  if v_partner_count = 0 then
    return;
  end if;

  select weekend_day, weekend_night, midweek_day, midweek_night
    into v_wd, v_wn, v_md, v_mn
    from public.fn_classify_hours(v_period.start_date::timestamptz, v_period.end_date::timestamptz);

  v_per_wd := v_wd / v_partner_count;
  v_per_wn := v_wn / v_partner_count;
  v_per_md := v_md / v_partner_count;
  v_per_mn := v_mn / v_partner_count;

  for v_user in select id from public.users loop
    insert into public.user_wallets (user_id, period_id, coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night)
    values (v_user.id, p_period_id, v_per_wd, v_per_wn, v_per_md, v_per_mn)
    on conflict (user_id, period_id) do update set
      coins_weekend_day = excluded.coins_weekend_day,
      coins_weekend_night = excluded.coins_weekend_night,
      coins_midweek_day = excluded.coins_midweek_day,
      coins_midweek_night = excluded.coins_midweek_night;

    insert into public.coin_transactions (user_id, period_id, coin_type, delta, reason)
    values
      (v_user.id, p_period_id, 'weekend_day', v_per_wd, 'quarterly_allowance'),
      (v_user.id, p_period_id, 'weekend_night', v_per_wn, 'quarterly_allowance'),
      (v_user.id, p_period_id, 'midweek_day', v_per_md, 'quarterly_allowance'),
      (v_user.id, p_period_id, 'midweek_night', v_per_mn, 'quarterly_allowance');
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- §50: period length = 20 * S weeks. Replaces the calendar-quarter
-- model entirely (ensure_current_quarter_period is superseded by
-- this — kept around unreferenced rather than dropped, since nothing
-- calls it anymore once the client is updated). Chains forward from
-- the latest existing period's end_date so a variable S never produces
-- misaligned boundaries; the very first period anchors to Jan 1 of the
-- current year (2026-08-26 decision).
-- ---------------------------------------------------------------------
create or replace function public.ensure_current_period()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_period_id integer;
  v_start date;
  v_end date;
  v_s integer;
  v_today date := current_date;
begin
  select id into v_period_id from public.periods where v_today >= start_date and v_today < end_date limit 1;
  if v_period_id is not null then
    update public.periods set is_current = (id = v_period_id) where true;
    return v_period_id;
  end if;

  select end_date, s_multiplier into v_start, v_s from public.periods order by end_date desc limit 1;

  if v_start is null then
    v_start := date_trunc('year', v_today)::date;
    v_s := 1;
  end if;

  while v_start + (20 * v_s) * interval '1 week' <= v_today loop
    v_start := (v_start + (20 * v_s) * interval '1 week')::date;
  end loop;
  v_end := (v_start + (20 * v_s) * interval '1 week')::date;

  update public.periods set is_current = false where is_current = true;

  insert into public.periods (start_date, end_date, s_multiplier, is_current)
  values (v_start, v_end, v_s, true)
  returning id into v_period_id;

  perform public.fn_allocate_period_coins(v_period_id);

  return v_period_id;
end;
$$;

revoke all on function public.ensure_current_period() from public;
grant execute on function public.ensure_current_period() to authenticated;
