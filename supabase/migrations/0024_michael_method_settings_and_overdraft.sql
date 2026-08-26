-- =====================================================================
-- SailShare — Michael's Method: system settings, overdraft, fixed period length
-- =====================================================================
-- Final decisions from the partners (2026-08-26), superseding parts of
-- 0021-0023:
--   - §50: period length is a FIXED 20 weeks — NOT 20*S as 0021 first
--     assumed from "מכפיל=S" in the doc. S is now a fully independent,
--     admin/treasurer-adjustable setting, not something that changes
--     period boundaries.
--   - Anchor date for the first period: 2026-08-26 (today), not Jan 1
--     — supersedes the earlier "start of year" answer.
--   - §110 overdraft: APPROVED at 20%, but as an adjustable setting,
--     not a hardcoded number — a partner's balance of a given coin
--     type can go negative down to -(overdraft_percent/100) * what
--     they were ALLOCATED for that type this period.
--   - §120 transfers: confirmed OFF. Nothing built for this — no
--     change needed.
--   - §130 rollover: confirmed OFF by default, but the PERCENTAGE
--     needs to be a configurable setting for a future management
--     screen. Only the setting itself is scaffolded here — actually
--     applying a rollover at period-allocation time is real design
--     work (the doc's "no partner ends up more than 10% ahead of
--     another" balancing rule needs its own logic) that was
--     deliberately scoped OUT of this pass; fn_allocate_period_coins
--     does not read or apply rollover_percent yet. Flagged explicitly
--     rather than silently building a partial version.
--
-- system_settings is a singleton table (id is always `true`) —
-- read by anyone authenticated (S needs to be visible for booking
-- validation messages), writable only by admin/treasurer (same tier
-- as Freeze/Soft-Delete in 0015 — these are all high-stakes,
-- system-wide financial parameters).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Settings table.
-- ---------------------------------------------------------------------
create table if not exists public.system_settings (
  id boolean primary key default true,
  s_multiplier integer not null default 1,
  overdraft_percent numeric not null default 20,
  rollover_percent numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  constraint system_settings_singleton check (id),
  constraint system_settings_s_positive check (s_multiplier > 0),
  constraint system_settings_overdraft_range check (overdraft_percent >= 0 and overdraft_percent <= 100),
  constraint system_settings_rollover_range check (rollover_percent >= 0 and rollover_percent <= 100)
);

insert into public.system_settings (id, s_multiplier, overdraft_percent, rollover_percent)
values (true, 1, 20, 0)
on conflict (id) do nothing;

alter table public.system_settings enable row level security;

drop policy if exists system_settings_select_all on public.system_settings;
create policy system_settings_select_all on public.system_settings
  for select using (auth.role() = 'authenticated');

drop policy if exists system_settings_manage on public.system_settings;
create policy system_settings_manage on public.system_settings
  for all using (public.is_admin_or_treasurer()) with check (public.is_admin_or_treasurer());


-- ---------------------------------------------------------------------
-- user_wallets: track what was actually ALLOCATED per type this period
-- (separate from the current balance, which decreases as coins are
-- spent) — the overdraft floor is computed against the allocation, not
-- the ever-changing balance.
-- ---------------------------------------------------------------------
alter table public.user_wallets add column if not exists allocated_weekend_day numeric not null default 0;
alter table public.user_wallets add column if not exists allocated_weekend_night numeric not null default 0;
alter table public.user_wallets add column if not exists allocated_midweek_day numeric not null default 0;
alter table public.user_wallets add column if not exists allocated_midweek_night numeric not null default 0;


-- ---------------------------------------------------------------------
-- fn_allocate_period_coins: now also records the allocated_* reference
-- columns. Otherwise unchanged from 0021.
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
    insert into public.user_wallets (
      user_id, period_id,
      coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night,
      allocated_weekend_day, allocated_weekend_night, allocated_midweek_day, allocated_midweek_night
    )
    values (
      v_user.id, p_period_id,
      v_per_wd, v_per_wn, v_per_md, v_per_mn,
      v_per_wd, v_per_wn, v_per_md, v_per_mn
    )
    on conflict (user_id, period_id) do update set
      coins_weekend_day = excluded.coins_weekend_day,
      coins_weekend_night = excluded.coins_weekend_night,
      coins_midweek_day = excluded.coins_midweek_day,
      coins_midweek_night = excluded.coins_midweek_night,
      allocated_weekend_day = excluded.allocated_weekend_day,
      allocated_weekend_night = excluded.allocated_weekend_night,
      allocated_midweek_day = excluded.allocated_midweek_day,
      allocated_midweek_night = excluded.allocated_midweek_night;

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
-- §50, corrected: period length is a FIXED 20 weeks (140 days),
-- anchored to 2026-08-26. Direct modular computation instead of
-- chaining from the latest period row — safe even though the periods
-- table already has old calendar-quarter rows from before this system,
-- since those don't sit on the new 140-day grid and are simply ignored
-- for boundary math (only ever matched by an exact start_date lookup
-- below, which they won't satisfy).
-- ---------------------------------------------------------------------
create or replace function public.ensure_current_period()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_anchor constant date := '2026-08-26';
  v_period_length constant int := 140; -- 20 weeks
  v_period_id integer;
  v_days_since_anchor integer;
  v_period_index integer;
  v_start date;
  v_end date;
  v_s integer;
  v_today date := current_date;
begin
  v_days_since_anchor := greatest(v_today - v_anchor, 0);
  v_period_index := v_days_since_anchor / v_period_length;
  v_start := v_anchor + (v_period_index * v_period_length);
  v_end := v_start + v_period_length;

  select id into v_period_id from public.periods where start_date = v_start;
  if v_period_id is not null then
    update public.periods set is_current = (id = v_period_id) where true;
    return v_period_id;
  end if;

  select s_multiplier into v_s from public.system_settings where id = true;

  update public.periods set is_current = false where is_current = true;

  insert into public.periods (start_date, end_date, s_multiplier, is_current)
  values (v_start, v_end, coalesce(v_s, 1), true)
  returning id into v_period_id;

  perform public.fn_allocate_period_coins(v_period_id);

  return v_period_id;
end;
$$;


-- ---------------------------------------------------------------------
-- fn_apply_coin_delta: overdraft floor, read live from system_settings
-- (an admin changing the % takes effect immediately) against the
-- period's allocated_* reference for that type.
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
  v_allocated numeric;
  v_overdraft_percent numeric;
  v_floor numeric;
  v_type_label text;
begin
  v_period_id := public.ensure_current_period();

  insert into public.user_wallets (user_id, period_id, coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night)
  values (p_user_id, v_period_id, 0, 0, 0, 0)
  on conflict (user_id, period_id) do nothing;

  select overdraft_percent into v_overdraft_percent from public.system_settings where id = true;
  v_overdraft_percent := coalesce(v_overdraft_percent, 0);

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
    select coins_weekend_day, allocated_weekend_day into v_current, v_allocated
      from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
  elsif p_coin_type = 'weekend_night' then
    select coins_weekend_night, allocated_weekend_night into v_current, v_allocated
      from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
  elsif p_coin_type = 'midweek_day' then
    select coins_midweek_day, allocated_midweek_day into v_current, v_allocated
      from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
  else
    select coins_midweek_night, allocated_midweek_night into v_current, v_allocated
      from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
  end if;

  v_floor := -(v_overdraft_percent / 100.0) * coalesce(v_allocated, 0);

  if p_delta < 0 and v_current + p_delta < v_floor then
    raise exception 'אין מספיק מטבעות מסוג % (כולל אוברדרפט של %%%). יתרה: %, מינימום אפשרי: %, נדרש: %.',
      v_type_label, v_overdraft_percent, v_current, v_floor, abs(p_delta) using errcode = 'P0001';
  end if;

  if p_coin_type = 'weekend_day' then
    update public.user_wallets set coins_weekend_day = coins_weekend_day + p_delta where user_id = p_user_id and period_id = v_period_id;
  elsif p_coin_type = 'weekend_night' then
    update public.user_wallets set coins_weekend_night = coins_weekend_night + p_delta where user_id = p_user_id and period_id = v_period_id;
  elsif p_coin_type = 'midweek_day' then
    update public.user_wallets set coins_midweek_day = coins_midweek_day + p_delta where user_id = p_user_id and period_id = v_period_id;
  else
    update public.user_wallets set coins_midweek_night = coins_midweek_night + p_delta where user_id = p_user_id and period_id = v_period_id;
  end if;

  insert into public.coin_transactions (user_id, period_id, coin_type, delta, reason, related_booking_id)
  values (p_user_id, v_period_id, p_coin_type, p_delta, p_reason, p_related_booking_id);
end;
$$;


-- ---------------------------------------------------------------------
-- enforce_s_rule / fn_create_shared_booking: read S live from
-- system_settings instead of periods.s_multiplier, so an admin change
-- takes effect immediately for all future bookings (not just new
-- periods). periods.s_multiplier is still populated at period-creation
-- time (0021) purely as a historical record of what S was then.
-- ---------------------------------------------------------------------
create or replace function public.enforce_s_rule()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  current_s int;
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
begin
  if NEW.status = 'Cancelled' then
    return NEW;
  end if;
  if NEW.booking_type in ('Maintenance', 'Shared', 'Cyprus') or NEW.is_anchor then
    return NEW;
  end if;

  select s_multiplier into current_s from public.system_settings where id = true;
  if current_s is null then current_s := 1; end if;

  select weekend_day, weekend_night, midweek_day, midweek_night
    into v_wd, v_wn, v_md, v_mn
    from public.fn_classify_hours(NEW.start_time, NEW.end_time);

  if v_wd > 0 and public.fn_count_future_type_usage(NEW.user_id, 'weekend_day', NEW.id) >= current_s then
    raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג סופ"ש יום (מקסימום %).', current_s using errcode = 'P0001';
  end if;
  if v_wn > 0 and public.fn_count_future_type_usage(NEW.user_id, 'weekend_night', NEW.id) >= current_s then
    raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג סופ"ש לילה (מקסימום %).', current_s using errcode = 'P0001';
  end if;
  if v_md > 0 and public.fn_count_future_type_usage(NEW.user_id, 'midweek_day', NEW.id) >= current_s then
    raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג אמצ"ש יום (מקסימום %).', current_s using errcode = 'P0001';
  end if;
  if v_mn > 0 and public.fn_count_future_type_usage(NEW.user_id, 'midweek_night', NEW.id) >= current_s then
    raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג אמצ"ש לילה (מקסימום %).', current_s using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;


create or replace function public.fn_create_shared_booking(
  p_booking_type text,
  p_start timestamptz,
  p_end timestamptz,
  p_notes text,
  p_participants jsonb
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_organizer uuid := auth.uid();
  v_booking_id integer;
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
  v_total_shares numeric := 0;
  v_participant jsonb;
  v_user_id uuid;
  v_guest_count int;
  v_share numeric;
  v_p_wd numeric; v_p_wn numeric; v_p_md numeric; v_p_mn numeric;
  current_s int;
begin
  if v_organizer is null then
    raise exception 'יש להתחבר מחדש כדי ליצור הזמנה.' using errcode = 'P0001';
  end if;
  if p_booking_type not in ('Shared', 'Cyprus') then
    raise exception 'סוג הזמנה לא תקין לפעולה זו.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_participants) elem
    where (elem ->> 'user_id')::uuid = v_organizer
  ) then
    raise exception 'המזמין חייב להיות בין המשתתפים.' using errcode = 'P0001';
  end if;

  insert into public.bookings (user_id, start_time, end_time, booking_type, guests_count, notes, status)
  values (v_organizer, p_start, p_end, p_booking_type, 0, p_notes, 'Confirmed')
  returning id into v_booking_id;

  for v_participant in select * from jsonb_array_elements(p_participants)
  loop
    v_user_id := (v_participant ->> 'user_id')::uuid;
    v_guest_count := coalesce((v_participant ->> 'guest_count')::int, 0);
    insert into public.booking_participants (booking_id, user_id, guest_count)
    values (v_booking_id, v_user_id, v_guest_count);
    v_total_shares := v_total_shares + 1 + v_guest_count;
  end loop;

  select weekend_day, weekend_night, midweek_day, midweek_night
    into v_wd, v_wn, v_md, v_mn
    from public.fn_classify_hours(p_start, p_end);

  select s_multiplier into current_s from public.system_settings where id = true;
  if current_s is null then current_s := 1; end if;

  for v_participant in select * from jsonb_array_elements(p_participants)
  loop
    v_user_id := (v_participant ->> 'user_id')::uuid;
    v_guest_count := coalesce((v_participant ->> 'guest_count')::int, 0);
    v_share := (1 + v_guest_count) / v_total_shares;

    v_p_wd := v_wd * v_share;
    v_p_wn := v_wn * v_share;
    v_p_md := v_md * v_share;
    v_p_mn := v_mn * v_share;

    if v_p_wd > 0 and public.fn_count_future_type_usage(v_user_id, 'weekend_day', v_booking_id) >= current_s then
      raise exception 'שותף % ניצל את מכסת ההזמנות העתידיות שלו מסוג סופ"ש יום (מקסימום %).', v_user_id, current_s using errcode = 'P0001';
    end if;
    if v_p_wn > 0 and public.fn_count_future_type_usage(v_user_id, 'weekend_night', v_booking_id) >= current_s then
      raise exception 'שותף % ניצל את מכסת ההזמנות העתידיות שלו מסוג סופ"ש לילה (מקסימום %).', v_user_id, current_s using errcode = 'P0001';
    end if;
    if v_p_md > 0 and public.fn_count_future_type_usage(v_user_id, 'midweek_day', v_booking_id) >= current_s then
      raise exception 'שותף % ניצל את מכסת ההזמנות העתידיות שלו מסוג אמצ"ש יום (מקסימום %).', v_user_id, current_s using errcode = 'P0001';
    end if;
    if v_p_mn > 0 and public.fn_count_future_type_usage(v_user_id, 'midweek_night', v_booking_id) >= current_s then
      raise exception 'שותף % ניצל את מכסת ההזמנות העתידיות שלו מסוג אמצ"ש לילה (מקסימום %).', v_user_id, current_s using errcode = 'P0001';
    end if;

    if v_p_wd > 0 then perform public.fn_apply_coin_delta(v_user_id, 'weekend_day', -v_p_wd, 'participant_charge', v_booking_id); end if;
    if v_p_wn > 0 then perform public.fn_apply_coin_delta(v_user_id, 'weekend_night', -v_p_wn, 'participant_charge', v_booking_id); end if;
    if v_p_md > 0 then perform public.fn_apply_coin_delta(v_user_id, 'midweek_day', -v_p_md, 'participant_charge', v_booking_id); end if;
    if v_p_mn > 0 then perform public.fn_apply_coin_delta(v_user_id, 'midweek_night', -v_p_mn, 'participant_charge', v_booking_id); end if;

    update public.booking_participants set
      coins_charged_weekend_day = v_p_wd,
      coins_charged_weekend_night = v_p_wn,
      coins_charged_midweek_day = v_p_md,
      coins_charged_midweek_night = v_p_mn,
      coins_charged = v_p_wd + v_p_wn + v_p_md + v_p_mn
    where booking_id = v_booking_id and user_id = v_user_id;
  end loop;

  return v_booking_id;
end;
$$;
