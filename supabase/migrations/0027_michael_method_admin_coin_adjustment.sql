-- =====================================================================
-- SailShare — Michael's Method: admin coin adjustment + audit trail
-- =====================================================================
-- New requirement: admin/treasurer can directly override any partner's
-- balance for any one coin type, fully audited — who made it, for
-- whom, old vs new value, and when.
--
-- coin_transactions already logs every delta (who it happened to,
-- when, why) — this migration extends it rather than building a
-- parallel audit table:
--   - actor_user_id: WHO caused the change. For self-service actions
--     (a partner's own booking charge/refund) this is just that same
--     partner — fn_apply_coin_delta defaults it to p_user_id. For an
--     admin adjustment it's the ADMIN's own auth.uid(), genuinely
--     different from the affected partner (p_user_id).
--   - balance_before / balance_after: a self-contained snapshot per
--     row, so an audit view never has to reconstruct a running total
--     by summing prior deltas. Populated for every transaction going
--     forward (not just admin adjustments) — free given
--     fn_apply_coin_delta already reads the current balance anyway.
--   - note: optional free-text admin explanation for an adjustment.
--   - 'admin_adjustment' is a new valid `reason`.
--
-- fn_admin_adjust_coin_balance SETS a balance directly (not a delta)
-- and deliberately bypasses fn_apply_coin_delta's overdraft-floor
-- check — an explicit administrative correction shouldn't be
-- constrained by the same limit that applies to a partner's own
-- booking actions.
-- =====================================================================

alter table public.coin_transactions add column if not exists actor_user_id uuid references public.users(id) on delete set null;
alter table public.coin_transactions add column if not exists balance_before numeric;
alter table public.coin_transactions add column if not exists balance_after numeric;
alter table public.coin_transactions add column if not exists note text;

alter table public.coin_transactions drop constraint if exists coin_transactions_reason_check;
alter table public.coin_transactions add constraint coin_transactions_reason_check check (
  reason in ('quarterly_allowance', 'booking_charge', 'booking_refund', 'participant_charge', 'participant_refund', 'admin_adjustment')
);

-- Admin (not just is_manager()'s treasurer/ceo/lab_tester/maintenance
-- set) needs to be able to read the audit trail they just wrote —
-- broadening SELECT to match, same as partner_roster's admin door
-- in 0015.
drop policy if exists coin_transactions_select on public.coin_transactions;
create policy coin_transactions_select on public.coin_transactions
  for select using (auth.uid() = user_id or public.is_manager() or public.is_admin());


-- ---------------------------------------------------------------------
-- fn_apply_coin_delta: now also records actor_user_id (defaults to the
-- affected user themselves — every existing call site is self-caused)
-- and a before/after snapshot. Signature unchanged for every existing
-- caller; the new p_actor_user_id parameter is optional and appended
-- last.
-- ---------------------------------------------------------------------
create or replace function public.fn_apply_coin_delta(
  p_user_id uuid,
  p_coin_type text,
  p_delta numeric,
  p_reason text,
  p_related_booking_id integer default null,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_period_id integer;
  v_current numeric;
  v_allocated numeric;
  v_overdraft_percent numeric;
  v_floor numeric;
  v_type_label text;
begin
  v_period_id := public.ensure_current_period();

  insert into public.user_wallets (user_id, period_id, coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night)
  values (p_user_id, v_period_id, 0, 0, 0, 0)
  on conflict (user_id, period_id) do nothing;

  select overdraft_percent into v_overdraft_percent from public.system_settings where id = true;
  v_overdraft_percent := coalesce(v_overdraft_percent, 0);

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

  if p_coin_type = 'weekend_day' then
    select coins_weekend_day, allocated_weekend_day into v_current, v_allocated
      from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
  elsif p_coin_type = 'weekend_night' then
    select coins_weekend_night, allocated_weekend_night into v_current, v_allocated
      from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
  elsif p_coin_type = 'midweek_day' then
    select coins_midweek_day, allocated_midweek_day into v_current, v_allocated
      from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
  else
    select coins_midweek_night, allocated_midweek_night into v_current, v_allocated
      from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
  end if;

  v_floor := -(v_overdraft_percent / 100.0) * coalesce(v_allocated, 0);

  if p_delta < 0 and v_current + p_delta < v_floor then
    raise exception 'אין מספיק מטבעות מסוג % (כולל אוברדרפט של %%%). יתרה: %, מינימום אפשרי: %, נדרש: %.',
      v_type_label, v_overdraft_percent, v_current, v_floor, abs(p_delta) using errcode = 'P0001';
  end if;

  if p_coin_type = 'weekend_day' then
    update public.user_wallets set coins_weekend_day = coins_weekend_day + p_delta where user_id = p_user_id and period_id = v_period_id;
  elsif p_coin_type = 'weekend_night' then
    update public.user_wallets set coins_weekend_night = coins_weekend_night + p_delta where user_id = p_user_id and period_id = v_period_id;
  elsif p_coin_type = 'midweek_day' then
    update public.user_wallets set coins_midweek_day = coins_midweek_day + p_delta where user_id = p_user_id and period_id = v_period_id;
  else
    update public.user_wallets set coins_midweek_night = coins_midweek_night + p_delta where user_id = p_user_id and period_id = v_period_id;
  end if;

  insert into public.coin_transactions (user_id, period_id, coin_type, delta, reason, related_booking_id, actor_user_id, balance_before, balance_after)
  values (p_user_id, v_period_id, p_coin_type, p_delta, p_reason, p_related_booking_id, coalesce(p_actor_user_id, p_user_id), v_current, v_current + p_delta);
end;
$$;


-- ---------------------------------------------------------------------
-- Admin/treasurer-only: directly SET a partner's balance for one coin
-- type. Bypasses the overdraft floor deliberately (an explicit
-- correction, not a booking deduction) — does NOT route through
-- fn_apply_coin_delta's floor check, but still writes the same
-- coin_transactions audit shape (actor/before/after/note).
-- ---------------------------------------------------------------------
create or replace function public.fn_admin_adjust_coin_balance(
  p_user_id uuid,
  p_coin_type text,
  p_new_balance numeric,
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
    raise exception 'יש להתחבר מחדש כדי לבצע שינוי.' using errcode = 'P0001';
  end if;
  if not public.is_admin_or_treasurer() then
    raise exception 'רק מנהל או גזבר יכולים לשנות יתרת מטבעות באופן ידני.' using errcode = 'P0001';
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

  if p_coin_type = 'weekend_day' then
    select coins_weekend_day into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    update public.user_wallets set coins_weekend_day = p_new_balance where user_id = p_user_id and period_id = v_period_id;
  elsif p_coin_type = 'weekend_night' then
    select coins_weekend_night into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    update public.user_wallets set coins_weekend_night = p_new_balance where user_id = p_user_id and period_id = v_period_id;
  elsif p_coin_type = 'midweek_day' then
    select coins_midweek_day into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    update public.user_wallets set coins_midweek_day = p_new_balance where user_id = p_user_id and period_id = v_period_id;
  else
    select coins_midweek_night into v_current from public.user_wallets where user_id = p_user_id and period_id = v_period_id for update;
    update public.user_wallets set coins_midweek_night = p_new_balance where user_id = p_user_id and period_id = v_period_id;
  end if;

  v_delta := p_new_balance - coalesce(v_current, 0);

  insert into public.coin_transactions (user_id, period_id, coin_type, delta, reason, actor_user_id, balance_before, balance_after, note)
  values (p_user_id, v_period_id, p_coin_type, v_delta, 'admin_adjustment', v_actor, coalesce(v_current, 0), p_new_balance, p_note);
end;
$$;

revoke all on function public.fn_admin_adjust_coin_balance(uuid, text, numeric, text) from public;
grant execute on function public.fn_admin_adjust_coin_balance(uuid, text, numeric, text) to authenticated;
