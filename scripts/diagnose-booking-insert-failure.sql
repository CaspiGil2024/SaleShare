-- Diagnostic only — run in the Supabase SQL Editor and share the
-- output. Checks the two things most likely to break a booking INSERT
-- after a login-mechanism change: (1) an auth.users account with no
-- matching public.users profile (breaks the bookings.user_id FK), and
-- (2) a partner whose account is unexpectedly frozen/inactive (blocks
-- new bookings via 0015's trg_fn_block_frozen_or_inactive_booking).

-- 1. Any auth.users account with no public.users row at all — this
--    would make bookings.user_id's FK reject every insert attempt for
--    that specific account.
select au.id, au.email, au.created_at
from auth.users au
left join public.users pu on pu.id = au.id
where pu.id is null;

-- 2. Every real account's current state — check specifically whether
--    the account you tested with shows is_active = false or
--    is_frozen = true (either would block new bookings, unrelated to
--    the login change itself).
select id, email, full_name, role, is_active, is_frozen
from public.users
order by email;

-- 3. Roster rows whose email has no matching public.users account yet
--    (expected for anyone who's never logged in — not itself a bug,
--    just useful context).
select pr.email, pr.full_name, pr.is_active, pr.is_frozen
from public.partner_roster pr
left join public.users pu on lower(pu.email) = lower(pr.email)
where pu.id is null;
