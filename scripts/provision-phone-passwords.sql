-- =====================================================================
-- SailShare — one-time: set auth password = cleaned phone number
-- =====================================================================
-- Run manually in the Supabase SQL Editor, ONCE. Self-sufficient — it
-- adds public.users.must_change_password itself if migration 0039
-- hasn't been applied yet (Step 0 below), so run order doesn't matter.
-- Still apply 0039 normally too so the column stays part of the
-- tracked schema history, not just a side effect of this script. Not
-- a numbered migration itself on purpose:
--   - it writes directly into Supabase's internal auth.users table
--     (the standard-but-unsupported crypt()/gen_salt('bf') technique
--     against encrypted_password — there is no public API for this);
--   - it only ever needs to run once per person, not on every fresh
--     deploy/re-run of the migration set.
--
-- SECURITY WARNING — read before running:
-- The temporary password this sets (a partner's own phone number) is
-- almost certainly known or easily learned by other partners in this
-- group (shared WhatsApp group, roster sheet, etc.) — this is
-- meaningfully weaker than a per-person random temp password. From the
-- moment this script runs until a given partner actually logs in and
-- is forced through the app's new password-change screen, ANYONE who
-- knows or guesses that phone number can sign in as them. To limit the
-- exposure window:
--   1. Send each partner their login instructions individually
--      (1:1 message: "log in with your email + your phone number"),
--      never broadcast to the whole group at once.
--   2. Ask them to log in and set a real password immediately.
--   3. Don't publish or leave visible anywhere a list pairing
--      partners' emails to their phone numbers.
--
-- SCOPE: this only touches partners who already have an auth.users
-- account (they've signed in before, so public.users.phone is already
-- populated via fn_apply_partner_roster). It deliberately does NOT
-- create new accounts for roster entries that have never signed up —
-- hand-constructing a new Supabase Auth user via raw SQL is unsupported
-- and easy to get subtly wrong (missing identities row, confirmation
-- state, etc.). For those partners, either have them use "Sign up"
-- once with their phone number as the chosen password, or create the
-- account via Dashboard -> Authentication -> Add User first, then
-- re-run this script.
-- =====================================================================

-- Step 0 — make this script runnable standalone, regardless of whether
-- migration 0039 (or pgcrypto's original 0001 install) has actually
-- been applied to this database yet. Both are idempotent no-ops if
-- already present, so safe to run every time.
alter table public.users
  add column if not exists must_change_password boolean not null default false;

create extension if not exists pgcrypto;


-- Step 1 — preview who this will affect before writing anything.
select pu.email, pu.full_name, pu.phone
from public.users pu
where pu.phone is not null and pu.phone <> ''
order by pu.full_name;


-- Step 2 — set each affected account's password to their own phone
-- number, cleaned of dashes/spaces and the +972/972 country code
-- (e.g. '054-7750141' or '+972-54-7750141' -> '0547750141'). Reads
-- straight from public.users.phone, so no phone numbers are hardcoded
-- in this file.
update auth.users au
set encrypted_password = crypt(
      regexp_replace(
        regexp_replace(replace(replace(pu.phone, '-', ''), ' ', ''), '^\+?972', '0'),
        '\D', '', 'g'
      ),
      gen_salt('bf')
    ),
    updated_at = now()
from public.users pu
where au.id = pu.id
  and pu.phone is not null and pu.phone <> '';


-- Step 3 — force the app's first-login password-change screen for
-- every account just touched.
update public.users
set must_change_password = true
where phone is not null and phone <> '';
