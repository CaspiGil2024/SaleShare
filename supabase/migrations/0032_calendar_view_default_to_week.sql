-- =====================================================================
-- SailShare — change the global default calendar view to Weekly
-- =====================================================================
-- 0031 defaulted default_calendar_view to 'day'. Since that column was
-- only just added and nobody has meaningfully had a chance to
-- customize it yet, this both changes the column default for future
-- signups AND resets every existing row to 'week' — a one-time reset,
-- not overwriting real deliberate choices (there aren't any yet).
-- =====================================================================

alter table public.users alter column default_calendar_view set default 'week';

-- where true: intentionally unconditional (resets every partner) —
-- harmless to run via the SQL Editor (postgres role), but matches the
-- explicit-WHERE convention established after the safeupdate incident
-- (see 0019) in case this is ever run through a different path.
update public.users set default_calendar_view = 'week' where true;
