-- =====================================================================
-- SailShare — Cyprus sail duration: 5-14 days, all other types unchanged
-- =====================================================================
-- check_max_24_hours (confirmed live, 0005_schema_reality_baseline.sql)
-- capped every booking at 24h regardless of type — directly incompatible
-- with a Cyprus sail needing 5+ days. Replacing it with a type-aware
-- version: Cyprus bookings must be 120-336 hours (5-14 days); every
-- other type keeps the original <= 24h rule, completely unchanged.
--
-- Keeping the constraint's original name (not renaming it) since
-- nothing in the app's error-mapping code references it by name
-- anyway (see bookingErrors.js — only prevent_overlap is matched by
-- name; the others are matched by message text), so there's no
-- compatibility reason to change it, and less churn.
--
-- prevent_overlap and check_no_one_hour_gap need NO changes — both
-- already operate correctly on ranges of any length, confirmed when
-- they were first read from pg_get_functiondef earlier this project.
-- =====================================================================

alter table public.bookings drop constraint if exists check_max_24_hours;

alter table public.bookings add constraint check_max_24_hours check (
  case
    when booking_type = 'Cyprus' then
      extract(epoch from (end_time - start_time)) / 3600 between 120 and 336
    else
      extract(epoch from (end_time - start_time)) / 3600 <= 24
  end
);
