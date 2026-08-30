import { useEffect, useMemo, useState } from 'react';
import { X, Calendar as CalendarIcon, Clock, Coins as CoinsIcon, Anchor } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { classifyHours, COIN_TYPE_LABELS_HE } from '../lib/coinCalculator';
import { BOOKING_TYPE_OPTIONS, chargesCoins } from '../lib/bookingTypes';
import { fetchIsraeliHolidayMap, syncIsraeliHolidays } from '../lib/israeliHolidays';
import { friendlyBookingErrorMessage } from '../lib/bookingErrors';

const MAX_TOTAL_PARTICIPANTS = 9;
// Matches trg_fn_enforce_day_night_hour_limit's Cyprus branch
// (0022_michael_method_booking_rules.sql): 5-14 days, i.e. 120-336 hours.
const CYPRUS_MIN_DURATION_DAYS = 5;
const CYPRUS_MAX_DURATION_DAYS = 14;
// §70: a single booking can never need more than 16 day-hours + 8
// night-hours = 24h total either way, so the dropdown's upper bound
// stays 24 — the day/16 + night/8 sub-limits (checked below) are what
// actually narrow it further for a given start time.
const MAX_STANDARD_DURATION_HOURS = 24;
const MAX_DAY_HOURS = 16;
const MAX_NIGHT_HOURS = 8;

const START_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);
const DURATION_OPTIONS = Array.from({ length: MAX_STANDARD_DURATION_HOURS }, (_, i) => i + 1);
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

