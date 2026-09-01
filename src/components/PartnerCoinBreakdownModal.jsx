import { X, Coins } from 'lucide-react';
import { formatCoinAmount } from '../lib/coinCalculator';

// Same 4-type-grid + total-footer shape as CoinBreakdownModal.jsx (the
// "my own balance" one, opened from Dashboard.jsx) — kept as a separate
// component rather than generalizing that one, since this one takes an
// already-loaded partner (PartnersPage.jsx's own list fetch already has
// every partner's wallet) instead of fetching by currentUser.id itself.
const COIN_TYPES = [
  { key: 'coins_midweek_day', label: 'אמצ"ש יום', className: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' },
  { key: 'coins_midweek_night', label: 'אמצ"ש לילה', className: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' },
  { key: 'coins_weekend_day', label: 'סופ"ש יום', className: 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300' },
  { key: 'coins_weekend_night', label: 'סופ"ש לילה', className: 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300' },
];

export default function PartnerCoinBreakdownModal({ isOpen, onClose, partner }) {
  if (!isOpen || !partner) return null;

  const wallet = partner.wallet;
  const total = wallet ? COIN_TYPES.reduce((sum, t) => sum + (wallet[t.key] ?? 0), 0) : (partner.balance ?? 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div dir="rtl" className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Coins size={18} className="text-amber-500 dark:text-amber-400" />
              פירוט יתרת מטבעות
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{partner.full_name ?? partner.email}</p>
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

        <div className="p-5 flex flex-col gap-3">
          {wallet ? (
            <div className="grid grid-cols-2 gap-2.5">
              {COIN_TYPES.map((t) => (
                <div key={t.key} className={`rounded-lg px-3 py-2.5 ${t.className}`}>
                  <p className="text-xs opacity-80">{t.label}</p>
                  <p className="text-lg font-bold">{formatCoinAmount(wallet[t.key])}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              שותף זה טרם נרשם לתקופה הנוכחית — היתרה המוצגת היא נקודת הפתיחה מרשימת השותפים בלבד.
            </p>
          )}
          <div className="rounded-lg bg-blue-600 text-white px-3 py-2.5 flex items-center justify-between">
            <span className="text-sm">סה"כ</span>
            <span className="text-lg font-bold">{formatCoinAmount(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
