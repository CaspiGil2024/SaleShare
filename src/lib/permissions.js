// Shared "management role" check — treasurer/ceo/lab_tester/maintenance.
// Used by PartnersPage.jsx and ImportantInfoPage.jsx so this list can't
// drift between UI surfaces. The actual enforcement is server-side RLS
// (see can_edit_partners() / is_manager() in the migrations) — this is
// purely for hiding/disabling UI, never trust it as the real gate.
export const MANAGEMENT_ROLES = ['treasurer', 'ceo', 'lab_tester', 'maintenance'];

export function isManager(currentUser) {
  return (currentUser?.roles ?? []).some((role) => MANAGEMENT_ROLES.includes(role));
}

// Narrower tiers for Freeze / Soft-Delete / Permanent-Delete (2026-08-26
// business rule) — deliberately NOT the same set as isManager() above.
// "Manager" here means the admin role specifically (מנהל), not the
// broader treasurer/ceo/lab_tester/maintenance group. Mirrors
// is_admin_or_treasurer()/is_admin() in 0015_partner_freeze_and_delete_gates.sql
// — the real enforcement is server-side (RLS + trigger); this is only
// for hiding/disabling the matching menu items in the UI.
export function isAdminOrTreasurer(currentUser) {
  return (currentUser?.roles ?? []).some((role) => role === 'admin' || role === 'treasurer');
}

export function isAdminRole(currentUser) {
  return (currentUser?.roles ?? []).includes('admin');
}

// Who can even see the partner row-actions menu at all: the existing
// broader management set, OR admin/treasurer (who need it for Freeze /
// Soft Delete / Permanent Delete even though they're not "managers" in
// the general-edit sense). Each individual item inside the menu still
// applies its own narrower check on top of this.
export function canSeePartnerManagementMenu(currentUser) {
  return isManager(currentUser) || isAdminOrTreasurer(currentUser);
}
