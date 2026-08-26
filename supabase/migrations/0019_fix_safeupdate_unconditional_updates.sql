-- =====================================================================
-- SailShare — fix: safeupdate extension rejects unconditional UPDATEs
-- =====================================================================
-- Live error confirmed via browser console: code 21000, "UPDATE
-- requires a WHERE clause" — the signature of Postgres's safeupdate
-- extension, apparently enforced on this project for the
-- authenticated-role connection PostgREST/RPC calls use (not on the
-- postgres role the SQL Editor runs as — which is why 0016's identical
-- pattern executed fine there, but this one, called via
-- supabase.rpc('ensure_current_quarter_period') from the app, did not).
--
-- ensure_current_quarter_period() (0014) has one intentionally
-- unconditional UPDATE — flipping is_current on/off across every row
-- of periods in one statement:
--
--   update public.periods set is_current = (id = v_period_id);
--
-- That's not a bug, just a statement safeupdate refuses to run without
-- an explicit WHERE. Adding `where true` preserves the exact original
-- behavior (still touches every row) while satisfying the check. This
-- function is called on essentially every booking, Dashboard load, and
-- CoinsPage load (directly, and via fn_apply_coin_delta), which is why
-- the failure was so immediate and total.
-- =====================================================================

create or replace function public.ensure_current_quarter_period()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_quarter_start date := date_trunc('quarter', now())::date;
  v_quarter_end   date := (date_trunc('quarter', now()) + interval '3 months')::date;
  v_period_id     integer;
  v_prev_s        integer;
begin
  select id into v_period_id
  from public.periods
  where start_date = v_quarter_start
  limit 1;

  if v_period_id is not null then
    -- Make sure it's the one marked current (handles a quarter
    -- rollover mid-transaction cleanly). where true: intentionally
    -- unconditional (see migration header) — required explicitly to
    -- satisfy the safeupdate extension.
    update public.periods set is_current = (id = v_period_id) where true;
    return v_period_id;
  end if;

  -- First touch of a new quarter: carry forward the previous period's
  -- s_multiplier (S-Rule's own setting) rather than silently resetting
  -- it to some default.
  select s_multiplier into v_prev_s from public.periods where is_current = true limit 1;

  update public.periods set is_current = false where is_current = true;

  insert into public.periods (start_date, end_date, s_multiplier, is_current)
  values (v_quarter_start, v_quarter_end, coalesce(v_prev_s, 1), true)
  returning id into v_period_id;

  -- Backfill every partner's wallet for the new quarter with the
  -- 400-coin allowance, and log one 'quarterly_allowance' transaction
  -- per partner actually granted (the "returning" from the wallet
  -- insert only yields rows that weren't already there — on conflict
  -- do nothing skips, and doesn't log, anyone somehow already granted).
  with newly_granted as (
    insert into public.user_wallets (user_id, period_id, coins_midweek_day, coins_weekend_day, coins_weekend_night, coins_midweek_night)
    select u.id, v_period_id, 400, 0, 0, 0
    from public.users u
    on conflict (user_id, period_id) do nothing
    returning user_id
  )
  insert into public.coin_transactions (user_id, period_id, delta, reason)
  select user_id, v_period_id, 400, 'quarterly_allowance' from newly_granted;

  return v_period_id;
end;
$$;
