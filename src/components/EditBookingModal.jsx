import { useEffect, useMemo, useState } from 'react';
import { X, Calendar as CalendarIcon, Clock, Coins as CoinsIcon, User, Users, LogIn, LogOut, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { classifyHours, COIN_TYPE_LABELS_HE, formatCoinAmount } from '../lib/coinCalculator';
import { BOOKING_TYPE_OPTIONS, chargesCoins } from '../lib/bookingTypes';
import { bookingTypeLabelHe } from '../lib/bookingColors';
import { fetchIsraeliHolidayMap, syncIsraeliHolidays } from '../lib/israeliHolidays';
import { friendlyBookingErrorMessage } from '../lib/bookingErrors';
import { isManager, isAdminRole } from '../lib/permissions';

const MAX_TOTAL_PARTICIPANTS = 9;
// Matches check_max_24_hours' Cyprus branch (0013_cyprus_duration.sql):
// 5-14 days, i.e. 120-336 hours.
const CYPRUS_MIN_DURATION_DAYS = 5;
const CYPRUS_MAX_DURATION_DAYS = 14;

const START_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);
const DURATION_OPTIONS = Array.from({ length: 24 }, (_, i) => i + 1);
const CYPRUS_DURATION_DAY_OPTIONS = Array.from(
  { length: CYPRUS_MAX_DURATION_DAYS - CYPRUS_MIN_DURATION_DAYS + 1 },
  (_, i) => CYPRUS_MIN_DURATION_DAYS + i
);
const GUEST_OPTIONS = Array.from({ length: 8 }, (_, i) => i); // 0..7

