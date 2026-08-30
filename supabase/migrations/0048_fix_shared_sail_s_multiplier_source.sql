-- =====================================================================
-- SailShare — fix: shared-sail S-rule read the frozen s_multiplier
-- =====================================================================
-- Regression, not a business-rule question. 0024 deliberately moved
-- the S-multiplier's LIVE source to system_settings.s_multiplier (so
-- an admin's change in the Parameters page takes effect immediately),
-- explicitly leaving periods.s_multiplier as a frozen snapshot of
-- whatever S was at period-creation time, nothing more — see 0024's
-- own header comment on enforce_s_rule.
--
-- 0040 rewrote fn_create_shared_booking (fixing the guest-weighting
-- formula) from an outdated pre-0024 copy that still read
-- periods.s_multiplier, silently reverting that fix for shared sails.
-- 0044 then built fn_recompute_shared_booking_participants — the
-- shared engine behind fn_create_shared_booking, fn_update_shared_
-- booking, fn_join_shared_booking, fn_leave_shared_booking, and
-- 0047's fn_admin_add/remove_shared_participant — from that same
-- stale copy, so the bug spread to all six entry points.
--
-- Net effect: if an admin ever raises the S-multiplier via Parameters
-- after the current period was created, every one of those six
-- operations kept enforcing the OLD, lower cap, exactly like the
-- "quota too restrictive" report — enforce_s_rule (Private/Dockside)
-- was never affected, only the shared-sail engine was.
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

  -- Live value, not periods.s_multiplier's frozen snapshot — see header.
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

    if v_p_wd > 0 and public.fn_count_future_type_usage(v_user_id, 'weekend_day', p_booking_id) >= current_s then
      if v_is_self then
        raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג סופ"ש יום (מקסימום %).', current_s using errcode = 'P0001';
      else
        raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג סופ"ש יום (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
      end if;
    end if;
    if v_p_wn > 0 and public.fn_count_future_type_usage(v_user_id, 'weekend_night', p_booking_id) >= current_s then
      if v_is_self then
        raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג סופ"ש לילה (מקסימום %).', current_s using errcode = 'P0001';
      else
        raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג סופ"ש לילה (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
      end if;
    end if;
    if v_p_md > 0 and public.fn_count_future_type_usage(v_user_id, 'midweek_day', p_booking_id) >= current_s then
      if v_is_self then
        raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג אמצ"ש יום (מקסימום %).', current_s using errcode = 'P0001';
      else
        raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג אמצ"ש יום (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
      end if;
    end if;
    if v_p_mn > 0 and public.fn_count_future_type_usage(v_user_id, 'midweek_night', p_booking_id) >= current_s then
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
