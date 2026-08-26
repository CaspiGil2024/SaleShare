// Color coding for the 5 booking types: Blue = Private, Green = Shared,
// Orange = Dockside, Violet = Cyprus (long-distance, visually distinct
// from the others), Gray = Maintenance (blocks the boat, no coin cost).
// booking_type is plain text on the live DB (no enum — see
// 0005_schema_reality_baseline.sql), so adding a new value here needs
// no migration.
const BOOKING_TYPE_COLORS = {
  Private: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  Shared: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  Dockside: { backgroundColor: '#f97316', borderColor: '#f97316' },
  Cyprus: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  Maintenance: { backgroundColor: '#64748b', borderColor: '#64748b' },
};

const FALLBACK_COLOR = { backgroundColor: '#64748b', borderColor: '#64748b' };

export function getBookingTypeColors(bookingType) {
  return BOOKING_TYPE_COLORS[bookingType] ?? FALLBACK_COLOR;
}

const BOOKING_TYPE_LABELS_HE = {
  Private: 'שייט פרטי',
  Shared: 'שייט שותפים',
  Dockside: 'רתיקה / שימוש ברציף',
  Cyprus: 'שייט לקפריסין',
  Maintenance: 'תחזוקה',
};

export function bookingTypeLabelHe(bookingType) {
  return BOOKING_TYPE_LABELS_HE[bookingType] ?? bookingType;
}
