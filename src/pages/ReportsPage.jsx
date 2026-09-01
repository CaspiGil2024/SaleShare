import { Fragment, useEffect, useState } from 'react';
import { FileBarChart, History, CalendarClock, Coins, Play, Download, BookOpenText } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isManager, isAdminRole } from '../lib/permissions';
import { bookingTypeLabelHe } from '../lib/bookingColors';
import {
  exportActivityReportToXlsx,
  exportDetailedActivityReportToXlsx,
  exportPartnerBalancesToXlsx,
  exportPartnerStatementToXlsx,
} from '../lib/xlsxExport';
import { formatCoinAmount } from '../lib/coinCalculator';
import { formatDateOnlyHe, formatDateTimeHe } from '../lib/dateFormat';

const TABS = [
  { key: 'past', label: 'דוח פעילות היסטורית', icon: History },
  { key: 'future', label: 'דוח פעילות עתידית', icon: CalendarClock },
  { key: 'balances', label: 'יתרות שותפים', icon: Coins },
  { key: 'statement', label: 'דוח תקופתי לשותף', icon: BookOpenText },
];

// Snake_case coin_type (as stored in coin_transactions / returned by
// fn_partner_coin_statement) — separate from coinCalculator.js's
// camelCase COIN_TYPE_LABELS_HE, which keys by the classifyHours
// breakdown shape instead. Same standardized midweek-day-first order.
const STATEMENT_COIN_TYPES = [
  { value: 'midweek_day', label: 'אמצ"ש יום' },
  { value: 'midweek_night', label: 'אמצ"ש לילה' },
  { value: 'weekend_day', label: 'סופ"ש יום' },
  { value: 'weekend_night', label: 'סופ"ש לילה' },
];

const STATEMENT_REASON_LABELS_HE = {
  quarterly_allowance: 'הקצאה רבעונית',
  booking_charge: 'חיוב הפלגה',
  booking_refund: 'זיכוי ביטול הפלגה',
  participant_charge: 'חיוב השתתפות',
  participant_refund: 'זיכוי ביטול השתתפות',
  admin_adjustment: 'תנועה ידנית',
  opening_balance: 'יתרת פתיחה',
};

// Every partner's real current-period balance across all 4 coin
// types (0021+). Open to every partner, not just managers — see
// 0029_open_reports_and_wallet_visibility.sql, which broadened
// user_wallets' RLS to match; Michael's Method's own equality/
// low-usage-priority goals depend on this being visible to everyone,
// same as the activity report above already showing everyone's hours.
async function fetchPartnerBalances() {
  const { error: ensureError } = await supabase.rpc('ensure_current_period');
  if (ensureError) console.error('Failed to ensure current period', ensureError);

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, full_name, email')
    .order('full_name');
  if (usersError) throw usersError;

  const { data: period } = await supabase.from('periods').select('id').eq('is_current', true).limit(1).maybeSingle();
  if (!period) return users.map((u) => ({ userId: u.id, name: u.full_name ?? u.email, weekendDay: 0, weekendNight: 0, midweekDay: 0, midweekNight: 0 }));

  const { data: wallets, error: walletsError } = await supabase
    .from('user_wallets')
    .select('user_id, coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night')
    .eq('period_id', period.id);
  if (walletsError) throw walletsError;

  const walletByUserId = new Map(wallets.map((w) => [w.user_id, w]));

  return users.map((u) => {
    const w = walletByUserId.get(u.id);
    return {
      userId: u.id,
      name: u.full_name ?? u.email,
      weekendDay: w?.coins_weekend_day ?? 0,
      weekendNight: w?.coins_weekend_night ?? 0,
      midweekDay: w?.coins_midweek_day ?? 0,
      midweekNight: w?.coins_midweek_night ?? 0,
    };
  });
}

