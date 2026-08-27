import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const DAY_LABELS_HE = ["א'", "ב'", "ג'", "ד'", "ה'", 'ו׳', 'ש׳']; // index 0 = Sunday, matches getDay()

// Sunday 00:00 local through next Sunday 00:00 — matches the app's
// week-starts-Sunday convention (YachtCalendar's firstDay={0}) and the
// dashboard greeting's "this week" framing.
function currentWeekRange() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export default function SailingStatsChart({ onClick }) {
  const [hoursByDay, setHoursByDay] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    let isCancelled = false;

    async function fetchWeeklyStats() {
      setIsLoading(true);
      setErrorMessage(null);

      const { start, end } = currentWeekRange();

      // Maintenance blocks the boat but isn't "sailing"; Cancelled
      // never happened. Overlap filter (start < weekEnd AND end >
      // weekStart) catches bookings that cross into or out of this
      // week, not just ones fully contained in it.
      const { data, error } = await supabase
        .from('bookings')
        .select('start_time, end_time')
        .neq('status', 'Cancelled')
        .neq('booking_type', 'Maintenance')
        .lt('start_time', end.toISOString())
        .gt('end_time', start.toISOString());

      if (isCancelled) return;

      if (error) {
        console.error('Failed to load weekly sailing stats', error);
        setErrorMessage('אירעה שגיאה בטעינת הסטטיסטיקה.');
        setIsLoading(false);
        return;
      }

      // Walk hour-by-hour (bookings always start/end exactly on the
      // hour — bookings_hour_aligned — so this is exact, no partial-
      // hour rounding) and clip each booking to the week window before
      // attributing its hours to a day, so a booking that starts
      // before/ends after the visible week doesn't over-count.
      const hours = [0, 0, 0, 0, 0, 0, 0];
      for (const booking of data) {
        const bookingStart = new Date(booking.start_time);
        const bookingEnd = new Date(booking.end_time);
        let cursor = bookingStart < start ? new Date(start) : bookingStart;
        const clippedEnd = bookingEnd > end ? end : bookingEnd;

        while (cursor < clippedEnd) {
          hours[cursor.getDay()] += 1;
          cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
        }
      }

      setHoursByDay(hours);
      setIsLoading(false);
    }

    fetchWeeklyStats();

    return () => {
      isCancelled = true;
    };
  }, []);

  const maxHours = Math.max(...(hoursByDay ?? []), 1);

  return (
    <button
      type="button"
      onClick={onClick}
      title="לחצו למעבר ליומן"
      className="w-full text-start bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-md hover:border-slate-300 transition-shadow cursor-pointer"
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-base font-semibold text-slate-800">סטטיסטיקת הפלגות שבועית</h3>
        <span className="text-xs text-slate-400">שעות שיט</span>
      </div>

      {isLoading ? (
        <p className="h-40 flex items-center justify-center text-sm text-slate-400">טוען...</p>
      ) : errorMessage ? (
        <p className="h-40 flex items-center justify-center text-sm text-rose-600">{errorMessage}</p>
      ) : (
        <div className="flex items-end justify-between gap-3 h-40">
          {DAY_LABELS_HE.map((label, index) => {
            const hours = hoursByDay[index];
            return (
              <div key={label} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full h-32 flex items-end">
                  <div
                    title={`${hours} שעות`}
                    className="w-full rounded-t-md bg-gradient-to-t from-blue-600 to-sky-400"
                    style={{ height: `${(hours / maxHours) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500">{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </button>
  );
}
