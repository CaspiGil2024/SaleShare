# Changelog

All notable changes to SailShare/OBOR are recorded here. Newest entries first.

This file is maintained alongside every change from now on — see also the
in-app "מה חדש" modal (`src/data/releaseNotes.js`), which is the
Hebrew, end-user-facing counterpart aimed at partners rather than
developers.

## Unreleased

### Changed
- **Shared/Cyprus sail coins now settle once, at sail time, instead of
  re-splitting everyone's cost on every join/leave/guest-count change.**
  Confirmed against two fully-worked scenarios with exact expected
  balances at every step. Previously, `fn_recompute_shared_booking_
  participants` ran on every single participant-list change — a new
  partner joining would immediately refund and re-split every existing
  participant's charge too, moving balances that partner never touched.
  New model (migration `0061`): each participant is charged the sail's
  full (unsplit) price independently the moment they join — guest
  count is purely informational, capacity-checked but coin-neutral,
  until a new one-time settlement (`fn_settle_shared_booking`, swept by
  `fn_settle_due_shared_bookings` — called opportunistically from
  `CalendarPage.jsx` right after the existing solo-Cyprus-cancel and
  solo-Shared-to-Private sweeps) applies the TRUE guest-weighted
  proportional split once `start_time` has passed, reusing the
  existing `fn_recompute_shared_booking_participants` (0051) unchanged
  for that one-time computation. New `bookings.coins_settled` flag
  makes it idempotent; backfilled `true` for every already-past
  Shared/Cyprus sailing so the sweep doesn't churn historical data.
  `fn_join_shared_booking`/`fn_admin_add_shared_participant` now charge
  just the joiner; `fn_leave_shared_booking`/`fn_admin_remove_shared_
  participant` now just delete that one row (refunded by the existing
  per-row trigger); `fn_update_my_shared_participation_guests` and the
  organizer's own guest-count field in `fn_update_shared_booking` are
  now plain coin-neutral updates; editing a sail's date/time/type still
  reprices everyone at the new full price via a new `fn_reprice_all_
  participants_full`, since the cost basis itself changed. A guest-
  count increase that would exceed the 9-person cap now raises a
  dedicated message ("עברת את כושר השיט - לא ניתן להוסיף אורחים"),
  separate from the existing "can't add another partner" message for a
  brand-new participant.
  **Known gap**: `EditBookingModal.jsx`/`NewBookingModal.jsx` still
  display an estimated *guest-weighted split* while editing, but the
  actual pre-settlement charge is now the *full* price — that display
  estimate is now misleading until settlement and wasn't touched here.
- **`fn_organizer_leave_shared_booking` (0060) revised**: the departing
  organizer now stays aboard as a full participant (own guest count and
  charge untouched) — only `bookings.user_id` moves to a remaining
  partner. Verified against a worked example where the ex-organizer's
  own guest count is still reflected in the settlement split after they
  step down.
- Added `tests/sharedSailCoinEngine.test.js` (vitest + supabase-js) —
  real integration tests encoding both scenarios end-to-end against the
  actual RPCs (not a JS reimplementation of the coin math), including
  the capacity error message and the organizer handover. Requires a
  local Supabase stack (`supabase start`) to run — see
  `.env.test.example`; never point at the production project.

