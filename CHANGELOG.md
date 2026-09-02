# Changelog

All notable changes to SailShare/OBOR are recorded here. Newest entries first.

This file is maintained alongside every change from now on — see also the
in-app "מה חדש" modal (`src/data/releaseNotes.js`), which is the
Hebrew, end-user-facing counterpart aimed at partners rather than
developers.

## Unreleased

### Fixed
- **The organizer of a Shared/Cyprus sailing had no way to leave it
  without cancelling the whole thing for every other partner still on
  it.** `fn_leave_shared_booking` (0044) explicitly refused the
  organizer ("המארגן/ת לא יכול/ה לעזוב... ניתן לבטל אותה"), and
  `EditBookingModal.jsx`'s only organizer-facing exit was "ביטול
  ההפלגה" — a full cancellation that refunds and removes every
  remaining partner, even when they were actively participating and
  had no wish to lose the sailing. Fixed with a new organizer-only RPC,
  `fn_organizer_leave_shared_booking` (migration `0060`): if no other
  partner is on the sail, leaving still cancels it exactly as before
  (nothing to hand it to); otherwise the organizer's own participant
  row is dropped, `bookings.user_id` is reassigned to a remaining
  partner, and the existing `fn_recompute_shared_booking_participants`
  engine reruns across whoever's left — refunding and recharging
  everyone from scratch against the new (larger) total shares, the
  same correct redistribution a non-organizer's departure already
  triggers. `EditBookingModal.jsx`'s cancel button now reads "עזיבת
  ההפלגה (העברת ניהול לשותף אחר)" and skips the cancellation email
  whenever the sail is actually still happening.
- **Editing another partner's roles/phone/status from `EditPartnerModal.jsx`
  raised "שינוי שדות אלה עבור שותף אחר חייב לעבור דרך ניהול שותפים
  (partner_roster)" — even though the save WAS going through
  partner_roster, exactly as the message demanded.** Root cause:
  `trg_fn_enforce_users_field_gate` (0033/0037/0043) unconditionally
  blocks any non-self change to full_name/email/phone/role/is_active/
  is_frozen/is_test_account on `public.users`. But the legitimate sync
  that message points you toward — `trg_sync_roster_to_user` (0018)
  calling `fn_apply_partner_roster` (0004+) whenever an admin saves a
  `partner_roster` edit — writes exactly those same fields onto the
  matching `users` row, and `auth.uid()` inside that `SECURITY DEFINER`
  sync is still the admin who saved the edit, not the target partner —
  so the gate blocked its own prescribed fix path for every admin edit
  of *another* partner (the normal case; only editing your own row
  ever worked). Fixed (migration `0059`) with the same transaction-local
  GUC bypass pattern already used for `trg_fn_block_past_cancellation`'s
  auto-cancel exemption (0044): `fn_apply_partner_roster` sets a flag
  right before its own `UPDATE`, and the field gate exits immediately
  when that flag is set — scoped to just this one function's own
  statement, not a general bypass. No frontend changes needed —
  `EditPartnerModal.jsx` was already doing the right thing.

### Added
- **Critical maintenance / vessel-grounding notifications — both ends
  wired, both templates configured.** New `users.receive_critical_updates`
  preference (migration `0058`, same self/admin field-gate shape as
  `emails_enabled`/`receive_shared_sail_notifications`) with a checkbox
  in `EditPartnerModal.jsx`. New `maintenance_issues.is_grounding` flag,
  set via a prominent checkbox in `MessagesPage.jsx`'s "דיווח תקלה
  חדשה" form and shown as a badge on the issue card. Two emails, same
  `emails_enabled` + `receive_critical_updates` audience:
  - `sendVesselGroundingAlertEmails` (new) — fires immediately from
    `NewIssueForm`'s submit handler when a new issue is reported with
    "השבתת יאכטה" checked. Fixed message "היאכטה הושבתה עקב תקלה ואינה
    כשירה לשייט" + the ticket's summary/description. Env var
    `VITE_EMAILJS_TEMPLATE_VESSEL_GROUNDING`.
  - `sendMaintenanceResolvedNotificationEmails` — fires from
    `IssueCard.handleResolve` when a grounding issue is marked resolved.
    Fixed message "התקלה נפתרה והיאכטה מוכנה לשימוש" + summary/resolution
    notes. Env var `VITE_EMAILJS_TEMPLATE_MAINTENANCE_RESOLVED`.
  
  Both template IDs are now set in `.env.local`.
