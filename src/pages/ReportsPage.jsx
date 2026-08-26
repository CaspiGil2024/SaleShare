import { useEffect, useState } from 'react';
import { FileBarChart, History, CalendarClock, Coins, Play, Download } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { exportActivityReportToXlsx, exportPartnerBalancesToXlsx } from '../lib/xlsxExport';

const TABS = [
  { key: 'past', label: 'דוח פעילות היסטורית', icon: History },
  { key: 'future', label: 'דוח פעילות עתידית', icon: CalendarClock },
  { key: 'balances', label: 'יתרות שותפים', icon: Coins },
];

function formatCoinAmount(n) {
  if (n === null || n === undefined) return '0';
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-start text-slate-500">
                  <th className="px-4 py-3 font-medium text-start">שותף</th>
                  <th className="px-4 py-3 font-medium text-start">סופ"ש יום</th>
                  <th className="px-4 py-3 font-medium text-start">סופ"ש לילה</th>
                  <th className="px-4 py-3 font-medium text-start">אמצ"ש יום</th>
                  <th className="px-4 py-3 font-medium text-start">אמצ"ש לילה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{r.name}</td>
                    <td className="px-4 py-3 text-amber-700 font-semibold">{formatCoinAmount(r.weekendDay)}</td>
                    <td className="px-4 py-3 text-indigo-700 font-semibold">{formatCoinAmount(r.weekendNight)}</td>
                    <td className="px-4 py-3 text-emerald-700 font-semibold">{formatCoinAmount(r.midweekDay)}</td>
                    <td className="px-4 py-3 text-slate-600 font-semibold">{formatCoinAmount(r.midweekNight)}</td>
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
    .select('user_id, start_time, end_time, booking_type, coins_charged, booker:users(full_name, email)')
    .neq('status', 'Cancelled')
    .not('booking_type', 'in', '(Shared,Cyprus)')
    .gte('start_time', fromIso)
    .lte('start_time', toIso);
  if (bookingsError) throw bookingsError;

  const { data: participantRows, error: participantsError } = await supabase
    .from('booking_participants')
    .select('user_id, coins_charged, users(full_name, email), bookings!inner(start_time, end_time, status)')
    .gte('bookings.start_time', fromIso)
    .lte('bookings.start_time', toIso)
    .neq('bookings.status', 'Cancelled');
  if (participantsError) throw participantsError;

  const byPartner = new Map();
  function entryFor(userId, name) {
    if (!byPartner.has(userId)) {
      byPartner.set(userId, { userId, name, sailCount: 0, hours: 0, coins: 0 });
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
  }

  for (const p of participantRows) {
    const hours = (new Date(p.bookings.end_time).getTime() - new Date(p.bookings.start_time).getTime()) / 3_600_000;
    const entry = entryFor(p.user_id, p.users?.full_name ?? p.users?.email ?? 'שותף');
    entry.sailCount += 1;
    entry.hours += hours;
    entry.coins += p.coins_charged ?? 0;
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
    exportActivityReportToXlsx({ rows, fromDate, toDate, reportLabel });
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
      </div>

      {!hasGenerated ? (
        <p className="p-10 text-center text-sm text-slate-400">בחרו טווח תאריכים ולחצו על "בצע דוח" כדי להציג נתונים.</p>
      ) : isLoading ? (
        <p className="p-10 text-center text-sm text-slate-400">טוען...</p>
      ) : errorMessage ? (
        <p className="p-10 text-center text-sm text-rose-600">{errorMessage}</p>
      ) : rows.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-400">אין נתוני פעילות בטווח התאריכים שנבחר.</p>
      ) : (
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
            <table className="w-full text-sm">
              <thead>
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
                    <td className="px-4 py-3 text-slate-600">{r.coins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
    </div>
  );
}
