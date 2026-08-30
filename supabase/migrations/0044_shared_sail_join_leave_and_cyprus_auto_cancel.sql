-- =====================================================================
-- SailShare — join/leave an existing Shared/Cyprus sailing, Cyprus
-- solo auto-cancel, and two correctness fixes surfaced by testing
-- =====================================================================
-- FIX 1 (regression): 0040 rewrote fn_create_shared_booking/fn_update_
-- shared_booking to fix the guest-weighting formula, but the rewrite
-- was based on the PRE-0038 function bodies — it accidentally
-- reintroduced the raw-uuid-in-error-message bug 0038 had already
-- fixed ("שותף <uuid> ניצל..."). Restored here, plus a further
-- refinement: when the participant being checked is the caller
-- themselves (always true for solo creation, and true for the joiner
-- inside fn_join_shared_booking below), the message now reads in
-- second person ("ניצלת את...", matching enforce_s_rule's own private-
-- booking phrasing) instead of naming them in the third person as if
-- discussing someone else's quota — that mismatch is what read as a
-- confusing "partner limit" error during solo creation.
--
-- FIX 2 (this migration's main purpose): factor the participant
-- delete+reinsert+recompute logic every one of these RPCs needs into
-- one shared helper, fn_recompute_shared_booking_participants — not
-- directly callable by clients (no grant to authenticated), only from
-- other SECURITY DEFINER functions in this file. This lets
-- fn_join_shared_booking/fn_leave_shared_booking reuse the exact same
-- atomic refund-everyone/recompute-equal-share/recharge-everyone logic
-- fn_create_shared_booking/fn_update_shared_booking already had,
-- instead of a third copy of it.
--
-- NEW: fn_join_shared_booking / fn_leave_shared_booking — self-service
-- only (a partner joins/removes THEMSELVES; the organizer can't be
-- added or removed this way — they're fixed by fn_create_shared_
-- booking, and leaving their own sail means cancelling it via the
-- existing Cancel flow, not this). Both block once start_time has
-- passed (same "strictly no changes to a sailing that already
-- happened" principle as 0041's cancellation block) and both end by
-- calling the shared recompute helper, so cost splits equally among
-- whoever's left, guests still cost nothing, and a sail that's back
-- down to just the organizer is — automatically, as a consequence of
-- the same equal-split formula, no special case needed — charged at
-- 100% (private-equivalent).
--
-- NEW: Cyprus-only rule — a Cyprus sailing that reaches its own
-- start_time with no OTHER partner ever having joined (organizer-only)
-- is auto-cancelled rather than falling back to private-equivalent
-- pricing (unlike Shared, which keeps that fallback). fn_auto_cancel_
-- solo_cyprus_sailings() does the cancelling — 0041's "no cancelling a
-- past sailing" trigger would otherwise block exactly this, so it gets
-- a narrow, code-only bypass (a transaction-local GUC only this
-- function ever sets — no client-reachable path can set it, since
-- nothing grants a raw SQL/config-setting RPC to authenticated).
-- Granted to `authenticated` (harmless — it only ever cancels bookings
-- that objectively meet the rule, same trust level as the existing
-- ensure_current_period() housekeeping RPC) and called opportunistically
-- from CalendarPage.jsx on every calendar load, the same lazy-
-- maintenance pattern this project already uses instead of a cron
-- dependency. A commented-out pg_cron schedule is included at the
-- bottom for projects where that extension is available, as a belt-
-- and-suspenders option — not required for correctness.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared recompute helper
-- ---------------------------------------------------------------------
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

  select s_multiplier into current_s from public.periods where is_current = true limit 1;
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

revoke all on function public.fn_recompute_shared_booking_participants(integer, jsonb) from public;


-- ---------------------------------------------------------------------
-- fn_create_shared_booking / fn_update_shared_booking — now thin
-- wrappers around the shared helper. Behavior unchanged from 0040
-- except for the UUID/phrasing fix (which lives in the helper).
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

  perform public.fn_recompute_shared_booking_participants(v_booking_id, p_participants);

  return v_booking_id;
end;
$$;

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

  update public.bookings
    set start_time = p_start, end_time = p_end, booking_type = p_booking_type, notes = p_notes, guests_count = 0
    where id = p_booking_id;

  perform public.fn_recompute_shared_booking_participants(p_booking_id, p_participants);
end;
$$;


-- ---------------------------------------------------------------------
-- fn_join_shared_booking — self-service: a partner adds THEMSELVES
-- (with their own guest count, which never adds cost) to an existing
-- Shared/Cyprus sailing they didn't organize.
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
  v_participants jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'guest_count', guest_count)), '[]'::jsonb)
    into v_participants
    from public.booking_participants where booking_id = p_booking_id;

  v_participants := v_participants
    || jsonb_build_array(jsonb_build_object('user_id', v_caller, 'guest_count', greatest(coalesce(p_guest_count, 0), 0)));

  perform public.fn_recompute_shared_booking_participants(p_booking_id, v_participants);
