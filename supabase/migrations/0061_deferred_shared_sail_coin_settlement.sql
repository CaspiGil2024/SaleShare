-- =====================================================================
-- SailShare — shared-sail coins: charge each joiner the FULL price
-- independently as they join, defer the true guest-weighted split to a
-- one-time settlement at sail time, instead of re-splitting everyone's
-- cost on every join/leave/guest-count change
-- =====================================================================
-- Reported behavior (worked example, confirmed against exact expected
-- balances): Michael creates a Shared sail (3 midweek-day hours, alone)
-- and pays the full 3 coins. Uri then joins with 3 guests — under the
-- OLD fn_recompute_shared_booking_participants-on-every-change design
-- (0044/0048/0051), that immediately REFUNDS Michael's charge and
-- RECOMPUTES it as a smaller guest-weighted share (since the sail now
-- has 2 people to split across), moving Michael's balance the moment
-- Uri joins — even though Michael did nothing. The expected behavior
-- is that Michael's balance does NOT move when Uri joins (or when Uri
-- later adds/removes guests) — it only ever changes at genuine sail
-- time, when the TRUE final proportional split gets applied once.
--
-- New model:
--   1. PRE-SETTLEMENT (booking exists, hasn't reached its start_time
--      settlement yet): every participant is charged the sail's FULL
--      classifyHours cost independently the moment they join —
--      exactly as if they were sailing alone — regardless of their own
--      or anyone else's guest_count, and regardless of who else is on
--      the sail. Nobody else's stored charge is touched by a join, a
--      leave, or a guest-count edit. Guest count itself becomes purely
--      informational pre-settlement (still capacity-capped at 9, just
--      coin-neutral) — see fn_update_my_shared_participation_guests
--      and fn_update_shared_booking below, both now plain UPDATEs with
--      no coin_delta at all.
--   2. SETTLEMENT (start_time has passed): fn_settle_shared_booking
--      runs exactly once per booking — refunds every participant's
--      provisional full charge and recharges the TRUE guest-weighted
--      proportional split (each participant's share = (1+guest_count)
--      / sum of that across everyone still on the sail at that moment)
--      by simply reusing fn_recompute_shared_booking_participants
--      (0051) UNCHANGED — that function already computes exactly this
--      split correctly, it was just being invoked far too often. A new
--      bookings.coins_settled flag makes this idempotent; fn_settle_
--      due_shared_bookings() sweeps every booking whose time has come,
--      called opportunistically from CalendarPage.jsx (same lazy-
--      maintenance pattern as fn_auto_cancel_solo_cyprus_sailings/
--      fn_auto_convert_solo_shared_sailings_to_private, called right
--      after both of those so a solo Cyprus sailing is already
--      Cancelled — and thus skipped here — by the time this runs).
--   3. LEAVING pre-settlement now means exactly what it always should
--      have: delete just your own row, refund exactly what YOU were
--      charged (trg_fn_refund_participant_coins, unchanged, fires
--      per-row on DELETE) — nobody else's charge moves. Joining/admin-
--      add mirror this: insert one row, charge that one participant,
--      touch nothing else. Both are now single, simple operations
--      instead of routing through the "refund everyone, resplit
--      everyone" helper.
--   4. ORGANIZER HANDOVER (fn_organizer_leave_shared_booking, 0060) is
--      unaffected by this migration — it never applied a coin_delta to
--      begin with, so it's already consistent with "nothing moves
--      except at settlement."
--   5. Editing the sail's date/time/type (fn_update_shared_booking, the
--      organizer's own edit form) changes the cost basis itself, so
--      every current participant's provisional full charge is stale —
--      fn_reprice_all_participants_full refunds and recharges everyone
--      at the NEW full price (still unsplit; the true split still only
--      happens at settlement) whenever start_time/end_time/booking_type
--      actually changes. A plain guest-count-only edit (the far more
--      common case) touches no coins at all.
--
-- New capacity message: raising a participant's OWN guest_count (self-
-- service or the organizer's own field) past the 9-person cap now
-- raises a guest-specific message ('עברת את כושר השיט - לא ניתן
-- להוסיף אורחים') instead of the generic "can't add another partner"
-- message that trg_fn_enforce_booking_capacity (0023) raises for an
-- actual new participant joining — that trigger is untouched and still
-- covers fn_join_shared_booking/fn_admin_add_shared_participant, whose
-- capacity violation really is "another partner", not "another guest".
-- =====================================================================


-- ---------------------------------------------------------------------
-- bookings.coins_settled — false for every Shared/Cyprus sail created
-- from now on (provisional charges only); backfilled true for every
-- Shared/Cyprus sailing whose start_time is already in the past as of
-- this migration, so the new sweep doesn't try to "settle" (churn
-- refund+recharge transactions for) years of historical data that was
-- already fully priced correctly under the old always-immediate model.
-- ---------------------------------------------------------------------
alter table public.bookings add column if not exists coins_settled boolean not null default false;

