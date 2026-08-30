import { useCallback, useEffect, useState } from 'react';
import YachtCalendar, { VIEW_PREFERENCE_TO_FULLCALENDAR } from '../components/YachtCalendar';
import NewBookingModal from '../components/NewBookingModal';
import EditBookingModal from '../components/EditBookingModal';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabaseClient';

export default function CalendarPage() {
  const { currentUser, profileLoading, updateDefaultCalendarView } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [selectedRange, setSelectedRange] = useState(null); // { start: Date, end: Date }
  const [editingBooking, setEditingBooking] = useState(null);

  const fetchBookings = useCallback(async () => {
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
        <h2 className="text-2xl font-bold text-slate-800">יומן הפלגות</h2>
        <p className="text-sm text-slate-500">לחצו וגררו על משבצת פנויה כדי לפתוח הזמנה חדשה, או לחצו על הפלגה קיימת לעריכה</p>
      </header>

      {/*
        FullCalendar only reads initialView once, at mount — waiting
        for profileLoading here (rather than rendering immediately with
        a fallback) means the calendar mounts already knowing the
        partner's real saved preference instead of locking in "day" and
        never correcting itself.
      */}
      {profileLoading ? (
        <div className="flex items-center justify-center h-[calc(100vh-140px)] bg-white rounded-2xl shadow-sm border border-slate-200 text-sm text-slate-400">
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
