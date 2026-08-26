import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// Self-service only: supabase.auth.updateUser() can only ever change
// the CURRENTLY AUTHENTICATED session's own password — there is no
// client-side way for one user to set another user's password without
// the Admin API (service-role key), which this project has deliberately
// kept out of the client. PartnersPage.jsx only opens this for a row
// matching the logged-in user's own email — see canManagePassword there.
export default function ChangePasswordModal({ isOpen, onClose }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setNewPassword('');
    setConfirmPassword('');
    setErrorMessage(null);
    setSuccessMessage(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (newPassword.length < 6) {
      setErrorMessage('הסיסמה חייבת להכיל לפחות 6 תווים.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('הסיסמאות אינן תואמות.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setSuccessMessage('הסיסמה עודכנה בהצלחה.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Failed to update password', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בעדכון הסיסמה. נסו שוב.');
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
          <h3 className="text-lg font-bold text-slate-800">שינוי סיסמה</h3>
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
            <label className="text-sm font-medium text-slate-700">סיסמה חדשה</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">אימות סיסמה חדשה</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {errorMessage && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {errorMessage}
            </p>
          )}
          {successMessage && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              {successMessage}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 transition-colors"
            >
              {submitting ? 'מעדכן...' : 'עדכון סיסמה'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold py-2.5 transition-colors"
            >
              סגירה
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
