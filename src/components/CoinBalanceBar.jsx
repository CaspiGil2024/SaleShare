import { formatCoinAmount } from '../lib/coinCalculator';

const COIN_DEFS = [
  { key: 'coins_weekend_day', label: 'סופ"ש - יום', dotClass: 'bg-amber-500' },
  { key: 'coins_weekend_night', label: 'סופ"ש - לילה', dotClass: 'bg-violet-600' },
  { key: 'coins_midweek_day', label: 'אמצע שבוע - יום', dotClass: 'bg-sky-500' },
  { key: 'coins_midweek_night', label: 'אמצע שבוע - לילה', dotClass: 'bg-slate-700' },
];

export default function CoinBalanceBar({ wallet }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {COIN_DEFS.map((coin) => (
        <div
          key={coin.key}
          className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3"
        >
          <span className={`w-2.5 h-10 rounded-full ${coin.dotClass}`} />
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{coin.label}</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{formatCoinAmount(wallet?.[coin.key])}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
