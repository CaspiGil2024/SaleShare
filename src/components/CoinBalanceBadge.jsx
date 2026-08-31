import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { formatCoinAmount } from '../lib/coinCalculator';

// Bold, always-visible current-balance strip — shared by CalendarPage.jsx
// (header) and SailingLogPage.jsx (top row), so a partner can check
// their exact standing at a glance without opening CoinBreakdownModal.
// Same ensure_current_period + user_wallets fetch pattern used
// everywhere else a balance is shown.
export default function CoinBalanceBadge({ currentUser }) {
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
      <span className="text-sm font-semibold text-white shrink-0">היתרה שלי:</span>
      {isLoading ? (
        <span className="text-sm text-amber-50">טוען...</span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/15">
            <span className="text-xs font-medium">אמצ"ש יום</span>
            <span className="text-lg font-bold">{formatCoinAmount(wallet?.coins_midweek_day)}</span>
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/15">
            <span className="text-xs font-medium">אמצ"ש לילה</span>
            <span className="text-lg font-bold">{formatCoinAmount(wallet?.coins_midweek_night)}</span>
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/15">
            <span className="text-xs font-medium">סופ"ש יום</span>
            <span className="text-lg font-bold">{formatCoinAmount(wallet?.coins_weekend_day)}</span>
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/15">
            <span className="text-xs font-medium">סופ"ש לילה</span>
            <span className="text-lg font-bold">{formatCoinAmount(wallet?.coins_weekend_night)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
