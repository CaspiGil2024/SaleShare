import { useEffect, useState } from 'react';
import { DatabaseBackup, Download, Table2, History, Pencil, X, PlusCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isManager, isAdminOrTreasurer } from '../lib/permissions';
import { bookingTypeLabelHe } from '../lib/bookingColors';
import { exportDatabaseToXlsx, exportCoinAdjustmentAuditToXlsx } from '../lib/xlsxExport';
import { formatCoinAmount as formatCoin } from '../lib/coinCalculator';
import { formatDateTimeHe } from '../lib/dateFormat';

const COIN_TYPE_OPTIONS = [
  { value: 'midweek_day', label: 'אמצ"ש יום' },
  { value: 'midweek_night', label: 'אמצ"ש לילה' },
  { value: 'weekend_day', label: 'סופ"ש יום' },
  { value: 'weekend_night', label: 'סופ"ש לילה' },
];
const COIN_TYPE_LABELS_HE = Object.fromEntries(COIN_TYPE_OPTIONS.map((o) => [o.value, o.label]));
const COIN_TYPE_COLUMN = {
  midweek_day: 'coins_midweek_day',
  midweek_night: 'coins_midweek_night',
  weekend_day: 'coins_weekend_day',
  weekend_night: 'coins_weekend_night',
};

// Dash for genuinely missing data, otherwise always two decimals — the
// shared formatCoinAmount (coinCalculator.js) is the single source of
// truth for the number formatting itself.
function formatCoinAmount(n) {
  if (n === null || n === undefined) return '—';
  return formatCoin(n);
}

// ---------------------------------------------------------------------
// Manual coin-balance editing + its audit log — moved here from
// ParametersPage.jsx (which keeps only the general S/overdraft/rollover
// settings form). All three sections below stay admin/treasurer-only,
// same as when the whole page they used to live on was gated that way
// — see canManageBalances in the default export.
// ---------------------------------------------------------------------

