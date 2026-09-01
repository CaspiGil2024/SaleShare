-- =====================================================================
-- SailShare — manual coin journal (Debit/Credit/value-date) + periodic
-- partner statement report
-- =====================================================================
-- Part 1: coin_transactions already IS a double-entry-style ledger —
-- `delta` positive = credit, negative = debit, with a per-row
-- balance_before/balance_after snapshot (0027) and a full actor/reason
-- audit trail. What's missing for a proper accounting journal is a
-- value date (תאריך ערך) distinct from created_at (when the row was
-- actually entered) — added here, defaulting every existing row to its
-- own created_at date (the only sensible backfill) and every future
-- automatic row (booking charge/refund, quarterly allowance, ...) to
-- today, same as before. Only the new manual-entry screen below lets
-- an admin/treasurer pick a different value date explicitly.
--
-- fn_admin_manual_coin_entry is a new, explicit Debit/Credit entry
-- point alongside the EXISTING fn_admin_adjust_coin_balance (which
-- SETS a target balance directly) — this one instead takes an amount +
-- direction ('credit' adds, 'debit' subtracts), matching how a
-- bookkeeper actually thinks about a manual journal entry. Both write
-- the SAME 'admin_adjustment' reason and the same audit columns, so
-- they share one unified audit trail (MaintenanceDataPage.jsx's
-- AdjustmentAuditLog) rather than needing a second one. Same
-- philosophy as fn_admin_adjust_coin_balance: bypasses fn_apply_coin_
-- delta's overdraft floor deliberately — an explicit administrative
-- entry shouldn't be constrained by the same limit that applies to a
-- partner's own booking actions.
--
-- Part 2: fn_partner_coin_statement returns one partner's transactions
-- in a date range (by value_date), with a running balance PER coin
-- type that correctly starts from the real opening balance as of just
-- before the range (sum of every earlier delta for that type) rather
-- than starting from zero.
-- =====================================================================

alter table public.coin_transactions add column if not exists value_date date;
update public.coin_transactions set value_date = created_at::date where value_date is null;
alter table public.coin_transactions alter column value_date set default current_date;
alter table public.coin_transactions alter column value_date set not null;

create index if not exists coin_transactions_value_date_idx on public.coin_transactions (user_id, value_date);


