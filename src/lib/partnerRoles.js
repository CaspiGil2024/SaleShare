// Shared between PartnersPage.jsx and EditPartnerModal.jsx so the role
// list/labels can't drift out of sync between the table and the modal.
export const ALL_PARTNER_ROLES = ['partner', 'treasurer', 'admin', 'ceo', 'maintenance', 'lab_tester'];

const ROLE_LABELS_HE = {
  partner: 'שותף',
  treasurer: 'גזבר',
  admin: 'מנהל',
  ceo: 'מנכ"ל',
  maintenance: 'תחזוקה',
  lab_tester: 'בודק מעבדה',
};

export function roleLabelHe(role) {
  return ROLE_LABELS_HE[role] ?? role;
}
