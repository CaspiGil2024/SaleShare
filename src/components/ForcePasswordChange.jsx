import { useState } from 'react';
import { Lock, Sailboat } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';

export default function ForcePasswordChange() {
  const { changePassword, signOut } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 6) {
      setErrorMessage('הסיסמה חייבת להכיל לפחות 6 תווים.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('הסיסמאות אינן תואמות.');
      return;
    }

    setSubmitting(true);
    const { error } = await changePassword(password);
    setSubmitting(false);
    if (error) setErrorMessage(error.message ?? 'משהו השתבש. נסו שוב.');
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 dark:bg-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white">
            <Sailboat size={26} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">קביעת סיסמה חדשה</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              זוהי כניסתכם הראשונה — לפני שממשיכים, יש לבחור סיסמה קבועה במקום מספר הטלפון הזמני.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <Lock size={16} className="absolute inset-y-0 right-3 my-auto text-slate-400 dark:text-slate-500" />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="סיסמה חדשה"
              className="w-full rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900 pr-9 pl-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
          </div>

          <div className="relative">
            <Lock size={16} className="absolute inset-y-0 right-3 my-auto text-slate-400 dark:text-slate-500" />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="אימות סיסמה חדשה"
              className="w-full rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900 pr-9 pl-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
          </div>

          {errorMessage && (
            <p className="text-sm text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-900 hover:bg-blue-950 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 transition-colors"
          >
            {submitting ? '...' : 'שמירת סיסמה והמשך'}
          </button>
        </form>

        <button type="button" onClick={signOut} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 self-center">
          יציאה
        </button>
      </div>
    </div>
  );
}
