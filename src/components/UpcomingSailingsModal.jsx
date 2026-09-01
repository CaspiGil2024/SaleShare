import { useEffect, useState } from 'react';
import { X, CalendarClock } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { bookingTypeLabelHe } from '../lib/bookingColors';

export default function UpcomingSailingsModal({ isOpen, onClose }) {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabase
        .from('bookings')
        .select('id, booking_type, start_time, end_time, booker:users(full_name, email)')
        .neq('status', 'Cancelled')
        .gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true })
        .limit(50);

      if (isCancelled) return;
      if (error) {
        console.error('Failed to load upcoming sailings', error);
        setErrorMessage('אירעה שגיאה בטעינת ההפלגות הקרובות.');
      } else {
        setRows(data);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      isCancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div dir="rtl" className="w-full max-w-lg max-h-[80dvh] rounded-2xl bg-white dark:bg-slate-800 shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <CalendarClock size={18} className="text-blue-600 dark:text-blue-300" />
            הפלגות קרובות
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

        <div className="overflow-y-auto p-3">
          {isLoading ? (
            <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">טוען...</p>
          ) : errorMessage ? (
            <p className="p-10 text-center text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">אין הפלגות קרובות מתוכננות.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-50 dark:divide-slate-800">
              {rows.map((r) => {
                const start = new Date(r.start_time);
                const end = new Date(r.end_time);
                const durationHours = Math.round((end.getTime() - start.getTime()) / 3_600_000);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3 px-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                        {r.booker?.full_name ?? r.booker?.email ?? 'שותף'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{bookingTypeLabelHe(r.booking_type)}</p>
                    </div>
                    <div className="text-end shrink-0">
                      <p className="text-sm text-slate-700 dark:text-slate-200">
                        {start.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}{' '}
                        {start.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">{durationHours} שעות</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
