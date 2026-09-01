import * as XLSX from 'xlsx';
import { formatDateOnlyHe, formatDateTimeHe } from './dateFormat';

// xlsx (SheetJS) has two known high-severity advisories (prototype
// pollution, ReDoS) with no fix available — both are only exploitable
// when the library PARSES an untrusted file. This module only ever
// WRITES a workbook from data this app already trusts (its own
// Supabase queries), never parses an uploaded file, so the real
// exposure here is low — flagged in chat when this was added, not
// silently installed.

export function exportDatabaseToXlsx({ partners, bookings }) {
  const wb = XLSX.utils.book_new();

  const partnerRows = partners.map((p) => ({
    'שם מלא': p.full_name,
    'אימייל': p.email,
    'טלפון': p.phone ?? '',
    'תפקידים': (p.roles ?? []).join(', '),
    'פעיל': p.is_active ? 'כן' : 'לא',
    'יתרת מטבעות (ראשונית)': p.balance ?? 0,
  }));
  const partnersSheet = XLSX.utils.json_to_sheet(partnerRows);
  XLSX.utils.book_append_sheet(wb, partnersSheet, 'פרטי שותפים');

  const bookingRows = bookings.map((b) => ({
    'מזהה הזמנה': b.id,
    'שותף מזמין': b.organizerName,
    'סוג הזמנה': b.bookingTypeLabel,
    'סטטוס': b.status,
    'תאריך התחלה': formatDateTimeHe(b.start_time),
    'תאריך סיום': formatDateTimeHe(b.end_time),
    'מספר אורחים': b.guests_count ?? 0,
    'שותפים משתתפים': b.participantNames,
    'מטבעות שולם ע"י המזמין': b.coins_charged ?? 0,
    'מטבעות שולמו ע"י שותפים': b.participantCoinsTotal,
    'סה"כ מטבעות שנוצלו בהפלגה': b.totalCoinsCharged,
    'הערות': b.notes ?? '',
  }));
  const bookingsSheet = XLSX.utils.json_to_sheet(bookingRows);
  XLSX.utils.book_append_sheet(wb, bookingsSheet, 'פרטי הפלגות');

  const timestamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `SailShare-backup-${timestamp}.xlsx`);
}

// Detailed (מפורט) activity report — every partner's name followed by
// each of their individual sailings, flattened into one sheet (one row
// per sailing, partner name repeated) since XLSX has no native
// "section header per group" concept.
export function exportDetailedActivityReportToXlsx({ rows, fromDate, toDate, reportLabel }) {
  const wb = XLSX.utils.book_new();

  const sheetRows = rows.flatMap((r) =>
    r.entries.map((e) => ({
      'שותף': r.name,
      'תפקיד': e.role,
      'סוג הפלגה': e.bookingTypeLabel,
      'תאריך התחלה': formatDateTimeHe(e.start_time),
      'תאריך סיום': formatDateTimeHe(e.end_time),
      'שעות': Number(e.hours.toFixed(1)),
      'אמצ"ש יום': e.coinBreakdown?.midweekDay ?? 0,
      'אמצ"ש לילה': e.coinBreakdown?.midweekNight ?? 0,
      'סופ"ש יום': e.coinBreakdown?.weekendDay ?? 0,
      'סופ"ש לילה': e.coinBreakdown?.weekendNight ?? 0,
      'סה"כ מטבעות': e.coins,
    }))
  );
  const sheet = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, sheet, 'דוח מפורט');

  const safeLabel = (reportLabel ?? 'report').replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `SailShare-${safeLabel}-detailed-${fromDate}-to-${toDate}.xlsx`);
}

// Activity report rows (ReportsPage.jsx) — per-partner sail count/
// hours/coins for a date range, past or future.
export function exportActivityReportToXlsx({ rows, fromDate, toDate, reportLabel }) {
  const wb = XLSX.utils.book_new();

  const sheetRows = rows.map((r) => ({
    'שותף': r.name,
    'מספר הפלגות': r.sailCount,
    'סה"כ שעות': Number(r.hours.toFixed(1)),
    'סה"כ מטבעות': r.coins,
  }));
  const sheet = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, sheet, 'דוח פעילות');

  const safeLabel = (reportLabel ?? 'report').replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `SailShare-${safeLabel}-${fromDate}-to-${toDate}.xlsx`);
}

// All-partners coin-balance report (ReportsPage.jsx's "יתרות שותפים"
// tab) — the 4 real coin-type balances per partner, current period,
// plus their sum (the same "יתרה כוללת" total the table itself shows).
export function exportPartnerBalancesToXlsx({ rows }) {
  const wb = XLSX.utils.book_new();

  const sheetRows = rows.map((r) => ({
    'שותף': r.name,
    'אמצ"ש יום': r.midweekDay,
    'אמצ"ש לילה': r.midweekNight,
    'סופ"ש יום': r.weekendDay,
    'סופ"ש לילה': r.weekendNight,
    'יתרה כוללת': r.total,
  }));
  const sheet = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, sheet, 'יתרות שותפים');

  const timestamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `SailShare-partner-balances-${timestamp}.xlsx`);
}

