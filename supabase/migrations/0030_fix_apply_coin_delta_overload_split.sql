-- =====================================================================
-- SailShare — fix: fn_apply_coin_delta silently split into 2 overloads
-- =====================================================================
-- Found in a QA sweep, not from an observed failure. 0027 added a 6th
-- parameter (p_actor_user_id) to fn_apply_coin_delta via CREATE OR
-- REPLACE. Postgres identifies a function by its ordered parameter
-- TYPE list — CREATE OR REPLACE cannot change that list, so appending
-- a parameter (even one with a DEFAULT) doesn't replace the existing
-- 5-arg function, it silently creates a SECOND, separate 6-arg
-- overload alongside it. Every existing call site (0022/0023/0024/
-- 0025, all still passing exactly 5 positional arguments) keeps
-- resolving to the OLD 5-arg version — the one from 0024, which has no
-- idea actor_user_id/balance_before/balance_after even exist. 0027
-- also never re-granted EXECUTE for the new signature, so even an
-- explicit 6-arg call would additionally fail on permissions.
--
-- Net effect: coin balance math itself was never wrong (the live 5-arg
-- overload's deduction/refund/overdraft logic is exactly what 0024
-- specified, untouched) and the admin-adjustment audit log this was
-- built for was never affected either (fn_admin_adjust_coin_balance
-- writes coin_transactions directly, it never calls
-- fn_apply_coin_delta). What silently didn't work: every OTHER
-- coin_transactions row (booking charges/refunds, participant charges/
-- refunds, quarterly allowances) has actor_user_id/balance_before/
-- balance_after left NULL — nothing in the UI currently reads those
-- for non-admin-adjustment rows, so this had no visible symptom, but
-- it defeats the point of having added the columns.
--
-- Fix: drop the stale 5-arg overload outright, so every existing
-- 5-arg call site now resolves to the real (6th-parameter-defaulted)
-- function — no call site needs to change.
-- =====================================================================

drop function if exists public.fn_apply_coin_delta(uuid, text, numeric, text, integer);

-- Also genuinely dead: 0014's original signature (pre-0022's rewrite
-- to the 5-arg/4-coin-type version), never dropped, never called since.
drop function if exists public.fn_apply_coin_delta(uuid, numeric, text, integer);

revoke all on function public.fn_apply_coin_delta(uuid, text, numeric, text, integer, uuid) from public;
grant execute on function public.fn_apply_coin_delta(uuid, text, numeric, text, integer, uuid) to authenticated;
