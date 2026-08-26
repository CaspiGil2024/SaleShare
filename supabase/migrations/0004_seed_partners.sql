-- =====================================================================
-- SailShare — Phase: Full partner roster + multi-role support
-- =====================================================================
-- Design notes (read before applying):
--
-- 1. WHY NOT A DIRECT public.users UPSERT: public.users.id is a foreign
--    key to auth.users(id) (see 0001). A plain "insert ... on conflict
--    (email) do update" against public.users would foreign-key-violate
--    for every partner who doesn't have a real Supabase Auth account
--    yet — which, as of this migration, is everyone except whoever is
--    already logged into this project (matched below by email). These
--    are real people's real personal email addresses, so this
--    migration does NOT create auth accounts or send any invite email;
--    that has to be a deliberate, separate action.
--
--    Instead, the full roster (name/phone/roles/balance/active) is
--    staged in a new public.partner_roster table, keyed by email, with
--    no dependency on auth.users. fn_apply_partner_roster() copies a
--    roster row onto a real public.users row once one exists, and is
--    wired into the existing sign-up trigger (0003) so it runs
--    automatically the moment each partner actually signs in for the
--    first time — no manual follow-up needed per person. It's also run
--    once at the bottom of this file for whichever accounts already
--    exist today.
--
-- 2. ROLES: the original user_role enum ('partner' | 'treasurer') only
--    supports one role per person and doesn't cover Admin / CEO /
--    Maintenance / Lab Tester, several of which the same person holds
--    simultaneously (e.g. Eyal Rashelbach: Treasurer+Admin+Maintenance+
--    Lab Tester). A new public.user_roles junction table replaces the
--    single-column model for permission purposes; the old
--    public.users.role column is kept in sync (treasurer if 'treasurer'
--    is among the roles, else partner) purely for readability/back-
--    compat, but RLS policies below now check user_roles instead of it.
--
-- 3. BALANCE: user_wallets splits coins into 4 buckets (weekend/midweek
--    x day/night) per sharing period; the roster only has one flat
--    number per partner. Per instruction, the full balance is written
--    into coins_midweek_day and the other 3 buckets are zeroed. This is
--    a placeholder split, not a real historical breakdown — rebalance
--    per person later if the real bucket composition matters.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Expanded role model
-- ---------------------------------------------------------------------
do $$ begin
  create type public.partner_role as enum (
    'partner', 'treasurer', 'admin', 'ceo', 'maintenance', 'lab_tester'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.user_roles (
  user_id uuid not null references public.users(id) on delete cascade,
  role    public.partner_role not null,
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;

drop policy if exists user_roles_select_all on public.user_roles;
create policy user_roles_select_all on public.user_roles
  for select using (auth.role() = 'authenticated');

-- Self-referencing membership check is the standard RLS pattern for
-- "does the requester hold role X" — Postgres evaluates it as a normal
-- correlated subquery, not an infinite policy recursion.
drop policy if exists user_roles_treasurer_write on public.user_roles;
create policy user_roles_treasurer_write on public.user_roles
  for all using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'treasurer'
    )
  );


-- ---------------------------------------------------------------------
-- New profile fields the roster needs
-- ---------------------------------------------------------------------
alter table public.users
  add column if not exists phone text,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_test_account boolean not null default false;


-- ---------------------------------------------------------------------
-- Switch treasurer-gated RLS policies from the single role column to
-- user_roles membership (needed because Gil Caspi and Eyal Rashelbach's
-- treasurer access must keep working once 'treasurer' lives in
-- user_roles rather than solely in public.users.role).
-- ---------------------------------------------------------------------
drop policy if exists periods_treasurer_write on public.periods;
create policy periods_treasurer_write on public.periods
  for all using (
    exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'treasurer')
  );

drop policy if exists wallets_select_own on public.user_wallets;
create policy wallets_select_own on public.user_wallets
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'treasurer')
  );

drop policy if exists wallets_treasurer_write on public.user_wallets;
create policy wallets_treasurer_write on public.user_wallets
  for all using (
    exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'treasurer')
  );

drop policy if exists bookings_treasurer_all on public.bookings;
create policy bookings_treasurer_all on public.bookings
  for all using (
    exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'treasurer')
  );


-- ---------------------------------------------------------------------
-- Staged roster (no auth.users dependency)
-- ---------------------------------------------------------------------
create table if not exists public.partner_roster (
  email           text primary key,
  full_name       text not null,
  phone           text,
  roles           public.partner_role[] not null default '{partner}',
  balance         numeric not null default 0,
  is_active       boolean not null default true,
  is_test_account boolean not null default false,
  applied_at      timestamptz -- set once actually copied onto a real public.users row
);

alter table public.partner_roster enable row level security;

-- Contains phone numbers + balances for real people — only treasurers
-- can read the staging table itself (regular partners see roles/phone
-- for provisioned accounts via public.users/user_roles as normal).
drop policy if exists partner_roster_treasurer_select on public.partner_roster;
create policy partner_roster_treasurer_select on public.partner_roster
  for select using (
    exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'treasurer')
  );

