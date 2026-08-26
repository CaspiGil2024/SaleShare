-- =====================================================================
-- SailShare — Michael's Method: booking-side rules (§30/60/70/80/140)
-- =====================================================================
-- Builds on 0021's coin engine. Covers:
--   - §30: Private/Dockside/Maintenance charge/refund, now per coin
--     type (a booking can span more than one type) instead of one
--     flat number.
--   - §70: single booking <= 16 day-hours + 8 night-hours, replacing
--     the flat 24h check_max_24_hours constraint. Cyprus keeps its own
--     5-14 day rule (0013), now enforced in this same trigger instead
--     of a separate CHECK, so both live in one place.
--   - §60/80: S-rule rewritten per coin type, checked across ALL
--     future periods combined (not just the current one), anchor
--     sailings exempt. Shared/Cyprus are explicitly skipped here — see
--     0023's RPC, which checks S per-participant instead (the
--     organizer-level bookings row for those types never carries a
--     real per-type charge, so this trigger has nothing meaningful to
--     check for them).
--   - §140: anchor sailings — max 2 per partner per calendar year.
-- =====================================================================


-- ---------------------------------------------------------------------
-- §30: Private/Dockside/Maintenance charge, per coin type.
-- Shared/Cyprus always carry a zero breakdown here — their real
-- charging happens per-participant in 0023's RPC.
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_charge_booking_coins()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'Cancelled' or NEW.booking_type in ('Shared', 'Cyprus', 'Maintenance') then
      NEW.coins_charged_weekend_day := 0;
      NEW.coins_charged_weekend_night := 0;
      NEW.coins_charged_midweek_day := 0;
      NEW.coins_charged_midweek_night := 0;
      NEW.coins_charged := 0;
      return NEW;
    end if;

    select weekend_day, weekend_night, midweek_day, midweek_night
      into v_wd, v_wn, v_md, v_mn
      from public.fn_classify_hours(NEW.start_time, NEW.end_time);

    if v_wd > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'weekend_day', -v_wd, 'booking_charge', NEW.id); end if;
    if v_wn > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'weekend_night', -v_wn, 'booking_charge', NEW.id); end if;
    if v_md > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'midweek_day', -v_md, 'booking_charge', NEW.id); end if;
    if v_mn > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'midweek_night', -v_mn, 'booking_charge', NEW.id); end if;

    NEW.coins_charged_weekend_day := v_wd;
    NEW.coins_charged_weekend_night := v_wn;
    NEW.coins_charged_midweek_day := v_md;
    NEW.coins_charged_midweek_night := v_mn;
    NEW.coins_charged := v_wd + v_wn + v_md + v_mn;
    return NEW;
  end if;

  -- TG_OP = 'UPDATE'
  if OLD.status <> 'Cancelled' and NEW.status = 'Cancelled' then
    if OLD.coins_charged_weekend_day > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'weekend_day', OLD.coins_charged_weekend_day, 'booking_refund', NEW.id); end if;
    if OLD.coins_charged_weekend_night > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'weekend_night', OLD.coins_charged_weekend_night, 'booking_refund', NEW.id); end if;
    if OLD.coins_charged_midweek_day > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'midweek_day', OLD.coins_charged_midweek_day, 'booking_refund', NEW.id); end if;
    if OLD.coins_charged_midweek_night > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'midweek_night', OLD.coins_charged_midweek_night, 'booking_refund', NEW.id); end if;
    NEW.coins_charged_weekend_day := 0;
    NEW.coins_charged_weekend_night := 0;
    NEW.coins_charged_midweek_day := 0;
    NEW.coins_charged_midweek_night := 0;
    NEW.coins_charged := 0;
    return NEW;
  end if;

  if NEW.status = 'Cancelled' then
    return NEW;
  end if;

  if OLD.coins_charged_weekend_day > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'weekend_day', OLD.coins_charged_weekend_day, 'booking_refund', NEW.id); end if;
  if OLD.coins_charged_weekend_night > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'weekend_night', OLD.coins_charged_weekend_night, 'booking_refund', NEW.id); end if;
  if OLD.coins_charged_midweek_day > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'midweek_day', OLD.coins_charged_midweek_day, 'booking_refund', NEW.id); end if;
  if OLD.coins_charged_midweek_night > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'midweek_night', OLD.coins_charged_midweek_night, 'booking_refund', NEW.id); end if;

  if NEW.booking_type in ('Shared', 'Cyprus', 'Maintenance') then
    NEW.coins_charged_weekend_day := 0;
    NEW.coins_charged_weekend_night := 0;
    NEW.coins_charged_midweek_day := 0;
    NEW.coins_charged_midweek_night := 0;
    NEW.coins_charged := 0;
  else
    select weekend_day, weekend_night, midweek_day, midweek_night
      into v_wd, v_wn, v_md, v_mn
      from public.fn_classify_hours(NEW.start_time, NEW.end_time);
    if v_wd > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'weekend_day', -v_wd, 'booking_charge', NEW.id); end if;
    if v_wn > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'weekend_night', -v_wn, 'booking_charge', NEW.id); end if;
    if v_md > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'midweek_day', -v_md, 'booking_charge', NEW.id); end if;
    if v_mn > 0 then perform public.fn_apply_coin_delta(NEW.user_id, 'midweek_night', -v_mn, 'booking_charge', NEW.id); end if;
    NEW.coins_charged_weekend_day := v_wd;
    NEW.coins_charged_weekend_night := v_wn;
    NEW.coins_charged_midweek_day := v_md;
    NEW.coins_charged_midweek_night := v_mn;
    NEW.coins_charged := v_wd + v_wn + v_md + v_mn;
  end if;

  return NEW;
