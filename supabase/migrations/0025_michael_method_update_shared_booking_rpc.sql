-- =====================================================================
-- SailShare — Michael's Method: update-shared-booking RPC
-- =====================================================================
-- EditBookingModal.jsx's existing Shared/Cyprus save flow (delete all
-- participants, then plain-insert the new selection) relied on
-- trg_charge_participant_coins to charge each re-inserted row — that
-- trigger was dropped in 0023 (charging now happens inside
-- fn_create_shared_booking instead). Left unfixed, editing a shared
-- sail would delete the old participants (correctly refunding them,
-- trg_fn_refund_participant_coins still fires on delete), then
-- re-insert fresh rows with coins_charged left at 0 — a free re-save.
-- This RPC mirrors fn_create_shared_booking's charge/S-rule logic for
-- the update path, atomically. Per-partner guest editing isn't wired
-- into EditBookingModal's UI yet (guest_count defaults to 0 for every
-- participant when a shared sail is edited) — flagged as a known scope
-- limit, not silently dropped.
-- =====================================================================

create or replace function public.fn_update_shared_booking(
  p_booking_id integer,
  p_booking_type text,
  p_start timestamptz,
  p_end timestamptz,
  p_notes text,
  p_participants jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
  v_total_shares numeric := 0;
  v_participant jsonb;
  v_user_id uuid;
  v_guest_count int;
  v_share numeric;
  v_p_wd numeric; v_p_wn numeric; v_p_md numeric; v_p_mn numeric;
  current_s int;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש כדי לערוך הזמנה.' using errcode = 'P0001';
  end if;
  if p_booking_type not in ('Shared', 'Cyprus') then
    raise exception 'סוג הזמנה לא תקין לפעולה זו.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההזמנה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.user_id <> v_caller and not public.is_manager() then
    raise exception 'אין לכם הרשאה לערוך הזמנה זו.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_participants) elem
    where (elem ->> 'user_id')::uuid = v_booking.user_id
  ) then
    raise exception 'המזמין חייב להיות בין המשתתפים.' using errcode = 'P0001';
  end if;

  update public.bookings
    set start_time = p_start, end_time = p_end, booking_type = p_booking_type, notes = p_notes, guests_count = 0
    where id = p_booking_id;

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

    if v_p_wd > 0 and public.fn_count_future_type_usage(v_user_id, 'weekend_day', p_booking_id) >= current_s then
      raise exception 'שותף % ניצל את מכסת ההזמנות העתידיות שלו מסוג סופ"ש יום (מקסימום %).', v_user_id, current_s using errcode = 'P0001';
    end if;
    if v_p_wn > 0 and public.fn_count_future_type_usage(v_user_id, 'weekend_night', p_booking_id) >= current_s then
      raise exception 'שותף % ניצל את מכסת ההזמנות העתידיות שלו מסוג סופ"ש לילה (מקסימום %).', v_user_id, current_s using errcode = 'P0001';
    end if;
    if v_p_md > 0 and public.fn_count_future_type_usage(v_user_id, 'midweek_day', p_booking_id) >= current_s then
      raise exception 'שותף % ניצל את מכסת ההזמנות העתידיות שלו מסוג אמצ"ש יום (מקסימום %).', v_user_id, current_s using errcode = 'P0001';
    end if;
    if v_p_mn > 0 and public.fn_count_future_type_usage(v_user_id, 'midweek_night', p_booking_id) >= current_s then
      raise exception 'שותף % ניצל את מכסת ההזמנות העתידיות שלו מסוג אמצ"ש לילה (מקסימום %).', v_user_id, current_s using errcode = 'P0001';
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

revoke all on function public.fn_update_shared_booking(integer, text, timestamptz, timestamptz, text, jsonb) from public;
grant execute on function public.fn_update_shared_booking(integer, text, timestamptz, timestamptz, text, jsonb) to authenticated;
