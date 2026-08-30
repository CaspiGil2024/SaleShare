// Color coding for the 5 booking types: Blue = Private, Green = Shared,
// Orange = Dockside, Violet = Cyprus (long-distance, visually distinct
// from the others), Gray = Maintenance (blocks the boat, no coin cost).
// booking_type is plain text on the live DB (no enum — see
// 0005_schema_reality_baseline.sql), so adding a new value here needs
// no migration.
// textColor is chosen per background for contrast — Shared's light
// green reads poorly with FullCalendar's default white event text, so
// it gets a dark green instead; every other type keeps white.
const BOOKING_TYPE_COLORS = {
  Private: { backgroundColor: '#3b82f6', borderColor: '#3b82f6', textColor: '#ffffff' },
  Shared: { backgroundColor: '#86efac', borderColor: '#86efac', textColor: '#14532d' },
  Dockside: { backgroundColor: '#f97316', borderColor: '#f97316', textColor: '#ffffff' },
  Cyprus: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6', textColor: '#ffffff' },
  Maintenance: { backgroundColor: '#64748b', borderColor: '#64748b', textColor: '#ffffff' },
};

const FALLBACK_COLOR = { backgroundColor: '#64748b', borderColor: '#64748b', textColor: '#ffffff' };

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
