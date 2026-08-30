import { useEffect, useState } from 'react';
import { X, Download } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { bookingTypeLabelHe } from '../lib/bookingColors';
import { exportPartnerHistoryToXlsx } from '../lib/xlsxExport';

function statusLabelHe(status) {
  return status === 'Cancelled' ? 'בוטלה' : 'פעילה';
}

// Resolves partner_roster's email to a real public.users.id (roster
// rows aren't FK'd to users — only email-matched, same as
// fn_apply_partner_roster) and pulls every booking that partner either
// organized OR was a participant in (Shared/Cyprus — the organizer is
// inserted as a participant row too, see 0014's comment, so filtered
// out here to avoid listing the same sail twice for its own organizer).
async function fetchPartnerBookingHistory(email) {
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .ilike('email', email)
    .maybeSingle();
  if (userError) throw userError;
  if (!user) return { hasAccount: false, rows: [] };

  const { data: organized, error: organizedError } = await supabase
    .from('bookings')
    .select('id, booking_type, status, start_time, end_time, guests_count, notes, coins_charged')
    .eq('user_id', user.id)
    .order('start_time', { ascending: false });
  if (organizedError) throw organizedError;

  const { data: participated, error: participatedError } = await supabase
    .from('booking_participants')
    .select(
      'coins_charged, bookings(id, booking_type, status, start_time, end_time, guests_count, notes, user_id)'
    )
    .eq('user_id', user.id);
  if (participatedError) throw participatedError;

  const organizedRows = organized.map((b) => ({
    id: b.id,
    role: 'מארגן',
    bookingTypeLabel: bookingTypeLabelHe(b.booking_type),
    statusLabel: statusLabelHe(b.status),
    start_time: b.start_time,
    end_time: b.end_time,
    guests_count: b.guests_count,
    notes: b.notes,
    coinsForThisPartner: b.coins_charged ?? 0,
  }));

  const participantRows = participated
    .filter((p) => p.bookings && p.bookings.user_id !== user.id)
    .map((p) => ({
      id: p.bookings.id,
      role: 'משתתף',
      bookingTypeLabel: bookingTypeLabelHe(p.bookings.booking_type),
      statusLabel: statusLabelHe(p.bookings.status),
      start_time: p.bookings.start_time,
      end_time: p.bookings.end_time,
      guests_count: p.bookings.guests_count,
      notes: p.bookings.notes,
      coinsForThisPartner: p.coins_charged ?? 0,
    }));

  const rows = [...organizedRows, ...participantRows].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
  );

  return { hasAccount: true, rows };
}

export default function BookingHistoryModal({ isOpen, onClose, partner }) {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [hasAccount, setHasAccount] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!isOpen || !partner) return;
    let isCancelled = false;

    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const { hasAccount: accountExists, rows: data } = await fetchPartnerBookingHistory(partner.email);
        if (isCancelled) return;
        setHasAccount(accountExists);
        setRows(data);
      } catch (err) {
        console.error('Failed to load partner booking history', err);
        if (!isCancelled) setErrorMessage('אירעה שגיאה בטעינת היסטוריית ההזמנות.');
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      isCancelled = true;
    };
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

  function handleExport() {
    exportPartnerHistoryToXlsx({ partnerName: partner.full_name, rows });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div dir="rtl" className="w-full max-w-3xl max-h-[85dvh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-800">היסטוריית הזמנות</h3>
            <p className="text-sm text-slate-500">{partner.full_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={isLoading || rows.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-3.5 py-2 transition-colors"
            >
              <Download size={15} />
              ייצוא ל-XLSX
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="סגור"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6">
          {isLoading ? (
            <p className="p-10 text-center text-sm text-slate-400">טוען היסטוריה...</p>
          ) : errorMessage ? (
            <p className="p-10 text-center text-sm text-rose-600">{errorMessage}</p>
          ) : !hasAccount ? (
            <p className="p-10 text-center text-sm text-slate-400">
              לשותף זה עדיין אין חשבון פעיל במערכת, ולכן אין היסטוריית הזמנות.
            </p>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-400">לא נמצאו הזמנות עבור שותף זה.</p>
          ) : (
            <div className="overflow-auto max-h-[60dvh] rounded-2xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky-thead">
                  <tr className="border-b border-slate-100 text-start text-slate-500 bg-slate-50">
                    <th className="px-4 py-3 font-medium text-start">תפקיד</th>
                    <th className="px-4 py-3 font-medium text-start">סוג</th>
                    <th className="px-4 py-3 font-medium text-start">סטטוס</th>
                    <th className="px-4 py-3 font-medium text-start">התחלה</th>
                    <th className="px-4 py-3 font-medium text-start">סיום</th>
                    <th className="px-4 py-3 font-medium text-start">מטבעות</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={`${r.id}-${r.role}-${idx}`} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.role}</td>
                      <td className="px-4 py-3 text-slate-800 font-medium whitespace-nowrap">
                        {r.bookingTypeLabel}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.statusLabel === 'בוטלה'
                              ? 'bg-rose-50 text-rose-600'
                              : 'bg-green-50 text-green-700'
                          }`}
                        >
                          {r.statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {r.start_time ? new Date(r.start_time).toLocaleString('he-IL') : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {r.end_time ? new Date(r.end_time).toLocaleString('he-IL') : '—'}
                      </td>
                      <td className="px-4 py-3 text-amber-700 font-semibold whitespace-nowrap">
                        {r.coinsForThisPartner}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