// Explicit Debit/Credit journal entry — classic accounting-style
// counterpart to EditBalanceModal below (which SETS a target balance
// directly). This one takes an amount + direction (חובה/זכות) and a
// value date, calling fn_admin_manual_coin_entry (0055) — a different
// RPC from fn_admin_adjust_coin_balance, but both write the SAME
// 'admin_adjustment' reason, so they share one unified audit trail
// (AdjustmentAuditLog below) rather than needing a second one.
function ManualCoinEntryForm({ onSaved }) {
  const [partners, setPartners] = useState([]);
  const [partnerId, setPartnerId] = useState('');
  const [coinType, setCoinType] = useState(COIN_TYPE_OPTIONS[0].value);
  const [direction, setDirection] = useState('credit');
  const [amount, setAmount] = useState('');
  const [valueDate, setValueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  useEffect(() => {
    supabase
      .from('users')
      .select('id, full_name, email')
      .order('full_name')
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to load partners for manual coin entry', error);
          return;
        }
        setPartners(data ?? []);
      });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!partnerId) {
      setErrorMessage('יש לבחור שותף.');
      return;
    }
    const parsedAmount = Number(amount);
    if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMessage('יש להזין סכום חיובי גדול מאפס.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_admin_manual_coin_entry', {
        p_user_id: partnerId,
        p_coin_type: coinType,
        p_amount: parsedAmount,
        p_direction: direction,
        p_value_date: valueDate,
        p_note: note.trim() ? note.trim() : null,
      });
      if (error) throw error;

      setSuccessMessage('התנועה נרשמה בהצלחה.');
      setAmount('');
      setNote('');
      await onSaved?.();
    } catch (err) {
      console.error('Failed to record manual coin entry', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה ברישום התנועה.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-4"
    >
      <div>
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <PlusCircle size={18} className="text-blue-600 dark:text-blue-300" />
          תנועת מטבעות ידנית (חובה / זכות)
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          רישום ידני של תנועת חובה או זכות עבור שותף, כולל תאריך ערך — בהתאם לכללי הנהלת חשבונות כפולה
        </p>
      </div>

      {/* flex-wrap (not a fixed-column grid) so every field — the
          button included — flows on one line whenever there's room,
          and only wraps to a second line on a genuinely narrow
          viewport, instead of always breaking into fixed rows of N. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5 w-44">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">שותף</label>
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          >
            <option value="">בחרו שותף...</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? p.email}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 w-36">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">סוג מטבע</label>
          <select
            value={coinType}
            onChange={(e) => setCoinType(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          >
            {COIN_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 w-32">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">חובה / זכות</label>
          <div className="flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden">
            <button
              type="button"
              onClick={() => setDirection('debit')}
              className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                direction === 'debit' ? 'bg-rose-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              חובה
            </button>
            <button
              type="button"
              onClick={() => setDirection('credit')}
              className={`flex-1 py-2 text-sm font-semibold transition-colors border-r border-slate-300 dark:border-slate-600 ${
                direction === 'credit' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              זכות
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 w-28">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">סכום</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          />
        </div>

        <div className="flex flex-col gap-1.5 w-40">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">תאריך ערך</label>
          <input
            type="date"
            value={valueDate}
            onChange={(e) => setValueDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          />
        </div>

        <div className="flex flex-col gap-1.5 flex-1 min-w-[160px]">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">הערה (אופציונלי)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="סיבת התנועה..."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="shrink-0 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 transition-colors"
        >
          {submitting ? 'רושם...' : 'רישום תנועה'}
        </button>
      </div>

      {errorMessage && (
        <p className="text-sm text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">{errorMessage}</p>
      )}
      {successMessage && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
          {successMessage}
        </p>
      )}
    </form>
  );
}

// Opens pre-filled with all 4 of one partner's coin-type balances at
// once. Deliberately batches every field behind a single Save button
// instead of committing per-field: each field used to open its own
// single-value modal that wrote + reloaded the whole partner table
// immediately, so adjusting all 4 types for one person meant 4 separate
// full-table reloads back to back — that's the "locks up / takes
// forever" UI freeze this replaces. The actual write still always goes
// through fn_admin_adjust_coin_balance (never a raw UPDATE on
// user_wallets), once per type that actually changed, so every change
// stays individually audited — Save just batches the calls into one
// user action and one reload afterward instead of one each.
function EditBalanceModal({ partner, onClose, onSaved }) {
  const [values, setValues] = useState({});
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!partner) return;
    // Seed from the ROUNDED balance (formatCoin, 2dp), not the raw
    // stored float — Michael's Method's guest-weighted splits produce
    // repeating decimals (e.g. 43.333333333333336), which used to leak
    // straight into this editable field verbatim. changedTypes below
    // compares against this same rounded baseline, not the raw value,
    // so simply opening and saving without touching a field never
    // writes a spurious "change" just because of the rounding.
    setValues(Object.fromEntries(COIN_TYPE_OPTIONS.map((opt) => [opt.value, formatCoin(partner.balances[opt.value] ?? 0)])));
    setNote('');
    setErrorMessage(null);
    // Belt-and-suspenders alongside the finally block in handleSubmit
    // below: this modal doesn't unmount between partners (same
    // component instance, `partner` prop just changes), so any stray
    // stuck submitting=true from a previous session would otherwise
    // survive into the next one.
    setSubmitting(false);
  }, [partner]);

  if (!partner) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);

    const parsed = {};
    for (const opt of COIN_TYPE_OPTIONS) {
      const raw = values[opt.value];
      if (raw === '' || raw === undefined || Number.isNaN(Number(raw))) {
        setErrorMessage(`יש להזין יתרה תקינה עבור ${opt.label}.`);
        return;
      }
      parsed[opt.value] = Number(raw);
    }

    // Only types whose value actually changed get written/audited —
    // re-submitting an untouched field as a no-op "change" would just
    // add noise to the audit log for nothing.
    const changedTypes = COIN_TYPE_OPTIONS.filter(
      (opt) => parsed[opt.value] !== Number(formatCoin(partner.balances[opt.value] ?? 0))
    );
    if (changedTypes.length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    try {
      for (const opt of changedTypes) {
        const { error } = await supabase.rpc('fn_admin_adjust_coin_balance', {
          p_user_id: partner.partnerId,
          p_coin_type: opt.value,
          p_new_balance: parsed[opt.value],
          p_note: note.trim() ? note.trim() : null,
        });
        if (error) throw error;
      }
      await onSaved?.();
    } catch (err) {
      console.error('Failed to adjust coin balance', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בעדכון היתרה.');
    } finally {
      // Was previously only reset in the catch block — on success this
      // modal doesn't unmount between partners (same component
      // instance, just a new `partner` prop), so submitting stayed
      // stuck true forever after the FIRST successful save, disabling
      // the Save button for every partner opened after that one.
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div dir="rtl" className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">שינוי יתרות</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{partner.partnerName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {COIN_TYPE_OPTIONS.map((opt, i) => (
              <div key={opt.value} className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">{opt.label}</label>
                <input
                  type="number"
                  step="0.01"
                  autoFocus={i === 0}
                  value={values[opt.value] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [opt.value]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">הערה (אופציונלי, חלה על כל שדה ששונה)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="סיבת השינוי..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500">
            שינוי זה עוקף את מגבלת האוברדרפט (תיקון מנהלי מפורש) ומתועד באופן מלא ביומן הביקורת, כולל שם
            המבצע, יתרה קודמת/חדשה, וחותמת זמן — לכל שדה ששונה בנפרד.
          </p>

          {errorMessage && (
            <p className="text-sm text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">{errorMessage}</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 transition-colors"
            >
              {submitting ? 'מעדכן...' : 'שמירה'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold py-2.5 transition-colors"
            >
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// The dedicated table this feature is actually about: every partner,
// all 4 coin-type balances at once, each one directly editable.
// Clicking any balance cell opens EditBalanceModal pre-filled with
// that partner's full set of 4 balances, saved together behind one
// Save button — there's no separate dropdown-based form anymore, this
// table IS the adjustment UI.
function PartnerBalancesTable({ onAdjusted, refreshToken = 0 }) {
  const [partners, setPartners] = useState([]);
  const [walletByUserId, setWalletByUserId] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [editingPartner, setEditingPartner] = useState(null); // { partnerId, partnerName, balances }

  // isLoading only ever gates the FIRST load (replaces the table with a
  // spinner, since there's nothing to show yet); every reload after
  // that — e.g. right after EditBalanceModal saves — uses isRefreshing
  // instead, which keeps the existing rows on screen (just dimmed) so
  // saving one balance doesn't blank/flash the whole table each time.
  async function load({ isInitial = false } = {}) {
    if (isInitial) setIsLoading(true);
    else setIsRefreshing(true);
    setErrorMessage(null);
    try {
      const { error: ensureError } = await supabase.rpc('ensure_current_period');
      if (ensureError) console.error('Failed to ensure current period', ensureError);

      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, full_name, email')
        .order('full_name');
      if (usersError) throw usersError;

      const { data: period } = await supabase.from('periods').select('id').eq('is_current', true).limit(1).maybeSingle();

      let wallets = [];
      if (period) {
        const { data, error: walletsError } = await supabase
          .from('user_wallets')
          .select('user_id, coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night')
          .eq('period_id', period.id);
        if (walletsError) throw walletsError;
        wallets = data ?? [];
      }

      setPartners(users ?? []);
      setWalletByUserId(Object.fromEntries(wallets.map((w) => [w.user_id, w])));
    } catch (err) {
      console.error('Failed to load partner balances', err);
      setErrorMessage('אירעה שגיאה בטעינת יתרות השותפים.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  // Also reloads (dimmed, not a full spinner) whenever refreshToken
  // changes — e.g. ManualCoinEntryForm above just recorded a new entry
  // for some partner, so the table shouldn't keep showing stale
  // balances until this page happens to remount.
  useEffect(() => {
    load({ isInitial: refreshToken === 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  async function handleSaved() {
    setEditingPartner(null);
    await load();
    await onAdjusted?.();
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
        <Table2 size={18} className="text-blue-600 dark:text-blue-300" />
        <div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">יתרות שותפים - עריכה ידנית</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500">לחצו על עיפרון ליד כל יתרה כדי לערוך את כל 4 היתרות של אותו שותף יחד</p>
        </div>
      </div>

      {isLoading ? (
        <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">טוען...</p>
      ) : errorMessage ? (
        <p className="p-10 text-center text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
      ) : partners.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">אין שותפים רשומים.</p>
      ) : (
        <div className={`overflow-auto max-h-[65dvh] transition-opacity ${isRefreshing ? 'opacity-60' : ''}`}>
          <table className="w-full text-sm">
            <thead className="sticky-thead">
              <tr className="border-b border-slate-100 dark:border-slate-800 text-start text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium text-start whitespace-nowrap">שותף</th>
                {COIN_TYPE_OPTIONS.map((opt) => (
                  <th key={opt.value} className="px-4 py-3 font-medium text-start whitespace-nowrap min-w-[110px]">
                    {opt.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => {
                const wallet = walletByUserId[p.id];
                const partnerName = p.full_name ?? p.email;
                const balances = Object.fromEntries(
                  COIN_TYPE_OPTIONS.map((opt) => [opt.value, wallet ? wallet[COIN_TYPE_COLUMN[opt.value]] : 0])
                );
                return (
                  <tr key={p.id} className="border-b border-slate-50 dark:border-slate-800 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap">{partnerName}</td>
                    {COIN_TYPE_OPTIONS.map((opt) => (
                      <td key={opt.value} className="px-4 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setEditingPartner({ partnerId: p.id, partnerName, balances })}
                          disabled={isRefreshing}
                          className="flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-amber-50 dark:hover:bg-amber-900 text-amber-700 dark:text-amber-300 font-semibold transition-colors whitespace-nowrap disabled:cursor-not-allowed"
                          title="לחצו לעריכת כל היתרות של שותף זה"
                        >
                          {formatCoinAmount(balances[opt.value])}
                          <Pencil size={12} className="text-amber-400 dark:text-amber-400" />
                        </button>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <EditBalanceModal partner={editingPartner} onClose={() => setEditingPartner(null)} onSaved={handleSaved} />
    </div>
  );
}

function AdjustmentAuditLog({ refreshToken }) {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabase
        .from('coin_transactions')
        .select(
          'id, coin_type, balance_before, balance_after, note, created_at, partner:users!coin_transactions_user_id_fkey(full_name, email), actor:users!coin_transactions_actor_user_id_fkey(full_name, email)'
        )
        .eq('reason', 'admin_adjustment')
        .order('created_at', { ascending: false })
        .limit(100);

      if (isCancelled) return;
      if (error) {
        console.error('Failed to load coin adjustment audit log', error);
        setErrorMessage('אירעה שגיאה בטעינת יומן הביקורת.');
      } else {
        setRows(data ?? []);
      }
      setIsLoading(false);
    }
    load();
    return () => {
      isCancelled = true;
    };
  }, [refreshToken]);

  function handleExport() {
    exportCoinAdjustmentAuditToXlsx({
      rows: rows.map((r) => ({ ...r, coinTypeLabel: COIN_TYPE_LABELS_HE[r.coin_type] })),
    });
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History size={18} className="text-slate-500 dark:text-slate-400" />
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">יומן ביקורת - שינויים ידניים ביתרות</h3>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={isLoading || rows.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold px-3.5 py-2 transition-colors"
        >
          <Download size={15} />
          יצוא ל-EXCEL
        </button>
      </div>

      {isLoading ? (
        <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">טוען...</p>
      ) : errorMessage ? (
        <p className="p-10 text-center text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
      ) : rows.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">אין עדיין שינויים ידניים רשומים.</p>
      ) : (
        <div className="overflow-auto max-h-[65dvh]">
          <table className="w-full text-sm">
            <thead className="sticky-thead">
              <tr className="border-b border-slate-100 dark:border-slate-800 text-start text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium text-start">תאריך ושעה</th>
                <th className="px-4 py-3 font-medium text-start">בוצע ע"י</th>
                <th className="px-4 py-3 font-medium text-start">שותף</th>
                <th className="px-4 py-3 font-medium text-start">סוג מטבע</th>
                <th className="px-4 py-3 font-medium text-start">יתרה קודמת</th>
                <th className="px-4 py-3 font-medium text-start">יתרה חדשה</th>
                <th className="px-4 py-3 font-medium text-start">הערה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800 last:border-0">
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {formatDateTimeHe(r.created_at)}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                    {r.actor?.full_name ?? r.actor?.email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                    {r.partner?.full_name ?? r.partner?.email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{COIN_TYPE_LABELS_HE[r.coin_type]}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatCoinAmount(r.balance_before)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">{formatCoinAmount(r.balance_after)}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Existing DB backup/export tool — unchanged, still manager-only.
// ---------------------------------------------------------------------
async function loadExportData() {
  const { data: partners, error: partnersError } = await supabase
    .from('partner_roster')
    .select('full_name, email, phone, roles, is_active, balance')
    .order('full_name');
  if (partnersError) throw partnersError;

  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select(
      'id, booking_type, status, start_time, end_time, guests_count, notes, coins_charged, booker:users(full_name, email)'
    )
    .order('start_time');
  if (bookingsError) throw bookingsError;

  const { data: participantRows, error: participantsError } = await supabase
    .from('booking_participants')
    .select('booking_id, coins_charged, users(full_name, email)');
  if (participantsError) throw participantsError;

  const participantsByBooking = new Map();
  for (const p of participantRows) {
    if (!participantsByBooking.has(p.booking_id)) {
      participantsByBooking.set(p.booking_id, { names: [], coinsTotal: 0 });
    }
    const entry = participantsByBooking.get(p.booking_id);
    entry.names.push(p.users?.full_name ?? p.users?.email ?? 'שותף');
    entry.coinsTotal += p.coins_charged ?? 0;
  }

  const enrichedBookings = bookings.map((b) => {
    const participants = participantsByBooking.get(b.id);
    const participantCoinsTotal = participants?.coinsTotal ?? 0;
    return {
      id: b.id,
      organizerName: b.booker?.full_name ?? b.booker?.email ?? 'שותף',
      bookingTypeLabel: bookingTypeLabelHe(b.booking_type),
      status: b.status,
      start_time: b.start_time,
      end_time: b.end_time,
      guests_count: b.guests_count,
      notes: b.notes,
      coins_charged: b.coins_charged ?? 0,
      participantNames: participants?.names.join(', ') ?? '',
      participantCoinsTotal,
      totalCoinsCharged: (b.coins_charged ?? 0) + participantCoinsTotal,
    };
  });

  return { partners, bookings: enrichedBookings };
}

function DatabaseBackupSection() {
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  async function handleExport() {
    setIsExporting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const { partners, bookings } = await loadExportData();
      exportDatabaseToXlsx({ partners, bookings });
      setSuccessMessage(`הקובץ הורד בהצלחה (${partners.length} שותפים, ${bookings.length} הפלגות).`);
    } catch (err) {
      console.error('Failed to export database', err);
      setErrorMessage('אירעה שגיאה בייצוא הנתונים. נסו שוב.');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-4 max-w-xl">
      <div>
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">גיבוי DB (ייצוא ל-XLSX)</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          מוריד קובץ Excel עם שני גיליונות: פרטי שותפים, ופרטי הפלגות מתחילת הפעילות כולל מטבעות שנוצלו לכל
          הפלגה (הן על ידי המזמין והן על ידי שותפים משתתפים).
        </p>
      </div>

      {errorMessage && (
        <p className="text-sm text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">{errorMessage}</p>
      )}
      {successMessage && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
          {successMessage}
        </p>
      )}

      <button
        type="button"
        onClick={handleExport}
        disabled={isExporting}
        className="self-start flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 transition-colors"
      >
        <Download size={16} />
        {isExporting ? 'מייצא...' : 'ייצוא DB'}
      </button>
    </div>
  );
}

export default function MaintenanceDataPage() {
  const { currentUser } = useAuth();
  const [auditRefreshToken, setAuditRefreshToken] = useState(0);
  const canManageBalances = isAdminOrTreasurer(currentUser);

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <DatabaseBackup size={22} className="text-blue-600 dark:text-blue-300" />
          תחזוקה ונתונים
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">יתרות שותפים, יומן ביקורת, וכלי גיבוי וייצוא נתונים</p>
      </header>

      {canManageBalances && (
        <>
          <ManualCoinEntryForm onSaved={() => setAuditRefreshToken((n) => n + 1)} />
          <PartnerBalancesTable
            refreshToken={auditRefreshToken}
            onAdjusted={() => setAuditRefreshToken((n) => n + 1)}
          />
          <AdjustmentAuditLog refreshToken={auditRefreshToken} />
        </>
      )}

      {isManager(currentUser) && <DatabaseBackupSection />}
    </div>
  );
}
