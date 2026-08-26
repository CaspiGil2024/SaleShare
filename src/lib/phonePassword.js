// Normalizes a phone number into the exact string used as a
// provisioned partner's password. Shared between the login form
// (src/pages/Login.jsx) and the one-off account-provisioning script
// (scripts/provision-partner-accounts.mjs) via a direct import — these
// two MUST stay in sync. If they diverge, accounts get created with a
// password the login form can never actually reproduce.
export function phoneToPassword(phone) {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('972')) {
    digits = '0' + digits.slice(3);
  }
  return digits;
}
