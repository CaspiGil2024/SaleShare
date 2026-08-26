import { useEffect, useMemo, useState } from 'react';
import { X, Calendar as CalendarIcon, Clock, Coins as CoinsIcon } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { calculateBookingCoins, calculateSharedSailCoins, COIN_TYPE_LABELS_HE } from '../lib/coinCalculator';
import { BOOKING_TYPE_OPTIONS, chargesCoins } from '../lib/bookingTypes';
import { fetchIsraeliHolidayMap, syncIsraeliHolidays } from '../lib/israeliHolidays';
import { friendlyBookingErrorMessage } from '../lib/bookingErrors';
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

// Matches the two examples from the spec verbatim: "שעה 1" for the
// first option, "24 שעות" for the last.
function formatDurationOptionLabel(hours) {
  return hours === 1 ? 'שעה 1' : `${hours} שעות`;
}

function formatDaysLabel(days) {
  return days === 1 ? 'יום 1' : `${days} ימים`;
}

// Matches the summary-card example verbatim: "1 שעה". Cyprus durations
// are always whole days (24h multiples), so shown in days instead.
function formatDurationSummaryLabel(hours, isCyprus) {
  if (isCyprus) return formatDaysLabel(hours / 24);
  return hours === 1 ? '1 שעה' : `${hours} שעות`;
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

export default function NewBookingModal({ isOpen, onClose, initialStart, initialEnd, currentUser, onBookingCreated }) {
  const [selectedDate, setSelectedDate] = useState(initialStart ?? new Date());
  const [startHour, setStartHour] = useState(initialStart ? initialStart.getHours() : 9);
  const [durationHours, setDurationHours] = useState(1);
  const [bookingType, setBookingType] = useState('Private');
  const [guestsCount, setGuestsCount] = useState(0);
  const [notes, setNotes] = useState('');
  const [selectedPartnerIds, setSelectedPartnerIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Re-seed the form whenever a fresh grid selection comes in.
  useEffect(() => {
    if (!isOpen || !initialStart) return;

    setSelectedDate(initialStart);
    setStartHour(initialStart.getHours());

    if (initialEnd) {
      const rawHours = Math.round((initialEnd.getTime() - initialStart.getTime()) / 3_600_000);
      setDurationHours(Math.min(Math.max(rawHours, 1), 24));
    } else {
      setDurationHours(1);
    }

    setBookingType('Private');
    setGuestsCount(0);
    setNotes('');
    setSelectedPartnerIds([]);
    setErrorMessage(null);
  }, [isOpen, initialStart, initialEnd]);

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

  // Israeli chag/erev-chag dates get weekend coin rates too — fetched
  // for whatever narrow window this specific booking spans. This is
  // purely a client-side estimate (see coinCalculator.js's header
  // comment on why nothing server-side actually consumes it).
  const [holidayMap, setHolidayMap] = useState(new Map());

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;
    fetchIsraeliHolidayMap(startDateTime, endDateTime)
      .then((map) => {
        if (isCancelled) return;
        setHolidayMap(map);
      })
      .catch((err) => {
        console.error('Failed to load holiday dates for coin estimate', err);
      });
    return () => {
      isCancelled = true;
    };
  }, [isOpen, startDateTime.getTime(), endDateTime.getTime()]);

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
      // Flat 1 coin/hour per participant, paid individually — the
      // organizer is a participant too (see submit handler, which
      // inserts them into booking_participants alongside the picked
      // partners), so they're counted here.
      return { shared: true, ...calculateSharedSailCoins(startDateTime, endDateTime, 1 + selectedPartnerIds.length) };
    }
    return { shared: false, ...calculateBookingCoins(startDateTime, endDateTime, new Set(holidayMap.keys())) };
  }, [bookingType, requiresPartners, startDateTime, endDateTime, holidayMap, selectedPartnerIds.length]);

  const formattedDateHe = startDateTime.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const formattedEndDateHe = endDateTime.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const formattedTimeRange = `${formatHourLabel(startHour)} - ${formatHourLabel((startHour + durationHours) % 24)}`;
  const formattedDuration = formatDurationSummaryLabel(durationHours, isCyprusType);

  if (!isOpen) return null;

  async function handleSubmit(e) {
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
      // Re-check the live session instead of trusting the currentUser prop:
      // a stale/expired session can still leave currentUser populated in
      // React state, and inserting with a mismatched or missing auth.uid()
      // fails RLS with an opaque Postgres error rather than a clear one.
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !authUser) {
        setErrorMessage('פג תוקף החיבור שלכם. אנא התחברו מחדש ונסו שוב.');
        setSubmitting(false);
        return;
      }

      // The server-side rate function checks public.israeli_holidays
      // for weekend/holiday classification — it can't call Hebcal
      // itself mid-transaction, so make sure the dates this booking
      // actually spans are synced before the insert that needs them.
      await syncIsraeliHolidays(holidayMap);

      const payload = {
        user_id: authUser.id,
        start_time: startDateTime.toISOString(),
        end_time: endDateTime.toISOString(),
        booking_type: bookingType,
        guests_count: guestsCount,
        notes: notes.trim() ? notes.trim() : null,
      };
      const { data: newBooking, error } = await supabase.from('bookings').insert(payload).select('id').single();

      if (error) throw error;

      if (requiresPartners) {
        // The organizer is a participant too — each joining partner
        // (organizer included) pays their own 1 coin/hour individually
        // (0014_coin_quota_system.sql), so they need their own row here.
        const participantUserIds = [authUser.id, ...selectedPartnerIds];
        const { error: participantsError } = await supabase.from('booking_participants').insert(
          participantUserIds.map((partnerId) => ({ booking_id: newBooking.id, user_id: partnerId }))
        );
        if (participantsError) {
          // The booking row itself was already created and can't be
          // rolled back from here (two separate inserts, no shared
          // transaction) — surface this clearly rather than pretending
          // it fully succeeded.
          console.error('Failed to attach partners to booking', participantsError);
          setErrorMessage(
            'ההזמנה נוצרה אך אירעה שגיאה בצירוף השותפים: ' + friendlyBookingErrorMessage(participantsError)
          );
          await onBookingCreated?.();
          setSubmitting(false);
          return;
        }
      }

      // Re-fetch from the DB rather than locally patching in the new
      // event, so the calendar also stays correct for other partners'
      // concurrent bookings.
      await onBookingCreated?.();
      onClose();
    } catch (err) {
      console.error('Failed to create booking:', {
        message: err?.message,
        code: err?.code,
        details: err?.details,
        hint: err?.hint,
      });
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
          <h3 className="text-lg font-bold text-slate-800">הוספת הפלגה</h3>
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
          {/* Top summary card */}
          <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-blue-900 font-semibold">
              <CalendarIcon size={16} />
              <span>{formattedDateHe}</span>
            </div>
            {isCyprusType && (
              <div className="flex items-center gap-2 text-blue-800 text-sm">
                <CalendarIcon size={14} className="opacity-60" />
                <span>עד {formattedEndDateHe}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-blue-800 text-sm">
              <Clock size={16} />
              <span>{formattedTimeRange}</span>
              <span className="text-blue-400">•</span>
              <span>{formattedDuration}</span>
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

          {/* Booking type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">סוג הזמנה</label>
            <select
              value={bookingType}
              onChange={(e) => {
                const nextType = e.target.value;
                setBookingType(nextType);
                // Switching to/from Cyprus needs a matching duration
                // unit (days vs hours) — otherwise the day-select would
                // show a duration that isn't one of its own options.
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
            <p className="text-xs text-slate-400">
              {BOOKING_TYPE_OPTIONS.find((opt) => opt.value === bookingType)?.helper}
            </p>
          </div>

          {/* Start time + duration */}
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
              excludeUserId={currentUser?.id}
              selectedIds={selectedPartnerIds}
              onChange={setSelectedPartnerIds}
            />
          )}

          {/* Booking name (read-only) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">שם המזמין</label>
            <input
              type="text"
              value={currentUser?.full_name ?? currentUser?.email ?? ''}
              disabled
              readOnly
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
          </div>

          {/* Guests */}
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

          {/* Notes */}
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

          {/* Real-time coin cost */}
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

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={
                submitting || exceedsMaxDuration || exceedsCapacity || missingPartners || insufficientCyprusDuration
              }
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 transition-colors"
            >
              {submitting && (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
              )}
              {submitting ? 'שומר...' : 'צור הזמנה'}
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
