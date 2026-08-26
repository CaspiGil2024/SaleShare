-- =====================================================================
-- SailShare — Departure / Closing checklists
-- =====================================================================
-- No SystemSettings table exists anywhere in this project (checked all
-- migrations + source before writing this) — using the same pattern
-- already established for important_phones/important_links instead of
-- inventing a JSON-blob table to match an assumed shape.
--
-- checklist_items: the configurable list per type, manager-maintained
-- (same is_manager() gate from 0008 — reused, not duplicated, since
-- it's already the general-purpose "management roles" check).
--
-- checklist_submissions: the audit log. Deliberately append-only — no
-- UPDATE/DELETE policy for anyone, including managers. checked_items
-- is a JSON snapshot of {item_text, checked} at submission time (not a
-- live join to checklist_items), so a later edit/deletion of an item
-- can't retroactively change what a past audit record shows.
-- =====================================================================

create table if not exists public.checklist_items (
  id             uuid primary key default gen_random_uuid(),
  checklist_type text not null check (checklist_type in ('departure', 'closing')),
  item_text      text not null,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.checklist_items enable row level security;

drop policy if exists checklist_items_select_all on public.checklist_items;
create policy checklist_items_select_all on public.checklist_items
  for select using (auth.role() = 'authenticated');

drop policy if exists checklist_items_manage on public.checklist_items;
create policy checklist_items_manage on public.checklist_items
  for all using (public.is_manager()) with check (public.is_manager());


create table if not exists public.checklist_submissions (
  id                uuid primary key default gen_random_uuid(),
  checklist_type    text not null check (checklist_type in ('departure', 'closing')),
  completed_by      uuid references public.users(id) on delete set null default auth.uid(),
  completed_by_name text not null,
  completed_at      timestamptz not null default now(),
  checked_items     jsonb not null default '[]'::jsonb,
  notes             text
);

alter table public.checklist_submissions enable row level security;

-- Own submissions, or any submission if you're a manager (the "audit"
-- part of the requirement).
drop policy if exists checklist_submissions_select on public.checklist_submissions;
create policy checklist_submissions_select on public.checklist_submissions
  for select using (auth.uid() = completed_by or public.is_manager());

-- Any authenticated partner can log a completion — this isn't a
-- manager-only action, it's whoever actually performed the checklist —
-- but only as themselves.
drop policy if exists checklist_submissions_insert_own on public.checklist_submissions;
create policy checklist_submissions_insert_own on public.checklist_submissions
  for insert with check (auth.uid() = completed_by);

-- No UPDATE or DELETE policy at all, on purpose — see file header.
