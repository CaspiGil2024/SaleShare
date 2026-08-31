-- =====================================================================
-- SailShare — booking cancel/edit RLS didn't match the app's own
-- "manager" definition, silently blocking non-treasurer managers
-- =====================================================================
-- EditBookingModal.jsx's canEdit gate (and its Cancel-sailing button)
-- has always been:
--   booking.user_id === currentUser.id || isManager(currentUser)
-- where isManager() (src/lib/permissions.js) checks role in
-- ('treasurer', 'ceo', 'sailing_officer', 'maintenance') — matching
-- is_manager() below, which several OTHER tables already use (e.g.
-- fn_admin_add_shared_participant's organizer-or-admin check pulls from
-- a narrower is_admin(), but the general "manager" tier used for
-- Announcements/Checklists/ImportantInfo/etc. is this same set).
--
-- bookings' own elevated-access RLS policy was never updated to match:
-- bookings_treasurer_all (0004, last touched 0006) only grants 'for
-- all' access to public.is_treasurer() — literally the treasurer role
-- alone. A CEO, sailing_officer ("אחראי הפלגות"), or maintenance-role
-- user is NOT a treasurer, so bookings_update_own (owner-only) doesn't
-- match them and bookings_treasurer_all doesn't either: the UI shows
-- them the edit form and an enabled "ביטול ההפלגה" button for another
-- partner's sailing, but the UPDATE silently matches zero rows under
-- RLS, surfacing as "ייתכן שאין לכם הרשאה" — even though the app's own
-- design says they should have exactly this permission.
--
-- Fix: replace the treasurer-only policy with one keyed off
-- is_manager(), the same function/role set the frontend already uses
-- for this gate. Renamed bookings_manager_all so the name matches what
-- it actually checks instead of implying treasurer-only.
--
-- Regular partners are unaffected — bookings_update_own (auth.uid() =
-- user_id) was already correctly restricting them to their own
-- bookings, and stays exactly as-is.
-- =====================================================================

drop policy if exists bookings_treasurer_all on public.bookings;
drop policy if exists bookings_manager_all on public.bookings;
create policy bookings_manager_all on public.bookings
  for all using (public.is_manager()) with check (public.is_manager());
