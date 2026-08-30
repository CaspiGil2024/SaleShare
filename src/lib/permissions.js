// Shared "management role" check — treasurer/ceo/sailing_officer/
// maintenance ('sailing_officer' was renamed from 'lab_tester', see
// 0047). Used by PartnersPage.jsx and ImportantInfoPage.jsx so this
// list can't drift between UI surfaces. The actual enforcement is
// server-side RLS (see can_edit_partners() / is_manager() in the
// migrations) — this is purely for hiding/disabling UI, never trust it
// as the real gate.
export const MANAGEMENT_ROLES = ['treasurer', 'ceo', 'sailing_officer', 'maintenance'];

export function isManager(currentUser) {
  return (currentUser?.roles ?? []).some((role) => MANAGEMENT_ROLES.includes(role));
}

// Narrower tiers for Freeze / Soft-Delete / Permanent-Delete (2026-08-26
// business rule) — deliberately NOT the same set as isManager() above.
// 'sailing_officer' carries full admin privileges by explicit product
// decision (0047) — both functions include it, matching is_admin()/
// is_admin_or_treasurer() server-side. Mirrors those exactly; the real
// enforcement is server-side (RLS + trigger), this is only for hiding/
// disabling the matching UI.
export function isAdminOrTreasurer(currentUser) {
  return (currentUser?.roles ?? []).some(
    (role) => role === 'admin' || role === 'treasurer' || role === 'sailing_officer'
  );
}

export function isAdminRole(currentUser) {
  return (currentUser?.roles ?? []).some((role) => role === 'admin' || role === 'sailing_officer');
}

// Who can even see the partner row-actions menu at all: the existing
// broader management set, OR admin/treasurer (who need it for Freeze /
// Soft Delete / Permanent Delete even though they're not "managers" in
// the general-edit sense). Each individual item inside the menu still
// applies its own narrower check on top of this.
export function canSeePartnerManagementMenu(currentUser) {
  return isManager(currentUser) || isAdminOrTreasurer(currentUser);
}