insert into public.partner_roster (email, full_name, phone, roles, balance, is_active, is_test_account) values
  ('nulman.adr@gmail.com',        'Adir Nulman',              '053-2767969', array['lab_tester','maintenance']::public.partner_role[], 50,  true, false),
  ('uribd11@gmail.com',           'Uri Ben David',             '054-4497550', array['partner']::public.partner_role[],                  38,  true, false),
  ('eyal.rashelbach@gmail.com',   'Eyal Rashelbach',           '054-7750141', array['treasurer','admin','maintenance','lab_tester']::public.partner_role[], 88, true, false),
  ('eyal.adanya@gmail.com',       'Eyal Adanya',                '054-4223272', array['partner']::public.partner_role[],                  30,  true, false),
  ('eladfh47@gmail.com',          'Elad Fahima',                '054-2133449', array['partner']::public.partner_role[],                  90,  true, false),
  ('levy.amnon@gmail.com',        'Amnon Levy',                 '054-2476767', array['partner']::public.partner_role[],                  70,  true, false),
  ('erez7075@gmail.com',          'Erez Shalev',                '050-4343410', array['partner']::public.partner_role[],                  90,  true, false),
  ('guy.natanson@gmail.com',      'Guy Natanson',               '050-5885569', array['partner']::public.partner_role[],                  0,   true, false),
  ('caspigil@gmail.com',          'Gil Caspi',                  '052-3844744', array['admin','treasurer']::public.partner_role[],        90,  true, false),
  ('kabas@netpath.co.il',         'David Kabas',                '052-3513478', array['partner']::public.partner_role[],                  90,  true, false),
  ('dror.lederman@gmail.com',     'Dror Lederman',              '050-2285052', array['ceo','admin']::public.partner_role[],              90,  true, false),
  ('lederman.dror@gmail.com',     'Dror (QA Mock Partner)',     '050-2285052', array['partner']::public.partner_role[],                  85,  true, true),
  ('mailzohar@gmail.com',         'Zohar Ronen',                '052-4286520', array['partner']::public.partner_role[],                  45,  true, false),
  ('igalstar1@gmail.com',         'Igal Smadja',                '054-6098375', array['partner']::public.partner_role[],                  90,  true, false),
  ('yossound@gmail.com',          'Yossi Apelbaum',             '052-5290669', array['partner']::public.partner_role[],                  86,  true, false),
  ('mwexler101@gmail.com',        'Michael Wexler',             '054-2993303', array['admin']::public.partner_role[],                    32,  true, false),
  ('ariinpire@gmail.com',         'Nir Engel',                  '053-9822597', array['partner']::public.partner_role[],                  14,  true, false),
  ('hason25@gmail.com',           'Amer Yosri',                 '050-5355872', array['partner']::public.partner_role[],                  45,  true, false),
  ('oded@bnc-il.com',             'Oded Gutentag',              '054-3928909', array['ceo','admin']::public.partner_role[],              158, true, false),
  ('einel00h@gmail.com',          'Einel Chaimovitz',           '052-9259933', array['partner']::public.partner_role[],                  0,   true, false),
  ('bugpwr@gmail.com',            'Pavel Razdoyolovsky',        '054-4818021', array['partner']::public.partner_role[],                  90,  true, false)
on conflict (email) do update set
  full_name       = excluded.full_name,
  phone           = excluded.phone,
  roles           = excluded.roles,
  balance         = excluded.balance,
  is_active       = excluded.is_active,
  is_test_account = excluded.is_test_account;


-- ---------------------------------------------------------------------
-- Copies one roster row onto an already-existing public.users row:
-- profile fields, user_roles membership, and the (placeholder,
-- single-bucket) wallet balance for the current period, if one exists.
-- Safe to call multiple times for the same user (fully idempotent).
-- ---------------------------------------------------------------------
create or replace function public.fn_apply_partner_roster(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_roster    public.partner_roster%rowtype;
  v_period_id public.periods.id%type;
  v_role      public.partner_role;
begin
  select * into v_roster from public.partner_roster where lower(email) = lower(p_email);
  if not found then
    return;
  end if;

  update public.users
    set phone           = v_roster.phone,
        is_active       = v_roster.is_active,
        is_test_account = v_roster.is_test_account,
        role = case
          when 'treasurer'::public.partner_role = any(v_roster.roles) then 'treasurer'
          else 'partner'
        end
    where id = p_user_id;

  delete from public.user_roles where user_id = p_user_id;
  foreach v_role in array v_roster.roles loop
    insert into public.user_roles (user_id, role) values (p_user_id, v_role)
      on conflict do nothing;
  end loop;

  select id into v_period_id from public.periods where is_current = true limit 1;
  if v_period_id is not null then
    update public.user_wallets
      set coins_midweek_day   = v_roster.balance,
          coins_weekend_day   = 0,
          coins_weekend_night = 0,
          coins_midweek_night = 0
      where user_id = p_user_id and period_id = v_period_id;
  end if;

  update public.partner_roster set applied_at = now() where lower(email) = lower(p_email);
end;
$$;


-- ---------------------------------------------------------------------
-- Wire it into sign-up: the moment a roster partner actually creates
-- their auth account, their roles/phone/balance apply automatically —
-- no manual step needed per person going forward.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;

  insert into public.user_wallets (user_id, period_id)
  select new.id, p.id
  from public.periods p
  where p.is_current = true
  on conflict (user_id, period_id) do nothing;

  perform public.fn_apply_partner_roster(new.id, new.email);

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- One-time backfill for accounts that already exist today (as of this
-- migration, that's just whichever partner(s) have already signed in).
-- ---------------------------------------------------------------------
do $$
declare
  v_user record;
begin
  for v_user in select id, email from public.users loop
    perform public.fn_apply_partner_roster(v_user.id, v_user.email);
  end loop;
end $$;
