-- =====================================================================
-- SailShare — per-partner default calendar view preference
-- =====================================================================
-- Stored as a friendly value ('day'|'week'|'month') rather than
-- FullCalendar's own view names (timeGridDay/timeGridWeek/dayGridMonth)
-- — keeps the DB decoupled from a specific calendar library's naming,
-- the client maps between them (see YachtCalendar.jsx/CalendarPage.jsx).
--
-- No RLS change needed: users_update_own (0001, `auth.uid() = id`)
-- already lets a partner update their own row, which is all this
-- needs — reading/writing your OWN preference, nothing cross-partner.
-- =====================================================================

alter table public.users add column if not exists default_calendar_view text not null default 'day';

alter table public.users drop constraint if exists users_default_calendar_view_check;
alter table public.users add constraint users_default_calendar_view_check
  check (default_calendar_view in ('day', 'week', 'month'));
