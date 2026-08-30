// Mirrors public.fn_classify_hours() / trg_fn_charge_booking_coins()
// (0021_michael_method_coin_engine.sql) — a client-side *estimate* for
// instant UI feedback. The database functions are the real source of
// truth at insert/update time; this is purely for display and light
// client-side validation.
//
// Michael's Method (§10/30/40): 4 coin types — weekend/weekday ×
// day/night — each hour costs exactly 1 coin of its own type. Guests
// never pay or consume coins (0040_guests_free_and_shared_sail_solo_
// pricing.sql), and the booking form no longer lets partners be added
// at creation/edit (see NewBookingModal.jsx/EditBookingModal.jsx) — so
// every chargeable booking, Shared/Cyprus included, is a single payer
// (the organizer) for the FULL classifyHours breakdown of its
// duration. That's why there's no separate "shared sail split"
// calculation here anymore: fn_create_shared_booking/fn_update_shared_
// booking's own proportional-share formula already degrades to "100%
// to the one participant" whenever there's only the organizer, which
// is every case reachable from the UI today — see that migration's
// header for the reasoning if partners-joining-later ever comes back.
//
// Day/night boundary (20:00-08:00) and weekend/holiday classification
// match every other rule in this project — Asia/Jerusalem local time,
// Friday/Saturday + Israeli holidays, same assumption as the backend
// (browser must run in that timezone for this estimate to be exact).
const NIGHT_START_HOUR = 20; // 20:00
const NIGHT_END_HOUR = 8; // 08:00 (exclusive)
const WEEKEND_DAYS = [5, 6]; // Friday, Saturday

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// holidayDates: optional Set<'YYYY-MM-DD'> of Israeli chag/erev-chag
// dates (see src/lib/israeliHolidays.js).
//
// Returns { weekendDay, weekendNight, midweekDay, midweekNight, total }
// — hour counts per coin type (1 coin/hour each, so hours === coins)
// and the total coin cost.
export function classifyHours(start, end, holidayDates = new Set()) {
  const breakdown = { weekendDay: 0, weekendNight: 0, midweekDay: 0, midweekNight: 0 };

  const cursor = new Date(start);
  while (cursor < end) {
    const day = cursor.getDay();
    const hour = cursor.getHours();
    const isNight = hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
    const isWeekend = WEEKEND_DAYS.includes(day) || holidayDates.has(toDateKey(cursor));

    if (isWeekend && isNight) breakdown.weekendNight += 1;
    else if (isWeekend) breakdown.weekendDay += 1;
    else if (isNight) breakdown.midweekNight += 1;
    else breakdown.midweekDay += 1;

    cursor.setHours(cursor.getHours() + 1);
  }

  const total = breakdown.weekendDay + breakdown.weekendNight + breakdown.midweekDay + breakdown.midweekNight;
  return { ...breakdown, total };
}

// Same breakdown as a private booking of this duration would get —
// that IS the shared sail's total cost (§40). Kept as a thin alias so
// call sites read naturally either way.
export function calculateBookingCoins(start, end, holidayDates = new Set()) {
  return classifyHours(start, end, holidayDates);
}

export const COIN_TYPE_LABELS_HE = {
  weekendDay: 'סופ"ש יום',
  weekendNight: 'סופ"ש לילה',
  midweekDay: 'אמצ"ש יום',
  midweekNight: 'אמצ"ש לילה',
};
