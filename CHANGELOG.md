# Changelog

All notable changes to SailShare/OBOR are recorded here. Newest entries first.

This file is maintained alongside every change from now on — see also the
in-app "מה חדש" modal (`src/data/releaseNotes.js`), which is the
Hebrew, end-user-facing counterpart aimed at partners rather than
developers.

## Unreleased

### Fixed
- Shared/Cyprus sailing: a partner who already joined had no way to change
  their own guest count afterward (only leave-and-rejoin) — added
  self-service guest-count editing (`fn_update_my_shared_participation_guests`,
  migration `0057`) with the same dynamic 9-person capacity ceiling used
  elsewhere.
- The bold coin-balance badge (Calendar page) did not refresh after
  creating/editing/cancelling a booking without navigating away and back —
  it now refetches immediately (`CoinBalanceBadge`'s new `refreshToken` prop).
- Audited every scrollable table/modal in the app for clipped rows —
  confirmed all already wrap their content in a proper `overflow-auto`
  container with a sensible max-height; no gaps found.

### Verified (no change needed)
- Shared-sailing cost splitting for a joining partner uses the exact same
  guest-weighted proportional formula as the organizer (migration `0051`) —
  confirmed no asymmetry exists between the two paths.
- Shared-sailing costs are recomputed and settled in real time on every
  join/leave/admin add-remove, not deferred to the sailing's start time —
  confirmed this is the intended, already-correct design (participants can
  still join/leave up to 7 days after a sailing starts, per `0046`).

## 2026-09-01 — Double-entry coin ledger

### Added
- **Manual coin journal** (מנהל / אחראי הפלגות only): a proper
  Debit/Credit entry screen under תחזוקה ונתונים, with partner, coin
  type, חובה/זכות toggle, amount, value date (תאריך ערך), and an optional
  note — `fn_admin_manual_coin_entry` (migration `0055`). Redesigned into
  a single-row responsive flex layout with the "רישום תנועה" button
  aligned at the end.
- **Periodic partner statement** report (דוח תקופתי לשותף, under דוחות):
  per-coin-type Debit / Credit / Running Balance columns over a chosen
  date range, including an **opening-balance row** ("יתרת פתיחה") when
  prior transactions exist before the selected start date —
  `fn_partner_coin_statement` (migration `0055`).
- **Total balance column** ("יתרה כוללת") on the יתרות שותפים report tab —
  the sum of all 4 coin types per partner, shown as a highlighted badge,
  also included in the Excel export.

### Fixed
- `coin_transactions.balance_before`/`balance_after` were `NULL` on every
  historical quarterly-allowance grant (`fn_allocate_period_coins` never
  set them). Fixed going forward, and backfilled every existing row via a
  new reusable `fn_recompute_coin_transaction_balances()` (migration
  `0056`) — correctly scoped **per period** (wallets do not roll over
  between periods, so a naive all-time cumulative sum would have
  overstated balances across a period boundary).
- `fn_partner_coin_statement` now reads the recomputed `balance_after`
  directly instead of independently re-deriving a running total, so it
  can never drift from the ledger again.
- Standardized every date/date-time display across the app to `dd/mm/yyyy`
  (and `dd/mm/yyyy HH:MM`) via a new shared `src/lib/dateFormat.js` —
  `toLocaleDateString('he-IL')` was unpadded and dot-separated
  (e.g. `3.9.2026`), not the intended slash-separated Israeli format.
  Long-form descriptive dates (weekday + full month name, e.g. booking
  modal headers, release notes, emails) were left as-is — a deliberately
  different style.

## Earlier

Prior work (Michael's Method coin engine, booking rules, shared-sailing
join/leave, sailing log, reports, maintenance/messages pages, sidebar
reorganization, and more) predates this changelog and is not
individually itemized here — see `git log` and `supabase/migrations/`
for the full history.
