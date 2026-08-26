// Mirrors public.fn_calculate_standard_cost() / the per-participant
// flat-rate charge in 0014_coin_quota_system.sql — a client-side
// *estimate* for instant UI feedback. The database trigger is the real
// source of truth at insert/update time; this is purely for display.
//
// Rates (from 0014):
//   night (20:00-08:00, any day)        -> 1 coin/hour  (highest priority)
//   weekend (Fri/Sat) or holiday, else  -> 10 coin/hour
//   everything else (weekday daytime)   -> 5 coin/hour
// Shared/Cyprus don't use this table at all — flat 1 coin/hour per
// participant, computed directly by the caller (see
// calculateSharedSailCoins below), no day/night/weekend variation.
//
// Same assumption as the backend: hours are classified using the
// browser's local time, which is only correct if the client runs in
// Asia/Jerusalem. Revisit with a timezone-aware library if SailShare
// ever needs to support partners booking from abroad.
const NIGHT_START_HOUR = 20; // 20:00
const NIGHT_END_HOUR = 8; // 08:00 (exclusive)
const WEEKEND_DAYS = [5, 6]; // Friday, Saturday

const NIGHT_RATE = 1;
const WEEKEND_OR_HOLIDAY_RATE = 10;
const WEEKDAY_RATE = 5;
const SHARED_SAIL_RATE_PER_PARTICIPANT = 1;

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// holidayDates: optional Set<'YYYY-MM-DD'> of Israeli chag/erev-chag
// dates (see src/lib/israeliHolidays.js).
//
// Returns { night, weekendOrHoliday, weekday, total } — hour counts
// per rate tier and the total coin cost (for Private/Dockside only;
// see calculateSharedSailCoins for Shared/Cyprus).
export function calculateBookingCoins(start, end, holidayDates = new Set()) {
  const breakdown = { night: 0, weekendOrHoliday: 0, weekday: 0 };

  const cursor = new Date(start);
  while (cursor < end) {
    const day = cursor.getDay();
    const hour = cursor.getHours();
    const isNight = hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
    const isWeekendOrHoliday = WEEKEND_DAYS.includes(day) || holidayDates.has(toDateKey(cursor));

    if (isNight) breakdown.night += 1;
    else if (isWeekendOrHoliday) breakdown.weekendOrHoliday += 1;
    else breakdown.weekday += 1;

    cursor.setHours(cursor.getHours() + 1);
  }

  const total =
    breakdown.night * NIGHT_RATE +
    breakdown.weekendOrHoliday * WEEKEND_OR_HOLIDAY_RATE +
    breakdown.weekday * WEEKDAY_RATE;

  return { ...breakdown, total };
}

// Flat 1 coin/hour, per participant (organizer included — see
// NewBookingModal.jsx/EditBookingModal.jsx, which now insert the
// organizer into booking_participants too). Returns the cost for ONE
// participant and the total across everyone, since the UI needs both
// ("you'll pay X, total across the group is Y").
export function calculateSharedSailCoins(start, end, participantCount) {
  const hours = Math.max(0, Math.round((end.getTime() - start.getTime()) / 3_600_000));
  const perPerson = hours * SHARED_SAIL_RATE_PER_PARTICIPANT;
  return { hours, perPerson, total: perPerson * participantCount };
}

export const COIN_TYPE_LABELS_HE = {
  night: 'לילה (1 מטבע/שעה)',
  weekendOrHoliday: 'סופ"ש/חג (10 מטבעות/שעה)',
  weekday: 'יום חול (5 מטבעות/שעה)',
};