function formatHourLabel(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatDurationOptionLabel(hours) {
  return hours === 1 ? 'שעה 1' : `${hours} שעות`;
}

function formatDaysLabel(days) {
  return days === 1 ? 'יום 1' : `${days} ימים`;
}

function formatGuestsLabel(count) {
  if (count === 0) return 'ללא אורחים';
  if (count === 1) return '1 אורח';
  return `${count} אורחים`;
}

function buildDateTime(baseDate, hour) {
  const dt = new Date(baseDate);
  dt.setHours(hour, 0, 0, 0);
  return dt;
}

export default function EditBookingModal({ isOpen, onClose, booking, currentUser, onBookingUpdated }) {
  const canEdit = Boolean(booking && currentUser && (booking.user_id === currentUser.id || isManager(currentUser)));

  const [startHour, setStartHour] = useState(9);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [durationHours, setDurationHours] = useState(1);
  const [bookingType, setBookingType] = useState('Private');
  const [guestsCount, setGuestsCount] = useState(0);
  const [notes, setNotes] = useState('');
  const [holidayMap, setHolidayMap] = useState(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Shared/Cyprus only: everyone currently attached to this sail
  // (organizer included), fetched fresh whenever the modal opens or a
  // join/leave happens. Drives both the participants list shown below
  // and, for the organizer's own edit form, guestsCount (Shared/Cyprus
  // track guests per-participant, not on bookings.guests_count — see
  // fn_create_shared_booking/fn_update_shared_booking).
  const [participants, setParticipants] = useState([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [joinGuestCount, setJoinGuestCount] = useState(0);
  const [joinLeaveSubmitting, setJoinLeaveSubmitting] = useState(false);
  const [joinLeaveError, setJoinLeaveError] = useState(null);

  // Organizer/admin explicit add — separate from the self-service join
  // above (fn_admin_add_shared_participant, not fn_join_shared_booking):
  // lets the organizer or an admin/sailing_officer add a SPECIFIC
  // partner on someone else's behalf, e.g. when that partner asked in
  // person rather than joining themselves. See 0047_sailing_officer_
  // role_and_admin_participant_management.sql.
  const [addPartnerCandidates, setAddPartnerCandidates] = useState([]);
  const [selectedAddPartnerId, setSelectedAddPartnerId] = useState('');
  const [addPartnerGuestCount, setAddPartnerGuestCount] = useState(0);

  const isSharedBookingType = booking?.booking_type === 'Shared' || booking?.booking_type === 'Cyprus';
  // Safe with booking possibly still null (computed before this
  // component's early `if (!isOpen || !booking) return null`, so it
  // can be used by the hooks below without violating hook-order rules).
  const isOrganizer = booking?.user_id === currentUser?.id;
  const canManageParticipants = isSharedBookingType && (isOrganizer || isAdminRole(currentUser));

  async function refetchParticipants() {
    if (!booking || !isSharedBookingType) return;
    setParticipantsLoading(true);
    const { data, error } = await supabase
      .from('booking_participants')
      .select('user_id, guest_count, users(full_name, email)')
      .eq('booking_id', booking.id);

    if (error) {
      console.error('Failed to load booking participants', error);
      setParticipantsLoading(false);
      return;
    }

    const rows = (data ?? []).map((r) => ({
      user_id: r.user_id,
      guest_count: r.guest_count ?? 0,
      full_name: r.users?.full_name ?? r.users?.email ?? 'שותף',
    }));
    setParticipants(rows);

    const organizerRow = rows.find((r) => r.user_id === booking.user_id);
    if (organizerRow) setGuestsCount(organizerRow.guest_count);

    setParticipantsLoading(false);
  }

  // Re-seed the form whenever a different booking is opened.
  useEffect(() => {
    if (!isOpen || !booking) return;
    const start = new Date(booking.start_time);
    const end = new Date(booking.end_time);

    setSelectedDate(start);
    setStartHour(start.getHours());
    setDurationHours(Math.max(1, Math.round((end.getTime() - start.getTime()) / 3_600_000)));
    setBookingType(booking.booking_type ?? 'Private');
    setNotes(booking.notes ?? '');
    setErrorMessage(null);
    setJoinLeaveError(null);
    setJoinGuestCount(0);
    setParticipants([]);
    setSelectedAddPartnerId('');
    setAddPartnerGuestCount(0);

    const isShared = booking.booking_type === 'Shared' || booking.booking_type === 'Cyprus';
    if (!isShared) {
      setGuestsCount(booking.guests_count ?? 0);
    }
  }, [isOpen, booking]);

  useEffect(() => {
    if (!isOpen || !booking) return;
    if (booking.booking_type !== 'Shared' && booking.booking_type !== 'Cyprus') return;
    let isCancelled = false;
    (async () => {
      if (isCancelled) return;
      await refetchParticipants();
    })();
    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, booking?.id, booking?.booking_type]);

  // Eligible partners the organizer/admin could explicitly add — active,
  // not frozen (matches trg_fn_block_frozen_or_inactive_participant),
  // excluding the organizer and anyone already on the sail.
  useEffect(() => {
    if (!isOpen || !canManageParticipants) {
      setAddPartnerCandidates([]);
      return;
    }
    let isCancelled = false;
    supabase
      .from('users')
      .select('id, full_name, email')
      .eq('is_active', true)
      .eq('is_frozen', false)
      .then(({ data, error }) => {
        if (isCancelled) return;
        if (error) {
          console.error('Failed to load eligible partners', error);
          return;
        }
        const participantIds = new Set(participants.map((p) => p.user_id));
        setAddPartnerCandidates(
          (data ?? []).filter((u) => u.id !== booking?.user_id && !participantIds.has(u.id))
        );
      });
    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, canManageParticipants, booking?.id, participants]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const startDateTime = useMemo(() => buildDateTime(selectedDate, startHour), [selectedDate, startHour]);
  const endDateTime = useMemo(() => {
    const dt = new Date(startDateTime);
    dt.setHours(dt.getHours() + durationHours);
    return dt;
  }, [startDateTime, durationHours]);

  useEffect(() => {
    if (!isOpen || !canEdit) return;
    let isCancelled = false;
    fetchIsraeliHolidayMap(startDateTime, endDateTime)
      .then((map) => {
        if (isCancelled) return;
        setHolidayMap(map);
      })
      .catch((err) => console.error('Failed to load holiday dates for coin estimate', err));
    return () => {
      isCancelled = true;
    };
  }, [isOpen, canEdit, startDateTime.getTime(), endDateTime.getTime()]);

  const isCyprusType = bookingType === 'Cyprus';
  // Cyprus has its own duration bounds (5-14 days, see 0013_cyprus_
  // duration.sql); every other type keeps the original <=24h rule.
  const exceedsMaxDuration = isCyprusType
    ? durationHours > CYPRUS_MAX_DURATION_DAYS * 24
    : durationHours > 24;
  const insufficientCyprusDuration = isCyprusType && durationHours < CYPRUS_MIN_DURATION_DAYS * 24;
  // Shared/Cyprus still route through fn_update_shared_booking (its
  // participants array now includes anyone who's joined, preserved as-
  // is except for the organizer's own guest count — see handleSave),
  // but no longer literally "require" other partners.
  const isSharedType = bookingType === 'Shared' || isCyprusType;
  const otherParticipants = participants.filter((p) => p.user_id !== booking?.user_id);
  // Headcount toward the 9-person cap = organizer + everyone joined +
  // everyone's guests (unrelated to how cost is split — see totalShares
  // below).
  const totalParticipants = isSharedType
    ? 1 + otherParticipants.length + guestsCount + otherParticipants.reduce((sum, p) => sum + p.guest_count, 0)
    : 1 + guestsCount;
  const exceedsCapacity = totalParticipants > MAX_TOTAL_PARTICIPANTS;

  const coinBreakdown = useMemo(() => {
    if (!chargesCoins(bookingType)) return null;
    // Full classifyHours cost either way — see coinCalculator.js header.
    return classifyHours(startDateTime, endDateTime, new Set(holidayMap.keys()));
  }, [bookingType, startDateTime, endDateTime, holidayMap]);

  // Display-only estimate of how the cost currently splits — the real
  // amount is always computed server-side (fn_recompute_shared_
  // booking_participants, 0051_restore_guest_weighted_cost_split.sql),
  // this just sets expectations before saving/joining/leaving. Each
  // participant's share is (1 + their own guest_count) out of this
  // total — guestsCount here is the ORGANIZER's own live-edited field,
  // matching what fn_update_shared_booking will actually submit.
  const totalShares = isSharedType
    ? 1 + guestsCount + otherParticipants.reduce((sum, p) => sum + 1 + p.guest_count, 0)
    : 1;

  if (!isOpen || !booking) return null;

  const isCurrentUserParticipant = participants.some((p) => p.user_id === currentUser?.id);
  const myParticipantRow = participants.find((p) => p.user_id === currentUser?.id);

  // Cancelling refunds coins in full (see trg_fn_refund_participants_
  // on_cancel / the private-booking refund trigger) — blocking it once
  // the sailing has started stops a free refund for a sail that
  // already happened. Enforced server-side too (0041_block_past_
  // sailing_cancellation.sql); this is just the matching UI guard so
  // the button doesn't invite an attempt that's always going to fail.
  const isPastSailing = new Date(booking.start_time) <= new Date();

  // Shared/Cyprus only: joining, leaving, and editing (date/time/notes/
  // guest count) are all allowed up to 7 days after the sailing's
  // start_time, then strictly blocked — see 0046_seven_day_shared_
  // sailing_modification_window.sql, the actual enforcement. This is
  // just the matching UI guard.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const isModificationWindowClosed =
    isSharedBookingType && Date.now() > new Date(booking.start_time).getTime() + SEVEN_DAYS_MS;

  async function handleSave(e) {
    e.preventDefault();
    setErrorMessage(null);

    if (exceedsMaxDuration) {
      setErrorMessage(
        isCyprusType
          ? `משך שייט לקפריסין לא יכול לעלות על ${CYPRUS_MAX_DURATION_DAYS} ימים.`
          : 'משך ההפלגה לא יכול לעלות על 24 שעות.'
      );
      return;
    }
    if (insufficientCyprusDuration) {
      setErrorMessage(`שייט לקפריסין חייב להימשך לפחות ${CYPRUS_MIN_DURATION_DAYS} ימים.`);
      return;
    }
    if (exceedsCapacity) {
      setErrorMessage(
        `סך המשתתפים (כולל אורחים) הוא ${totalParticipants}, ומעל המקסימום המותר של ${MAX_TOTAL_PARTICIPANTS}. הסירו אורחים.`
      );
      return;
    }
    if (isModificationWindowClosed) {
      setErrorMessage('עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר ולא ניתן לערוך אותה יותר.');
      return;
    }

    setSubmitting(true);
    try {
      // The server-side rate function checks public.israeli_holidays —
      // it can't call Hebcal mid-transaction, so make sure the (maybe
      // newly picked) dates this booking now spans are synced first.
      await syncIsraeliHolidays(holidayMap);

      if (isSharedType) {
        // Atomic: updates the booking row, then recomputes/recharges
        // the cost across whoever's still attached — see
        // fn_update_shared_booking. Preserves every OTHER participant
        // exactly as they were (only the organizer's own guest count
        // here can change) — submitting just the organizer would
        // silently kick out anyone who'd joined.
        const p_participants = [
          { user_id: booking.user_id, guest_count: guestsCount },
          ...otherParticipants.map((p) => ({ user_id: p.user_id, guest_count: p.guest_count })),
        ];
        const { error } = await supabase.rpc('fn_update_shared_booking', {
          p_booking_id: booking.id,
          p_booking_type: bookingType,
          p_start: startDateTime.toISOString(),
          p_end: endDateTime.toISOString(),
          p_notes: notes.trim() ? notes.trim() : null,
          p_participants,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('bookings')
          .update({
            start_time: startDateTime.toISOString(),
            end_time: endDateTime.toISOString(),
            booking_type: bookingType,
            guests_count: guestsCount,
            notes: notes.trim() ? notes.trim() : null,
          })
          .eq('id', booking.id)
          .select();

        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('העדכון לא בוצע בפועל — ייתכן שאין לכם הרשאה לערוך הזמנה זו.');
        }

        // Booking_type may have switched AWAY from Shared/Cyprus to a
        // solo type — clear any leftover participants from before.
        const { error: clearError } = await supabase
          .from('booking_participants')
          .delete()
          .eq('booking_id', booking.id);
        if (clearError) throw clearError;
      }

      await onBookingUpdated?.();
      onClose();
    } catch (err) {
      console.error('Failed to update booking', err);
      setErrorMessage(friendlyBookingErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelSail() {
    if (isPastSailing) return;
    if (!window.confirm('לבטל את ההפלגה הזו?')) return;
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .update({ status: 'Cancelled' })
        .eq('id', booking.id)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('הביטול לא בוצע בפועל — ייתכן שאין לכם הרשאה לבטל הזמנה זו.');
      }

      await onBookingUpdated?.();
      onClose();
    } catch (err) {
      console.error('Failed to cancel booking', err);
      setErrorMessage(friendlyBookingErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoin() {
    setJoinLeaveError(null);
    setJoinLeaveSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_join_shared_booking', {
        p_booking_id: booking.id,
        p_guest_count: joinGuestCount,
      });
      if (error) throw error;
      setJoinGuestCount(0);
      await refetchParticipants();
      await onBookingUpdated?.();
    } catch (err) {
      console.error('Failed to join sailing', err);
      setJoinLeaveError(friendlyBookingErrorMessage(err));
    } finally {
      setJoinLeaveSubmitting(false);
    }
  }

  async function handleLeave() {
    if (!window.confirm('לעזוב את ההפלגה הזו?')) return;
    setJoinLeaveError(null);
    setJoinLeaveSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_leave_shared_booking', { p_booking_id: booking.id });
      if (error) throw error;
      await refetchParticipants();
      await onBookingUpdated?.();
    } catch (err) {
      console.error('Failed to leave sailing', err);
      setJoinLeaveError(friendlyBookingErrorMessage(err));
    } finally {
      setJoinLeaveSubmitting(false);
    }
  }

  async function handleAdminAdd() {
    if (!selectedAddPartnerId) return;
    setJoinLeaveError(null);
    setJoinLeaveSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_admin_add_shared_participant', {
        p_booking_id: booking.id,
        p_user_id: selectedAddPartnerId,
        p_guest_count: addPartnerGuestCount,
      });
      if (error) throw error;
      setSelectedAddPartnerId('');
      setAddPartnerGuestCount(0);
      await refetchParticipants();
      await onBookingUpdated?.();
    } catch (err) {
      console.error('Failed to add participant', err);
      setJoinLeaveError(friendlyBookingErrorMessage(err));
    } finally {
      setJoinLeaveSubmitting(false);
    }
  }

  async function handleAdminRemove(userId) {
    if (!window.confirm('להסיר שותף זה מההפלגה?')) return;
    setJoinLeaveError(null);
    setJoinLeaveSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_admin_remove_shared_participant', {
        p_booking_id: booking.id,
        p_user_id: userId,
      });
      if (error) throw error;
      await refetchParticipants();
      await onBookingUpdated?.();
    } catch (err) {
      console.error('Failed to remove participant', err);
      setJoinLeaveError(friendlyBookingErrorMessage(err));
    } finally {
      setJoinLeaveSubmitting(false);
    }
  }

  // Shown in both the read-only and editable views for any Shared/
  // Cyprus booking — who's on it, plus a self-service join/leave
  // action for whoever isn't the organizer.
  function ParticipantsSection() {
    if (!isSharedBookingType) return null;
    return (
      <div className="rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Users size={16} className="text-blue-500" />
          <span>משתתפים{!participantsLoading ? ` (${participants.length})` : ''}</span>
        </div>

        {booking.booking_type === 'Cyprus' && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            שייט לקפריסין חייב לפחות שותף נוסף אחד. אם עד למועד השייט לא יצטרף אף שותף, ההפלגה תבוטל
            אוטומטית והמטבעות יוחזרו — היא לא תהפוך לשייט פרטי.
          </p>
        )}

        {participantsLoading ? (
          <p className="text-xs text-slate-400">טוען...</p>
        ) : participants.length === 0 ? (
          <p className="text-xs text-slate-400">רק המארגן/ת משתתף/ת כרגע.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {participants.map((p) => {
              const canRemove =
                canManageParticipants && !isModificationWindowClosed && p.user_id !== booking.user_id;
              return (
                <li
                  key={p.user_id}
                  className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium"
                >
                  <span>
                    {p.full_name}
                    {p.user_id === booking.user_id ? ' (מארגן/ת)' : ''}
                    {p.guest_count > 0 ? ` +${p.guest_count} אורחים` : ''}
                  </span>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => handleAdminRemove(p.user_id)}
                      disabled={joinLeaveSubmitting}
                      aria-label={`הסרת ${p.full_name}`}
                      className="w-4 h-4 flex items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40"
                    >
                      <X size={11} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canManageParticipants && !isModificationWindowClosed && (
          <div className="flex items-center gap-2 pt-1 border-t border-slate-100 mt-1">
            <select
              value={selectedAddPartnerId}
              onChange={(e) => setSelectedAddPartnerId(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">
                {addPartnerCandidates.length === 0 ? 'אין שותפים זמינים להוספה' : 'בחרו שותף להוספה...'}
              </option>
              {addPartnerCandidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name ?? u.email}
                </option>
              ))}
            </select>
            <select
              value={addPartnerGuestCount}
              onChange={(e) => setAddPartnerGuestCount(Number(e.target.value))}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {GUEST_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {formatGuestsLabel(count)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAdminAdd}
              disabled={joinLeaveSubmitting || !selectedAddPartnerId}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-1.5 transition-colors whitespace-nowrap"
            >
              <UserPlus size={13} />
              {joinLeaveSubmitting ? 'מוסיפים...' : 'הוספה'}
            </button>
          </div>
        )}

        {isModificationWindowClosed && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
            עברו יותר משבוע ממועד תחילת ההפלגה — חלון השינויים נסגר. לא ניתן עוד להצטרף, לעזוב, או לערוך הפלגה
            זו.
          </p>
        )}

        {!isOrganizer && !isCurrentUserParticipant && !isModificationWindowClosed && (
          <div className="flex items-center gap-2 pt-1">
            <select
              value={joinGuestCount}
              onChange={(e) => setJoinGuestCount(Number(e.target.value))}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {GUEST_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {formatGuestsLabel(count)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleJoin}
              disabled={joinLeaveSubmitting}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-1.5 transition-colors"
            >
              <LogIn size={13} />
              {joinLeaveSubmitting ? 'מצטרפים...' : 'הצטרפות להפלגה'}
            </button>
          </div>
        )}

        {!isOrganizer && isCurrentUserParticipant && !isModificationWindowClosed && (
          <button
            type="button"
            onClick={handleLeave}
            disabled={joinLeaveSubmitting}
            className="self-start flex items-center gap-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold px-3 py-1.5 transition-colors"
          >
            <LogOut size={13} />
            {joinLeaveSubmitting ? 'עוזבים...' : 'עזיבת ההפלגה'}
          </button>
        )}

        {!isOrganizer && !isModificationWindowClosed && (
          <p className="text-xs text-slate-400">
            {isCurrentUserParticipant
              ? (() => {
                  const myShares = 1 + (myParticipantRow?.guest_count ?? 0);
                  return `חלקכם המשוער בעלות: כ-${formatCoinAmount(
                    ((coinBreakdown?.total ?? 0) * myShares) / Math.max(totalShares, 1)
                  )} מטבעות (חלק ${myShares} מתוך ${totalShares}, לפי 1 + מספר האורחים שהבאתם).`;
                })()
              : (() => {
                  const prospectiveShares = 1 + joinGuestCount;
                  const prospectiveTotal = totalShares + prospectiveShares;
                  return `אם תצטרפו עם ${joinGuestCount} אורחים, חלקכם יהיה כ-${formatCoinAmount(
                    ((coinBreakdown?.total ?? 0) * prospectiveShares) / prospectiveTotal
                  )} מטבעות (חלק ${prospectiveShares} מתוך ${prospectiveTotal})${
                    isPastSailing ? ' — גם הפלגות שכבר עברו ניתן להצטרף אליהן' : ''
                  }.`;
                })()}
          </p>
        )}

        {joinLeaveError && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{joinLeaveError}</p>
        )}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div dir="rtl" className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">{canEdit ? 'עריכת הפלגה' : 'פרטי הפלגה'}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        {!canEdit ? (
          <div className="px-6 py-5 flex flex-col gap-4">
            <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-blue-900 font-semibold">
                <User size={16} />
                <span>{booking.bookedByName ?? 'שותף'}</span>
              </div>
              <div className="flex items-center gap-2 text-blue-800 text-sm">
                <CalendarIcon size={16} />
                <span>
                  {new Date(booking.start_time).toLocaleDateString('he-IL', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2 text-blue-800 text-sm">
                <Clock size={16} />
                <span>
                  {new Date(booking.start_time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} -{' '}
                  {new Date(booking.end_time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm text-blue-800">{bookingTypeLabelHe(booking.booking_type)}</p>
            </div>
            {booking.notes && <p className="text-sm text-slate-600">{booking.notes}</p>}

            <ParticipantsSection />

            <p className="text-xs text-slate-400">רק בעל ההזמנה או מנהל יכולים לערוך או לבטל הפלגה זו.</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold py-2.5 transition-colors"
            >
              סגור
            </button>
          </div>
        ) : (
          <form onSubmit={handleSave} className="px-6 py-5 flex flex-col gap-5">
            <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-4 flex flex-col gap-2">
              {booking.bookedByName && (
                <div className="flex items-center gap-2 text-blue-900 font-semibold">
                  <User size={16} />
                  <span>{booking.bookedByName}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-blue-900 font-semibold">
                <CalendarIcon size={16} />
                <span>
                  {startDateTime.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
              </div>
              {isCyprusType && (
                <div className="flex items-center gap-2 text-blue-800 text-sm">
                  <CalendarIcon size={14} className="opacity-60" />
                  <span>
                    עד{' '}
                    {endDateTime.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-blue-800 text-sm">
                <Clock size={16} />
                <span>
                  {formatHourLabel(startHour)} - {formatHourLabel((startHour + durationHours) % 24)}
                </span>
              </div>
            </div>

            {exceedsMaxDuration && (
              <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {isCyprusType
                  ? `משך שייט לקפריסין לא יכול לעלות על ${CYPRUS_MAX_DURATION_DAYS} ימים.`
                  : 'משך הפלגה מקסימלי הוא 24 שעות. אנא קצרו את משך ההפלגה.'}
              </p>
            )}

            {insufficientCyprusDuration && (
              <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                שייט לקפריסין חייב להימשך לפחות {CYPRUS_MIN_DURATION_DAYS} ימים. אנא הגדילו את משך ההפלגה.
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">סוג הזמנה</label>
              <select
                value={bookingType}
                onChange={(e) => {
                  const nextType = e.target.value;
                  setBookingType(nextType);
                  if (nextType === 'Cyprus' && durationHours < CYPRUS_MIN_DURATION_DAYS * 24) {
                    setDurationHours(CYPRUS_MIN_DURATION_DAYS * 24);
                  } else if (nextType !== 'Cyprus' && durationHours > 24) {
                    setDurationHours(1);
                  }
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {BOOKING_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">שעת התחלה</label>
                <select
                  value={startHour}
                  onChange={(e) => setStartHour(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {START_HOUR_OPTIONS.map((hour) => (
                    <option key={hour} value={hour}>
                      {formatHourLabel(hour)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">משך ההפלגה</label>
                {isCyprusType ? (
                  <select
                    value={durationHours / 24}
                    onChange={(e) => setDurationHours(Number(e.target.value) * 24)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {CYPRUS_DURATION_DAY_OPTIONS.map((days) => (
                      <option key={days} value={days}>
                        {formatDaysLabel(days)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={durationHours}
                    onChange={(e) => setDurationHours(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {DURATION_OPTIONS.map((hours) => (
                      <option key={hours} value={hours}>
                        {formatDurationOptionLabel(hours)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* For Shared/Cyprus, guests increase your proportional
                share of the cost (1 + guest count, out of the sail's
                total shares — see totalShares above); for other types
                they're headcount only. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">מספר האורחים שלכם</label>
              <select
                value={guestsCount}
                onChange={(e) => setGuestsCount(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {GUEST_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {formatGuestsLabel(count)}
                  </option>
                ))}
              </select>
              {isSharedType && (
                <p className={`text-xs ${exceedsCapacity ? 'text-rose-600 font-medium' : 'text-slate-400'}`}>
                  סה"כ משתתפים (כולל אתכם): {totalParticipants} / {MAX_TOTAL_PARTICIPANTS} · אורחים מגדילים את
                  חלקכם היחסי בעלות
                </p>
              )}
            </div>

            {isSharedBookingType && <ParticipantsSection />}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">הערות</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="הערות נוספות..."
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <CoinsIcon size={16} className="text-amber-500" />
                <span>עלות משוערת{isSharedType && otherParticipants.length > 0 ? ' (לכלל המשתתפים)' : ''}</span>
              </div>
              {coinBreakdown ? (
                <div className="flex flex-wrap items-center gap-2">
                  {Object.entries(COIN_TYPE_LABELS_HE).map(([key, label]) =>
                    coinBreakdown[key] > 0 ? (
                      <span
                        key={key}
                        className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium"
                      >
                        {label}: {formatCoinAmount(coinBreakdown[key])}
                      </span>
                    ) : null
                  )}
                  <span className="px-2.5 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold">
                    סה"כ {formatCoinAmount(coinBreakdown.total)} מטבעות
                  </span>
                </div>
              ) : (
                <p className="text-xs text-slate-500">תחזוקה אינה מחייבת מטבעות.</p>
              )}
              {isSharedType && otherParticipants.length > 0 && coinBreakdown && (
                <p className="text-xs text-slate-500 mt-2">
                  חלקכם כמארגנים: כ-{formatCoinAmount((coinBreakdown.total * (1 + guestsCount)) / totalShares)}{' '}
                  מטבעות (חלק {1 + guestsCount} מתוך {totalShares} — לפי 1 + מספר האורחים של כל שותף).
                </p>
              )}
            </div>

            {errorMessage && (
              <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {errorMessage}
              </p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={
                  submitting ||
                  exceedsMaxDuration ||
                  exceedsCapacity ||
                  insufficientCyprusDuration ||
                  isModificationWindowClosed
                }
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

            <button
              type="button"
              onClick={handleCancelSail}
              disabled={submitting || isPastSailing}
              title={isPastSailing ? 'לא ניתן לבטל הפלגה שכבר החלה או הסתיימה.' : undefined}
              className="rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold py-2.5 transition-colors"
            >
              ביטול ההפלגה
            </button>
            {isPastSailing && (
              <p className="text-xs text-slate-400 text-center -mt-1">לא ניתן לבטל הפלגה שכבר החלה או הסתיימה.</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
