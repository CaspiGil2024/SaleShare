import { useEffect, useState } from 'react';
import { Settings, SlidersHorizontal, History, Pencil, X, Table2, Download } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isAdminOrTreasurer } from '../lib/permissions';
import { exportCoinAdjustmentAuditToXlsx } from '../lib/xlsxExport';

const COIN_TYPE_OPTIONS = [
  { value: 'weekend_day', label: 'סופ"ש יום' },
  { value: 'weekend_night', label: 'סופ"ש לילה' },
  { value: 'midweek_day', label: 'אמצ"ש יום' },
  { value: 'midweek_night', label: 'אמצ"ש לילה' },
];
const COIN_TYPE_LABELS_HE = Object.fromEntries(COIN_TYPE_OPTIONS.map((o) => [o.value, o.label]));
const COIN_TYPE_COLUMN = {
  weekend_day: 'coins_weekend_day',
  weekend_night: 'coins_weekend_night',
  midweek_day: 'coins_midweek_day',
  midweek_night: 'coins_midweek_night',
};

function formatCoinAmount(n) {
  if (n === null || n === undefined) return '—';
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function SystemSettingsForm({ currentUser }) {
  const [sMultiplier, setSMultiplier] = useState(1);
  const [overdraftPercent, setOverdraftPercent] = useState(20);
  const [rolloverPercent, setRolloverPercent] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabase
        .from('system_settings')
        .select('s_multiplier, overdraft_percent, rollover_percent')
        .eq('id', true)
        .maybeSingle();

      if (error) {
        console.error('Failed to load system settings', error);
        setErrorMessage('אירעה שגיאה בטעינת הפרמטרים.');
      } else if (data) {
        setSMultiplier(data.s_multiplier);
        setOverdraftPercent(data.overdraft_percent);
        setRolloverPercent(data.rollover_percent);
      }
      setIsLoading(false);
    }
    load();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .update({
          s_multiplier: Number(sMultiplier),
          overdraft_percent: Number(overdraftPercent),
          rollover_percent: Number(rolloverPercent),
          updated_by: currentUser.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', true)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('השמירה לא בוצעה בפועל — ייתכן שאין לכם הרשאה. אנא רעננו ונסו שוב.');
      }
      setSuccessMessage('הפרמטרים נשמרו בהצלחה.');
    } catch (err) {
      console.error('Failed to save system settings', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בשמירת הפרמטרים.');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <p className="p-10 text-center text-sm text-slate-400">טוען...</p>;

  return (
    <form onSubmit={handleSave} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col gap-5 max-w-xl">
      <div className="flex items-center gap-2 text-slate-800 font-bold">
        <SlidersHorizontal size={18} className="text-blue-600" />
        <h3>הגדרות כלליות</h3>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">מכפיל S (מקסימום הזמנות עתידיות מכל סוג)</label>
        <input
          type="number"
          min={1}
          step={1}
          value={sMultiplier}
          onChange={(e) => setSMultiplier(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-slate-400">
          המלצת מיכאל: 1 או 2. שותף יוכל להיות רשום למקסימום S הפלגות עתידיות מכל סוג מטבע (סעיף 60/80).
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">אחוז אוברדרפט (יתרה שלילית מותרת)</label>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={overdraftPercent}
          onChange={(e) => setOverdraftPercent(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-slate-400">
          שותף יוכל לרדת עד {overdraftPercent}% מתחת ל-0 ביחס למכסה שקיבל באותו סוג מטבע לתקופה זו (סעיף 110).
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">אחוז צבירה בין תקופות</label>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={rolloverPercent}
          onChange={(e) => setRolloverPercent(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          שימו לב: ערך זה נשמר לשימוש עתידי בלבד — הלוגיקה בפועל להעברת מטבעות בין תקופות (סעיף 130,
          כולל כלל האיזון של עד 10% הפרש בין שותפים) עדיין לא מיושמת. כרגע אין צבירה בפועל בין תקופות,
          ללא קשר לערך שכאן.
        </p>
      </div>

      {errorMessage && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{errorMessage}</p>
      )}
      {successMessage && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
          {successMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="self-start rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 transition-colors"
      >
        {saving ? 'שומר...' : 'שמירת פרמטרים'}
      </button>
    </form>
  );
}

// Opens pre-filled with one specific partner+coin-type cell from the
// table below. The actual write always goes through
// fn_admin_adjust_coin_balance (never a raw UPDATE on user_wallets) so
// every change is unconditionally audited — there is no other path to
// change a balance from this screen.
function EditBalanceModal({ cell, onClose, onSaved }) {
  const [newBalance, setNewBalance] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!cell) return;
    setNewBalance(String(cell.currentBalance ?? 0));
    setNote('');
    setErrorMessage(null);
  }, [cell]);

  if (!cell) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);

    if (newBalance === '' || Number.isNaN(Number(newBalance))) {
      setErrorMessage('יש להזין יתרה חדשה תקינה.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_admin_adjust_coin_balance', {
        p_user_id: cell.partnerId,
        p_coin_type: cell.coinType,
        p_new_balance: Number(newBalance),
        p_note: note.trim() ? note.trim() : null,
      });
      if (error) throw error;
      await onSaved?.();
    } catch (err) {
      console.error('Failed to adjust coin balance', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בעדכון היתרה.');
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
      <div dir="rtl" className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-800">שינוי יתרה</h3>
            <p className="text-xs text-slate-500">
              {cell.partnerName} · {COIN_TYPE_LABELS_HE[cell.coinType]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-4">
          <p className="text-sm text-slate-600">
            יתרה נוכחית: <span className="font-semibold text-slate-800">{formatCoinAmount(cell.currentBalance)}</span>
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">יתרה חדשה</label>
            <input
              type="number"
              step="0.01"
              autoFocus
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">הערה (אופציונלי)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="סיבת השינוי..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <p className="text-xs text-slate-400">
            שינוי זה עוקף את מגבלת האוברדרפט (תיקון מנהלי מפורש) ומתועד באופן מלא ביומן הביקורת, כולל שם
            המבצע, יתרה קודמת/חדשה, וחותמת זמן.
          </p>

          {errorMessage && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{errorMessage}</p>
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
              className="flex-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold py-2.5 transition-colors"
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
// Clicking a balance cell opens EditBalanceModal pre-filled with that
// exact partner+type+current value — there's no separate dropdown-
// based form anymore, this table IS the adjustment UI.
function PartnerBalancesTable({ onAdjusted }) {
  const [partners, setPartners] = useState([]);
  const [walletByUserId, setWalletByUserId] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [editingCell, setEditingCell] = useState(null); // { partnerId, partnerName, coinType, currentBalance }

  async function load() {
    setIsLoading(true);
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
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSaved() {
    setEditingCell(null);
    await load();
    await onAdjusted?.();
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
        <Table2 size={18} className="text-blue-600" />
        <div>
          <h3 className="text-base font-bold text-slate-800">יתרות שותפים - עריכה ידנית</h3>
          <p className="text-xs text-slate-400">לחצו על עיפרון ליד כל יתרה כדי לשנות אותה</p>
        </div>
      </div>

      {isLoading ? (
        <p className="p-10 text-center text-sm text-slate-400">טוען...</p>
      ) : errorMessage ? (
        <p className="p-10 text-center text-sm text-rose-600">{errorMessage}</p>
      ) : partners.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-400">אין שותפים רשומים.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-start text-slate-500">
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
                return (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{partnerName}</td>
                    {COIN_TYPE_OPTIONS.map((opt) => {
                      const column = COIN_TYPE_COLUMN[opt.value];
                      const currentBalance = wallet ? wallet[column] : 0;
                      return (
                        <td key={opt.value} className="px-4 py-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              setEditingCell({ partnerId: p.id, partnerName, coinType: opt.value, currentBalance })
                            }
                            className="flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-amber-50 text-amber-700 font-semibold transition-colors whitespace-nowrap"
                            title="לחצו לעריכה"
                          >
                            {formatCoinAmount(currentBalance)}
                            <Pencil size={12} className="text-amber-400" />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <EditBalanceModal cell={editingCell} onClose={() => setEditingCell(null)} onSaved={handleSaved} />
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
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History size={18} className="text-slate-500" />
          <h3 className="text-base font-bold text-slate-800">יומן ביקורת - שינויים ידניים ביתרות</h3>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={isLoading || rows.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold px-3.5 py-2 transition-colors"
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
        <p className="p-10 text-center text-sm text-slate-400">אין עדיין שינויים ידניים רשומים.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-start text-slate-500">
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
                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString('he-IL', {
                      day: 'numeric',
                      month: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {r.actor?.full_name ?? r.actor?.email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {r.partner?.full_name ?? r.partner?.email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{COIN_TYPE_LABELS_HE[r.coin_type]}</td>
                  <td className="px-4 py-3 text-slate-600">{formatCoinAmount(r.balance_before)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{formatCoinAmount(r.balance_after)}</td>
                  <td className="px-4 py-3 text-slate-500">{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ParametersPage() {
  const { currentUser } = useAuth();
  const [auditRefreshToken, setAuditRefreshToken] = useState(0);

  const canManage = isAdminOrTreasurer(currentUser);

  if (!canManage) {
    return (
      <div className="p-10 text-center text-slate-400" dir="rtl">
        <p className="text-lg font-medium text-slate-500">מסך זה זמין למנהל או גזבר בלבד.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header>
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Settings size={22} className="text-blue-600" />
          פרמטרים
        </h2>
        <p className="text-sm text-slate-500">הגדרות מערכת שיטת חלוקת הזמן (שיטת מיכאל)</p>
      </header>

      <SystemSettingsForm currentUser={currentUser} />
      <PartnerBalancesTable onAdjusted={() => setAuditRefreshToken((n) => n + 1)} />
      <AdjustmentAuditLog refreshToken={auditRefreshToken} />
    </div>
  );
}
