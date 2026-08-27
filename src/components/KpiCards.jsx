import { Coins, CalendarClock, Wrench } from 'lucide-react';

const KPI_DEFS = [
  { key: 'totalCoins', label: 'סה"כ מטבעות', icon: Coins, iconClass: 'bg-amber-50 text-amber-600' },
  {
    key: 'upcomingBookings',
    label: 'הפלגות קרובות',
    icon: CalendarClock,
    iconClass: 'bg-blue-50 text-blue-600',
  },
  {
    key: 'openMaintenanceIssues',
    label: 'תקלות תחזוקה פתוחות',
    icon: Wrench,
    iconClass: 'bg-orange-50 text-orange-600',
  },
];

// onCardClick(key) — each card opens its own modal on Dashboard.jsx
// (coin breakdown, upcoming sailings list, open maintenance issues).
export default function KpiCards({ stats, onCardClick }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {KPI_DEFS.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <button
            key={kpi.key}
            type="button"
            onClick={() => onCardClick?.(kpi.key)}
            className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex items-center gap-4 text-start hover:shadow-md hover:border-slate-300 transition-shadow cursor-pointer"
          >
            <span className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${kpi.iconClass}`}>
              <Icon size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-500 truncate">{kpi.label}</p>
              <p className="text-xl font-bold text-slate-800">{stats?.[kpi.key] ?? '—'}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
