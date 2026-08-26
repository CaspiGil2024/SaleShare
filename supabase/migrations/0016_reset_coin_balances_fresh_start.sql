-- =====================================================================
-- SailShare — Reset coin balances to a clean 400-coin start
-- =====================================================================
-- Follow-up to the earlier "clear all bookings, reset coins" pass —
-- balances shown in the partner list are still stale test leftovers.
-- This is a deliberate one-time DATA reset, not a schema change; run
-- it once in the Supabase SQL Editor, not as part of normal ongoing
-- migrations.
--
-- DESTRUCTIVE: truncates coin_transactions — the permanent audit log
-- built in 0014 — wiping every past charge/refund/allowance record.
-- That's what "clear any transaction history" means here, done exactly
-- as asked, not silently softened. From this point forward the ledger
-- starts recording again from zero.
--
-- What this sets to 400:
--   - user_wallets.coins_midweek_day for the CURRENT quarter period
--     (the single bucket every coin lives in — see 0014), for every
--     partner who already has a real account.
--   - partner_roster.balance — the raw number PartnersPage.jsx shows
--     directly in the roster table for partners who haven't signed up
--     yet (they have no user_wallets row at all until they do).
-- The other 3 user_wallets columns (weekend_day/weekend_night/
-- midweek_night) are zeroed too, matching the existing "everything in
-- one bucket" convention.
-- =====================================================================

do $$
declare
  v_period_id integer;
begin
  v_period_id := public.ensure_current_quarter_period();

  truncate table public.coin_transactions;

  -- Make sure every current partner has a wallet row for this quarter
  -- before resetting (covers anyone whose wallet was never backfilled).
  insert into public.user_wallets (user_id, period_id, coins_midweek_day, coins_weekend_day, coins_weekend_night, coins_midweek_night)
  select u.id, v_period_id, 400, 0, 0, 0
  from public.users u
  on conflict (user_id, period_id) do nothing;

  update public.user_wallets
    set coins_midweek_day   = 400,
        coins_weekend_day   = 0,
        coins_weekend_night = 0,
        coins_midweek_night = 0
    where period_id = v_period_id;

  -- where true: intentionally unconditional (resets every partner) —
  -- required explicitly for the safeupdate extension (see 0019).
  update public.partner_roster set balance = 400 where true;
end $$;
