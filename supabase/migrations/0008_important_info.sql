-- =====================================================================
-- SailShare — Important Info page: phones, files, links
-- =====================================================================
-- Same "management roles" (treasurer/ceo/lab_tester/maintenance) gate
-- as partner_roster (0007), but deliberately a SEPARATE function
-- (is_manager(), not can_edit_partners()) rather than reusing 0007's
-- function. can_edit_partners() only just got confirmed working after
-- a real debugging cycle — not touching it, or anything that depends
-- on it, while that's still settling. Identical body, isolated blast
-- radius.
--
-- Files uses Supabase Storage (a bucket + storage.objects policies),
-- which is a different permission system from ordinary table RLS —
-- first time this project has used it. Test the Files tab separately
-- from Phones/Links before relying on it.
-- =====================================================================

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('treasurer', 'ceo', 'lab_tester', 'maintenance')
  );
$$;

revoke all on function public.is_manager() from public;
grant execute on function public.is_manager() to authenticated;


-- ---------------------------------------------------------------------
-- important_phones
-- ---------------------------------------------------------------------
create table if not exists public.important_phones (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null,
  sort_order int not null default 0,
  created_by uuid references public.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.important_phones enable row level security;

drop policy if exists important_phones_select_all on public.important_phones;
create policy important_phones_select_all on public.important_phones
  for select using (auth.role() = 'authenticated');

drop policy if exists important_phones_manage on public.important_phones;
create policy important_phones_manage on public.important_phones
  for all using (public.is_manager()) with check (public.is_manager());


-- ---------------------------------------------------------------------
-- important_links
-- ---------------------------------------------------------------------
create table if not exists public.important_links (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  url         text not null,
  description text,
  sort_order  int not null default 0,
  created_by  uuid references public.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.important_links enable row level security;

drop policy if exists important_links_select_all on public.important_links;
create policy important_links_select_all on public.important_links
  for select using (auth.role() = 'authenticated');

drop policy if exists important_links_manage on public.important_links;
create policy important_links_manage on public.important_links
  for all using (public.is_manager()) with check (public.is_manager());


-- ---------------------------------------------------------------------
-- important_files (metadata; bytes live in Storage — see below)
-- ---------------------------------------------------------------------
create table if not exists public.important_files (
  id            uuid primary key default gen_random_uuid(),
  file_name     text not null,
  storage_path  text not null unique, -- path within the important-files bucket
  file_size     bigint,
  content_type  text,
  created_by    uuid references public.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

alter table public.important_files enable row level security;

drop policy if exists important_files_select_all on public.important_files;
create policy important_files_select_all on public.important_files
  for select using (auth.role() = 'authenticated');

drop policy if exists important_files_manage on public.important_files;
create policy important_files_manage on public.important_files
  for all using (public.is_manager()) with check (public.is_manager());


-- ---------------------------------------------------------------------
-- Storage: private bucket + storage.objects policies
-- ---------------------------------------------------------------------
-- Private (not public) — downloads go through the authenticated client
-- (createSignedUrl), gated by the SELECT policy below, rather than a
-- guessable public URL.
insert into storage.buckets (id, name, public)
values ('important-files', 'important-files', false)
on conflict (id) do nothing;

drop policy if exists important_files_storage_select on storage.objects;
create policy important_files_storage_select on storage.objects
  for select using (bucket_id = 'important-files' and auth.role() = 'authenticated');

drop policy if exists important_files_storage_insert on storage.objects;
create policy important_files_storage_insert on storage.objects
  for insert with check (bucket_id = 'important-files' and public.is_manager());

drop policy if exists important_files_storage_delete on storage.objects;
create policy important_files_storage_delete on storage.objects
  for delete using (bucket_id = 'important-files' and public.is_manager());
