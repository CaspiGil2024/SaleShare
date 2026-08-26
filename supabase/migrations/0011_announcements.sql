-- =====================================================================
-- SailShare — Dashboard announcements panel
-- =====================================================================
-- Same manager-gated pattern as important_phones/important_links/
-- checklist_items: any authenticated partner reads, only treasurer/
-- ceo/lab_tester/maintenance (is_manager(), from 0008) can post/delete.
-- created_by_name is a denormalized snapshot (like checklist_
-- submissions' completed_by_name) so the byline still reads correctly
-- even if the poster's account or display name changes later.
-- =====================================================================

create table if not exists public.announcements (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  body            text,
  created_by      uuid references public.users(id) on delete set null default auth.uid(),
  created_by_name text,
  created_at      timestamptz not null default now()
);

alter table public.announcements enable row level security;

drop policy if exists announcements_select_all on public.announcements;
create policy announcements_select_all on public.announcements
  for select using (auth.role() = 'authenticated');

drop policy if exists announcements_manage on public.announcements;
create policy announcements_manage on public.announcements
  for all using (public.is_manager()) with check (public.is_manager());