function PartnerBalancesTab() {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await fetchPartnerBalances();
        if (!isCancelled) setRows(data);
      } catch (err) {
        console.error('Failed to load partner balances report', err);
        if (!isCancelled) setErrorMessage('אירעה שגיאה בטעינת הדוח.');
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">יתרות נוכחיות לפי סוג מטבע, לתקופה הנוכחית</p>
        <button
          type="button"
          onClick={() => exportPartnerBalancesToXlsx({ rows })}
          disabled={isLoading || rows.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold px-4 py-2.5 transition-colors"
        >
          <Download size={15} />
          יצוא ל-EXCEL
        </button>
      </div>

      {isLoading ? (
        <p className="p-10 text-center text-sm text-slate-400">טוען...</p>
      ) : errorMessage ? (
        <p className="p-10 text-center text-sm text-rose-600">{errorMessage}</p>
      ) : rows.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-400">אין שותפים רשומים.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-auto max-h-[65dvh]">
            <table className="w-full text-sm">
              <thead className="sticky-thead">
                <tr className="border-b border-slate-100 text-start text-slate-500">
                  <th className="px-4 py-3 font-medium text-start">שותף</th>
                  <th className="px-4 py-3 font-medium text-start">אמצ"ש יום</th>
                  <th className="px-4 py-3 font-medium text-start">אמצ"ש לילה</th>
                  <th className="px-4 py-3 font-medium text-start">סופ"ש יום</th>
                  <th className="px-4 py-3 font-medium text-start">סופ"ש לילה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{r.name}</td>
                    <td className="px-4 py-3 text-emerald-700 font-semibold">{formatCoinAmount(r.midweekDay)}</td>
                    <td className="px-4 py-3 text-slate-600 font-semibold">{formatCoinAmount(r.midweekNight)}</td>
                    <td className="px-4 py-3 text-amber-700 font-semibold">{formatCoinAmount(r.weekendDay)}</td>
                    <td className="px-4 py-3 text-indigo-700 font-semibold">{formatCoinAmount(r.weekendNight)}</td>
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

function toInputDate(date) {
  return date.toISOString().slice(0, 10);
}

// Hours/coins are attributed to whoever actually sailed, not just
// whoever organized: Private/Dockside/Maintenance bookings count
// toward the organizer (bookings.coins_charged, real per the sail);
// Shared/Cyprus bookings count toward every participant individually
// (booking_participants.coins_charged, organizer included — they're
// inserted as a participant row too, see NewBookingModal.jsx). Uses
// the actually-stored coins_charged rather than re-deriving from
// coin_transactions, since that's the same value the trigger really
// charged for that specific sail, immune to any later edits/refunds
// elsewhere in the ledger. Maintenance is excluded from the ranking —
// it's boat upkeep, not a partner's sailing activity (same convention
// SailingStatsChart.jsx already uses on the dashboard).
async function fetchPartnerActivity(fromDate, toDate) {
  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();

  const { data: standardBookings, error: bookingsError } = await supabase
    .from('bookings')
    .select(
      'user_id, start_time, end_time, booking_type, coins_charged, coins_charged_weekend_day, coins_charged_weekend_night, coins_charged_midweek_day, coins_charged_midweek_night, booker:users(full_name, email)'
    )
    .neq('status', 'Cancelled')
    .not('booking_type', 'in', '(Shared,Cyprus)')
    .gte('start_time', fromIso)
    .lte('start_time', toIso);
  if (bookingsError) throw bookingsError;

  const { data: participantRows, error: participantsError } = await supabase
    .from('booking_participants')
    .select(
      'user_id, coins_charged, coins_charged_weekend_day, coins_charged_weekend_night, coins_charged_midweek_day, coins_charged_midweek_night, users(full_name, email), bookings!inner(start_time, end_time, status, booking_type, user_id)'
    )
    .gte('bookings.start_time', fromIso)
    .lte('bookings.start_time', toIso)
    .neq('bookings.status', 'Cancelled');
  if (participantsError) throw participantsError;

  const byPartner = new Map();
  function entryFor(userId, name) {
    if (!byPartner.has(userId)) {
      byPartner.set(userId, { userId, name, sailCount: 0, hours: 0, coins: 0, entries: [] });
    }
    return byPartner.get(userId);
  }

  for (const b of standardBookings) {
    if (b.booking_type === 'Maintenance') continue;
    const hours = (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000;
    const entry = entryFor(b.user_id, b.booker?.full_name ?? b.booker?.email ?? 'שותף');
    entry.sailCount += 1;
    entry.hours += hours;
    entry.coins += b.coins_charged ?? 0;
    entry.entries.push({
      role: 'מארגן',
      bookingTypeLabel: bookingTypeLabelHe(b.booking_type),
      start_time: b.start_time,
      end_time: b.end_time,
      hours,
      coins: b.coins_charged ?? 0,
      coinBreakdown: {
        weekendDay: b.coins_charged_weekend_day ?? 0,
        weekendNight: b.coins_charged_weekend_night ?? 0,
        midweekDay: b.coins_charged_midweek_day ?? 0,
        midweekNight: b.coins_charged_midweek_night ?? 0,
      },
    });
  }

  for (const p of participantRows) {
    const hours = (new Date(p.bookings.end_time).getTime() - new Date(p.bookings.start_time).getTime()) / 3_600_000;
    const entry = entryFor(p.user_id, p.users?.full_name ?? p.users?.email ?? 'שותף');
    entry.sailCount += 1;
    entry.hours += hours;
    entry.coins += p.coins_charged ?? 0;
    entry.entries.push({
      role: p.bookings.user_id === p.user_id ? 'מארגן' : 'משתתף',
      bookingTypeLabel: bookingTypeLabelHe(p.bookings.booking_type),
      start_time: p.bookings.start_time,
      end_time: p.bookings.end_time,
      hours,
      coins: p.coins_charged ?? 0,
      coinBreakdown: {
        weekendDay: p.coins_charged_weekend_day ?? 0,
        weekendNight: p.coins_charged_weekend_night ?? 0,
        midweekDay: p.coins_charged_midweek_day ?? 0,
        midweekNight: p.coins_charged_midweek_night ?? 0,
      },
    });
  }

  for (const entry of byPartner.values()) {
    entry.entries.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }

  return Array.from(byPartner.values()).sort((a, b) => b.hours - a.hours);
}

function ActivityReportTab({ defaultFrom, defaultTo, reportLabel }) {
  const [fromDate, setFromDate] = useState(toInputDate(defaultFrom));
  const [toDate, setToDate] = useState(toInputDate(defaultTo));
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  // Report only fetches/renders after "בצע דוח" is clicked — not on
  // every date-picker change. null = never generated yet (distinct
  // from an empty [] result, which means "generated, found nothing").
  const [hasGenerated, setHasGenerated] = useState(false);
  // מקוצר (summary) = the existing aggregated ranking; מפורט (detailed)
  // = every individual sailing per partner, same underlying data
  // (fetchPartnerActivity already collects both in one query pass).
  const [viewMode, setViewMode] = useState('summary');

  async function handleGenerate() {
    setIsLoading(true);
    setErrorMessage(null);
    setHasGenerated(true);
    try {
      const data = await fetchPartnerActivity(new Date(fromDate), new Date(`${toDate}T23:59:59`));
      setRows(data);
    } catch (err) {
      console.error('Failed to load activity report', err);
      setErrorMessage('אירעה שגיאה בטעינת הדוח.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleExport() {
    if (viewMode === 'detailed') {
      exportDetailedActivityReportToXlsx({ rows, fromDate, toDate, reportLabel });
    } else {
      exportActivityReportToXlsx({ rows, fromDate, toDate, reportLabel });
    }
  }

  const maxHours = Math.max(...rows.map((r) => r.hours), 1);

  return (
    <div className="flex flex-col gap-4">
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
          {isLoading ? 'מפיק דוח...' : 'בצע דוח'}
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

        <div className="flex items-center gap-3 ms-auto rounded-lg border border-slate-200 px-3 py-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
            <input
              type="radio"
              name={`${reportLabel}-view-mode`}
              checked={viewMode === 'summary'}
              onChange={() => setViewMode('summary')}
              className="text-blue-600 focus:ring-blue-500"
            />
            מקוצר
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
            <input
              type="radio"
              name={`${reportLabel}-view-mode`}
              checked={viewMode === 'detailed'}
              onChange={() => setViewMode('detailed')}
              className="text-blue-600 focus:ring-blue-500"
            />
            מפורט
          </label>
        </div>
      </div>

      {!hasGenerated ? (
        <p className="p-10 text-center text-sm text-slate-400">בחרו טווח תאריכים ולחצו על "בצע דוח" כדי להציג נתונים.</p>
      ) : isLoading ? (
        <p className="p-10 text-center text-sm text-slate-400">טוען...</p>
      ) : errorMessage ? (
        <p className="p-10 text-center text-sm text-rose-600">{errorMessage}</p>
      ) : rows.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-400">אין נתוני פעילות בטווח התאריכים שנבחר.</p>
      ) : viewMode === 'summary' ? (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <p className="text-xs text-slate-400 mb-4">שעות הפלגה לפי שותף (מהגבוה לנמוך)</p>
            <div className="flex flex-col gap-2.5">
              {rows.map((r) => (
                <div key={r.userId} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm text-slate-700 truncate">{r.name}</span>
                  <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-l from-blue-600 to-sky-400 rounded-full"
                      style={{ width: `${(r.hours / maxHours) * 100}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-sm font-semibold text-slate-800 text-end">
                    {r.hours.toFixed(1)} ש'
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-auto max-h-[65dvh]">
              <table className="w-full text-sm">
                <thead className="sticky-thead">
                  <tr className="border-b border-slate-100 text-start text-slate-500">
                    <th className="px-4 py-3 font-medium text-start">שותף</th>
                    <th className="px-4 py-3 font-medium text-start">מספר הפלגות</th>
                    <th className="px-4 py-3 font-medium text-start">סה"כ שעות</th>
                    <th className="px-4 py-3 font-medium text-start">סה"כ מטבעות</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.userId} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                      <td className="px-4 py-3 text-slate-600">{r.sailCount}</td>
                      <td className="px-4 py-3 text-slate-600">{r.hours.toFixed(1)}</td>
                      <td className="px-4 py-3 text-slate-600">{formatCoinAmount(r.coins)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        // מפורט: every partner, in the same order as the summary
        // ranking, each followed by their own complete itemized log.
        <div className="flex flex-col gap-4">
          {rows.map((r) => (
            <div key={r.userId} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h4 className="font-bold text-slate-800">{r.name}</h4>
                <p className="text-xs text-slate-400">
                  {r.sailCount} הפלגות · {r.hours.toFixed(1)} שעות · {formatCoinAmount(r.coins)} מטבעות
                </p>
              </div>
              <div className="overflow-auto max-h-[40dvh]">
              <table className="w-full text-sm">
                <thead className="sticky-thead">
                  <tr className="border-b border-slate-100 text-start text-slate-500">
                    <th className="px-4 py-2 font-medium text-start">תפקיד</th>
                    <th className="px-4 py-2 font-medium text-start">סוג</th>
                    <th className="px-4 py-2 font-medium text-start">התחלה</th>
                    <th className="px-4 py-2 font-medium text-start">סיום</th>
                    <th className="px-4 py-2 font-medium text-start">שעות</th>
                    <th className="px-4 py-2 font-medium text-start whitespace-nowrap">אמצ"ש יום</th>
                    <th className="px-4 py-2 font-medium text-start whitespace-nowrap">אמצ"ש לילה</th>
                    <th className="px-4 py-2 font-medium text-start whitespace-nowrap">סופ"ש יום</th>
                    <th className="px-4 py-2 font-medium text-start whitespace-nowrap">סופ"ש לילה</th>
                  </tr>
                </thead>
                <tbody>
                  {r.entries.map((e, idx) => (
                    <tr key={idx} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{e.role}</td>
                      <td className="px-4 py-2 text-slate-800 font-medium whitespace-nowrap">{e.bookingTypeLabel}</td>
                      <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                        {formatDateTimeHe(e.start_time)}
                      </td>
                      <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                        {formatDateTimeHe(e.end_time)}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{e.hours.toFixed(1)}</td>
                      <td className="px-4 py-2 text-emerald-700 font-medium whitespace-nowrap">
                        {e.coinBreakdown.midweekDay ? formatCoinAmount(e.coinBreakdown.midweekDay) : '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-600 font-medium whitespace-nowrap">
                        {e.coinBreakdown.midweekNight ? formatCoinAmount(e.coinBreakdown.midweekNight) : '—'}
                      </td>
                      <td className="px-4 py-2 text-amber-700 font-medium whitespace-nowrap">
                        {e.coinBreakdown.weekendDay ? formatCoinAmount(e.coinBreakdown.weekendDay) : '—'}
                      </td>
                      <td className="px-4 py-2 text-indigo-700 font-medium whitespace-nowrap">
                        {e.coinBreakdown.weekendNight ? formatCoinAmount(e.coinBreakdown.weekendNight) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One partner's coin_transactions in a value-date range, split into
// Debit/Credit per coin type — real double-entry-style statement.
// fn_partner_coin_statement (0055) already returns a correct running
// balance PER type (seeded from the true opening balance before the
// range, not from zero); this only needs to carry each type's last-
// known balance forward across rows that belong to a DIFFERENT type,
// so all 4 running-balance columns stay populated at every row instead
// of only the one type that row's transaction actually touched.
async function fetchPartnerStatement(userId, fromDate, toDate) {
  const { data, error } = await supabase.rpc('fn_partner_coin_statement', {
    p_user_id: userId,
    p_from: fromDate,
    p_to: toDate,
  });
  if (error) throw error;
  return data ?? [];
}

function PartnerStatementTab() {
  const { currentUser } = useAuth();
  // fn_partner_coin_statement itself only allows viewing your own
  // statement unless you're a manager/admin (0055) — mirrored here so a
  // regular partner isn't offered a dropdown of everyone else's names
  // just to have it fail server-side when they pick one.
  const canViewOthers = isManager(currentUser) || isAdminRole(currentUser);
  const [partners, setPartners] = useState([]);
  const [partnerId, setPartnerId] = useState('');
  const [fromDate, setFromDate] = useState(toInputDate(new Date(new Date().getFullYear(), 0, 1)));
  const [toDate, setToDate] = useState(toInputDate(new Date()));
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  useEffect(() => {
    if (!currentUser?.id) return;
    if (!canViewOthers) {
      setPartners([{ id: currentUser.id, full_name: currentUser.full_name, email: currentUser.email }]);
      setPartnerId(currentUser.id);
      return;
    }
    supabase
      .from('users')
      .select('id, full_name, email')
      .order('full_name')
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to load partners for statement report', error);
          return;
        }
        setPartners(data ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, canViewOthers]);

  async function handleGenerate() {
    if (!partnerId) {
      setErrorMessage('יש לבחור שותף.');
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchPartnerStatement(partnerId, fromDate, toDate);
      setRows(data);
      setHasGenerated(true);
    } catch (err) {
      console.error('Failed to load partner statement', err);
      setErrorMessage('אירעה שגיאה בהפקת הדוח.');
    } finally {
      setIsLoading(false);
    }
  }

  // fn_partner_coin_statement (0055) returns two kinds of rows: up to 4
  // "opening_balance" pseudo-rows (value_date null, one per coin type,
  // only present at all when that partner has any transaction before
  // fromDate) that together summarize everything before the range, and
  // the real chronological transactions inside it. The 4 opening rows
  // get merged into ONE displayed row up top instead of being shown
  // per-type like a normal transaction row would.
  const openingByType = {};
  let hasOpening = false;
  const transactionRows = [];
  for (const r of rows) {
    if (r.value_date === null) {
      openingByType[r.coin_type] = r;
      hasOpening = true;
    } else {
      transactionRows.push(r);
    }
  }

  // Running balance carried forward per type, seeded from the opening
  // row (0 if there wasn't one) — each transaction row only updates ITS
  // OWN type's entry, the other 3 stay whatever they last were.
  const lastKnownBalance = {};
  for (const t of STATEMENT_COIN_TYPES) {
    lastKnownBalance[t.value] = openingByType[t.value]?.running_balance ?? 0;
  }
  const displayRows = transactionRows.map((r) => {
    lastKnownBalance[r.coin_type] = r.running_balance;
    return { ...r, balancesByType: { ...lastKnownBalance } };
  });

  const partnerName = partners.find((p) => p.id === partnerId)?.full_name ?? partners.find((p) => p.id === partnerId)?.email;

  function handleExport() {
    exportPartnerStatementToXlsx({
      partnerName,
      fromDate,
      toDate,
      rows: rows.map((r) => ({
        ...r,
        coinTypeLabel: STATEMENT_COIN_TYPES.find((t) => t.value === r.coin_type)?.label ?? r.coin_type,
        reasonLabel: STATEMENT_REASON_LABELS_HE[r.reason] ?? r.reason,
      })),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">שותף</label>
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            disabled={!canViewOthers}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px] disabled:bg-slate-50 disabled:text-slate-500"
          >
            {canViewOthers && <option value="">בחרו שותף...</option>}
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? p.email}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">מתאריך</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">עד תאריך</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition-colors"
        >
          <Play size={15} />
          {isLoading ? 'מפיק...' : 'הפק דוח'}
        </button>
        {hasGenerated && (
          <button
            type="button"
            onClick={handleExport}
            disabled={!hasOpening && displayRows.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold px-4 py-2 transition-colors"
          >
            <Download size={15} />
            יצוא ל-EXCEL
          </button>
        )}
      </div>

      {errorMessage && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{errorMessage}</p>
      )}

      {!hasGenerated ? (
        <p className="p-10 text-center text-sm text-slate-400">בחרו שותף וטווח תאריכים ולחצו "הפק דוח".</p>
      ) : isLoading ? (
        <p className="p-10 text-center text-sm text-slate-400">טוען...</p>
      ) : !hasOpening && displayRows.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-400">אין תנועות מטבעות בטווח התאריכים שנבחר.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-auto max-h-[65dvh]">
            <table className="w-full text-sm">
              <thead className="sticky-thead">
                <tr className="border-b border-slate-100 text-start text-slate-500">
                  <th rowSpan={2} className="px-4 py-3 font-bold text-start align-bottom whitespace-nowrap">
                    תאריך ערך
                  </th>
                  <th rowSpan={2} className="px-4 py-3 font-bold text-start align-bottom whitespace-nowrap">
                    סיבה
                  </th>
                  {STATEMENT_COIN_TYPES.map((t) => (
                    <th key={t.value} colSpan={3} className="px-4 py-2 font-bold text-center border-s border-slate-100 whitespace-nowrap">
                      {t.label}
                    </th>
                  ))}
                  <th rowSpan={2} className="px-4 py-3 font-bold text-start align-bottom whitespace-nowrap">
                    הערה
                  </th>
                </tr>
                <tr className="border-b border-slate-200 text-start text-slate-500">
                  {STATEMENT_COIN_TYPES.map((t) => (
                    <Fragment key={t.value}>
                      <th className="px-3 py-2 font-medium text-start border-s border-slate-100 whitespace-nowrap">
                        חובה
                      </th>
                      <th className="px-3 py-2 font-medium text-start whitespace-nowrap">זכות</th>
                      <th className="px-3 py-2 font-medium text-start whitespace-nowrap">יתרה</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hasOpening && (
                  <tr className="border-b border-slate-200 bg-slate-50 font-medium">
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">—</td>
                    <td className="px-4 py-3 text-slate-800 whitespace-nowrap">
                      {STATEMENT_REASON_LABELS_HE.opening_balance}
                    </td>
                    {STATEMENT_COIN_TYPES.map((t) => {
                      const o = openingByType[t.value];
                      return (
                        <Fragment key={t.value}>
                          <td className="px-3 py-3 border-s border-slate-100 text-rose-600 whitespace-nowrap">
                            {o?.debit != null ? formatCoinAmount(o.debit) : '—'}
                          </td>
                          <td className="px-3 py-3 text-emerald-700 whitespace-nowrap">
                            {o?.credit != null ? formatCoinAmount(o.credit) : '—'}
                          </td>
                          <td className="px-3 py-3 font-semibold text-slate-800 whitespace-nowrap">
                            {formatCoinAmount(o?.running_balance ?? 0)}
                          </td>
                        </Fragment>
                      );
                    })}
                    <td className="px-4 py-3 text-slate-500">—</td>
                  </tr>
                )}
                {displayRows.map((r, idx) => (
                  <tr key={idx} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDateOnlyHe(r.value_date)}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {STATEMENT_REASON_LABELS_HE[r.reason] ?? r.reason}
                    </td>
                    {STATEMENT_COIN_TYPES.map((t) => {
                      const isThisType = t.value === r.coin_type;
                      return (
                        <Fragment key={t.value}>
                          <td className="px-3 py-3 border-s border-slate-50 text-rose-600 whitespace-nowrap">
                            {isThisType && r.debit != null ? formatCoinAmount(r.debit) : '—'}
                          </td>
                          <td className="px-3 py-3 text-emerald-700 whitespace-nowrap">
                            {isThisType && r.credit != null ? formatCoinAmount(r.credit) : '—'}
                          </td>
                          <td className="px-3 py-3 font-semibold text-slate-800 whitespace-nowrap">
                            {r.balancesByType[t.value] !== undefined ? formatCoinAmount(r.balancesByType[t.value]) : '—'}
                          </td>
                        </Fragment>
                      );
                    })}
                    <td className="px-4 py-3 text-slate-500">{r.note ?? '—'}</td>
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

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState('past');

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header>
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <FileBarChart size={22} className="text-blue-600" />
          דוחות
        </h2>
        <p className="text-sm text-slate-500">פעילות שותפים - היסטורית ועתידית</p>
      </header>

      <div className="flex items-center gap-2 border-b border-slate-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* key= forces a clean remount when switching tabs, so each tab's
          own date-range state doesn't leak into the other's inputs. */}
      {activeTab === 'past' && (
        <ActivityReportTab
          key="past"
          defaultFrom={new Date('2024-01-01')}
          defaultTo={new Date()}
          reportLabel="historical-activity"
        />
      )}
      {activeTab === 'future' && (
        <ActivityReportTab
          key="future"
          defaultFrom={new Date()}
          defaultTo={new Date('2029-12-31')}
          reportLabel="future-activity"
        />
      )}
      {activeTab === 'balances' && <PartnerBalancesTab key="balances" />}
      {activeTab === 'statement' && <PartnerStatementTab key="statement" />}
    </div>
  );
}
