-- =====================================================================
-- SailShare — full historical recompute of coin_transactions.
-- balance_before/balance_after, and the real gap that made it necessary
-- =====================================================================
-- Real, found gap: fn_allocate_period_coins (0021/0024) — the function
-- that grants each partner's quarterly allowance at the start of every
-- period — inserts its 4 'quarterly_allowance' coin_transactions rows
-- with only (user_id, period_id, coin_type, delta, reason). It never
-- went through fn_apply_coin_delta (which DOES set these), so
-- balance_before/balance_after (and actor_user_id) were left NULL on
-- every quarterly_allowance row ever written — a real, silent gap in
-- the ledger, exactly the kind this migration is meant to close.
--
-- IMPORTANT — why this is a per-PERIOD recompute, not one continuous
-- running total "from inception": user_wallets does NOT roll over
-- between periods (see 0024/ParametersPage's own "אין צבירה בפועל בין
-- תקופות" note) — fn_allocate_period_coins's insert sets a period's
-- starting coins_* directly to that period's fresh allocation, not to
-- (previous period's leftover + new allocation). So the true balance
-- chain resets to 0 at the start of every period, per coin type, and a
-- naive global cumulative sum of every delta ever recorded would
-- OVERSTATE the balance by however much unused leftover a partner had
-- in an earlier period that was never actually carried forward. The
-- recompute below partitions by (user_id, coin_type, period_id) for
-- exactly this reason — "from inception to date" means every period in
-- the partner's history gets its own chain recomputed, not that all of
-- history is treated as one undivided ledger.
--
-- Ordering within a partition is (created_at, id) — id only as a
-- deterministic tiebreak for same-timestamp rows (Postgres's `now()`
-- returns transaction START time, so several coin_transactions rows
-- inserted by the same RPC call, e.g. charging 2+ coin types for one
-- booking, can share an identical created_at). This can't perfectly
-- reconstruct sub-transaction ordering that was never recorded more
-- precisely — but it doesn't need to: every row still gets a correct
-- balance_before/after relative to whatever order is chosen, and the
-- final balance_after for the partition (the actual current balance)
-- is the sum of all its deltas regardless of internal ordering, so it
-- always comes out right either way.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fix the actual gap going forward: quarterly_allowance rows now carry
-- balance_before/balance_after/actor_user_id the same as every other
-- coin_transactions row (actor = the partner themselves — a quarterly
-- grant isn't caused by an admin action, same "self-caused" convention
-- fn_apply_coin_delta already uses when no explicit actor is given).
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

    -- balance_before is always 0 here — a new period's wallet is
    -- created fresh (see header: no rollover), so nothing can have
    -- happened to this coin type in this period before its own
    -- opening grant.
    insert into public.coin_transactions
      (user_id, period_id, coin_type, delta, reason, actor_user_id, balance_before, balance_after)
    values
      (v_user.id, p_period_id, 'weekend_day', v_per_wd, 'quarterly_allowance', v_user.id, 0, v_per_wd),
      (v_user.id, p_period_id, 'weekend_night', v_per_wn, 'quarterly_allowance', v_user.id, 0, v_per_wn),
      (v_user.id, p_period_id, 'midweek_day', v_per_md, 'quarterly_allowance', v_user.id, 0, v_per_md),
      (v_user.id, p_period_id, 'midweek_night', v_per_mn, 'quarterly_allowance', v_user.id, 0, v_per_mn);
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- Reusable recompute — callable again in future if ever needed (e.g.
-- after a manual data fix), not just a one-shot backfill. Rewrites
-- EVERY row's balance_before/balance_after (not only the known-NULL
-- quarterly_allowance ones) so any other undiscovered drift self-heals
-- too, since it fully re-derives the chain from the deltas themselves
-- rather than patching only the specific gap found above.
-- ---------------------------------------------------------------------
create or replace function public.fn_recompute_coin_transaction_balances()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_updated integer;
begin
  if not public.is_admin_or_treasurer() then
    raise exception 'רק מנהל או גזבר יכולים להריץ חישוב מחדש של יתרות.' using errcode = 'P0001';
  end if;

  with ordered as (
    select
      id,
      sum(delta) over (
        partition by user_id, coin_type, period_id
        order by created_at, id
        rows between unbounded preceding and 1 preceding
      ) as new_balance_before,
      sum(delta) over (
        partition by user_id, coin_type, period_id
        order by created_at, id
        rows between unbounded preceding and current row
      ) as new_balance_after
    from public.coin_transactions
  )
  update public.coin_transactions ct
  set balance_before = coalesce(o.new_balance_before, 0),
      balance_after = o.new_balance_after
  from ordered o
  where o.id = ct.id
    and (ct.balance_before is distinct from coalesce(o.new_balance_before, 0)
         or ct.balance_after is distinct from o.new_balance_after);

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.fn_recompute_coin_transaction_balances() from public;
grant execute on function public.fn_recompute_coin_transaction_balances() to authenticated;

-- ---------------------------------------------------------------------
-- Apply it now, once, as part of this migration — this is what actually
-- backfills every historical quarterly_allowance row (and self-heals
-- anything else out of sync) rather than just leaving the tool defined
-- for someone to remember to run later. Run as the SAME query directly
-- (not a call to the function above): a migration executes with the
-- database owner's full privileges, no authenticated auth.uid() session
-- — calling the function itself would hit its own is_admin_or_treasurer()
-- check and fail with no user logged in.
-- ---------------------------------------------------------------------
with ordered as (
  select
    id,
    sum(delta) over (
      partition by user_id, coin_type, period_id
      order by created_at, id
      rows between unbounded preceding and 1 preceding
    ) as new_balance_before,
    sum(delta) over (
      partition by user_id, coin_type, period_id
      order by created_at, id
      rows between unbounded preceding and current row
    ) as new_balance_after
  from public.coin_transactions
)
update public.coin_transactions ct
set balance_before = coalesce(o.new_balance_before, 0),
    balance_after = o.new_balance_after
from ordered o
where o.id = ct.id
  and (ct.balance_before is distinct from coalesce(o.new_balance_before, 0)
       or ct.balance_after is distinct from o.new_balance_after);
