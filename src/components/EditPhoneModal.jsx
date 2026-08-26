import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default function EditPhoneModal({ isOpen, onClose, phoneEntry, onSaved }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!isOpen || !phoneEntry) return;
    setName(phoneEntry.name ?? '');
    setPhone(phoneEntry.phone ?? '');
    setErrorMessage(null);
  }, [isOpen, phoneEntry]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !phoneEntry) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim() || !phone.trim()) {
      setErrorMessage('שם ומספר טלפון הם שדות חובה.');
      return;
    }

    setSubmitting(true);
    try {
      // .select() + empty-result check: an UPDATE that RLS silently
      // filters to zero rows comes back with error: null, not an
      // error — same false-positive-success class fixed in
      // EditPartnerModal and ImportantInfoPage's delete handlers.
      const { data, error } = await supabase
        .from('important_phones')
        .update({ name: name.trim(), phone: phone.trim() })
        .eq('id', phoneEntry.id)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('העדכון לא בוצע בפועל — ייתכן שאין לכם הרשאה לערוך רשומה זו.');
      }

      await onSaved?.();
      onClose();
    } catch (err) {
      console.error('Failed to update phone entry', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בשמירת השינויים. נסו שוב.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div dir="rtl" className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">עריכת איש קשר</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">שם איש הקשר</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">מספר טלפון</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {errorMessage && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {errorMessage}
            </p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 transition-colors"
            >
              {submitting ? 'שומר...' : 'שמור שינויים'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold py-2.5 transition-colors"
            >
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