end;
$$;

revoke all on function public.fn_join_shared_booking(integer, integer) from public;
grant execute on function public.fn_join_shared_booking(integer, integer) to authenticated;


-- ---------------------------------------------------------------------
-- fn_leave_shared_booking — self-service: a joined (non-organizer)
-- partner removes themselves. The organizer can't leave their own
-- sail this way — cancel it instead (existing Cancel flow).
-- ---------------------------------------------------------------------
create or replace function public.fn_leave_shared_booking(p_booking_id integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_booking record;
  v_participants jsonb;
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
    raise exception 'המארגן/ת לא יכול/ה לעזוב את ההפלגה שלו/ה — ניתן לבטל אותה מתוך מסך העריכה.' using errcode = 'P0001';
  end if;
  if v_booking.start_time <= now() then
    raise exception 'לא ניתן לעזוב הפלגה שכבר החלה או הסתיימה.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.booking_participants where booking_id = p_booking_id and user_id = v_caller) then
    raise exception 'אינכם משתתפים בהפלגה זו.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'guest_count', guest_count)), '[]'::jsonb)
    into v_participants
    from public.booking_participants where booking_id = p_booking_id and user_id <> v_caller;

  perform public.fn_recompute_shared_booking_participants(p_booking_id, v_participants);
end;
$$;

revoke all on function public.fn_leave_shared_booking(integer) from public;
grant execute on function public.fn_leave_shared_booking(integer) to authenticated;


-- ---------------------------------------------------------------------
-- Cyprus-only: auto-cancel once start_time passes with no other
-- partner ever having joined (organizer-only — at most 1 participant
-- row, itself the organizer's). Narrow bypass of 0041's past-
-- cancellation block via a transaction-local GUC only this function
-- ever sets.
-- ---------------------------------------------------------------------
create or replace function public.trg_fn_block_past_cancellation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if OLD.status <> 'Cancelled' and NEW.status = 'Cancelled' and OLD.start_time <= now()
     and coalesce(current_setting('sailshare.auto_cancel', true), 'false') <> 'true' then
    raise exception 'לא ניתן לבטל הפלגה שכבר החלה או הסתיימה.' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

create or replace function public.fn_auto_cancel_solo_cyprus_sailings()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_booking record;
  v_count integer := 0;
begin
  for v_booking in
    select b.id
    from public.bookings b
    where b.booking_type = 'Cyprus'
      and b.status = 'Confirmed'
      and b.start_time <= now()
      and (select count(*) from public.booking_participants bp where bp.booking_id = b.id) <= 1
  loop
    perform set_config('sailshare.auto_cancel', 'true', true);
    update public.bookings set status = 'Cancelled' where id = v_booking.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.fn_auto_cancel_solo_cyprus_sailings() from public;
grant execute on function public.fn_auto_cancel_solo_cyprus_sailings() to authenticated;

-- Optional, if pg_cron is enabled on this project (Database ->
-- Extensions in the Supabase dashboard) — runs the sweep independently
-- of app traffic. Not required: CalendarPage.jsx calls the function
-- above opportunistically on every load either way.
--
-- create extension if not exists pg_cron;
-- select cron.schedule(
--   'auto-cancel-solo-cyprus-sailings',
--   '*/15 * * * *',
--   $$select public.fn_auto_cancel_solo_cyprus_sailings();$$
-- );
