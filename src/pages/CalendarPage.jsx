import { useCallback, useEffect, useState } from 'react';
import YachtCalendar, { VIEW_PREFERENCE_TO_FULLCALENDAR } from '../components/YachtCalendar';
import NewBookingModal from '../components/NewBookingModal';
import EditBookingModal from '../components/EditBookingModal';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabaseClient';
import CoinBalanceBadge from '../components/CoinBalanceBadge';

export default function CalendarPage() {
  const { currentUser, profileLoading, updateDefaultCalendarView } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [selectedRange, setSelectedRange] = useState(null); // { start: Date, end: Date }
  const [editingBooking, setEditingBooking] = useState(null);
  // Bumped every time fetchBookings runs (i.e. after any booking is
  // created/edited/cancelled) so CoinBalanceBadge — which manages its
  // own wallet fetch independently — knows to refetch too, instead of
  // only updating the next time this page happens to remount.
  const [walletRefreshToken, setWalletRefreshToken] = useState(0);

  const fetchBookings = useCallback(async () => {
    // Opportunistic sweep, same lazy-maintenance pattern as
    // ensure_current_period() elsewhere in the app (no cron dependency
    // required) — cancels any Cyprus sailing whose start_time has
    // passed with no other partner ever having joined. See
    // 0044_shared_sail_join_leave_and_cyprus_auto_cancel.sql.
    const { error: autoCancelError } = await supabase.rpc('fn_auto_cancel_solo_cyprus_sailings');
    if (autoCancelError) console.error('Failed to sweep solo Cyprus sailings', autoCancelError);

    // Same lazy-maintenance pattern: a past (last 14 days) Shared
    // sailing nobody else ever joined gets relabeled Private instead of
    // staying mislabeled forever — see 0054_auto_convert_solo_shared_
    // sailings_to_private.sql for why this is safe (coin cost unchanged).
    const { error: autoConvertError } = await supabase.rpc('fn_auto_convert_solo_shared_sailings_to_private');
    if (autoConvertError) console.error('Failed to sweep solo Shared sailings', autoConvertError);

    // Same lazy-maintenance pattern, run last (after the two sweeps
    // above) so a solo Cyprus sailing is already Cancelled — and thus
    // skipped here — by the time this runs: settles every Shared/
    // Cyprus sailing whose start_time has passed and hasn't been
    // settled yet, applying the true guest-weighted proportional split
    // once instead of the provisional full-price-per-joiner charge
    // each participant carried until now — see 0061_deferred_shared_
    // sail_coin_settlement.sql.
    const { error: settleError } = await supabase.rpc('fn_settle_due_shared_bookings');
    if (settleError) console.error('Failed to settle due shared sailings', settleError);

    const { data, error } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, booking_type, guests_count, notes, user_id, booker:users(full_name, email)')
      .neq('status', 'Cancelled')
      .order('start_time');

    if (error) {
      console.error('Failed to load bookings', error);
      return;
    }

    setBookings(
      data.map((b) => ({
        id: b.id,
        title: b.booker?.full_name ?? b.booker?.email ?? 'שותף',
        start: b.start_time,
        end: b.end_time,
        booking_type: b.booking_type,
        user_id: b.user_id,
        guests_count: b.guests_count,
        notes: b.notes,
      }))
    );
    setWalletRefreshToken((n) => n + 1);
  }, []);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  function handleSelectRange(start, end) {
    setSelectedRange({ start, end });
  }

  function handleModalClose() {
    setSelectedRange(null);
  }

  // Built from the clicked FullCalendar event's own data (id/start/end/
  // extendedProps) rather than re-looking-up the raw bookings array, so
  // there's only one place this shape has to stay in sync.
  function handleEventClick(event) {
    setEditingBooking({
      id: event.id,
      start_time: event.start.toISOString(),
      end_time: event.end.toISOString(),
      booking_type: event.extendedProps.bookingType,
      user_id: event.extendedProps.userId,
      guests_count: event.extendedProps.guestsCount,
      notes: event.extendedProps.notes,
      bookedByName: event.extendedProps.bookedBy,
    });
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">יומן הפלגות</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">לחצו וגררו על משבצת פנויה כדי לפתוח הזמנה חדשה, או לחצו על הפלגה קיימת לעריכה</p>
      </header>

      <CoinBalanceBadge currentUser={currentUser} refreshToken={walletRefreshToken} />

      {/*
        FullCalendar only reads initialView once, at mount — waiting
        for profileLoading here (rather than rendering immediately with
        a fallback) means the calendar mounts already knowing the
        partner's real saved preference instead of locking in "day" and
        never correcting itself. Height offset bumped from 140 to 205
        to make room for the balance badge above (~65px incl. its own
        margin) without pushing the page into vertical overflow.
      */}
      {profileLoading ? (
        <div className="flex items-center justify-center h-[calc(100dvh-205px)] bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 text-sm text-slate-400 dark:text-slate-500">
          טוען...
        </div>
      ) : (
        <YachtCalendar
          bookings={bookings}
          onSelectRange={handleSelectRange}
          onEventClick={handleEventClick}
          initialView={VIEW_PREFERENCE_TO_FULLCALENDAR[currentUser?.default_calendar_view] ?? 'timeGridDay'}
          onViewChange={updateDefaultCalendarView}
        />
      )}

      <NewBookingModal
        isOpen={selectedRange !== null}
        onClose={handleModalClose}
        initialStart={selectedRange?.start}
        initialEnd={selectedRange?.end}
        currentUser={currentUser}
        onBookingCreated={fetchBookings}
      />

      <EditBookingModal
        isOpen={editingBooking !== null}
        onClose={() => setEditingBooking(null)}
        booking={editingBooking}
        currentUser={currentUser}
        onBookingUpdated={fetchBookings}
      />
    </div>
  );
}