end;
$$;


-- ---------------------------------------------------------------------
-- §70 + Cyprus's own duration rule, in one place.
-- ---------------------------------------------------------------------
alter table public.bookings drop constraint if exists check_max_24_hours;

create or replace function public.trg_fn_enforce_day_night_hour_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
begin
  if NEW.booking_type = 'Cyprus' then
    if extract(epoch from (NEW.end_time - NEW.start_time)) / 3600 not between 120 and 336 then
      raise exception 'שייט לקפריסין חייב להימשך בין 5 ל-14 ימים.' using errcode = 'P0001';
    end if;
    return NEW;
  end if;

  select weekend_day, weekend_night, midweek_day, midweek_night
    into v_wd, v_wn, v_md, v_mn
    from public.fn_classify_hours(NEW.start_time, NEW.end_time);

  if (v_wd + v_md) > 16 then
    raise exception 'הזמנה בודדת מוגבלת ל-16 שעות יום לכל היותר.' using errcode = 'P0001';
  end if;
  if (v_wn + v_mn) > 8 then
    raise exception 'הזמנה בודדת מוגבלת ל-8 שעות לילה לכל היותר.' using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_day_night_hour_limit on public.bookings;
create trigger trg_enforce_day_night_hour_limit
  before insert or update of start_time, end_time, booking_type on public.bookings
  for each row execute function public.trg_fn_enforce_day_night_hour_limit();


-- ---------------------------------------------------------------------
-- §60/80: S-rule, rewritten per coin type across ALL future periods.
-- Same live function name (enforce_s_rule, no _fn_ infix — confirmed
-- via 0005's introspection) so the existing trg_enforce_s_rule trigger
-- picks this up automatically; the trigger declaration itself doesn't
-- need to change.
--
-- Shared/Cyprus are skipped entirely — their organizer-level bookings
-- row never carries a real per-type charge (charging happens per-
-- participant), so there is nothing meaningful to check here for those
-- types. 0023's RPC checks S per-participant instead, before it lets
-- anyone join.
-- ---------------------------------------------------------------------
create or replace function public.enforce_s_rule()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  current_s int;
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
  v_count int;
begin
  if NEW.status = 'Cancelled' then
    return NEW;
  end if;
  if NEW.booking_type in ('Maintenance', 'Shared', 'Cyprus') or NEW.is_anchor then
    return NEW;
  end if;

  select s_multiplier into current_s from public.periods where is_current = true limit 1;
  if current_s is null then current_s := 1; end if;

  select weekend_day, weekend_night, midweek_day, midweek_night
    into v_wd, v_wn, v_md, v_mn
    from public.fn_classify_hours(NEW.start_time, NEW.end_time);

  if v_wd > 0 then
    select count(*) into v_count from public.bookings
      where user_id = NEW.user_id and status <> 'Cancelled' and start_time > now()
        and booking_type <> 'Maintenance' and not is_anchor
        and coins_charged_weekend_day > 0 and id <> coalesce(NEW.id, -1);
    if v_count >= current_s then
      raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג סופ"ש יום (מקסימום %).', current_s using errcode = 'P0001';
    end if;
  end if;

  if v_wn > 0 then
    select count(*) into v_count from public.bookings
      where user_id = NEW.user_id and status <> 'Cancelled' and start_time > now()
        and booking_type <> 'Maintenance' and not is_anchor
        and coins_charged_weekend_night > 0 and id <> coalesce(NEW.id, -1);
    if v_count >= current_s then
      raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג סופ"ש לילה (מקסימום %).', current_s using errcode = 'P0001';
    end if;
  end if;

  if v_md > 0 then
    select count(*) into v_count from public.bookings
      where user_id = NEW.user_id and status <> 'Cancelled' and start_time > now()
        and booking_type <> 'Maintenance' and not is_anchor
        and coins_charged_midweek_day > 0 and id <> coalesce(NEW.id, -1);
    if v_count >= current_s then
      raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג אמצ"ש יום (מקסימום %).', current_s using errcode = 'P0001';
    end if;
  end if;

  if v_mn > 0 then
    select count(*) into v_count from public.bookings
      where user_id = NEW.user_id and status <> 'Cancelled' and start_time > now()
        and booking_type <> 'Maintenance' and not is_anchor
        and coins_charged_midweek_night > 0 and id <> coalesce(NEW.id, -1);
    if v_count >= current_s then
      raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג אמצ"ש לילה (מקסימום %).', current_s using errcode = 'P0001';
    end if;
  end if;

  return NEW;
end;
$$;


-- ---------------------------------------------------------------------
-- §140: max 2 anchor sailings per partner per calendar year.
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_enforce_anchor_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_count int;
begin
  if not NEW.is_anchor or NEW.status = 'Cancelled' then
    return NEW;
  end if;

  select count(*) into v_count
  from public.bookings
  where user_id = NEW.user_id
    and is_anchor
    and status <> 'Cancelled'
    and extract(year from start_time) = extract(year from NEW.start_time)
    and id <> coalesce(NEW.id, -1);

  if v_count >= 2 then
    raise exception 'ניתן לקבוע עד 2 הפלגות עוגן בשנה.' using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_anchor_limit on public.bookings;
create trigger trg_enforce_anchor_limit
  before insert or update of is_anchor, start_time, status on public.bookings
  for each row execute function public.trg_fn_enforce_anchor_limit();