### Fixed
- **Hardened notification-email addressing against a misconfigured
  EmailJS template.** Audit result: `emailNotifications.js` has no
  hardcoded recipient and never did — every send already passed the real
  per-partner address as `to_email`, and the recipient queries
  (`NewBookingModal`, `EditBookingModal`, `MessagesPage`) correctly
  select `emails_enabled = true` partners. The failure mode where every
  message lands in one inbox comes from the EmailJS **template** "To
  Email" field being blank / a literal address / a tag the app doesn't
  send (EmailJS starter templates default it to `{{email}}`, the app
  sent `{{to_email}}`). Each send now supplies the recipient under
  `to_email`, `email`, and `recipient` at once (via a new
  `recipientTags()` helper) so a template wired to any of them addresses
  the right person; a new `withValidEmail()` guard drops rows with a
  missing/invalid address before they reach EmailJS (an empty `to_email`
  is what makes EmailJS fall back to the account's own address). Grounding
  alert / resolution queries now also require `is_active = true`, and all
  recipient queries exclude null emails. The `.env.example` block spells
  out the required dashboard setting. **Still requires a one-time check
  on the EmailJS dashboard: every template's "To Email" must be
  `{{to_email}}`.**
- **A "deleted" shared sail could resurrect itself, and a partner who
  had stepped down as organizer could still cancel it.** With other
  partners aboard, `EditBookingModal.jsx`'s single destructive button
  routed the organizer through `fn_organizer_leave_shared_booking`
  (0060), which only ever *hands off* `bookings.user_id` to the
  earliest-joined remaining partner — it never actually cancels. So the
  new organizer pressing "delete" just bounced the organizer role back
  to whoever it came from, and the sail reappeared in its original
  shape. Migration `0062` adds `fn_cancel_shared_booking(p_booking_id)`
  — a real, permanent cancellation (`status = 'Cancelled'`, existing
  refund trigger pays everyone back) gated to the **current**
  `bookings.user_id` or a manager — and the edit modal now shows it as
  its own "ביטול ההפלגה עבור כל המשתתפים" action, separate from the
  "עזיבת תפקיד המארגן/ת" hand-off (only offered when there is someone to
  hand off to). `fn_organizer_leave_shared_booking` now flags the
  departing organizer's row (`booking_participants.stepped_down`) and
  picks the replacement `order by stepped_down asc, created_at asc`, so
  the role can't ping-pong back to someone who already left it. The
  modal also re-reads `bookings.user_id` fresh on open (the calendar's
  cached value went stale after a hand-off, briefly showing a former
  organizer the organizer-only controls).
- **The shared-sail edit modal showed two "מספר האורחים שלכם" guest
  selectors to a non-organizer with edit rights** (e.g. a manager who
  had joined): the main form's field — which actually submits the
  *organizer's* guest count — plus the self-service one inside the
  participants section. The main-form selector is now hidden for a
  non-organizer on a Shared/Cyprus sail; they use the participants-
  section control, which is genuinely their own.
- **The edit modal's "your share of the cost" estimate flashed a wrong
  number before the participant roster loaded** (e.g. ~1.5 instead of
  2.0 on a 3-coin sail where the organizer brings one guest), because it
  rendered against `guestsCount = 0` for a beat. Both the organizer and
  the joiner/participant estimate lines now wait for
  `participantsLoading` to clear. The server-side settlement split
  (`fn_recompute_shared_booking_participants`, unchanged) was always
  correct — `(1 + own guests) / Σ(1 + guests)` — and now has an explicit
  regression test for the reported case.
- **A new shared sail's "come join" broadcast email reached almost
  nobody but the organizer's own confirmation email.** `NewBookingModal.jsx`
  (and `EditBookingModal.jsx`'s matching cancellation broadcast) required
  BOTH `users.emails_enabled` AND the finer-grained `receive_shared_sail_
  notifications` toggle to be true before including a partner — the
  second flag defaults to `false` and nothing was pushing partners to
  opt into it separately, so in practice the broadcast list came back
  empty and only the creator's always-sent personal confirmation email
  went out, which read as "email only goes to the organizer." Both
  broadcasts now require only `emails_enabled = true` (plus a newly
  added `is_active = true`, which was never checked before either —
  a deactivated account with emails enabled could previously still get
  broadcasts). Note: `receive_shared_sail_notifications` is now
  unused by these two broadcasts — its column, `AuthProvider.jsx` load,
  and its checkbox in `EditPartnerModal.jsx` were left in place rather
  than removed, since deleting a working toggle wasn't asked for; worth
  a decision on whether to remove it or repurpose it later.
- **Raw floating-point coin balances (e.g. `43.333333333333336`, a
  guest-weighted split's repeating decimal) leaked into the UI
  unrounded in two spots.** The admin balance-adjustment modal
  (`MaintenanceDataPage.jsx`'s `EditBalanceModal`) seeded its editable
  inputs with `String(rawBalance)` instead of a rounded value — fixed
  to seed from `formatCoinAmount` (2dp) instead, with the "did this
  field actually change" check updated to compare against that same
  rounded baseline so merely opening and saving the modal untouched no
  longer writes a spurious audited "change" caused only by rounding.
  `CoinBalanceBar.jsx` (currently unused, but part of the shared coin-
  display surface) rendered `wallet[key]` with no formatting at all —
  now goes through `formatCoinAmount` like every other coin display in
  the app. Every other on-screen coin display was already going through
  `formatCoinAmount`/`formatCoinDisplay`, confirmed by an audit across
  every component and page that touches `coins_*`/`balance`/`wallet`
  fields. Also rounded every coin/balance number written into the xlsx
  exports (`xlsxExport.js`) — those weren't a screen-display bug but
  the same underlying float would have shown up just as ugly in a
  downloaded spreadsheet; a new local `roundCoin()` helper mirrors the
  `.toFixed(1)` rounding that file already applied to `hours`.
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
