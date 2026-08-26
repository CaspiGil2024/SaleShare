-- =====================================================================
-- SailShare — Michael's Method: shared-sail RPC (§40/60/80)
-- =====================================================================
-- Shared/Cyprus bookings move from the old two-step client flow
-- (insert bookings, THEN a separate insert into booking_participants)
-- to a single atomic RPC. Two independent reasons this is necessary,
-- not just nicer:
--   1. §40's proportional guest-weighted split needs to know every
--      participant's guest_count at once to compute "this person's
--      share of the total" — a per-row BEFORE INSERT trigger can't
--      reliably see sibling rows from the same multi-row INSERT
--      statement, so this can't correctly live in a trigger the way
--      the old flat 1-coin/hour charge did.
--   2. One function call = one transaction: if ANY participant fails
--      their balance or S-rule check partway through, Postgres rolls
--      back everything already done in this call (the booking row,
--      every participant row, every coin deduction already applied) —
--      no more risk of an orphaned booking with half-attached
--      partners, which the old two-separate-inserts flow could leave
--      behind on a mid-flow failure.
--
-- Also in this migration: the capacity trigger (0012) is rewritten to
-- sum booking_participants.guest_count instead of reading the old flat
-- bookings.guests_count (guests are now attributed per-participant,
-- see 0021); the S-rule helper/trigger is rewritten to count usage
-- combined across Private/Dockside AND Shared/Cyprus (the spec's S cap
-- is per coin TYPE, not per booking kind); and the old flat
-- participant-charge trigger is dropped (the RPC below owns charging
-- for these types now) while the refund triggers are updated to
-- refund per coin type using the stored breakdown.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Capacity: sum guest_count across every participant row instead of
-- the old flat bookings.guests_count (see 0021's guest_count column).
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_enforce_booking_capacity()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_existing_count int;
  v_existing_guests int;
  v_total int;
begin
  select count(*), coalesce(sum(guest_count), 0)
    into v_existing_count, v_existing_guests
    from public.booking_participants
    where booking_id = NEW.booking_id;

  v_total := v_existing_count + 1 + v_existing_guests + coalesce(NEW.guest_count, 0);

  if v_total > 9 then
    raise exception
      'לא ניתן להוסיף שותף נוסף - סך המשתתפים (שותפים ואורחים) לא יכול לעלות על 9. הסירו אורחים או שותפים לפני ההוספה.'
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;


-- ---------------------------------------------------------------------
-- §60/80 combined-usage helper: counts a user's future (non-cancelled,
-- non-Maintenance, non-anchor) usage of ONE coin type, across BOTH
-- their own Private/Dockside bookings AND their Shared/Cyprus
-- participations — the spec's S cap is per coin type, not per booking
-- kind, so these have to be counted together, not in two separate
-- silos.
-- ---------------------------------------------------------------------
create or replace function public.fn_count_future_type_usage(
  p_user_id uuid,
  p_coin_type text,
  p_exclude_booking_id integer default null
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_own_count int := 0;
  v_participant_count int := 0;
begin
  if p_coin_type = 'weekend_day' then
    select count(*) into v_own_count from public.bookings
      where user_id = p_user_id and status <> 'Cancelled' and start_time > now()
        and booking_type <> 'Maintenance' and not is_anchor
        and coins_charged_weekend_day > 0 and id <> coalesce(p_exclude_booking_id, -1);
    select count(*) into v_participant_count from public.booking_participants bp
      join public.bookings b on b.id = bp.booking_id
      where bp.user_id = p_user_id and b.status <> 'Cancelled' and b.start_time > now()
        and bp.coins_charged_weekend_day > 0 and b.id <> coalesce(p_exclude_booking_id, -1);
  elsif p_coin_type = 'weekend_night' then
    select count(*) into v_own_count from public.bookings
      where user_id = p_user_id and status <> 'Cancelled' and start_time > now()
        and booking_type <> 'Maintenance' and not is_anchor
        and coins_charged_weekend_night > 0 and id <> coalesce(p_exclude_booking_id, -1);
    select count(*) into v_participant_count from public.booking_participants bp
      join public.bookings b on b.id = bp.booking_id
      where bp.user_id = p_user_id and b.status <> 'Cancelled' and b.start_time > now()
        and bp.coins_charged_weekend_night > 0 and b.id <> coalesce(p_exclude_booking_id, -1);
  elsif p_coin_type = 'midweek_day' then
    select count(*) into v_own_count from public.bookings
      where user_id = p_user_id and status <> 'Cancelled' and start_time > now()
        and booking_type <> 'Maintenance' and not is_anchor
        and coins_charged_midweek_day > 0 and id <> coalesce(p_exclude_booking_id, -1);
    select count(*) into v_participant_count from public.booking_participants bp
      join public.bookings b on b.id = bp.booking_id
      where bp.user_id = p_user_id and b.status <> 'Cancelled' and b.start_time > now()
        and bp.coins_charged_midweek_day > 0 and b.id <> coalesce(p_exclude_booking_id, -1);
  else
    select count(*) into v_own_count from public.bookings
      where user_id = p_user_id and status <> 'Cancelled' and start_time > now()
        and booking_type <> 'Maintenance' and not is_anchor
        and coins_charged_midweek_night > 0 and id <> coalesce(p_exclude_booking_id, -1);
    select count(*) into v_participant_count from public.booking_participants bp
      join public.bookings b on b.id = bp.booking_id
      where bp.user_id = p_user_id and b.status <> 'Cancelled' and b.start_time > now()
        and bp.coins_charged_midweek_night > 0 and b.id <> coalesce(p_exclude_booking_id, -1);
  end if;

  return coalesce(v_own_count, 0) + coalesce(v_participant_count, 0);
end;
$$;

revoke all on function public.fn_count_future_type_usage(uuid, text, integer) from public;
grant execute on function public.fn_count_future_type_usage(uuid, text, integer) to authenticated;


-- ---------------------------------------------------------------------
-- enforce_s_rule, rewritten to use the combined-usage helper above
-- instead of only counting bookings.coins_charged_* (0022's version).
-- Same live function name, so the existing trg_enforce_s_rule trigger
-- keeps pointing at it automatically.
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

  select s_multiplier into current_s from public.periods where is_current = true limit 1;
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


-- ---------------------------------------------------------------------
-- Participant refunds, per coin type (delete a participant row, or
-- cancel the whole booking).
-- ---------------------------------------------------------------------
drop trigger if exists trg_charge_participant_coins on public.booking_participants;

create or replace function public.trg_fn_refund_participant_coins()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if OLD.coins_charged_weekend_day > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'weekend_day', OLD.coins_charged_weekend_day, 'participant_refund', OLD.booking_id); end if;
  if OLD.coins_charged_weekend_night > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'weekend_night', OLD.coins_charged_weekend_night, 'participant_refund', OLD.booking_id); end if;
  if OLD.coins_charged_midweek_day > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'midweek_day', OLD.coins_charged_midweek_day, 'participant_refund', OLD.booking_id); end if;
  if OLD.coins_charged_midweek_night > 0 then perform public.fn_apply_coin_delta(OLD.user_id, 'midweek_night', OLD.coins_charged_midweek_night, 'participant_refund', OLD.booking_id); end if;
  return OLD;
