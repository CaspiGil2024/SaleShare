import { useEffect, useState } from 'react';
import { BookOpen, Play, Download } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { bookingTypeLabelHe } from '../lib/bookingColors';
import { exportSailingLogToXlsx } from '../lib/xlsxExport';
import { formatCoinAmount as formatCoin } from '../lib/coinCalculator';
import { formatDateTimeHe } from '../lib/dateFormat';
import CoinBalanceBadge from '../components/CoinBalanceBadge';

const ACTION_LABELS_HE = {
  departure: 'הפלגה יצאה',
  closing: 'סירה נסגרה',
};
const REASON_LABELS_HE = {
  cancelled: 'ביטול הפלגה',
  maintenance: 'תחזוקה',
};

function toInputDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const ZERO_BREAKDOWN = { weekendDay: 0, weekendNight: 0, midweekDay: 0, midweekNight: 0 };

// Coin-type breakdown per TRIP (booking_id), not per log entry — the
// same booking can have both a 'departure' and a later 'closing' row,
// and they share the same underlying charge. Total per type = that
// booking's own coins_charged_* (real for Private/Dockside/Maintenance,
// always 0 for Shared/Cyprus) + the SUM of every participant's
// coins_charged_* for that booking (real for Shared/Cyprus, empty for
// the others) — same formula MaintenanceDataPage.jsx's DB export
// already uses, safe against double-counting either way.
async function fetchCoinBreakdownByBookingId(bookingIds) {
  const breakdownByBookingId = new Map();
  if (bookingIds.length === 0) return breakdownByBookingId;

  const { data: bookingRows, error: bookingsError } = await supabase
    .from('bookings')
    .select('id, coins_charged_weekend_day, coins_charged_weekend_night, coins_charged_midweek_day, coins_charged_midweek_night')
    .in('id', bookingIds);
  if (bookingsError) throw bookingsError;

  for (const b of bookingRows) {
    breakdownByBookingId.set(b.id, {
      weekendDay: b.coins_charged_weekend_day ?? 0,
      weekendNight: b.coins_charged_weekend_night ?? 0,
      midweekDay: b.coins_charged_midweek_day ?? 0,
      midweekNight: b.coins_charged_midweek_night ?? 0,
    });
  }

  const { data: participantRows, error: participantsError } = await supabase
    .from('booking_participants')
    .select('booking_id, coins_charged_weekend_day, coins_charged_weekend_night, coins_charged_midweek_day, coins_charged_midweek_night')
    .in('booking_id', bookingIds);
  if (participantsError) throw participantsError;

  for (const p of participantRows) {
    const entry = breakdownByBookingId.get(p.booking_id) ?? { ...ZERO_BREAKDOWN };
    entry.weekendDay += p.coins_charged_weekend_day ?? 0;
    entry.weekendNight += p.coins_charged_weekend_night ?? 0;
    entry.midweekDay += p.coins_charged_midweek_day ?? 0;
    entry.midweekNight += p.coins_charged_midweek_night ?? 0;
    breakdownByBookingId.set(p.booking_id, entry);
  }

  return breakdownByBookingId;
}

async function fetchSailingLog(fromDate, toDate, partnerId) {
  let query = supabase
    .from('sailing_log')
    .select('id, booking_id, action, reason, booking_type, start_time, end_time, logged_at, users(full_name, email)')
    .gte('logged_at', fromDate.toISOString())
    .lte('logged_at', toDate.toISOString())
    .order('logged_at', { ascending: false });
  if (partnerId) {
    query = query.eq('user_id', partnerId);
  }
  const { data, error } = await query;
  if (error) throw error;

  const bookingIds = [...new Set(data.map((r) => r.booking_id).filter((id) => id !== null))];
  const breakdownByBookingId = await fetchCoinBreakdownByBookingId(bookingIds);

  return data.map((r) => ({
    id: r.id,
    logged_at: r.logged_at,
    action: r.action,
    actionLabel: ACTION_LABELS_HE[r.action] ?? r.action,
    reasonLabel: r.reason ? REASON_LABELS_HE[r.reason] ?? r.reason : null,
    partnerName: r.users?.full_name ?? r.users?.email ?? '—',
    bookingTypeLabel: r.booking_type ? bookingTypeLabelHe(r.booking_type) : '—',
    start_time: r.start_time,
    end_time: r.end_time,
    coins: breakdownByBookingId.get(r.booking_id) ?? ZERO_BREAKDOWN,
  }));
}


