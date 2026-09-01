import { useEffect, useState } from 'react';
import { X, Coins } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { formatCoinAmount } from '../lib/coinCalculator';

const COIN_TYPES = [
  { key: 'coins_midweek_day', label: 'אמצ"ש יום', className: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' },
  { key: 'coins_midweek_night', label: 'אמצ"ש לילה', className: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' },
  { key: 'coins_weekend_day', label: 'סופ"ש יום', className: 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300' },
  { key: 'coins_weekend_night', label: 'סופ"ש לילה', className: 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300' },
];

export default function CoinBreakdownModal({ isOpen, onClose, currentUser }) {
  const [wallet, setWallet] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!isOpen || !currentUser?.id) return;
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      const { error: ensureError } = await supabase.rpc('ensure_current_period');
      if (ensureError) console.error('Failed to ensure current period', ensureError);

      const { data: period } = await supabase.from('periods').select('id').eq('is_current', true).limit(1).maybeSingle();
      if (!period) {
        if (!isCancelled) setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_wallets')
        .select('coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night')
        .eq('user_id', currentUser.id)
        .eq('period_id', period.id)
        .maybeSingle();

      if (isCancelled) return;
      if (error) {
        console.error('Failed to load coin breakdown', error);
        setErrorMessage('אירעה שגיאה בטעינת היתרה.');
      } else {
        setWallet(data);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      isCancelled = true;
    };
  }, [isOpen, currentUser?.id]);

  if (!isOpen) return null;

  const total = wallet
    ? COIN_TYPES.reduce((sum, t) => sum + (wallet[t.key] ?? 0), 0)
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div dir="rtl" className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Coins size={18} className="text-amber-500 dark:text-amber-400" />
            פירוט יתרת מטבעות
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          {isLoading ? (
            <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">טוען...</p>
          ) : errorMessage ? (
            <p className="p-6 text-center text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                {COIN_TYPES.map((t) => (
                  <div key={t.key} className={`rounded-lg px-3 py-2.5 ${t.className}`}>
                    <p className="text-xs opacity-80">{t.label}</p>
                    <p className="text-lg font-bold">{formatCoinAmount(wallet?.[t.key])}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-blue-600 text-white px-3 py-2.5 flex items-center justify-between">
                <span className="text-sm">סה"כ</span>
                <span className="text-lg font-bold">{formatCoinAmount(total)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
