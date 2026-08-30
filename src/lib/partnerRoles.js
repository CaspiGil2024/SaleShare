// Shared between PartnersPage.jsx and EditPartnerModal.jsx so the role
// list/labels can't drift out of sync between the table and the modal.
// 'sailing_officer' was renamed from 'lab_tester' (0047_sailing_
// officer_role_and_admin_participant_management.sql) and now carries
// full admin privileges everywhere — see isAdminRole()/isAdminOrTreasurer()
// in permissions.js and is_admin()/is_admin_or_treasurer() server-side.
export const ALL_PARTNER_ROLES = ['partner', 'treasurer', 'admin', 'ceo', 'maintenance', 'sailing_officer'];

const ROLE_LABELS_HE = {
  partner: 'שותף',
  treasurer: 'גזבר',
  admin: 'מנהל',
  ceo: 'מנכ"ל',
  maintenance: 'תחזוקה',
  sailing_officer: 'אחראי הפלגות',
};

export function roleLabelHe(role) {
  return ROLE_LABELS_HE[role] ?? role;
}
