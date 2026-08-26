-- =====================================================================
-- SailShare — remove the superseded calendar-quarter period function
-- =====================================================================
-- ensure_current_quarter_period() (0014) is fully replaced by
-- ensure_current_period() (0021/0024's 20-week model). Left in place
-- across 0021-0025 "unreferenced", but Dashboard.jsx was still calling
-- it — if left callable, it would keep marking an OLD calendar-quarter
-- periods row as is_current = true, fighting the new 20-week model for
-- the same flag. Dropping it outright now that nothing calls it.
-- =====================================================================

drop function if exists public.ensure_current_quarter_period();
