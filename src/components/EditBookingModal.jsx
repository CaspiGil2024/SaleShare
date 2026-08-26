import { useEffect, useMemo, useState } from 'react';
import { X, Calendar as CalendarIcon, Clock, Coins as CoinsIcon, User } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { calculateBookingCoins, calculateSharedSailCoins, COIN_TYPE_LABELS_HE } from '../lib/coinCalculator';
import { BOOKING_TYPE_OPTIONS, chargesCoins } from '../lib/bookingTypes';
import { bookingTypeLabelHe } from '../lib/bookingColors';
import { fetchIsraeliHolidayMap, syncIsraeliHolidays } from '../lib/israeliHolidays';
import { friendlyBookingErrorMessage } from '../lib/bookingErrors';
import { isManager } from '../lib/permissions';
import PartnerPicker from './PartnerPicker';

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
  const [selectedPartnerIds, setSelectedPartnerIds] = useState([]);
  const [holidayMap, setHolidayMap] = useState(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Re-seed the form whenever a different booking is opened.
  useEffect(() => {
    if (!isOpen || !booking) return;
    const start = new Date(booking.start_time);
    const end = new Date(booking.end_time);

    setSelectedDate(start);
    setStartHour(start.getHours());
    setDurationHours(Math.max(1, Math.round((end.getTime() - start.getTime()) / 3_600_000)));
    setBookingType(booking.booking_type ?? 'Private');
    setGuestsCount(booking.guests_count ?? 0);
    setNotes(booking.notes ?? '');
    setErrorMessage(null);
  }, [isOpen, booking]);

  // Load whoever's already attached to this booking as participants.
  useEffect(() => {
    if (!isOpen || !booking) return;
    let isCancelled = false;

    supabase
      .from('booking_participants')
      .select('user_id')
      .eq('booking_id', booking.id)
      .then(({ data, error }) => {
        if (isCancelled) return;
        if (error) {
          console.error('Failed to load booking participants', error);
          setSelectedPartnerIds([]);
          return;
        }
        // Excludes the organizer's own row — the organizer is now
        // always stored as a participant too (for individual coin
        // charging), but selectedPartnerIds/totalParticipants treat
        // the organizer as implicit ("+1"), separate from this list.
        // Including it here would double-count them.
        setSelectedPartnerIds(data.map((row) => row.user_id).filter((id) => id !== booking.user_id));
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, booking]);

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
  // Cyprus is a partners sail too — same picker, same minimum-1-partner
  // and 9-person-cap rules as Shared. Zero-overlap for the whole
  // duration needs no extra code — prevent_overlap already covers any
  // booking length.
  const requiresPartners = bookingType === 'Shared' || isCyprusType;
  const totalParticipants = 1 + (requiresPartners ? selectedPartnerIds.length : 0) + guestsCount;
  const exceedsCapacity = totalParticipants > MAX_TOTAL_PARTICIPANTS;
  const missingPartners = requiresPartners && selectedPartnerIds.length === 0;

  const coinBreakdown = useMemo(() => {
    if (!chargesCoins(bookingType)) return null;
    if (requiresPartners) {
      return { shared: true, ...calculateSharedSailCoins(startDateTime, endDateTime, 1 + selectedPartnerIds.length) };
    }
    return { shared: false, ...calculateBookingCoins(startDateTime, endDateTime, new Set(holidayMap.keys())) };
  }, [bookingType, requiresPartners, startDateTime, endDateTime, holidayMap, selectedPartnerIds.length]);

  if (!isOpen || !booking) return null;

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
    if (missingPartners) {
      setErrorMessage('יש לבחור לפחות שותף אחד נוסף להפלגה זו.');
      return;
    }
    if (exceedsCapacity) {
      setErrorMessage(
        `סך המשתתפים (שותפים ואורחים) הוא ${totalParticipants}, ומעל המקסימום המותר של ${MAX_TOTAL_PARTICIPANTS}. הסירו שותפים או אורחים.`
      );
      return;
    }

    setSubmitting(true);
    try {
      // The server-side rate function checks public.israeli_holidays —
      // it can't call Hebcal mid-transaction, so make sure the (maybe
      // newly picked) dates this booking now spans are synced first.
      await syncIsraeliHolidays(holidayMap);

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

      // Simplest correct sync regardless of what changed (partners
      // added/removed, or booking_type switched away from Shared
      // entirely): clear whatever's attached, then re-attach the
      // current selection.
      const { error: clearError } = await supabase
        .from('booking_participants')
        .delete()
        .eq('booking_id', booking.id);
      if (clearError) throw clearError;

      if (requiresPartners) {
        // The organizer is a participant too (0014_coin_quota_system.sql
        // charges each participant, organizer included, individually).
        const participantUserIds = [booking.user_id, ...selectedPartnerIds];
        const { error: participantsError } = await supabase
          .from('booking_participants')
          .insert(participantUserIds.map((partnerId) => ({ booking_id: booking.id, user_id: partnerId })));
        if (participantsError) throw participantsError;
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div dir="rtl" className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
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

            {/* Partners sail — pick who's joining */}
            {requiresPartners && (
              <PartnerPicker
                excludeUserId={booking.user_id}
                selectedIds={selectedPartnerIds}
                onChange={setSelectedPartnerIds}
              />
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">מספר אורחים</label>
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
              {requiresPartners && (
                <p className={`text-xs ${exceedsCapacity ? 'text-rose-600 font-medium' : 'text-slate-400'}`}>
                  סה"כ משתתפים (כולל אתכם): {totalParticipants} / {MAX_TOTAL_PARTICIPANTS}
                </p>
              )}
            </div>

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
                <span>עלות משוערת</span>
              </div>
              {coinBreakdown ? coinBreakdown.shared ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
                    לכל משתתף: {coinBreakdown.perPerson} מטבעות ({coinBreakdown.hours} שעות × 1)
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold">
                    סה"כ לקבוצה: {coinBreakdown.total} מטבעות
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {Object.entries(COIN_TYPE_LABELS_HE).map(([key, label]) =>
                    coinBreakdown[key] > 0 ? (
                      <span
                        key={key}
                        className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium"
                      >
                        {label}: {coinBreakdown[key]}
                      </span>
                    ) : null
                  )}
                  <span className="px-2.5 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold">
                    סה"כ {coinBreakdown.total} מטבעות
                  </span>
                </div>
              ) : (
                <p className="text-xs text-slate-500">תחזוקה אינה מחייבת מטבעות.</p>
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
                  submitting || exceedsMaxDuration || exceedsCapacity || missingPartners || insufficientCyprusDuration
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
              disabled={submitting}
              className="rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold py-2.5 transition-colors"
            >
              ביטול ההפלגה
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
