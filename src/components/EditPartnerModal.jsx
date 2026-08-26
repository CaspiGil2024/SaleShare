import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { ALL_PARTNER_ROLES, roleLabelHe } from '../lib/partnerRoles';

export default function EditPartnerModal({ isOpen, onClose, partner, onSaved }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roles, setRoles] = useState([]);
  const [balance, setBalance] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Re-seed the form whenever a different partner is opened for editing.
  useEffect(() => {
    if (!isOpen || !partner) return;

    setFullName(partner.full_name ?? '');
    setEmail(partner.email ?? '');
    setPhone(partner.phone ?? '');
    setRoles(partner.roles ?? []);
    setBalance(partner.balance ?? 0);
    setErrorMessage(null);
  }, [isOpen, partner]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !partner) return null;

  function toggleRole(role) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);

    if (!fullName.trim() || !email.trim()) {
      setErrorMessage('שם מלא ואימייל הם שדות חובה.');
      return;
    }

    setSubmitting(true);
    try {
      // partner.email (not the possibly-edited `email` state) identifies
      // the row being updated, since email is partner_roster's primary key.
      //
      // .select() here is load-bearing, not cosmetic: without it, an
      // UPDATE that matches zero rows (e.g. because RLS's WITH CHECK
      // silently filtered it) still comes back as { error: null } —
      // PostgREST has no way to distinguish "updated nothing" from
      // "updated successfully" unless you ask for the affected rows.
      // That's what was making role changes (and anything else) look
      // like they saved when they silently didn't.
      const { data, error } = await supabase
        .from('partner_roster')
        .update({
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() ? phone.trim() : null,
          roles,
          balance: Number(balance) || 0,
        })
        .eq('email', partner.email)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(
          'העדכון לא בוצע בפועל — ייתכן שאין לכם הרשאה לערוך שותף זה, או שהרשומה כבר לא קיימת. אנא רעננו את הדף ונסו שוב.'
        );
      }

      await onSaved?.();
      onClose();
    } catch (err) {
      console.error('Failed to update partner', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בשמירת השותף. נסו שוב.');
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
      <div dir="rtl" className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">עריכת שותף</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">שם מלא</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">אימייל</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">טלפון</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/*
            Status (is_active) and Freeze (is_frozen) are deliberately
            NOT editable here anymore — they're now dedicated,
            admin/treasurer-only row actions in PartnersPage.jsx
            (Soft Delete / Freeze), enforced server-side by
            0015_partner_freeze_and_delete_gates.sql. Leaving a status
            dropdown in this broader-access form would let
            ceo/lab_tester/maintenance bypass that narrower rule.
          */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">יתרת מטבעות</label>
            <input
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">תפקידים</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_PARTNER_ROLES.map((role) => (
                <label
                  key={role}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={() => toggleRole(role)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  {roleLabelHe(role)}
                </label>
              ))}
            </div>
          </div>

          {errorMessage && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {errorMessage}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
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
