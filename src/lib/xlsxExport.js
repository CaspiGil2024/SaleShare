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
