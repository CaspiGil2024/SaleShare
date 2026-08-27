-- =====================================================================
-- SailShare — General System Notices (הודעות מערכת כלליות)
-- =====================================================================
-- Deliberately a SEPARATE table from announcements (0011), not a
-- retrofit of it — the two have genuinely different shapes and
-- lifecycles: announcements require a title and are removed by hard
-- delete; notices have no title (content only) and are closed
-- (is_active -> false) rather than deleted, so a closed notice's
-- history isn't lost. Flagged in chat: this does mean there are now
-- two adjacent "message to all partners" features (the existing
-- Announcements panel and this one) — worth consolidating later if
-- that turns out to be confusing in practice.
--
-- Same manager-gated pattern as announcements/important_info/
-- checklists: any authenticated partner reads, only is_manager()
-- (treasurer/ceo/lab_tester/maintenance) creates/edits/closes.
-- =====================================================================

create table if not exists public.system_notices (
  id              uuid primary key default gen_random_uuid(),
  content         text not null,
  is_active       boolean not null default true,
  created_by      uuid references public.users(id) on delete set null,
  created_by_name text,
  closed_by       uuid references public.users(id) on delete set null,
  closed_by_name  text,
  closed_at       timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.system_notices enable row level security;

drop policy if exists system_notices_select_all on public.system_notices;
create policy system_notices_select_all on public.system_notices
  for select using (auth.role() = 'authenticated');

drop policy if exists system_notices_manage on public.system_notices;
create policy system_notices_manage on public.system_notices
  for all using (public.is_manager()) with check (public.is_manager());
