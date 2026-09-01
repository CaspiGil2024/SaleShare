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


create or replace function public.fn_partner_coin_statement(
  p_user_id uuid,
  p_from date,
  p_to date
)
returns table (
  value_date date,
  coin_type text,
  reason text,
  delta numeric,
  running_balance numeric,
  note text
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'יש להתחבר מחדש.' using errcode = 'P0001';
  end if;
  if v_caller <> p_user_id and not public.is_manager() and not public.is_admin() then
    raise exception 'אין הרשאה לצפות בדוח זה.' using errcode = 'P0001';
  end if;

  return query
  with opening as (
    select ct.coin_type as ot_coin_type, coalesce(sum(ct.delta), 0) as opening_balance
    from public.coin_transactions ct
    where ct.user_id = p_user_id and ct.value_date < p_from
    group by ct.coin_type
  ),
  in_range as (
    select ct.value_date as v_date, ct.coin_type as tx_coin_type, ct.reason as tx_reason,
           ct.delta as tx_delta, ct.note as tx_note, ct.created_at as tx_created_at
    from public.coin_transactions ct
    where ct.user_id = p_user_id and ct.value_date >= p_from and ct.value_date <= p_to
  )
  select
    r.v_date,
    r.tx_coin_type,
    r.tx_reason,
    r.tx_delta,
    coalesce(o.opening_balance, 0) + sum(r.tx_delta) over (
      partition by r.tx_coin_type order by r.v_date, r.tx_created_at
      rows between unbounded preceding and current row
    ) as running_balance,
    r.tx_note
  from in_range r
  left join opening o on o.ot_coin_type = r.tx_coin_type
  -- Chronological (not grouped by type) — the frontend renders one
  -- unified ledger where each row updates only its own coin type's
  -- running-balance column and carries the other 3 forward, so it
  -- needs true date order across all 4 types interleaved.
  order by r.v_date, r.tx_created_at;
end;
$$;

revoke all on function public.fn_partner_coin_statement(uuid, date, date) from public;
grant execute on function public.fn_partner_coin_statement(uuid, date, date) to authenticated;