- **Full EmailJS notification system, wired end to end.** The client
  wrapper (`src/lib/emailNotifications.js`) and env var placeholders
  already existed from an earlier pass but the actual call sites had
  been left deliberately disconnected pending a real mail provider —
  now connected:
  - `sendBookingConfirmationEmail` — fires from `NewBookingModal.jsx`
    after any successful booking, to the organizer, respecting their
    own `emails_enabled`.
  - `sendSharedSailNotificationEmails` — fires from `NewBookingModal.jsx`
    when a new Shared/Cyprus sailing is created, broadcasting to every
    *other* partner with `emails_enabled` **and**
    `receive_shared_sail_notifications` on ("a new shared sailing is
    open, come join" — the organizer is always the sole participant at
    creation time, so this isn't a notice to existing crew).
  - `sendCancelSharedSailNotificationEmails` (new) — fires from
    `EditBookingModal.jsx`'s `handleCancelSail`, same opted-in audience,
    when a Shared/Cyprus sailing is cancelled. New env var
    `VITE_EMAILJS_TEMPLATE_CANCEL_SHARED_SAIL`.
  - All three are fire-and-forget (not awaited) and no-op softly
    (console.warn/error, never throw) if EmailJS isn't configured or a
    recipient hasn't opted in — never risks the booking/cancellation
    that already succeeded.

### QA pass
- Re-ran `npm run build` clean (this project has no TypeScript and no
  configured lint script — Vite's build is the only automated check
  available, same as every prior pass in this changelog).
- Verified `emails_enabled` / `receive_shared_sail_notifications` are
  spelled identically everywhere they're read or written
  (`AuthProvider.jsx`, `EditPartnerModal.jsx`, `NewBookingModal.jsx`,
  `EditBookingModal.jsx`) and actually exist as columns on `public.users`
  (migration `0037`, both `not null default false`).
- Verified the `users_select_all` RLS policy (`auth.role() =
  'authenticated'`, no column restriction) lets the recipient-list
  queries in `NewBookingModal.jsx`/`EditBookingModal.jsx` actually read
  other partners' `email`/`emails_enabled`/`receive_shared_sail_
  notifications` — a stricter policy here would have silently emptied
  the recipient list with no error.
- Verified `trg_fn_enforce_users_field_gate` (0037) lets a partner freely
  edit their own two preference columns (`auth.uid() = NEW.id` bypasses
  the gate entirely) — self-service saving from `EditPartnerModal.jsx`
  works as intended.

### Changed
- **Dark mode extended app-wide.** The theme toggle (added 2026-09-01,
  sidebar only) previously left every page's content on hardcoded
  light-mode Tailwind classes. Applied a systematic `dark:` variant to
  every card, table, form, modal, and text color across all 33
  page/component files via a scripted, rule-based pass
  (`scripts/apply-dark-mode.py`) — neutral chrome (backgrounds, text,
  borders) and colored badges/alerts (blue/rose/emerald/amber/etc.) both
  covered; solid filled buttons were deliberately left unchanged since
  they already read fine on a dark background. `Sidebar.jsx`/`App.jsx`
  were excluded from the script (already hand-done) to avoid duplicate
  `dark:` classes on the same element — one such duplication slipped in
  on `App.jsx` before that exclusion was added and was cleaned up by hand.
  Not visually verified in a browser this session (no such tool
  available) — please flag anything that looks off.
- Synced the in-app "מה חדש" modal (`src/data/releaseNotes.js`) with
  everything shipped since the 2026-08-30 entry — it had fallen behind
  because new work was only being logged here, not in the array the
  modal actually reads from. Both are now updated together going forward.

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

## 2026-09-01 — Day/Night mode toggle (sidebar foundation)

### Added
- Theme toggle icon (sun/moon) in the sidebar's user-profile row —
  persists to `localStorage`, falls back to OS preference on first visit,
  smooth color transitions. `src/theme/ThemeProvider.jsx` +
  `darkMode: 'class'` in `tailwind.config.js`. Scoped at the time to the
  sidebar/header chrome only — see "Unreleased" above for the app-wide
  follow-up.

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
