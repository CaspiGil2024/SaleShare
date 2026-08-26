// Shared between NewBookingModal.jsx and EditBookingModal.jsx — both
// insert/update rows on `bookings`, so both can hit the same trigger-
// raised errors. Extracted rather than duplicated so the two forms
// can't drift out of sync on what a given Postgres error means.
//
// Order matters: exclusion-constraint violations carry a stable error
// code (23P01), but check_no_one_hour_gap and enforce_s_rule both
// raise with the default plpgsql code (P0001), so those two are told
// apart by matching a distinctive substring of their real (confirmed
// via pg_get_functiondef, 2026-08-26) Hebrew message — NOT the English
// text 0001's never-applied version would have used.
export function friendlyBookingErrorMessage(error) {
  const message = error?.message ?? '';

  if (error?.code === '23P01' || message.includes('prevent_overlap')) {
    return 'השעות המבוקשות תפוסות. אנא בחרו שעות אחרות.';
  }
  if (message.includes('חור של שעה')) {
    return 'לא ניתן לבצע הזמנה שמשאירה רווח של שעה בדיוק מהזמנה אחרת.';
  }
  if (message.includes('חוק ה-S')) {
    return 'ניצלת את כל מכסת ההזמנות העתידיות שלך.';
  }
  if (message.includes('מספיק מטבעות')) {
    return 'אין מספיק מטבעות ביתרה הרבעונית שלכם עבור הזמנה זו.';
  }
  return 'אירעה שגיאה בשמירת ההזמנה. אנא נסו שוב.';
}
