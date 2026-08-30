-- =====================================================================
-- SailShare — restore guest-weighted proportional cost split
-- =====================================================================
-- Reverses 0040's "guests never cost coins, equal split among partners
-- only" — explicit product decision, confirmed with a worked example:
--   Gil (0 guests) + Michael (0 guests) -> 2 shares total, 1/2 each.
--   Gil (2 guests, 3 shares) + Michael (3 guests, 4 shares) -> 7 shares
--   total; Gil pays 3/7, Michael pays 4/7.
-- i.e. each participant's share = (1 + their own guest_count) divided
-- by the sum of (1 + guest_count) across everyone on the sail — exactly
-- the pre-0040 formula. The 9-person capacity cap (organizer + every
-- participant + every one of their guests) is unrelated to this and
-- unchanged.
--
-- Restores fn_recompute_shared_booking_participants to weight by
-- guest_count again (re-reading it in the charging loop, which 0040
-- had stopped needing there). The solo case is unaffected either way:
-- with one participant, share = (1+g)/(1+g) = 1 = 100%, regardless of
-- guest count — the "alone = full private-equivalent price" behavior
-- from 0040/0044 still holds.
-- =====================================================================

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

  v_check_quota := v_booking.start_time > now();

  delete from public.booking_participants where booking_id = p_booking_id;

  for v_participant in select * from jsonb_array_elements(p_participants)
  loop
    v_user_id := (v_participant ->> 'user_id')::uuid;
    v_guest_count := coalesce((v_participant ->> 'guest_count')::int, 0);
    insert into public.booking_participants (booking_id, user_id, guest_count)
    values (p_booking_id, v_user_id, v_guest_count);
    v_total_shares := v_total_shares + 1 + v_guest_count;
  end loop;

  select weekend_day, weekend_night, midweek_day, midweek_night
    into v_wd, v_wn, v_md, v_mn
    from public.fn_classify_hours(v_booking.start_time, v_booking.end_time);

  select s_multiplier into current_s from public.system_settings where id = true;
  if current_s is null then current_s := 1; end if;

  for v_participant in select * from jsonb_array_elements(p_participants)
  loop
    v_user_id := (v_participant ->> 'user_id')::uuid;
    v_guest_count := coalesce((v_participant ->> 'guest_count')::int, 0);
    v_share := (1 + v_guest_count) / v_total_shares;
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
