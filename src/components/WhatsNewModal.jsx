import { createPortal } from 'react-dom';
import { X, Sparkles } from 'lucide-react';
import { RELEASE_NOTES } from '../data/releaseNotes';

function formatDateHe(dateString) {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function WhatsNewModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  // Rendered via a portal into document.body — this component is
  // opened from deep inside Sidebar.jsx's own tree (UserProfile,
  // nested in the sticky-positioned <aside>), and a modal left as a
  // normal nested child there can end up trapped in an unexpected
  // stacking context, letting page content behind it (e.g. the
  // Dashboard's colored KPI icon badges) bleed through instead of
  // being covered — the exact same class of bug already found and
  // fixed once for the Partners row-actions dropdown. A portal
  // sidesteps ancestor stacking/overflow entirely, regardless of the
  // exact cause.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        dir="rtl"
        className="w-full max-w-lg max-h-[80dvh] rounded-2xl bg-white shadow-xl flex flex-col text-right"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Sparkles size={18} className="text-blue-600 shrink-0" />
            מה חדש?
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 flex flex-col gap-6 text-right">
          {RELEASE_NOTES.map((entry) => (
            <div key={entry.date} className="text-right">
              <p className="text-xs font-semibold text-blue-600 mb-2">{formatDateHe(entry.date)}</p>
              <ul className="flex flex-col gap-2 list-none p-0 m-0">
                {entry.items.map((item, idx) => (
                  <li key={idx} className="text-sm text-slate-700 leading-relaxed ps-4 relative">
                    <span className="absolute top-2 start-0 w-1 h-1 rounded-full bg-slate-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