// Parameters page's manual coin-adjustment audit log.
export function exportCoinAdjustmentAuditToXlsx({ rows }) {
  const wb = XLSX.utils.book_new();

  const sheetRows = rows.map((r) => ({
    'תאריך ושעה': formatDateTimeHe(r.created_at),
    'בוצע ע"י': r.actor?.full_name ?? r.actor?.email ?? '',
    'שותף': r.partner?.full_name ?? r.partner?.email ?? '',
    'סוג מטבע': r.coinTypeLabel,
    'יתרה קודמת': r.balance_before,
    'יתרה חדשה': r.balance_after,
    'הערה': r.note ?? '',
  }));
  const sheet = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, sheet, 'יומן ביקורת מטבעות');

  const timestamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `SailShare-coin-adjustment-audit-${timestamp}.xlsx`);
}

// Maintenance issues (text data only, per requirement — images are
// never included in this export).
export function exportMaintenanceIssuesToXlsx({ rows }) {
  const wb = XLSX.utils.book_new();

  const sheetRows = rows.map((r) => ({
    'תקציר': r.summary,
    'תיאור הבעיה': r.description,
    'סטטוס': r.status === 'resolved' ? 'נפתרה' : 'פתוחה',
    'דווח ע"י': r.createdByName ?? '',
    'תאריך דיווח': formatDateTimeHe(r.created_at),
    'פתרון הבעיה': r.resolution_notes ?? '',
    'נפתרה ע"י': r.resolvedByName ?? '',
    'תאריך פתרון': formatDateTimeHe(r.resolved_at),
  }));
  const sheet = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, sheet, 'תקלות תחזוקה');

  const timestamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `SailShare-maintenance-issues-${timestamp}.xlsx`);
}

// Sailing & Boat-Closing Log (SailingLogPage.jsx) — every automatic
// departure/closing entry in the selected date range.
export function exportSailingLogToXlsx({ rows, fromDate, toDate }) {
  const wb = XLSX.utils.book_new();

  const sheetRows = rows.map((r) => ({
    'תאריך ושעה': formatDateTimeHe(r.logged_at),
    'פעולה': r.actionLabel,
    'שותף': r.partnerName,
    'סוג הפלגה': r.bookingTypeLabel,
    'התחלת הפלגה': formatDateTimeHe(r.start_time),
    'סיום הפלגה': formatDateTimeHe(r.end_time),
    'סיבה': r.reasonLabel ?? '',
    'אמצ"ש יום': r.coins?.midweekDay ?? 0,
    'אמצ"ש לילה': r.coins?.midweekNight ?? 0,
    'סופ"ש יום': r.coins?.weekendDay ?? 0,
    'סופ"ש לילה': r.coins?.weekendNight ?? 0,
  }));
  const sheet = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, sheet, 'יומן הפלגות וסגירת סירה');

  XLSX.writeFile(wb, `SailShare-sailing-log-${fromDate}-to-${toDate}.xlsx`);
}

// One partner's full booking history (organized + participated-in,
// every status including Cancelled) — used by the "היסטוריית הזמנות"
// row action in PartnersPage.jsx.
export function exportPartnerHistoryToXlsx({ partnerName, rows }) {
  const wb = XLSX.utils.book_new();

  const sheetRows = rows.map((r) => ({
    'תפקיד בהפלגה': r.role,
    'סוג הזמנה': r.bookingTypeLabel,
    'סטטוס': r.statusLabel,
    'תאריך התחלה': formatDateTimeHe(r.start_time),
    'תאריך סיום': formatDateTimeHe(r.end_time),
    'מספר אורחים': r.guests_count ?? 0,
    'מטבעות ששולמו': r.coinsForThisPartner ?? 0,
    'הערות': r.notes ?? '',
  }));
  const sheet = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, sheet, 'היסטוריית הזמנות');

  const timestamp = new Date().toISOString().slice(0, 10);
  const safeName = (partnerName ?? 'partner').replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `SailShare-${safeName}-history-${timestamp}.xlsx`);
}

// Periodic partner statement (ReportsPage.jsx's "דוח תקופתי לשותף" tab)
// — one row per coin_transactions entry in the chosen value-date range,
// already split into debit/credit by the caller (see PartnerStatementTab).
export function exportPartnerStatementToXlsx({ partnerName, fromDate, toDate, rows }) {
  const wb = XLSX.utils.book_new();

  const sheetRows = rows.map((r) => ({
    'תאריך ערך': formatDateOnlyHe(r.value_date),
    'סוג מטבע': r.coinTypeLabel,
    'סיבה': r.reasonLabel,
    'חובה': r.debit ?? 0,
    'זכות': r.credit ?? 0,
    'יתרה מתגלגלת': r.running_balance,
    'הערה': r.note ?? '',
  }));
  const sheet = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, sheet, 'דוח תקופתי');

  const safeName = (partnerName ?? 'partner').replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `SailShare-${safeName}-statement-${fromDate}-to-${toDate}.xlsx`);
}
