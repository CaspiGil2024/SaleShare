import { useEffect, useState } from 'react';
import { Settings, SlidersHorizontal, History } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isAdminOrTreasurer } from '../lib/permissions';

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

function AdminCoinAdjustment({ onAdjusted }) {
  const [partners, setPartners] = useState([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [selectedCoinType, setSelectedCoinType] = useState('midweek_day');
  const [currentBalance, setCurrentBalance] = useState(null);
  const [newBalance, setNewBalance] = useState('');
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
          console.error('Failed to load partner list', error);
          return;
        }
        setPartners(data ?? []);
      });
  }, []);

  // Show the current balance for whatever partner+type is selected, so
  // an admin can see what they're actually changing before submitting.
  useEffect(() => {
    if (!selectedPartnerId) {
      setCurrentBalance(null);
      return;
    }
    let isCancelled = false;
    async function loadBalance() {
      const { data: period } = await supabase.from('periods').select('id').eq('is_current', true).limit(1).maybeSingle();
      if (!period) {
        if (!isCancelled) setCurrentBalance(null);
        return;
      }
      const column = COIN_TYPE_COLUMN[selectedCoinType];
      const { data: wallet } = await supabase
        .from('user_wallets')
        .select(column)
        .eq('user_id', selectedPartnerId)
        .eq('period_id', period.id)
        .maybeSingle();
      if (!isCancelled) setCurrentBalance(wallet ? wallet[column] : 0);
    }
    loadBalance();
    return () => {
      isCancelled = true;
    };
  }, [selectedPartnerId, selectedCoinType]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedPartnerId) {
      setErrorMessage('יש לבחור שותף.');
      return;
    }
    if (newBalance === '' || Number.isNaN(Number(newBalance))) {
      setErrorMessage('יש להזין יתרה חדשה תקינה.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_admin_adjust_coin_balance', {
        p_user_id: selectedPartnerId,
        p_coin_type: selectedCoinType,
        p_new_balance: Number(newBalance),
        p_note: note.trim() ? note.trim() : null,
      });
      if (error) throw error;

      setSuccessMessage('היתרה עודכנה בהצלחה.');
      setNewBalance('');
      setNote('');
      setCurrentBalance(Number(newBalance));
      await onAdjusted?.();
    } catch (err) {
      console.error('Failed to adjust coin balance', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בעדכון היתרה.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col gap-5 max-w-xl">
      <div className="flex items-center gap-2 text-slate-800 font-bold">
        <Settings size={18} className="text-blue-600" />
        <h3>שינוי ידני של יתרת מטבעות</h3>
      </div>
      <p className="text-xs text-slate-400 -mt-3">
        שינוי זה עוקף את מגבלת האוברדרפט (תיקון מנהלי מפורש) ומתועד באופן מלא ביומן הביקורת למטה.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">שותף</label>
          <select
            value={selectedPartnerId}
            onChange={(e) => setSelectedPartnerId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">בחרו שותף...</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? p.email}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">סוג מטבע</label>
          <select
            value={selectedCoinType}
            onChange={(e) => setSelectedCoinType(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {COIN_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedPartnerId && (
        <p className="text-sm text-slate-600">
          יתרה נוכחית: <span className="font-semibold text-slate-800">{formatCoinAmount(currentBalance)}</span>
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">יתרה חדשה</label>
        <input
          type="number"
          step="0.01"
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
        disabled={submitting}
        className="self-start rounded-lg bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 transition-colors"
      >
        {submitting ? 'מעדכן...' : 'עדכון יתרה'}
      </button>
    </form>
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

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
        <History size={18} className="text-slate-500" />
        <h3 className="text-base font-bold text-slate-800">יומן ביקורת - שינויים ידניים ביתרות</h3>
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
      <AdminCoinAdjustment onAdjusted={() => setAuditRefreshToken((n) => n + 1)} />
      <AdjustmentAuditLog refreshToken={auditRefreshToken} />
    </div>
  );
}
