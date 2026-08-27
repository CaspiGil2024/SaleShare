-- =====================================================================
-- SailShare — Maintenance Issues system
-- =====================================================================
-- "Managers or Maintenance staff" is mapped to the existing is_manager()
-- set (treasurer/ceo/lab_tester/maintenance) — the 'maintenance' role
-- is already a member of that set, so this isn't inventing a new tier,
-- just reusing the one already used for other content-management
-- features (important_info, checklists). Viewing is open to everyone;
-- create/edit/resolve is is_manager()-only.
--
-- Images: a new public bucket (like important-files, but public rather
-- than signed-URL-gated — these are maintenance photos, not sensitive
-- documents, and public access means a plain <img src> works without
-- per-render signed-URL fetching for a screen every partner can view).
-- =====================================================================

create table if not exists public.maintenance_issues (
  id                uuid primary key default gen_random_uuid(),
  summary           text not null,
  description       text not null,
  status            text not null default 'open' check (status in ('open', 'resolved')),
  resolution_notes  text,
  created_by        uuid references public.users(id) on delete set null,
  resolved_by       uuid references public.users(id) on delete set null,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);

alter table public.maintenance_issues enable row level security;

drop policy if exists maintenance_issues_select_all on public.maintenance_issues;
create policy maintenance_issues_select_all on public.maintenance_issues
  for select using (auth.role() = 'authenticated');

drop policy if exists maintenance_issues_manage on public.maintenance_issues;
create policy maintenance_issues_manage on public.maintenance_issues
  for all using (public.is_manager()) with check (public.is_manager());


create table if not exists public.maintenance_issue_images (
  id            uuid primary key default gen_random_uuid(),
  issue_id      uuid not null references public.maintenance_issues(id) on delete cascade,
  storage_path  text not null,
  created_at    timestamptz not null default now()
);

alter table public.maintenance_issue_images enable row level security;

drop policy if exists maintenance_issue_images_select_all on public.maintenance_issue_images;
create policy maintenance_issue_images_select_all on public.maintenance_issue_images
  for select using (auth.role() = 'authenticated');

drop policy if exists maintenance_issue_images_manage on public.maintenance_issue_images;
create policy maintenance_issue_images_manage on public.maintenance_issue_images
  for all using (public.is_manager()) with check (public.is_manager());


insert into storage.buckets (id, name, public)
values ('maintenance-images', 'maintenance-images', true)
on conflict (id) do nothing;

drop policy if exists maintenance_images_storage_select on storage.objects;
create policy maintenance_images_storage_select on storage.objects
  for select using (bucket_id = 'maintenance-images');

drop policy if exists maintenance_images_storage_insert on storage.objects;
create policy maintenance_images_storage_insert on storage.objects
  for insert with check (bucket_id = 'maintenance-images' and public.is_manager());

drop policy if exists maintenance_images_storage_delete on storage.objects;
create policy maintenance_images_storage_delete on storage.objects
  for delete using (bucket_id = 'maintenance-images' and public.is_manager());
