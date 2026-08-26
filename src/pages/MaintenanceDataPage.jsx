import { useState } from 'react';
import { DatabaseBackup, Download } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isManager } from '../lib/permissions';
import { bookingTypeLabelHe } from '../lib/bookingColors';
import { exportDatabaseToXlsx } from '../lib/xlsxExport';

async function loadExportData() {
  const { data: partners, error: partnersError } = await supabase
    .from('partner_roster')
    .select('full_name, email, phone, roles, is_active, balance')
    .order('full_name');
  if (partnersError) throw partnersError;

  // Every booking ever, no date filter ("from the beginning of
  // operations and onwards"), plus each participant's own stored
  // coins_charged — the real amount that trigger actually deducted for
  // that specific sail, not a re-derived estimate.
  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select(
      'id, booking_type, status, start_time, end_time, guests_count, notes, coins_charged, booker:users(full_name, email)'
    )
    .order('start_time');
  if (bookingsError) throw bookingsError;

  const { data: participantRows, error: participantsError } = await supabase
    .from('booking_participants')
    .select('booking_id, coins_charged, users(full_name, email)');
  if (participantsError) throw participantsError;

  const participantsByBooking = new Map();
  for (const p of participantRows) {
    if (!participantsByBooking.has(p.booking_id)) {
      participantsByBooking.set(p.booking_id, { names: [], coinsTotal: 0 });
    }
    const entry = participantsByBooking.get(p.booking_id);
    entry.names.push(p.users?.full_name ?? p.users?.email ?? 'שותף');
    entry.coinsTotal += p.coins_charged ?? 0;
  }

  const enrichedBookings = bookings.map((b) => {
    const participants = participantsByBooking.get(b.id);
    const participantCoinsTotal = participants?.coinsTotal ?? 0;
    return {
      id: b.id,
      organizerName: b.booker?.full_name ?? b.booker?.email ?? 'שותף',
      bookingTypeLabel: bookingTypeLabelHe(b.booking_type),
      status: b.status,
      start_time: b.start_time,
      end_time: b.end_time,
      guests_count: b.guests_count,
      notes: b.notes,
      coins_charged: b.coins_charged ?? 0,
      participantNames: participants?.names.join(', ') ?? '',
      participantCoinsTotal,
      totalCoinsCharged: (b.coins_charged ?? 0) + participantCoinsTotal,
    };
  });

  return { partners, bookings: enrichedBookings };
}

export default function MaintenanceDataPage() {
  const { currentUser } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  if (!isManager(currentUser)) {
    return (
      <div className="p-10 text-center text-slate-400" dir="rtl">
        <p className="text-lg font-medium text-slate-500">מסך זה זמין למנהלים בלבד.</p>
      </div>
    );
  }

  async function handleExport() {
    setIsExporting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const { partners, bookings } = await loadExportData();
      exportDatabaseToXlsx({ partners, bookings });
      setSuccessMessage(`הקובץ הורד בהצלחה (${partners.length} שותפים, ${bookings.length} הפלגות).`);
    } catch (err) {
      console.error('Failed to export database', err);
      setErrorMessage('אירעה שגיאה בייצוא הנתונים. נסו שוב.');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header>
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <DatabaseBackup size={22} className="text-blue-600" />
          תחזוקה ונתונים
        </h2>
        <p className="text-sm text-slate-500">כלי גיבוי וייצוא נתונים</p>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col gap-4 max-w-xl">
        <div>
          <h3 className="text-base font-bold text-slate-800">גיבוי DB (ייצוא ל-XLSX)</h3>
          <p className="text-sm text-slate-500 mt-1">
            מוריד קובץ Excel עם שני גיליונות: פרטי שותפים, ופרטי הפלגות מתחילת הפעילות כולל מטבעות שנוצלו לכל
            הפלגה (הן על ידי המזמין והן על ידי שותפים משתתפים).
          </p>
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

        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className="self-start flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 transition-colors"
        >
          <Download size={16} />
          {isExporting ? 'מייצא...' : 'ייצוא DB'}
        </button>
      </div>
    </div>
  );
}
