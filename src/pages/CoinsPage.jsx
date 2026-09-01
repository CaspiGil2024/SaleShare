import { useEffect, useState } from 'react';
import { Coins, ArrowUpCircle, ArrowDownCircle, ListChecks } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isManager } from '../lib/permissions';
import { bookingTypeLabelHe } from '../lib/bookingColors';
import { formatCoinAmount as formatCoin } from '../lib/coinCalculator';
import { formatDateHe, formatDateTimeHe } from '../lib/dateFormat';

// Reference rate card — Michael's Method (§10/30/40,
// 0021-0024_michael_method_*.sql): every hour costs exactly 1 coin of
// its OWN type (4 types, not a flat 5/10/1 tier table). A shared sail
// costs the same total as a private one of that duration would, split
// proportionally among participants by (1 + their own guest count) —
// see fn_create_shared_booking. No "partner alone" rate: a Shared/
// Cyprus sail always requires >=1 additional partner to save at all.
const RATE_CARD_ITEMS = [
  { label: 'אמצ״ש (יום)', value: '1 מטבע אמצ״ש-יום / שעה' },
  { label: 'אמצ״ש (לילה)', value: '1 מטבע אמצ״ש-לילה / שעה' },
  { label: 'סופ״ש / חג (יום)', value: '1 מטבע סופ״ש-יום / שעה' },
  { label: 'סופ״ש / חג (לילה)', value: '1 מטבע סופ״ש-לילה / שעה' },
  { label: 'הפלגת שותפים', value: 'כמו הפלגה פרטית, מחולק יחסית לפי אורחים לכל שותף' },
];

function formatCoinDisplay(n) {
  if (n === null || n === undefined) return '—';
  return formatCoin(n);
}

const COIN_TYPE_SHORT_LABELS_HE = {
  weekend_day: 'סופ"ש יום',
  weekend_night: 'סופ"ש לילה',
  midweek_day: 'אמצ"ש יום',
  midweek_night: 'אמצ"ש לילה',
};

function transactionTitle(t) {
  if (t.reason === 'quarterly_allowance') return 'חלוקה רבעונית אוטומטית';
  if (t.reason === 'booking_refund' || t.reason === 'participant_refund') return 'ביטול הזמנה - החזר';
  if (t.reason === 'booking_charge' || t.reason === 'participant_charge') {
    const typeLabel = t.bookings?.booking_type ? bookingTypeLabelHe(t.bookings.booking_type) : null;
    return typeLabel ? `הזמנה: ${typeLabel}` : 'הזמנה';
  }
  return t.reason;
}

