import { useEffect, useState } from 'react';
import { BookOpen, Play, Download, Coins } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { bookingTypeLabelHe } from '../lib/bookingColors';
import { exportSailingLogToXlsx } from '../lib/xlsxExport';

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

function formatCoinDisplay(n) {
  if (n === null || n === undefined) return '—';
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
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

async function fetchSailingLog(fromDate, toDate) {
  const { data, error } = await supabase
    .from('sailing_log')
    .select('id, booking_id, action, reason, booking_type, start_time, end_time, logged_at, users(full_name, email)')
    .gte('logged_at', fromDate.toISOString())
    .lte('logged_at', toDate.toISOString())
    .order('logged_at', { ascending: false });
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

// Compact top-row balance strip so it's visible while scanning the log
// below, without duplicating CoinsPage's full rates/history screen —
// same ensure_current_period + user_wallets fetch pattern as there.
function CoinBalanceSummary({ currentUser }) {
  const [wallet, setWallet] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.id) return;
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      const { error: ensureError } = await supabase.rpc('ensure_current_period');
      if (ensureError) console.error('Failed to ensure current period', ensureError);

      const { data: period } = await supabase.from('periods').select('id').eq('is_current', true).limit(1).maybeSingle();
      if (period) {
        const { data: walletRow, error } = await supabase
          .from('user_wallets')
          .select('coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night')
          .eq('user_id', currentUser.id)
          .eq('period_id', period.id)
          .maybeSingle();
        if (!isCancelled) {
          if (error) console.error('Failed to load wallet balance', error);
          else setWallet(walletRow);
        }
      }
      if (!isCancelled) setIsLoading(false);
    }

    load();
    return () => {
      isCancelled = true;
    };
  }, [currentUser?.id]);

  return (
    <div className="rounded-2xl bg-gradient-to-l from-amber-500 to-orange-400 px-5 py-3 shadow-sm text-white flex flex-wrap items-center gap-3">
      <span className="w-9 h-9 shrink-0 rounded-lg bg-white/20 flex items-center justify-center">
        <Coins size={18} />
      </span>
      <span className="text-sm text-amber-50 shrink-0">היתרה שלי:</span>
      {isLoading ? (
        <span className="text-sm text-amber-50">טוען...</span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg bg-white/15 text-xs font-semibold">
            אמצ"ש יום: {formatCoinDisplay(wallet?.coins_midweek_day)}
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white/15 text-xs font-semibold">
            אמצ"ש לילה: {formatCoinDisplay(wallet?.coins_midweek_night)}
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white/15 text-xs font-semibold">
            סופ"ש יום: {formatCoinDisplay(wallet?.coins_weekend_day)}
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white/15 text-xs font-semibold">
            סופ"ש לילה: {formatCoinDisplay(wallet?.coins_weekend_night)}
          </span>
        </div>
      )}
    </div>
  );
}

export default function SailingLogPage() {
  const { currentUser } = useAuth();
  const [fromDate, setFromDate] = useState(toInputDate(addDays(new Date(), -7)));
  const [toDate, setToDate] = useState(toInputDate(addDays(new Date(), 7)));
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  async function handleGenerate() {
    setIsLoading(true);
    setErrorMessage(null);
    setHasGenerated(true);
    try {
      const data = await fetchSailingLog(new Date(fromDate), new Date(`${toDate}T23:59:59`));
      setRows(data);
    } catch (err) {
      console.error('Failed to load sailing log', err);
      setErrorMessage('אירעה שגיאה בטעינת היומן.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleExport() {
    exportSailingLogToXlsx({ rows, fromDate, toDate });
  }

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header>
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <BookOpen size={22} className="text-blue-600" />
          יומן הפלגות וסגירת סירה
        </h2>
        <p className="text-sm text-slate-500">
          רישום אוטומטי של כל יציאה להפלגה וסגירת הסירה (ביטול הפלגה או תחזוקה)
        </p>
      </header>

      <CoinBalanceSummary currentUser={currentUser} />

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
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2.5 transition-colors"
        >
          <Play size={15} />
          {isLoading ? 'מפיק דוח...' : 'הצג יומן'}
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
          <div className="overflow-auto max-h-[65vh]">
            <table className="w-full text-sm">
              <thead className="sticky-thead">
                <tr className="border-b border-slate-100 text-start text-slate-500">
                  <th className="px-4 py-3 font-medium text-start">תאריך ושעה</th>
                  <th className="px-4 py-3 font-medium text-start">פעולה</th>
                  <th className="px-4 py-3 font-medium text-start">שותף</th>
                  <th className="px-4 py-3 font-medium text-start">סוג</th>
                  <th className="px-4 py-3 font-medium text-start">התחלת הפלגה</th>
                  <th className="px-4 py-3 font-medium text-start">סיום הפלגה</th>
                  <th className="px-4 py-3 font-medium text-start">סיבה</th>
                  <th className="px-4 py-3 font-medium text-start whitespace-nowrap">סופ"ש יום</th>
                  <th className="px-4 py-3 font-medium text-start whitespace-nowrap">סופ"ש לילה</th>
                  <th className="px-4 py-3 font-medium text-start whitespace-nowrap">אמצ"ש יום</th>
                  <th className="px-4 py-3 font-medium text-start whitespace-nowrap">אמצ"ש לילה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {new Date(r.logged_at).toLocaleString('he-IL', {
                        day: 'numeric',
                        month: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
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
                      {r.start_time
                        ? new Date(r.start_time).toLocaleString('he-IL', {
                            day: 'numeric',
                            month: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {r.end_time
                        ? new Date(r.end_time).toLocaleString('he-IL', {
                            day: 'numeric',
                            month: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{r.reasonLabel ?? '—'}</td>
                    <td className="px-4 py-3 text-amber-700 font-medium whitespace-nowrap">
                      {r.coins.weekendDay || '—'}
                    </td>
                    <td className="px-4 py-3 text-indigo-700 font-medium whitespace-nowrap">
                      {r.coins.weekendNight || '—'}
                    </td>
                    <td className="px-4 py-3 text-emerald-700 font-medium whitespace-nowrap">
                      {r.coins.midweekDay || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-medium whitespace-nowrap">
                      {r.coins.midweekNight || '—'}
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