end;
$$;

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
      select user_id, coins_charged_weekend_day, coins_charged_weekend_night, coins_charged_midweek_day, coins_charged_midweek_night
      from public.booking_participants where booking_id = NEW.id
    loop
      if v_participant.coins_charged_weekend_day > 0 then perform public.fn_apply_coin_delta(v_participant.user_id, 'weekend_day', v_participant.coins_charged_weekend_day, 'participant_refund', NEW.id); end if;
      if v_participant.coins_charged_weekend_night > 0 then perform public.fn_apply_coin_delta(v_participant.user_id, 'weekend_night', v_participant.coins_charged_weekend_night, 'participant_refund', NEW.id); end if;
      if v_participant.coins_charged_midweek_day > 0 then perform public.fn_apply_coin_delta(v_participant.user_id, 'midweek_day', v_participant.coins_charged_midweek_day, 'participant_refund', NEW.id); end if;
      if v_participant.coins_charged_midweek_night > 0 then perform public.fn_apply_coin_delta(v_participant.user_id, 'midweek_night', v_participant.coins_charged_midweek_night, 'participant_refund', NEW.id); end if;
    end loop;
    update public.booking_participants set
      coins_charged_weekend_day = 0, coins_charged_weekend_night = 0,
      coins_charged_midweek_day = 0, coins_charged_midweek_night = 0,
      coins_charged = 0
    where booking_id = NEW.id;
  end if;
  return NEW;
end;
$$;


-- ---------------------------------------------------------------------
-- Main entry point: create a Shared/Cyprus booking + every participant
-- + the proportional per-type charge, atomically.
-- p_participants: jsonb array of {"user_id": "...", "guest_count": N},
-- MUST include the organizer (auth.uid()) as one entry — matches the
-- existing client convention of the organizer being their own
-- participant row too.
-- ---------------------------------------------------------------------
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

  select s_multiplier into current_s from public.periods where is_current = true limit 1;
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

revoke all on function public.fn_create_shared_booking(text, timestamptz, timestamptz, text, jsonb) from public;
grant execute on function public.fn_create_shared_booking(text, timestamptz, timestamptz, text, jsonb) to authenticated;
