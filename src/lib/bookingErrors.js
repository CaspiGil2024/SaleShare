// Shared between NewBookingModal.jsx and EditBookingModal.jsx — both
// insert/update rows on `bookings` (or call the shared-booking RPCs),
// so both can hit the same server-side rejections.
//
// Design (2026-08-27, replacing the old approach): only translate the
// couple of errors that are genuinely cryptic in their raw Postgres
// form — an EXCLUDE-constraint violation's raw text is internal
// Postgres jargon, not something to show a partner. Everything else —
// the S-rule quota, insufficient coins (incl. overdraft floor), the
// 16-day/8-night limit, a frozen/inactive account, the 9-person
// capacity cap, the anchor-sailing yearly cap, Cyprus's duration rule,
// per-participant checks inside the shared-booking RPCs, and any
// future server-side rule — is ALREADY raised as a specific, complete
// Hebrew sentence meant for the end user (see the migrations under
// supabase/migrations/, e.g. 0021-0027's RAISE EXCEPTION messages).
// Maintaining a growing list of substring translations for those was
// fragile by construction: every time a message's wording changed
// (which happened repeatedly across the Michael's Method migrations),
// the old hardcoded checks silently stopped matching and every one of
// those specific, useful errors quietly fell back to a generic
// "something went wrong" — exactly the bug this rewrite fixes. This
// now matches how every OTHER form in the app already behaves
// (EditPartnerModal, ChangePasswordModal, ParametersPage, ...) — show
// err.message directly, generic text only as a last-resort fallback.
export function friendlyBookingErrorMessage(error) {
  const message = error?.message ?? '';

  if (error?.code === '23P01' || message.includes('prevent_overlap')) {
    return 'השעות המבוקשות תפוסות. אנא בחרו שעות אחרות.';
  }

  if (message) {
    return message;
  }

  return 'אירעה שגיאה בשמירת ההזמנה. אנא נסו שוב.';
}
