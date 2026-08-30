-- =====================================================================
-- SailShare — the S-rule ("future bookings quota") must not block
-- creating/joining a PAST booking
-- =====================================================================
-- fn_count_future_type_usage already correctly counts only the user's
-- OTHER genuinely future bookings (start_time > now()) of a coin type —
-- that part was always right. The bug was on the OTHER side: neither
-- enforce_s_rule() (Private/Dockside) nor fn_recompute_shared_
-- booking_participants (Shared/Cyprus, and everything built on it —
-- join/leave/admin add-remove) ever checked whether the booking being
-- created/modified was ITSELF in the future before applying that
-- quota. So creating (or joining, within the 7-day window) a PAST
-- booking could get blocked by "you already have a future booking of
-- this type" — even though a past booking doesn't consume a future
-- slot at all; the rule's own name and message ("מכסת ההזמנות
-- העתידיות" — the FUTURE bookings quota) was never meant to apply to
-- something that already happened.
--
-- Fix: both now skip the quota check entirely when the booking's own
-- start_time is not in the future. The charge itself is unaffected —
-- past bookings still cost coins exactly as before, this only removes
-- the future-quota gate for them.
-- =====================================================================

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
  -- A past booking doesn't hold a future slot open — nothing to check.
  if NEW.start_time <= now() then
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


create or replace function public.fn_recompute_shared_booking_participants(
  p_booking_id integer,
  p_participants jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking record;
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
  v_total_shares numeric := 0;
  v_participant jsonb;
  v_user_id uuid;
  v_user_name text;
  v_is_self boolean;
  v_guest_count int;
  v_share numeric;
  v_p_wd numeric; v_p_wn numeric; v_p_md numeric; v_p_mn numeric;
  current_s int;
  v_check_quota boolean;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההזמנה לא נמצאה.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(p_participants) elem
    where (elem ->> 'user_id')::uuid = v_booking.user_id
  ) then
    raise exception 'המזמין חייב להיות בין המשתתפים.' using errcode = 'P0001';
  end if;

  -- A past sailing doesn't hold a future slot open for anyone on it —
  -- nothing to check, for any participant (see header).
  v_check_quota := v_booking.start_time > now();

  delete from public.booking_participants where booking_id = p_booking_id;

  for v_participant in select * from jsonb_array_elements(p_participants)
  loop
    v_user_id := (v_participant ->> 'user_id')::uuid;
    v_guest_count := coalesce((v_participant ->> 'guest_count')::int, 0);
    insert into public.booking_participants (booking_id, user_id, guest_count)
    values (p_booking_id, v_user_id, v_guest_count);
    v_total_shares := v_total_shares + 1; -- guests carry no weight (0040)
  end loop;

  select weekend_day, weekend_night, midweek_day, midweek_night
    into v_wd, v_wn, v_md, v_mn
    from public.fn_classify_hours(v_booking.start_time, v_booking.end_time);

  select s_multiplier into current_s from public.system_settings where id = true;
  if current_s is null then current_s := 1; end if;

  for v_participant in select * from jsonb_array_elements(p_participants)
  loop
    v_user_id := (v_participant ->> 'user_id')::uuid;
    v_share := 1 / v_total_shares;
    v_is_self := (v_user_id = auth.uid());

    if not v_is_self then
      select coalesce(full_name, email) into v_user_name from public.users where id = v_user_id;
      v_user_name := coalesce(v_user_name, 'שותף');
    end if;

    v_p_wd := v_wd * v_share;
    v_p_wn := v_wn * v_share;
    v_p_md := v_md * v_share;
    v_p_mn := v_mn * v_share;

    if v_check_quota and v_p_wd > 0 and public.fn_count_future_type_usage(v_user_id, 'weekend_day', p_booking_id) >= current_s then
      if v_is_self then
        raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג סופ"ש יום (מקסימום %).', current_s using errcode = 'P0001';
      else
        raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג סופ"ש יום (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
      end if;
    end if;
    if v_check_quota and v_p_wn > 0 and public.fn_count_future_type_usage(v_user_id, 'weekend_night', p_booking_id) >= current_s then
      if v_is_self then
        raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג סופ"ש לילה (מקסימום %).', current_s using errcode = 'P0001';
      else
        raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג סופ"ש לילה (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
      end if;
    end if;
    if v_check_quota and v_p_md > 0 and public.fn_count_future_type_usage(v_user_id, 'midweek_day', p_booking_id) >= current_s then
      if v_is_self then
        raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג אמצ"ש יום (מקסימום %).', current_s using errcode = 'P0001';
      else
        raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג אמצ"ש יום (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
      end if;
    end if;
    if v_check_quota and v_p_mn > 0 and public.fn_count_future_type_usage(v_user_id, 'midweek_night', p_booking_id) >= current_s then
      if v_is_self then
        raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג אמצ"ש לילה (מקסימום %).', current_s using errcode = 'P0001';
      else
        raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג אמצ"ש לילה (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
      end if;
    end if;

    if v_p_wd > 0 then perform public.fn_apply_coin_delta(v_user_id, 'weekend_day', -v_p_wd, 'participant_charge', p_booking_id); end if;
    if v_p_wn > 0 then perform public.fn_apply_coin_delta(v_user_id, 'weekend_night', -v_p_wn, 'participant_charge', p_booking_id); end if;
    if v_p_md > 0 then perform public.fn_apply_coin_delta(v_user_id, 'midweek_day', -v_p_md, 'participant_charge', p_booking_id); end if;
    if v_p_mn > 0 then perform public.fn_apply_coin_delta(v_user_id, 'midweek_night', -v_p_mn, 'participant_charge', p_booking_id); end if;

    update public.booking_participants set
      coins_charged_weekend_day = v_p_wd,
      coins_charged_weekend_night = v_p_wn,
      coins_charged_midweek_day = v_p_md,
      coins_charged_midweek_night = v_p_mn,
      coins_charged = v_p_wd + v_p_wn + v_p_md + v_p_mn
    where booking_id = p_booking_id and user_id = v_user_id;
  end loop;
end;
$$;
