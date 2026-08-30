import { getBookingTypeColors, bookingTypeLabelHe } from './bookingColors';

const RAW_OPTIONS = [
  { value: 'Private', helper: 'עלות מלאה לפי סוג המשבצת - 1 מטבע לשעה' },
  { value: 'Shared', helper: 'עלות מלאה למזמין - 1 מטבע לשעה (אורחים אינם משלמים)' },
  { value: 'Dockside', helper: 'רתיקה בנמל - 1 מטבע לשעה' },
  { value: 'Cyprus', helper: 'שייט ארוך לקפריסין' },
  { value: 'Maintenance', helper: 'חוסמת את לוח ההזמנות, ללא חיוב מטבעות' },
];

export const BOOKING_TYPE_OPTIONS = RAW_OPTIONS.map((option) => ({
  ...option,
  label: bookingTypeLabelHe(option.value),
  color: getBookingTypeColors(option.value).backgroundColor,
}));

export function chargesCoins(bookingType) {
  return bookingType !== 'Maintenance';
}
