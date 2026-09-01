// Single source of truth for every plain numeric date/date-time display
// in the app — tables, forms, reports, audit logs, XLSX exports.
// Israeli convention: dd/mm/yyyy, zero-padded, slash-separated.
//
// Deliberately NOT `toLocaleDateString('he-IL')` — that locale's ICU
// data renders numeric dates unpadded and dot-separated (e.g.
// "3.9.2026", not "03/09/2026"), and the exact separator/padding isn't
// guaranteed to stay consistent across browsers/runtimes. This module
// is the one place that decides the actual format, so it can't drift
// between call sites the way 8+ independent toLocaleDateString/
// toLocaleString option objects already had (same class of problem
// formatCoinAmount in coinCalculator.js was written to fix for coin
// amounts).
//
// Does NOT replace the app's separate long-form descriptive dates
// (weekday + full month name, e.g. "שלישי, 3 בספטמבר 2026" in booking
// modal headers, release notes, emails) — those are an intentionally
// different style for a different purpose, not a table/report cell.

function toDate(input) {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

// dd/mm/yyyy — for any timestamp (timestamptz column, JS Date, or
// ISO/parseable string). For a plain SQL `date` column with no time
// component, use formatDateOnlyHe instead (see below) — going through
// `new Date()` here is fine for a full timestamp since the local-time
// components genuinely reflect the moment being displayed.
export function formatDateHe(input) {
  const d = toDate(input);
  if (!d) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

// dd/mm/yyyy HH:MM
export function formatDateTimeHe(input) {
  const d = toDate(input);
  if (!d) return '';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${formatDateHe(d)} ${hours}:${minutes}`;
}

// For a plain SQL `date` column (no time component — comes back from
// Supabase as a bare 'YYYY-MM-DD' string, e.g. coin_transactions.
// value_date). Parses the string directly instead of going through
// `new Date(...)`, which would interpret a bare date string as UTC
// midnight and could shift the displayed day by one in a timezone
// behind UTC.
export function formatDateOnlyHe(isoDateString) {
  if (!isoDateString) return '';
  const [year, month, day] = isoDateString.split('-');
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
}
