// Israeli chag (yom tov) and erev-chag dates, via Hebcal's free, keyless
// public API — verified live against real 2026 dates before this file
// was written (Rosh Hashana, Yom Kippur, Sukkot, Pesach). i=on selects
// the Israel observance scheme (single-day chagim), NOT the Diaspora
// scheme (which adds an extra day Israel doesn't observe) — using the
// wrong scheme would mark a normal sailing day as a false holiday.
//
// "Holiday" = category 'holiday' with yomtov:true (an actual chag day,
// work-restricted like Shabbat). "Eve" = category 'holiday' items whose
// title Hebcal itself prefixes with "Erev " (e.g. "Erev Rosh Hashana") —
// Hebcal computes these directly, so there's no day-before-arithmetic
// to get wrong here. Intermediate/Chol HaMoed days (Sukkot II-VII, e.g.)
// are neither, matching how the app should treat them: normal weekdays.
import { supabase } from './supabaseClient';

const HEBCAL_URL = 'https://www.hebcal.com/hebcal';

function toDateKey(date) {
  // Local calendar date, not UTC — avoids an off-by-one near midnight.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Returns a Map<'YYYY-MM-DD', { type: 'holiday' | 'eve', label: string }>
// for every chag/erev-chag date in [startDate, endDate).
export async function fetchIsraeliHolidayMap(startDate, endDate) {
  const params = new URLSearchParams({
    v: '1',
    cfg: 'json',
    maj: 'on', // major holidays only
    min: 'off',
    mod: 'off',
    nx: 'off',
    mf: 'off',
    ss: 'off',
    c: 'off',
    i: 'on', // Israel observance scheme
    start: toDateKey(startDate),
    end: toDateKey(endDate),
  });

  const res = await fetch(`${HEBCAL_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Hebcal request failed: ${res.status}`);
  const json = await res.json();

  const map = new Map();
  for (const item of json.items ?? []) {
    if (item.category !== 'holiday') continue;
    const label = item.hebrew || item.title;
    if (item.yomtov) {
      map.set(item.date, { type: 'holiday', label });
    } else if (item.title?.startsWith('Erev ')) {
      map.set(item.date, { type: 'eve', label });
    }
  }
  return map;
}

// Upserts a holiday map (from fetchIsraeliHolidayMap) into
// public.israeli_holidays — the server-side coin-rate function
// (fn_calculate_standard_cost, 0014_coin_quota_system.sql) can't call
// Hebcal itself mid-transaction, so it checks this table instead.
// Called right before submitting a booking, for the exact dates that
// booking spans — the one point where the server genuinely needs the
// data, regardless of whether the calendar view has ever synced it.
export async function syncIsraeliHolidays(holidayMap) {
  if (holidayMap.size === 0) return;
  const rows = Array.from(holidayMap, ([holiday_date, { type }]) => ({
    holiday_date,
    holiday_type: type,
  }));
  const { error } = await supabase.from('israeli_holidays').upsert(rows, { onConflict: 'holiday_date' });
  if (error) {
    console.error('Failed to sync Israeli holidays to the database', error);
  }
}

export { toDateKey };