create or replace function public.fn_admin_manual_coin_entry(
  p_user_id uuid,
  p_coin_type text,
  p_amount numeric,
  p_direction text, -- 'credit' (זכות) or 'debit' (חובה)
  p_value_date date default current_date,
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_period_id integer;
  v_current numeric;
  v_delta numeric;
  v_type_label text;
begin
  if v_actor is null then
    raise exception 'יש להתחבר מחדש כדי לבצע פעולה זו.' using errcode = 'P0001';
  end if;
  if not public.is_admin_or_treasurer() then
    raise exception 'רק מנהל או גזבר יכולים לרשום תנועת מטבעות ידנית.' using errcode = 'P0001';
  end if;
  if p_direction not in ('credit', 'debit') then
    raise exception 'כיוון התנועה חייב להיות חובה או זכות.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'הסכום חייב להיות גדול מאפס.' using errcode = 'P0001';
  end if;

  v_type_label := case p_coin_type
    when 'weekend_day' then 'סופ"ש יום'
    when 'weekend_night' then 'סופ"ש לילה'
    when 'midweek_day' then 'אמצ"ש יום'
    when 'midweek_night' then 'אמצ"ש לילה'
    else null
  end;
  if v_type_label is null then
    raise exception 'סוג מטבע לא ידוע: %', p_coin_type using errcode = 'P0001';
  end if;

  v_period_id := public.ensure_current_period();

  insert into public.user_wallets (user_id, period_id, coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night)
  values (p_user_id, v_period_id, 0, 0, 0, 0)
  on conflict (user_id, period_id) do nothing;

  v_delta := case when p_direction = 'credit' then p_amount else -p_amount end;

  if p_coin_type = 'weekend_day' then
    select coins_weekend_day into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    update public.user_wallets set coins_weekend_day = coins_weekend_day + v_delta where user_id = p_user_id and period_id = v_period_id;
  elsif p_coin_type = 'weekend_night' then
    select coins_weekend_night into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    update public.user_wallets set coins_weekend_night = coins_weekend_night + v_delta where user_id = p_user_id and period_id = v_period_id;
  elsif p_coin_type = 'midweek_day' then
    select coins_midweek_day into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    update public.user_wallets set coins_midweek_day = coins_midweek_day + v_delta where user_id = p_user_id and period_id = v_period_id;
  else
    select coins_midweek_night into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    update public.user_wallets set coins_midweek_night = coins_midweek_night + v_delta where user_id = p_user_id and period_id = v_period_id;
  end if;

  insert into public.coin_transactions
    (user_id, period_id, coin_type, delta, reason, actor_user_id, balance_before, balance_after, note, value_date)
  values
    (p_user_id, v_period_id, p_coin_type, v_delta, 'admin_adjustment', v_actor,
     coalesce(v_current, 0), coalesce(v_current, 0) + v_delta, p_note, coalesce(p_value_date, current_date));
end;
$$;

revoke all on function public.fn_admin_manual_coin_entry(uuid, text, numeric, text, date, text) from public;
grant execute on function public.fn_admin_manual_coin_entry(uuid, text, numeric, text, date, text) to authenticated;


-- drop first: return TABLE shape changed (delta -> separate debit/
-- credit columns, plus the opening-balance summary rows below) —
-- CREATE OR REPLACE can't change an existing function's return type.
drop function if exists public.fn_partner_coin_statement(uuid, date, date);

create function public.fn_partner_coin_statement(
  p_user_id uuid,
  p_from date,
  p_to date
)
returns table (
  value_date date,     -- null for the opening-balance row (no single date)
  coin_type text,
  reason text,          -- 'opening_balance' for the opening row, else the usual coin_transactions.reason
  debit numeric,        -- null when this row is a credit
  credit numeric,       -- null when this row is a debit
  running_balance numeric,
  note text
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_has_opening boolean;
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש.' using errcode = 'P0001';
  end if;
  if v_caller <> p_user_id and not public.is_manager() and not public.is_admin() then
    raise exception 'אין הרשאה לצפות בדוח זה.' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.coin_transactions ct
    where ct.user_id = p_user_id and ct.value_date < p_from
  ) into v_has_opening;

  return query
  with opening_balance as (
    -- The balance as it stood right before the range = balance_after of
    -- the most recent pre-range row per type. Read directly rather than
    -- re-summed from delta: user_wallets resets every period (no
    -- rollover — see 0056's header), so balance_after already correctly
    -- encodes that reset chain (thanks to 0056's recompute) while a
    -- plain sum(delta) across period boundaries would NOT — it would
    -- silently include leftover amounts from an earlier period that
    -- were never actually carried into the next one.
    select distinct on (ct.coin_type)
      ct.coin_type as ob_coin_type,
      ct.balance_after as ob_balance
    from public.coin_transactions ct
    where ct.user_id = p_user_id and ct.value_date < p_from
    order by ct.coin_type, ct.value_date desc, ct.created_at desc, ct.id desc
  ),
  opening_totals as (
    -- Cumulative debit/credit activity before the range (informational
    -- — this is the ONE figure here that intentionally spans every
    -- period in the partner's history, per the original request; only
    -- the balance itself needed to become period-aware).
    select
      ct.coin_type as ot_coin_type,
      coalesce(sum(case when ct.delta < 0 then -ct.delta else 0 end), 0) as ot_debit,
      coalesce(sum(case when ct.delta > 0 then ct.delta else 0 end), 0) as ot_credit
    from public.coin_transactions ct
    where ct.user_id = p_user_id and ct.value_date < p_from
    group by ct.coin_type
  ),
  in_range as (
    select ct.value_date as v_date, ct.coin_type as tx_coin_type, ct.reason as tx_reason,
           ct.delta as tx_delta, ct.balance_after as tx_balance_after,
           ct.note as tx_note, ct.created_at as tx_created_at
    from public.coin_transactions ct
    where ct.user_id = p_user_id and ct.value_date >= p_from and ct.value_date <= p_to
  ),
  combined as (
    -- Opening-balance summary — one row per coin type — only included
    -- at all when at least one transaction exists before the range.
    select
      0 as sort_group,
      null::date as out_value_date,
      t.coin_type_value as out_coin_type,
      'opening_balance'::text as out_reason,
      case when coalesce(ot.ot_debit, 0) > 0 then ot.ot_debit else null end as out_debit,
      case when coalesce(ot.ot_credit, 0) > 0 then ot.ot_credit else null end as out_credit,
      coalesce(ob.ob_balance, 0) as out_balance,
      null::text as out_note,
      null::timestamptz as out_created_at
    from (values ('midweek_day'), ('midweek_night'), ('weekend_day'), ('weekend_night')) as t(coin_type_value)
    left join opening_balance ob on ob.ob_coin_type = t.coin_type_value
    left join opening_totals ot on ot.ot_coin_type = t.coin_type_value
    where v_has_opening

    union all

    -- Actual transactions inside the range, chronological. running_
    -- balance is each row's own stored balance_after — already correct
    -- and period-aware (0056), no re-derivation needed here.
    select
      1 as sort_group,
      r.v_date as out_value_date,
      r.tx_coin_type as out_coin_type,
      r.tx_reason as out_reason,
      case when r.tx_delta < 0 then -r.tx_delta else null end as out_debit,
      case when r.tx_delta > 0 then r.tx_delta else null end as out_credit,
      r.tx_balance_after as out_balance,
      r.tx_note as out_note,
      r.tx_created_at as out_created_at
    from in_range r
  )
  select out_value_date, out_coin_type, out_reason, out_debit, out_credit, out_balance, out_note
  from combined
  -- Opening rows (sort_group 0) always first; within each group,
  -- chronological — the frontend renders one unified ledger where each
  -- row updates only its own coin type's running-balance column and
  -- carries the other 3 forward, so it needs true date order across
  -- all 4 types interleaved.
  order by sort_group, out_value_date, out_created_at, out_coin_type;
end;
$$;

revoke all on function public.fn_partner_coin_statement(uuid, date, date) from public;
grant execute on function public.fn_partner_coin_statement(uuid, date, date) to authenticated;