function formatCoinAmount(n) {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export default function NewBookingModal({ isOpen, onClose, initialStart, initialEnd, currentUser, onBookingCreated }) {
  const [selectedDate, setSelectedDate] = useState(initialStart ?? new Date());
  const [startHour, setStartHour] = useState(initialStart ? initialStart.getHours() : 9);
  const [durationHours, setDurationHours] = useState(1);
  const [bookingType, setBookingType] = useState('Private');
  const [guestsCount, setGuestsCount] = useState(0);
  const [isAnchor, setIsAnchor] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Re-seed the form whenever a fresh grid selection comes in.
  useEffect(() => {
    if (!isOpen || !initialStart) return;

    setSelectedDate(initialStart);
    setStartHour(initialStart.getHours());

    if (initialEnd) {
      const rawHours = Math.round((initialEnd.getTime() - initialStart.getTime()) / 3_600_000);
      setDurationHours(Math.min(Math.max(rawHours, 1), MAX_STANDARD_DURATION_HOURS));
    } else {
      setDurationHours(1);
    }

    setBookingType('Private');
    setGuestsCount(0);
    setIsAnchor(false);
    setNotes('');
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
  // Shared/Cyprus still route through fn_create_shared_booking (its
  // participants array is now always just the organizer — see
  // 0040_guests_free_and_shared_sail_solo_pricing.sql), but no longer
  // literally "require" other partners — kept as its own flag purely
  // to pick the right insert path in handleSubmit below.
  const isSharedType = bookingType === 'Shared' || isCyprusType;

  const exceedsMaxDuration = isCyprusType
    ? durationHours > CYPRUS_MAX_DURATION_DAYS * 24
    : durationHours > MAX_STANDARD_DURATION_HOURS;
  const insufficientCyprusDuration = isCyprusType && durationHours < CYPRUS_MIN_DURATION_DAYS * 24;

  // §70: day-hours <= 16, night-hours <= 8 — client-side estimate of
  // the same rule trg_fn_enforce_day_night_hour_limit enforces server-
  // side. Cyprus is exempt (its own 5-14 day rule applies instead).
  const dayNightBreakdown = useMemo(
    () => (isCyprusType ? null : classifyHours(startDateTime, endDateTime, new Set(holidayMap.keys()))),
    [isCyprusType, startDateTime, endDateTime, holidayMap]
  );
  const exceedsDayHourLimit =
    !!dayNightBreakdown && dayNightBreakdown.weekendDay + dayNightBreakdown.midweekDay > MAX_DAY_HOURS;
  const exceedsNightHourLimit =
    !!dayNightBreakdown && dayNightBreakdown.weekendNight + dayNightBreakdown.midweekNight > MAX_NIGHT_HOURS;

  // Guests never cost coins and are no longer attributed to a specific
  // partner (there's only ever one participant — the organizer — since
  // partners can no longer be added to a booking at all), so headcount
  // is the same flat "1 + guestsCount" for every type.
  const totalParticipants = 1 + guestsCount;
  const exceedsCapacity = totalParticipants > MAX_TOTAL_PARTICIPANTS;

  const coinBreakdown = useMemo(() => {
    if (!chargesCoins(bookingType)) return null;
    // Full classifyHours cost either way: for Private/Dockside the
    // organizer always pays it all, and for Shared/Cyprus the
    // proportional-share RPC formula degrades to the same 100% share
    // once there's only one participant (see coinCalculator.js header).
    return classifyHours(startDateTime, endDateTime, new Set(holidayMap.keys()));
  }, [bookingType, startDateTime, endDateTime, holidayMap]);

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
          : `משך ההפלגה לא יכול לעלות על ${MAX_STANDARD_DURATION_HOURS} שעות.`
      );
      return;
    }
    if (insufficientCyprusDuration) {
      setErrorMessage(`שייט לקפריסין חייב להימשך לפחות ${CYPRUS_MIN_DURATION_DAYS} ימים.`);
      return;
    }
    if (exceedsDayHourLimit) {
      setErrorMessage(`הזמנה בודדת מוגבלת ל-${MAX_DAY_HOURS} שעות יום לכל היותר.`);
      return;
    }
    if (exceedsNightHourLimit) {
      setErrorMessage(`הזמנה בודדת מוגבלת ל-${MAX_NIGHT_HOURS} שעות לילה לכל היותר.`);
      return;
    }
    if (exceedsCapacity) {
      setErrorMessage(
        `סך המשתתפים (כולל אורחים) הוא ${totalParticipants}, ומעל המקסימום המותר של ${MAX_TOTAL_PARTICIPANTS}. הסירו אורחים.`
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

      // The server-side classifier checks public.israeli_holidays for
      // weekend/holiday classification — it can't call Hebcal itself
      // mid-transaction, so make sure the dates this booking actually
      // spans are synced before the insert/RPC call that needs them.
      await syncIsraeliHolidays(holidayMap);

      if (isSharedType) {
        // Organizer is always the sole participant now — see
        // 0040_guests_free_and_shared_sail_solo_pricing.sql, which
        // makes this equivalent to a full-price Private-rate charge.
        const { error } = await supabase.rpc('fn_create_shared_booking', {
          p_booking_type: bookingType,
          p_start: startDateTime.toISOString(),
          p_end: endDateTime.toISOString(),
          p_notes: notes.trim() ? notes.trim() : null,
          p_participants: [{ user_id: authUser.id, guest_count: guestsCount }],
        });
        if (error) throw error;
      } else {
        const payload = {
          user_id: authUser.id,
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          booking_type: bookingType,
          guests_count: guestsCount,
          notes: notes.trim() ? notes.trim() : null,
          is_anchor: bookingType === 'Private' ? isAnchor : false,
        };
        const { error } = await supabase.from('bookings').insert(payload);
        if (error) throw error;
      }

      // Email sending (confirmation + shared-sail notifications) is
      // intentionally disconnected for now, pending a real mail
      // provider — see src/lib/emailNotifications.js, left in place
      // and ready to reconnect here once that's set up. The
      // emails_enabled/receive_shared_sail_notifications preferences
      // still save normally from EditPartnerModal.jsx; nothing reads
      // them yet.

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
      <div dir="rtl" className="w-full max-w-lg max-h-[95vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-800">הוספת הפלגה</h3>
            <p className="text-xs text-slate-400">{currentUser?.full_name ?? currentUser?.email ?? ''}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-3 flex flex-col gap-2.5">
          {/* Top summary line */}
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-blue-900 font-semibold">
              <CalendarIcon size={14} />
              {formattedDateHe}
            </span>
            {isCyprusType && (
              <span className="flex items-center gap-1.5 text-blue-800">
                <CalendarIcon size={13} className="opacity-60" />
                עד {formattedEndDateHe}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-blue-800">
              <Clock size={14} />
              {formattedTimeRange} • {formattedDuration}
            </span>
          </div>

          {exceedsMaxDuration && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {isCyprusType
                ? `משך שייט לקפריסין לא יכול לעלות על ${CYPRUS_MAX_DURATION_DAYS} ימים.`
                : `משך הפלגה מקסימלי הוא ${MAX_STANDARD_DURATION_HOURS} שעות. אנא קצרו את משך ההפלגה.`}
            </p>
          )}
          {insufficientCyprusDuration && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              שייט לקפריסין חייב להימשך לפחות {CYPRUS_MIN_DURATION_DAYS} ימים. אנא הגדילו את משך ההפלגה.
            </p>
          )}
          {!exceedsMaxDuration && exceedsDayHourLimit && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              הזמנה זו כוללת יותר מ-{MAX_DAY_HOURS} שעות יום. אנא בחרו שעת התחלה/משך אחרים.
            </p>
          )}
          {!exceedsMaxDuration && exceedsNightHourLimit && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              הזמנה זו כוללת יותר מ-{MAX_NIGHT_HOURS} שעות לילה. אנא בחרו שעת התחלה/משך אחרים.
            </p>
          )}

          {/* Booking type + anchor, tight */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <select
                value={bookingType}
                onChange={(e) => {
                  const nextType = e.target.value;
                  setBookingType(nextType);
                  if (nextType !== 'Private') setIsAnchor(false);
                  // Switching to/from Cyprus needs a matching duration
                  // unit (days vs hours) — otherwise the day-select would
                  // show a duration that isn't one of its own options.
                  if (nextType === 'Cyprus' && durationHours < CYPRUS_MIN_DURATION_DAYS * 24) {
                    setDurationHours(CYPRUS_MIN_DURATION_DAYS * 24);
                  } else if (nextType !== 'Cyprus' && durationHours > MAX_STANDARD_DURATION_HOURS) {
                    setDurationHours(1);
                  }
                }}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {BOOKING_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {bookingType === 'Private' && (
                <label
                  className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 cursor-pointer whitespace-nowrap"
                  title="הפלגת עוגן (אירוע חיים משמעותי) — עד 2 בשנה, פטורה ממגבלת S אך עדיין מחייבת מטבעות."
                >
                  <input
                    type="checkbox"
                    checked={isAnchor}
                    onChange={(e) => setIsAnchor(e.target.checked)}
                    className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <Anchor size={13} className="text-amber-600 shrink-0" />
                  הפלגת עוגן
                </label>
              )}
            </div>
            <p className="text-xs text-slate-400">
              {BOOKING_TYPE_OPTIONS.find((opt) => opt.value === bookingType)?.helper}
            </p>
          </div>

          {/* Start time + duration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-700">שעת התחלה</label>
              <select
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {START_HOUR_OPTIONS.map((hour) => (
                  <option key={hour} value={hour}>
                    {formatHourLabel(hour)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-700">משך ההפלגה</label>
              {isCyprusType ? (
                <select
                  value={durationHours / 24}
                  onChange={(e) => setDurationHours(Number(e.target.value) * 24)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
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

          {/* Guests — never cost coins, for any booking type (see
              0040_guests_free_and_shared_sail_solo_pricing.sql) */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700">מספר אורחים</label>
            <select
              value={guestsCount}
              onChange={(e) => setGuestsCount(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {GUEST_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {formatGuestsLabel(count)}
                </option>
              ))}
            </select>
            {isSharedType && (
              <p className={`text-xs ${exceedsCapacity ? 'text-rose-600 font-medium' : 'text-slate-400'}`}>
                סה"כ משתתפים: {totalParticipants} / {MAX_TOTAL_PARTICIPANTS}
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700">הערות (אופציונלי)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="הערות נוספות..."
              rows={1}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Real-time coin cost */}
          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1.5">
              <CoinsIcon size={14} className="text-amber-500" />
              <span>עלות משוערת</span>
            </div>
            {coinBreakdown ? (
              <div className="flex flex-wrap items-center gap-2">
                {Object.entries(COIN_TYPE_LABELS_HE).map(([key, label]) =>
                  coinBreakdown[key] > 0 ? (
                    <span key={key} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
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
          </div>

          {errorMessage && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {errorMessage}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={
                submitting ||
                exceedsMaxDuration ||
                exceedsDayHourLimit ||
                exceedsNightHourLimit ||
                exceedsCapacity ||
                insufficientCyprusDuration
              }
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold py-2 transition-colors"
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
              className="flex-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold py-2 transition-colors"
            >
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
