import { useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { ALL_PARTNER_ROLES, roleLabelHe } from '../lib/partnerRoles';

// Adding a partner here always stages them in partner_roster — the
// same table EditPartnerModal edits, RLS-gated to can_edit_partners()/
// is_admin() (0007/0015). That alone does NOT create a login: creating
// a real Supabase Auth account needs the Admin API (service-role only,
// never safe to expose to a browser), which this client-side app has
// no way to call directly. So this also tries the optional
// 'create-partner-account' Edge Function (see supabase/functions/) —
// if it's deployed, the partner gets a real login immediately
// (temporary password = their phone number, must change on first
// sign-in, same convention as scripts/provision-phone-passwords.sql).
// If it's not deployed (the common case unless you've run `supabase
// functions deploy create-partner-account`), the roster entry still
// saves fine — you just finish account creation manually afterward
// (Supabase Dashboard -> Authentication -> Add User, then re-run
// scripts/provision-phone-passwords.sql), exactly as before this
// feature existed.
export default function AddPartnerModal({ isOpen, onClose, onSaved }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roles, setRoles] = useState(['partner']);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);

  if (!isOpen) return null;

  function toggleRole(role) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  function reset() {
    setFullName('');
    setEmail('');
    setPhone('');
    setRoles(['partner']);
    setErrorMessage(null);
    setInfoMessage(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    if (!fullName.trim() || !email.trim()) {
      setErrorMessage('שם מלא ואימייל הם שדות חובה.');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('partner_roster')
        .insert({
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() ? phone.trim() : null,
          roles: roles.length > 0 ? roles : ['partner'],
        })
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('ההוספה לא בוצעה בפועל — ייתכן שאין לכם הרשאה להוסיף שותפים.');
      }

      let accountCreated = false;
      try {
        const { data: fnData, error: fnError } = await supabase.functions.invoke('create-partner-account', {
          body: { email: email.trim(), full_name: fullName.trim(), phone: phone.trim() || null },
        });
        if (!fnError && fnData?.ok) accountCreated = true;
      } catch {
        // Function not deployed, or failed — the roster row above
        // already saved either way, so this is not fatal.
      }

      setInfoMessage(
        accountCreated
          ? 'השותף/ה נוסף/ה לרשימה וחשבון הכניסה נוצר — סיסמה זמנית: מספר הטלפון (ללא מקפים/רווחים), חובה להחליף בכניסה הראשונה.'
          : 'השותף/ה נוסף/ה לרשימה. חשבון כניסה טרם נוצר — צרו אותו ב-Supabase Dashboard (Authentication -> Add User), ואז הריצו את scripts/provision-phone-passwords.sql.'
      );
      await onSaved?.();
      reset();
    } catch (err) {
      console.error('Failed to add partner', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בהוספת השותף. נסו שוב.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div dir="rtl" className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">הוספת שותף</h3>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">שם מלא</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">אימייל</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">טלפון</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="05X-XXXXXXX"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
            </div>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 -mt-3">
            אם חשבון הכניסה ייווצר אוטומטית, הטלפון (ללא מקפים/רווחים) ישמש כסיסמה זמנית — מומלץ למלא אותו.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">תפקידים</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_PARTNER_ROLES.map((role) => (
                <label
                  key={role}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={() => toggleRole(role)}
                    className="rounded border-slate-300 dark:border-slate-600 text-blue-600 dark:text-blue-300 focus:ring-blue-500 dark:focus:ring-blue-400"
                  />
                  {roleLabelHe(role)}
                </label>
              ))}
            </div>
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

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 transition-colors"
            >
              {submitting ? 'מוסיף/ה...' : 'הוספת שותף'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold py-2.5 transition-colors"
            >
              סגירה
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
