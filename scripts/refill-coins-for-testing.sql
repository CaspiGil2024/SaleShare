-- =====================================================================
-- SailShare — quick coin refill for testing (repeatable, not a migration)
-- =====================================================================
-- Run any section below in the Supabase SQL Editor whenever you need a
-- clean slate mid-testing. Not numbered/tracked as a migration on
-- purpose — meant to be run as many times as you like.
-- =====================================================================

-- Make sure the current 20-week period (and every partner's wallet row
-- for it) actually exists before touching balances.
select public.ensure_current_period();


-- ---------------------------------------------------------------------
-- Option A: refill ONE partner (by email) to a generous flat amount
-- across all 4 coin types — fastest for a single-person test loop.
-- ---------------------------------------------------------------------
update public.user_wallets
set coins_weekend_day = 200,
    coins_weekend_night = 200,
    coins_midweek_day = 200,
    coins_midweek_night = 200
where user_id = (select id from public.users where lower(email) = lower('YOUR_TEST_EMAIL@example.com'))
  and period_id = (select id from public.periods where is_current = true);


-- ---------------------------------------------------------------------
-- Option B: refill EVERY partner to the same flat amount — use when
-- several people are testing together.
-- ---------------------------------------------------------------------
-- update public.user_wallets
-- set coins_weekend_day = 200,
--     coins_weekend_night = 200,
--     coins_midweek_day = 200,
--     coins_midweek_night = 200
-- where period_id = (select id from public.periods where is_current = true);


-- ---------------------------------------------------------------------
-- Option C: for an audited change (shows up in the Parameters page's
-- adjustment log), use the app itself — Parameters -> "שינוי ידני של
-- יתרת מטבעות" — rather than SQL. fn_admin_adjust_coin_balance() reads
-- auth.uid() to know who's making the change, which the SQL Editor's
-- session doesn't have (no logged-in user), so calling it directly
-- from here will fail with "יש להתחבר מחדש כדי לבצע שינוי" — it can
-- only be called from inside the running app.
-- ---------------------------------------------------------------------
