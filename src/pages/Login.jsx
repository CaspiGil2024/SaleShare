import { useState } from 'react';
import { Mail, Lock, Sailboat } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';

export default function Login() {
  const { signInWithPassword, resetPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);
    setSubmitting(true);
    try {
      const { error } = await signInWithPassword(email, password);
      if (error) throw error;
    } catch (err) {
      setErrorMessage(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    setErrorMessage(null);
    setInfoMessage(null);
    if (!email) {
      setErrorMessage('Enter your email address first.');
      return;
    }
    const { error } = await resetPassword(email);
    if (error) setErrorMessage(error.message);
    else setInfoMessage('Password reset email sent.');
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 dark:bg-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white">
            <Sailboat size={26} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Welcome to אובור (OBOR)</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <Mail size={16} className="absolute inset-y-0 right-3 my-auto text-slate-400 dark:text-slate-500" />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900 pr-9 pl-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
          </div>

          <div className="relative">
            <Lock size={16} className="absolute inset-y-0 right-3 my-auto text-slate-400 dark:text-slate-500" />
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900 pr-9 pl-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
          </div>

          {errorMessage && (
            <p className="text-sm text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">
              {errorMessage}
            </p>
          )}
          {infoMessage && (
            <p className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
              {infoMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-900 hover:bg-blue-950 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 transition-colors"
          >
            {submitting ? '...' : 'Sign in'}
          </button>
        </form>

        <div className="flex items-center justify-center text-sm">
          <button type="button" onClick={handleForgotPassword} className="text-blue-600 dark:text-blue-300 hover:underline">
            Forgot password?
          </button>
        </div>
      </div>
    </div>
  );
}