export default function SailingLogPage() {
  const { currentUser } = useAuth();
  const [fromDate, setFromDate] = useState(toInputDate(addDays(new Date(), -7)));
  const [toDate, setToDate] = useState(toInputDate(addDays(new Date(), 7)));
  // '' = כל השותפים (no filter). Defaults to the logged-in partner once
  // known, so the log is immediately useful ("my own sailings") without
  // requiring a manual selection first.
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [partners, setPartners] = useState([]);
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  useEffect(() => {
    supabase
      .from('users')
      .select('id, full_name, email')
      .order('full_name')
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to load partner list', error);
          return;
        }
        setPartners(data ?? []);
      });
  }, []);

  useEffect(() => {
    if (currentUser?.id) setSelectedPartnerId(currentUser.id);
  }, [currentUser?.id]);

  async function handleGenerate(partnerIdOverride) {
    setIsLoading(true);
    setErrorMessage(null);
    setHasGenerated(true);
    try {
      const partnerId = partnerIdOverride !== undefined ? partnerIdOverride : selectedPartnerId;
      const data = await fetchSailingLog(new Date(fromDate), new Date(`${toDate}T23:59:59`), partnerId || null);
      setRows(data);
    } catch (err) {
      console.error('Failed to load sailing log', err);
      setErrorMessage('אירעה שגיאה בטעינת היומן.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }

  // Auto-load once the default filters (±7 days, current partner) are
  // known, so the log shows real data immediately instead of the empty
  // "pick a range and click הצג" placeholder.
  useEffect(() => {
    if (!currentUser?.id) return;
    handleGenerate(currentUser.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  function handleExport() {
    exportSailingLogToXlsx({ rows, fromDate, toDate });
  }

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <CoinBalanceBadge currentUser={currentUser} />

      <header>
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <BookOpen size={26} className="text-blue-600" />
          יומן הפלגות וסגירת סירה
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          רישום אוטומטי של כל יציאה להפלגה וסגירת הסירה (ביטול הפלגה או תחזוקה)
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">מתאריך</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">עד תאריך</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">שותף</label>
          <select
            value={selectedPartnerId}
            onChange={(e) => setSelectedPartnerId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 min-w-[160px]"
          >
            <option value="">כל השותפים</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === currentUser?.id ? `${p.full_name ?? p.email} (אני)` : p.full_name ?? p.email}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => handleGenerate()}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2.5 transition-colors"
        >
          <Play size={15} />
          {isLoading ? 'מפיק דוח...' : 'הצג'}
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={!hasGenerated || isLoading || rows.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold px-4 py-2.5 transition-colors"
        >
          <Download size={15} />
          יצוא ל-EXCEL
        </button>
      </div>

      {!hasGenerated ? (
        <p className="p-10 text-center text-sm text-slate-400">בחרו טווח תאריכים ולחצו על "הצג יומן" כדי להציג נתונים.</p>
      ) : isLoading ? (
        <p className="p-10 text-center text-sm text-slate-400">טוען...</p>
      ) : errorMessage ? (
        <p className="p-10 text-center text-sm text-rose-600">{errorMessage}</p>
      ) : rows.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-400">אין רשומות יומן בטווח התאריכים שנבחר.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-auto max-h-[65dvh]">
            <table className="w-full text-sm">
              <thead className="sticky-thead">
                <tr className="border-b border-slate-200 text-start text-slate-700">
                  <th className="px-4 py-3 font-bold text-start">תאריך ושעה</th>
                  <th className="px-4 py-3 font-bold text-start">פעולה</th>
                  <th className="px-4 py-3 font-bold text-start">שותף</th>
                  <th className="px-4 py-3 font-bold text-start">סוג</th>
                  <th className="px-4 py-3 font-bold text-start">התחלת הפלגה</th>
                  <th className="px-4 py-3 font-bold text-start">סיום הפלגה</th>
                  <th className="px-4 py-3 font-bold text-start">סיבה</th>
                  <th className="px-4 py-3 font-bold text-start whitespace-nowrap">אמצ"ש יום</th>
                  <th className="px-4 py-3 font-bold text-start whitespace-nowrap">אמצ"ש לילה</th>
                  <th className="px-4 py-3 font-bold text-start whitespace-nowrap">סופ"ש יום</th>
                  <th className="px-4 py-3 font-bold text-start whitespace-nowrap">סופ"ש לילה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {formatDateTimeHe(r.logged_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.action === 'departure' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {r.actionLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{r.partnerName}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.bookingTypeLabel}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {r.start_time ? formatDateTimeHe(r.start_time) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {r.end_time ? formatDateTimeHe(r.end_time) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{r.reasonLabel ?? '—'}</td>
                    <td className="px-4 py-3 text-emerald-700 font-medium whitespace-nowrap">
                      {r.coins.midweekDay ? formatCoin(r.coins.midweekDay) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-medium whitespace-nowrap">
                      {r.coins.midweekNight ? formatCoin(r.coins.midweekNight) : '—'}
                    </td>
                    <td className="px-4 py-3 text-amber-700 font-medium whitespace-nowrap">
                      {r.coins.weekendDay ? formatCoin(r.coins.weekendDay) : '—'}
                    </td>
                    <td className="px-4 py-3 text-indigo-700 font-medium whitespace-nowrap">
                      {r.coins.weekendNight ? formatCoin(r.coins.weekendNight) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
