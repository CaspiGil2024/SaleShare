-- =====================================================================
-- SailShare — open Reports (and the balances behind it) to every partner
-- =====================================================================
-- ReportsPage.jsx's activity report already only depended on bookings/
-- booking_participants, both already fully open to any authenticated
-- partner (bookings_select_all / booking_participants_select_all) — no
-- RLS change was needed for that part; only the client-side
-- isManager() gate was blocking it, removed separately in
-- ReportsPage.jsx.
--
-- The NEW all-partners coin-balance report is different: it reads
-- user_wallets, which was still narrowly restricted to "your own row,
-- or a treasurer" (0004/0006) — a real gap for this feature, not just
-- a UI thing. Broadening it to match bookings/booking_participants'
-- existing openness. This is a deliberate transparency choice, not an
-- oversight: Michael's Method's own stated goals (שיוויון — equality;
-- תעדוף לשותפים המפליגים מעט — priority for partners who sail little)
-- depend on partners being able to SEE relative balances/usage to
-- trust the system is fair, the same way the activity report already
-- shows everyone's hours to everyone.
-- =====================================================================

drop policy if exists wallets_select_own on public.user_wallets;
create policy wallets_select_own on public.user_wallets
  for select using (auth.role() = 'authenticated');