export default function CoinsPage() {
  const { currentUser } = useAuth();
  const canViewAll = isManager(currentUser);

  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!currentUser?.id) return;
    let isCancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setErrorMessage(null);

      // Ensures periods.is_current points at the real current 20-week
      // period (and this partner has a wallet row for it) before
      // reading anything — see 0024_michael_method_settings_and_overdraft.sql.
      const { error: ensureError } = await supabase.rpc('ensure_current_period');
      if (ensureError) console.error('Failed to ensure current period', ensureError);

      const { data: period } = await supabase.from('periods').select('id').eq('is_current', true).limit(1).maybeSingle();

      if (period) {
        const { data: walletRow } = await supabase
          .from('user_wallets')
          .select('coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night')
          .eq('user_id', currentUser.id)
          .eq('period_id', period.id)
          .maybeSingle();
        if (!isCancelled && walletRow) {
          setWallet(walletRow);
        }
      }

      // RLS (coin_transactions_select: auth.uid()=user_id or is_manager())
      // scopes this automatically — a manager sees everyone, a regular
      // partner only ever sees their own rows, no client-side filter needed.
      // bookings(...) is embedded for the sail's own type/date, needed to
      // show "הזמנה: הפלגה פרטית" and the actual sail date, not just when
      // the coin transaction itself was recorded.
      const { data, error } = await supabase
        .from('coin_transactions')
        .select(
          'id, delta, reason, coin_type, related_booking_id, created_at, user_id, users!coin_transactions_user_id_fkey(full_name, email), bookings(booking_type, start_time, end_time)'
        )
        .order('created_at', { ascending: false })
        .limit(100);

      if (isCancelled) return;
      if (error) {
        console.error('Failed to load coin transactions', error);
        setErrorMessage('אירעה שגיאה בטעינת יומן המטבעות.');
      } else {
        setTransactions(data);
      }
      setIsLoading(false);
    }

    fetchData();
    return () => {
      isCancelled = true;
    };
  }, [currentUser?.id]);

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">המטבעות שלי</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {canViewAll ? 'יתרה ויומן תנועות מטבעות - כל השותפים' : 'היתרה והיסטוריית התנועות שלכם'}
        </p>
      </header>

      {/* Top section: rates (left) + balance (right) side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <ListChecks size={18} className="text-slate-500 dark:text-slate-400" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">תעריפים</h3>
          </div>
          <ul className="flex flex-col divide-y divide-slate-50 dark:divide-slate-800">
            {RATE_CARD_ITEMS.map((item) => (
              <li key={item.label} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100">{item.value}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl bg-gradient-to-l from-amber-500 to-orange-400 px-6 py-5 shadow-sm text-white flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 shrink-0 rounded-xl bg-white/20 flex items-center justify-center">
              <Coins size={22} />
            </span>
            <p className="text-sm text-amber-50">יתרת מטבעות לפי סוג (סעיף 10)</p>
          </div>
          {wallet ? (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-lg bg-white/15 px-3 py-2">
                <p className="text-[11px] text-amber-50">אמצ"ש יום</p>
                <p className="text-xl font-bold">{formatCoinDisplay(wallet.coins_midweek_day)}</p>
              </div>
              <div className="rounded-lg bg-white/15 px-3 py-2">
                <p className="text-[11px] text-amber-50">אמצ"ש לילה</p>
                <p className="text-xl font-bold">{formatCoinDisplay(wallet.coins_midweek_night)}</p>
              </div>
              <div className="rounded-lg bg-white/15 px-3 py-2">
                <p className="text-[11px] text-amber-50">סופ"ש יום</p>
                <p className="text-xl font-bold">{formatCoinDisplay(wallet.coins_weekend_day)}</p>
              </div>
              <div className="rounded-lg bg-white/15 px-3 py-2">
                <p className="text-[11px] text-amber-50">סופ"ש לילה</p>
                <p className="text-xl font-bold">{formatCoinDisplay(wallet.coins_weekend_night)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-amber-50">טוען...</p>
          )}
        </div>
      </div>

      {/* Bottom section: transaction history */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">היסטוריית עסקאות</h3>
        </div>

        {isLoading ? (
          <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">טוען...</p>
        ) : errorMessage ? (
          <p className="p-10 text-center text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
        ) : transactions.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">אין עדיין תנועות מטבעות.</p>
        ) : (
          <div className="overflow-auto max-h-[65dvh]">
            <table className="w-full text-sm">
              <thead className="sticky-thead">
                <tr className="border-b border-slate-100 dark:border-slate-800 text-start text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium text-start">תאריך פעולה</th>
                  {canViewAll && <th className="px-4 py-3 font-medium text-start">שותף</th>}
                  <th className="px-4 py-3 font-medium text-start">פעולה</th>
                  <th className="px-4 py-3 font-medium text-start">סוג מטבע</th>
                  <th className="px-4 py-3 font-medium text-start">תאריך הפלגה</th>
                  <th className="px-4 py-3 font-medium text-start">מטבעות</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 dark:border-slate-800 last:border-0">
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatDateTimeHe(t.created_at)}
                    </td>
                    {canViewAll && (
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                        {t.users?.full_name ?? t.users?.email ?? '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{transactionTitle(t)}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {COIN_TYPE_SHORT_LABELS_HE[t.coin_type] ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {t.bookings?.start_time ? formatDateHe(t.bookings.start_time) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          t.delta >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'
                        }`}
                      >
                        {t.delta >= 0 ? <ArrowUpCircle size={14} /> : <ArrowDownCircle size={14} />}
                        {t.delta >= 0 ? '+' : ''}
                        {formatCoinDisplay(t.delta)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
