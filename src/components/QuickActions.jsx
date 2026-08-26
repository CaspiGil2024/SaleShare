import { Sailboat, ClipboardCheck } from 'lucide-react';

export default function QuickActions({ onAddBooking, onDepartureChecklist }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <button
        type="button"
        onClick={onAddBooking}
        className="flex items-center gap-4 h-full rounded-2xl bg-blue-600 hover:bg-blue-700 transition-all duration-150 text-white px-6 py-5 shadow-sm hover:shadow-lg hover:-translate-y-0.5 text-start"
      >
        <span className="w-11 h-11 shrink-0 rounded-xl bg-white/15 flex items-center justify-center">
          <Sailboat size={22} />
        </span>
        <span>
          <span className="block text-base font-semibold">הזמנת הפלגה</span>
          <span className="block text-xs text-blue-100">קביעת הזמנה חדשה ביומן</span>
        </span>
      </button>

      <button
        type="button"
        onClick={onDepartureChecklist}
        className="flex items-center gap-4 h-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 transition-all duration-150 text-white px-6 py-5 shadow-sm hover:shadow-lg hover:-translate-y-0.5 text-start"
      >
        <span className="w-11 h-11 shrink-0 rounded-xl bg-white/15 flex items-center justify-center">
          <ClipboardCheck size={22} />
        </span>
        <span>
          <span className="block text-base font-semibold">צ'ק ליסט יציאה לים</span>
          <span className="block text-xs text-emerald-100">בדיקות בטיחות לפני הפלגה</span>
        </span>
      </button>
    </div>
  );
}
