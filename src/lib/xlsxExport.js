import * as XLSX from 'xlsx';

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
    'תאריך התחלה': b.start_time ? new Date(b.start_time).toLocaleString('he-IL') : '',
    'תאריך סיום': b.end_time ? new Date(b.end_time).toLocaleString('he-IL') : '',
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
      'תאריך התחלה': e.start_time ? new Date(e.start_time).toLocaleString('he-IL') : '',
      'תאריך סיום': e.end_time ? new Date(e.end_time).toLocaleString('he-IL') : '',
      'שעות': Number(e.hours.toFixed(1)),
      'סופ"ש יום': e.coinBreakdown?.weekendDay ?? 0,
      'סופ"ש לילה': e.coinBreakdown?.weekendNight ?? 0,
      'אמצ"ש יום': e.coinBreakdown?.midweekDay ?? 0,
      'אמצ"ש לילה': e.coinBreakdown?.midweekNight ?? 0,
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
// tab) — the 4 real coin-type balances per partner, current period.
export function exportPartnerBalancesToXlsx({ rows }) {
  const wb = XLSX.utils.book_new();

  const sheetRows = rows.map((r) => ({
    'שותף': r.name,
    'סופ"ש יום': r.weekendDay,
    'סופ"ש לילה': r.weekendNight,
    'אמצ"ש יום': r.midweekDay,
    'אמצ"ש לילה': r.midweekNight,
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
    'תאריך ושעה': r.created_at ? new Date(r.created_at).toLocaleString('he-IL') : '',
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
    'תאריך דיווח': r.created_at ? new Date(r.created_at).toLocaleString('he-IL') : '',
    'פתרון הבעיה': r.resolution_notes ?? '',
    'נפתרה ע"י': r.resolvedByName ?? '',
    'תאריך פתרון': r.resolved_at ? new Date(r.resolved_at).toLocaleString('he-IL') : '',
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
    'תאריך ושעה': r.logged_at ? new Date(r.logged_at).toLocaleString('he-IL') : '',
    'פעולה': r.actionLabel,
    'שותף': r.partnerName,
    'סוג הפלגה': r.bookingTypeLabel,
    'התחלת הפלגה': r.start_time ? new Date(r.start_time).toLocaleString('he-IL') : '',
    'סיום הפלגה': r.end_time ? new Date(r.end_time).toLocaleString('he-IL') : '',
    'סיבה': r.reasonLabel ?? '',
    'סופ"ש יום': r.coins?.weekendDay ?? 0,
    'סופ"ש לילה': r.coins?.weekendNight ?? 0,
    'אמצ"ש יום': r.coins?.midweekDay ?? 0,
    'אמצ"ש לילה': r.coins?.midweekNight ?? 0,
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
    'תאריך התחלה': r.start_time ? new Date(r.start_time).toLocaleString('he-IL') : '',
    'תאריך סיום': r.end_time ? new Date(r.end_time).toLocaleString('he-IL') : '',
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
