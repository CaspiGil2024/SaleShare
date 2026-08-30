-- =====================================================================
-- SailShare — permanently purge unregistered ("orphan") accounts
-- =====================================================================
-- Run manually in the Supabase SQL Editor. "Orphan" = an account that
-- signed up directly (old self-service flow, since removed) and was
-- never added to partner_roster — shown in the Partners screen with
-- the amber "לא ברשימת שותפים" badge (see PartnersPage.jsx's
-- fetchPartners).
--
-- SECURITY / DATA-LOSS WARNING — read before running:
-- Deleting from auth.users CASCADES all the way down: public.users
-- (FK: public.users.id references auth.users(id) on delete cascade),
-- then from there to every one of THEIR bookings, booking_participants
-- rows, coin_transactions (their own AND any admin-adjustment audit
-- rows recorded against them), and user_wallets/user_roles. This is
-- permanent and cannot be undone from within the app — there is no
-- soft-delete for this path. If you want them gone from view without
-- destroying their history, set is_active = false on their
-- public.users row instead (Step 0 below) rather than running Step 2.
--
-- Only ever targets emails YOU explicitly list in Step 2 below — this
-- deliberately does NOT offer a "delete every orphan" blanket option,
-- since an orphan might just be a legitimate new partner who hasn't
-- been added to the roster yet, not someone to purge.
-- =====================================================================


-- Step 0 (optional, non-destructive alternative) — hide an orphan from
-- view without deleting anything. Uncomment and fill in to use this
-- instead of Steps 1-2.
-- update public.users set is_active = false where lower(email) = lower('someone@example.com');


-- Step 1 — see every current orphan before deciding what to delete.
select u.id, u.email, u.full_name, u.created_at
from public.users u
where not exists (
  select 1 from public.partner_roster pr where lower(pr.email) = lower(u.email)
)
order by u.created_at;


-- Step 2 — list the EXACT emails to permanently delete. Nothing runs
-- against anyone not named here.
with targets (email) as (
  values
    ('REPLACE_ME_1@example.com'),
    ('REPLACE_ME_2@example.com')
)
delete from auth.users au
using targets t
where lower(au.email) = lower(t.email)
returning au.id, au.email;
