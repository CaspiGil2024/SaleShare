// Normalizes a phone number into the exact string used as a
// provisioned partner's default password. Used by the one-off
// account-provisioning script (scripts/provision-partner-accounts.mjs)
// via a direct import — Login.jsx itself no longer derives a password
// from phone numbers (it moved to a plain shared password), so this is
// only the source of truth for NEW-account provisioning, not for login.
//
// /\D/g strips every character that ISN'T a digit — hyphens, spaces,
// parentheses, a leading "+" — so the result is always digits-only, no
// matter how the phone number was formatted in partner_roster (e.g.
// "052-3844744" -> "0523844744").
export function phoneToPassword(phone) {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('972')) {
    digits = '0' + digits.slice(3);
  }
  return digits;
}
