-- =====================================================================
-- SailShare — diagnostic: is the S-multiplier quota reading the live
-- system_settings value, or a stale periods snapshot?
-- =====================================================================
-- Run manually in the Supabase SQL Editor. If the two numbers below
-- differ, that BY ITSELF isn't a bug (periods.s_multiplier is only a
-- historical snapshot from when the period was created, on purpose —
-- see 0024/0048's own comments). What actually matters is whether
-- enforce_s_rule() and fn_recompute_shared_booking_participants read
-- from system_settings (correct, live) or periods (wrong, frozen) —
-- Step 2 shows that directly from the live function definitions.
-- =====================================================================

-- Step 1 — the two candidate sources, side by side.
select
  (select s_multiplier from public.system_settings where id = true) as system_settings_s_multiplier,
  (select s_multiplier from public.periods where is_current = true limit 1) as current_period_s_multiplier;

-- Step 2 — which source the actual quota-checking functions use RIGHT
-- NOW in your database. Should show "system_settings" for both rows.
-- If either shows "periods" instead, the migrations that fix this
-- (0024 for Private/Dockside, 0048/0050/0051 for Shared/Cyprus) have
-- not been applied to this database yet — apply them in order.
select
  proname as function_name,
  case
    when prosrc ilike '%from public.system_settings%' then 'system_settings (correct)'
    when prosrc ilike '%from public.periods%' then 'periods (STALE — apply 0024/0048/0050/0051)'
    else 'unclear — inspect prosrc manually'
  end as s_multiplier_source
from pg_proc
where proname in ('enforce_s_rule', 'fn_recompute_shared_booking_participants')
  and pronamespace = 'public'::regnamespace;