update public.bookings
  set coins_settled = true
  where booking_type in ('Shared', 'Cyprus') and start_time <= now();


-- ---------------------------------------------------------------------
-- Charges ONE participant the sail's current full (unsplit)
-- classifyHours cost — used at creation, on join, on admin-add, and by
-- fn_reprice_all_participants_full below. Quota-checked (skipped for a
-- booking whose start_time has already passed, matching 0051's
-- v_check_quota precedent) but NOT guest-weighted: full price
-- regardless of guest_count, by design (see header).
-- ---------------------------------------------------------------------
create or replace function public.fn_charge_new_participant_full(
  p_booking_id integer,
  p_user_id uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking record;
  v_wd numeric; v_wn numeric; v_md numeric; v_mn numeric;
  current_s int;
  v_check_quota boolean;
  v_is_self boolean;
  v_user_name text;
begin
  select * into v_booking from public.bookings where id = p_booking_id;

  select weekend_day, weekend_night, midweek_day, midweek_night
    into v_wd, v_wn, v_md, v_mn
    from public.fn_classify_hours(v_booking.start_time, v_booking.end_time);

  v_check_quota := v_booking.start_time > now();

  select s_multiplier into current_s from public.system_settings where id = true;
  if current_s is null then current_s := 1; end if;

  v_is_self := (p_user_id = auth.uid());
  if not v_is_self then
    select coalesce(full_name, email) into v_user_name from public.users where id = p_user_id;
    v_user_name := coalesce(v_user_name, 'שותף');
  end if;

  if v_check_quota and v_wd > 0 and public.fn_count_future_type_usage(p_user_id, 'weekend_day', p_booking_id) >= current_s then
    if v_is_self then
      raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג סופ"ש יום (מקסימום %).', current_s using errcode = 'P0001';
    else
      raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג סופ"ש יום (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
    end if;
  end if;
  if v_check_quota and v_wn > 0 and public.fn_count_future_type_usage(p_user_id, 'weekend_night', p_booking_id) >= current_s then
    if v_is_self then
      raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג סופ"ש לילה (מקסימום %).', current_s using errcode = 'P0001';
    else
      raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג סופ"ש לילה (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
    end if;
  end if;
  if v_check_quota and v_md > 0 and public.fn_count_future_type_usage(p_user_id, 'midweek_day', p_booking_id) >= current_s then
    if v_is_self then
      raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג אמצ"ש יום (מקסימום %).', current_s using errcode = 'P0001';
    else
      raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג אמצ"ש יום (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
    end if;
  end if;
  if v_check_quota and v_mn > 0 and public.fn_count_future_type_usage(p_user_id, 'midweek_night', p_booking_id) >= current_s then
    if v_is_self then
      raise exception 'ניצלת את מכסת ההזמנות העתידיות שלך מסוג אמצ"ש לילה (מקסימום %).', current_s using errcode = 'P0001';
    else
      raise exception 'שותף % ניצל/ה את מכסת ההזמנות העתידיות שלו/ה מסוג אמצ"ש לילה (מקסימום %).', v_user_name, current_s using errcode = 'P0001';
    end if;
  end if;

  if v_wd > 0 then perform public.fn_apply_coin_delta(p_user_id, 'weekend_day', -v_wd, 'participant_charge', p_booking_id); end if;
  if v_wn > 0 then perform public.fn_apply_coin_delta(p_user_id, 'weekend_night', -v_wn, 'participant_charge', p_booking_id); end if;
  if v_md > 0 then perform public.fn_apply_coin_delta(p_user_id, 'midweek_day', -v_md, 'participant_charge', p_booking_id); end if;
  if v_mn > 0 then perform public.fn_apply_coin_delta(p_user_id, 'midweek_night', -v_mn, 'participant_charge', p_booking_id); end if;

  update public.booking_participants set
    coins_charged_weekend_day = v_wd,
    coins_charged_weekend_night = v_wn,
    coins_charged_midweek_day = v_md,
    coins_charged_midweek_night = v_mn,
    coins_charged = v_wd + v_wn + v_md + v_mn
  where booking_id = p_booking_id and user_id = p_user_id;
end;
$$;

revoke all on function public.fn_charge_new_participant_full(integer, uuid) from public;


-- ---------------------------------------------------------------------
-- Re-prices EVERY current participant at the sail's (new) full price —
-- used only when the cost basis itself changes (start/end/type edited
-- by the organizer). Refunds each participant's currently stored
-- charge, then reuses fn_charge_new_participant_full per row so the
-- fresh-charge logic (quota checks included) isn't duplicated.
-- ---------------------------------------------------------------------
create or replace function public.fn_reprice_all_participants_full(p_booking_id integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_participant record;
begin
  for v_participant in select * from public.booking_participants where booking_id = p_booking_id
  loop
    if v_participant.coins_charged_weekend_day > 0 then perform public.fn_apply_coin_delta(v_participant.user_id, 'weekend_day', v_participant.coins_charged_weekend_day, 'participant_refund', p_booking_id); end if;
    if v_participant.coins_charged_weekend_night > 0 then perform public.fn_apply_coin_delta(v_participant.user_id, 'weekend_night', v_participant.coins_charged_weekend_night, 'participant_refund', p_booking_id); end if;
    if v_participant.coins_charged_midweek_day > 0 then perform public.fn_apply_coin_delta(v_participant.user_id, 'midweek_day', v_participant.coins_charged_midweek_day, 'participant_refund', p_booking_id); end if;
    if v_participant.coins_charged_midweek_night > 0 then perform public.fn_apply_coin_delta(v_participant.user_id, 'midweek_night', v_participant.coins_charged_midweek_night, 'participant_refund', p_booking_id); end if;

    perform public.fn_charge_new_participant_full(p_booking_id, v_participant.user_id);
  end loop;
end;
$$;

revoke all on function public.fn_reprice_all_participants_full(integer) from public;


-- ---------------------------------------------------------------------
-- fn_create_shared_booking — insert the booking + every starting
-- participant row (in practice always just the organizer — see
-- coinCalculator.js), then charge each their own full price.
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
  v_participant jsonb;
  v_user_id uuid;
  v_guest_count int;
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
    v_guest_count := greatest(coalesce((v_participant ->> 'guest_count')::int, 0), 0);
    insert into public.booking_participants (booking_id, user_id, guest_count)
    values (v_booking_id, v_user_id, v_guest_count);
  end loop;

  for v_participant in select * from jsonb_array_elements(p_participants)
  loop
    perform public.fn_charge_new_participant_full(v_booking_id, (v_participant ->> 'user_id')::uuid);
  end loop;

  return v_booking_id;
end;
$$;

revoke all on function public.fn_create_shared_booking(text, timestamptz, timestamptz, text, jsonb) from public;
grant execute on function public.fn_create_shared_booking(text, timestamptz, timestamptz, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- fn_update_shared_booking — organizer/admin edits date/time/notes/
-- booking_type/guest counts. Membership (WHO is on the sail) can no
-- longer change through this RPC — that's what join/leave/admin-add/
-- admin-remove are for; this now explicitly rejects a participant-set
-- mismatch rather than silently mishandling it. Guest-count changes
-- are coin-neutral (just capacity-checked); a real start/end/type
-- change reprices everyone at the new full price.
-- ---------------------------------------------------------------------
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
  v_current_ids uuid[];
  v_new_ids uuid[];
  v_prospective_total int;
  v_time_or_type_changed boolean;
  v_participant jsonb;
  v_user_id uuid;
  v_guest_count int;
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

  select coalesce(array_agg(user_id order by user_id), array[]::uuid[]) into v_current_ids
    from public.booking_participants where booking_id = p_booking_id;
  select coalesce(array_agg((elem ->> 'user_id')::uuid order by (elem ->> 'user_id')::uuid), array[]::uuid[]) into v_new_ids
    from jsonb_array_elements(p_participants) elem;
  if v_current_ids is distinct from v_new_ids then
    raise exception 'לא ניתן לשנות מי משתתף בהפלגה ממסך זה — יש להשתמש בהצטרפות/עזיבה/הוספת שותף.' using errcode = 'P0001';
  end if;

  select sum(1 + greatest(coalesce((elem ->> 'guest_count')::int, 0), 0)) into v_prospective_total
    from jsonb_array_elements(p_participants) elem;
  if v_prospective_total > 9 then
    raise exception 'עברת את כושר השיט - לא ניתן להוסיף אורחים' using errcode = 'P0001';
  end if;

  v_time_or_type_changed := (
    v_booking.start_time <> p_start or v_booking.end_time <> p_end or v_booking.booking_type <> p_booking_type
  );

  for v_participant in select * from jsonb_array_elements(p_participants)
  loop
    v_user_id := (v_participant ->> 'user_id')::uuid;
    v_guest_count := greatest(coalesce((v_participant ->> 'guest_count')::int, 0), 0);
    update public.booking_participants set guest_count = v_guest_count
      where booking_id = p_booking_id and user_id = v_user_id;
  end loop;

  update public.bookings
    set start_time = p_start, end_time = p_end, booking_type = p_booking_type, notes = p_notes, guests_count = 0
    where id = p_booking_id;

  if v_time_or_type_changed then
    perform public.fn_reprice_all_participants_full(p_booking_id);
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- fn_join_shared_booking — self-service join: insert one row (existing
-- trg_fn_enforce_booking_capacity still fires, unchanged message/
-- behavior), then charge just the joiner their own full price.
-- ---------------------------------------------------------------------
create or replace function public.fn_join_shared_booking(
  p_booking_id integer,
  p_guest_count integer default 0
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש כדי להצטרף להפלגה.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'ניתן להצטרף רק להפלגות שותפים.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'לא ניתן להצטרף להפלגה שבוטלה.' using errcode = 'P0001';
  end if;
  if v_booking.start_time <= now() then
    raise exception 'לא ניתן להצטרף להפלגה שכבר החלה או הסתיימה.' using errcode = 'P0001';
  end if;
  if v_booking.user_id = v_caller then
    raise exception 'אתם המארגנים של הפלגה זו.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = v_caller) then
    raise exception 'אתם כבר משתתפים בהפלגה זו.' using errcode = 'P0001';
  end if;

  insert into public.booking_participants (booking_id, user_id, guest_count)
  values (p_booking_id, v_caller, greatest(coalesce(p_guest_count, 0), 0));

  perform public.fn_charge_new_participant_full(p_booking_id, v_caller);
end;
$$;

revoke all on function public.fn_join_shared_booking(integer, integer) from public;
grant execute on function public.fn_join_shared_booking(integer, integer) to authenticated;


-- ---------------------------------------------------------------------
-- fn_leave_shared_booking — self-service leave: delete just the
-- caller's own row. trg_fn_refund_participant_coins (unchanged, fires
-- per-row on DELETE) refunds exactly what THEY were charged; nobody
-- else's row or charge is touched. Organizer still can't leave this
-- way — see fn_organizer_leave_shared_booking (0060).
-- ---------------------------------------------------------------------
create or replace function public.fn_leave_shared_booking(p_booking_id integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש כדי לעזוב הפלגה.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'ניתן לעזוב רק הפלגות שותפים.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'הפלגה זו כבר בוטלה.' using errcode = 'P0001';
  end if;
  if v_booking.user_id = v_caller then
    raise exception 'המארגן/ת לא יכול/ה לעזוב את ההפלגה כך — ניתן לעזוב מתוך מסך העריכה (התפקיד יועבר לשותף אחר).' using errcode = 'P0001';
  end if;
  if v_booking.start_time <= now() then
    raise exception 'לא ניתן לעזוב הפלגה שכבר החלה או הסתיימה.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = v_caller) then
    raise exception 'אינכם משתתפים בהפלגה זו.' using errcode = 'P0001';
  end if;

  delete from public.booking_participants where booking_id = p_booking_id and user_id = v_caller;
end;
$$;

revoke all on function public.fn_leave_shared_booking(integer) from public;
grant execute on function public.fn_leave_shared_booking(integer) to authenticated;


-- ---------------------------------------------------------------------
-- fn_update_my_shared_participation_guests — self-service guest-count
-- edit: coin-neutral pre-settlement, capacity-checked with the new
-- guest-specific message.
-- ---------------------------------------------------------------------
create or replace function public.fn_update_my_shared_participation_guests(
  p_booking_id integer,
  p_guest_count integer
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
  v_guest_count int := greatest(coalesce(p_guest_count, 0), 0);
  v_prospective_total int;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש כדי לעדכן את מספר האורחים.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'ניתן לעדכן מספר אורחים רק בהפלגות שותפים.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'הפלגה זו כבר בוטלה.' using errcode = 'P0001';
  end if;
  if now() > v_booking.start_time + interval '7 days' then
    raise exception 'עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר ולא ניתן לעדכן אורחים יותר.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = v_caller) then
    raise exception 'אינכם משתתפים בהפלגה זו.' using errcode = 'P0001';
  end if;

  select coalesce(sum(case when user_id = v_caller then 1 + v_guest_count else 1 + guest_count end), 0)
    into v_prospective_total
    from public.booking_participants where booking_id = p_booking_id;
  if v_prospective_total > 9 then
    raise exception 'עברת את כושר השיט - לא ניתן להוסיף אורחים' using errcode = 'P0001';
  end if;

  update public.booking_participants set guest_count = v_guest_count
    where booking_id = p_booking_id and user_id = v_caller;
end;
$$;

revoke all on function public.fn_update_my_shared_participation_guests(integer, integer) from public;
grant execute on function public.fn_update_my_shared_participation_guests(integer, integer) to authenticated;


-- ---------------------------------------------------------------------
-- fn_admin_add_shared_participant — organizer/admin adds a SPECIFIC
-- partner: insert + charge that one row full price, same as join.
-- ---------------------------------------------------------------------
create or replace function public.fn_admin_add_shared_participant(
  p_booking_id integer,
  p_user_id uuid,
  p_guest_count integer default 0
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש כדי לנהל משתתפים.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'ניתן להוסיף משתתפים רק להפלגות שותפים.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'לא ניתן להוסיף משתתף להפלגה שבוטלה.' using errcode = 'P0001';
  end if;
  if v_booking.user_id <> v_caller and not public.is_admin() then
    raise exception 'רק המארגן/ת או מנהל יכולים להוסיף משתתפים להפלגה זו.' using errcode = 'P0001';
  end if;
  if now() > v_booking.start_time + interval '7 days' then
    raise exception 'עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר ולא ניתן להוסיף משתתפים יותר.' using errcode = 'P0001';
  end if;
  if p_user_id = v_booking.user_id then
    raise exception 'המארגן/ת כבר משתתפ/ת בהפלגה.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = p_user_id) then
    raise exception 'שותף זה כבר משתתף בהפלגה.' using errcode = 'P0001';
  end if;

  insert into public.booking_participants (booking_id, user_id, guest_count)
  values (p_booking_id, p_user_id, greatest(coalesce(p_guest_count, 0), 0));

  perform public.fn_charge_new_participant_full(p_booking_id, p_user_id);
end;
$$;

revoke all on function public.fn_admin_add_shared_participant(integer, uuid, integer) from public;
grant execute on function public.fn_admin_add_shared_participant(integer, uuid, integer) to authenticated;


-- ---------------------------------------------------------------------
-- fn_admin_remove_shared_participant — organizer/admin removes a
-- SPECIFIC partner: plain delete, same as leave.
-- ---------------------------------------------------------------------
create or replace function public.fn_admin_remove_shared_participant(
  p_booking_id integer,
  p_user_id uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש כדי לנהל משתתפים.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if v_booking is null then
    raise exception 'ההפלגה לא נמצאה.' using errcode = 'P0001';
  end if;
  if v_booking.booking_type not in ('Shared', 'Cyprus') then
    raise exception 'ניתן להסיר משתתפים רק מהפלגות שותפים.' using errcode = 'P0001';
  end if;
  if v_booking.status = 'Cancelled' then
    raise exception 'הפלגה זו כבר בוטלה.' using errcode = 'P0001';
  end if;
  if v_booking.user_id <> v_caller and not public.is_admin() then
    raise exception 'רק המארגן/ת או מנהל יכולים להסיר משתתפים מהפלגה זו.' using errcode = 'P0001';
  end if;
  if p_user_id = v_booking.user_id then
    raise exception 'לא ניתן להסיר את המארגן/ת — ניתן לבטל את ההפלגה מתוך מסך העריכה.' using errcode = 'P0001';
  end if;
  if now() > v_booking.start_time + interval '7 days' then
    raise exception 'עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר ולא ניתן להסיר משתתפים יותר.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = p_user_id) then
    raise exception 'שותף זה אינו משתתף בהפלגה.' using errcode = 'P0001';
  end if;

  delete from public.booking_participants where booking_id = p_booking_id and user_id = p_user_id;
end;
$$;

revoke all on function public.fn_admin_remove_shared_participant(integer, uuid) from public;
grant execute on function public.fn_admin_remove_shared_participant(integer, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Settlement: one-time true guest-weighted split, once start_time has
-- passed. Reuses fn_recompute_shared_booking_participants (0051)
-- UNCHANGED — it already refunds everyone's stored charge and
-- recharges the correct proportional split; it was simply being
-- called far too often before this migration.
-- ---------------------------------------------------------------------
create or replace function public.fn_settle_shared_booking(p_booking_id integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking record;
  v_participants jsonb;
begin
  select * into v_booking from public.bookings
    where id = p_booking_id
      and booking_type in ('Shared', 'Cyprus')
      and status <> 'Cancelled'
      and coins_settled = false
      and start_time <= now()
    for update;
  if not found then
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'guest_count', guest_count)), '[]'::jsonb)
    into v_participants
    from public.booking_participants where booking_id = p_booking_id;

  perform public.fn_recompute_shared_booking_participants(p_booking_id, v_participants);

  update public.bookings set coins_settled = true where id = p_booking_id;
end;
$$;

revoke all on function public.fn_settle_shared_booking(integer) from public;

create or replace function public.fn_settle_due_shared_bookings()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking record;
  v_count integer := 0;
begin
  for v_booking in
    select id from public.bookings
    where booking_type in ('Shared', 'Cyprus')
      and status <> 'Cancelled'
      and coins_settled = false
      and start_time <= now()
  loop
    perform public.fn_settle_shared_booking(v_booking.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.fn_settle_due_shared_bookings() from public;
grant execute on function public.fn_settle_due_shared_bookings() to authenticated;
