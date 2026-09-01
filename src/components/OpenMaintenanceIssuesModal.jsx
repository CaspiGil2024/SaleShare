import { useEffect, useState } from 'react';
import { X, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { formatDateHe } from '../lib/dateFormat';

export default function OpenMaintenanceIssuesModal({ isOpen, onClose }) {
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
        .from('maintenance_issues')
        .select('id, summary, description, created_at, creator:users!maintenance_issues_created_by_fkey(full_name, email)')
        .eq('status', 'open')
        .order('created_at', { ascending: false });

      if (isCancelled) return;
      if (error) {
        console.error('Failed to load open maintenance issues', error);
        setErrorMessage('אירעה שגיאה בטעינת התקלות הפתוחות.');
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
      <div dir="rtl" className="w-full max-w-lg max-h-[80dvh] rounded-2xl bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Wrench size={18} className="text-orange-500" />
            תקלות תחזוקה פתוחות
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-3">
          {isLoading ? (
            <p className="p-10 text-center text-sm text-slate-400">טוען...</p>
          ) : errorMessage ? (
            <p className="p-10 text-center text-sm text-rose-600">{errorMessage}</p>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-400">אין תקלות פתוחות כרגע.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-50">
              {rows.map((r) => (
                <li key={r.id} className="py-3 px-2">
                  <p className="text-sm font-semibold text-slate-800">{r.summary}</p>
                  <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">{r.description}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    דווח ע"י {r.creator?.full_name ?? r.creator?.email ?? 'שותף'} ·{' '}
                    {formatDateHe(r.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
