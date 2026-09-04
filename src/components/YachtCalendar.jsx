import { useCallback, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import heLocale from '@fullcalendar/core/locales/he';
import { getBookingTypeColors, bookingTypeLabelHe } from '../lib/bookingColors';
import { fetchIsraeliHolidayMap, toDateKey } from '../lib/israeliHolidays';

// Recurring, non-interactive background layers so partners can see at
// a glance which of the 4 coin types a slot will draw from:
//  - Friday AND Saturday share one unified wash (fc-bg-weekend-holiday
//    — soft yellow, 30% opacity) by explicit product decision; an
//    earlier two-tier version (lighter Friday, deeper Saturday) was
//    replaced. Same unified class applies to holidays below (see
//    holidayMapToBackgroundEvents) — erev-chag and chag now render
//    identically too, not just to each other but to Friday/Saturday.
//  - 20:00-08:00 rows get a dark wash for night hours (matches the
//    real night rate in 0014_coin_quota_system.sql — was 20:00-06:00
//    before that migration redefined "night").
// FullCalendar's display:'background' + daysOfWeek/startTime/endTime
// is the same mechanism it uses internally for businessHours, so no
// custom cell-rendering hook is needed; layers stack automatically.
const WEEKEND_BACKGROUND_EVENTS = [
  {
    daysOfWeek: [5, 6], // Friday + Saturday (ערב שבת/שבת)
    display: 'background',
    classNames: ['fc-bg-weekend-holiday'],
  },
];

const NIGHT_BACKGROUND_EVENTS = [
  {
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '20:00',
    endTime: '24:00',
    display: 'background',
    classNames: ['fc-bg-night'],
  },
  {
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '00:00',
    endTime: '08:00',
    display: 'background',
    classNames: ['fc-bg-night'],
  },
];

function mapBookingToEvent(booking) {
  const { backgroundColor, borderColor, textColor } = getBookingTypeColors(booking.booking_type);
  return {
    id: booking.id,
    title: booking.title,
    start: booking.start,
    end: booking.end,
    backgroundColor,
    borderColor,
    textColor,
    extendedProps: {
      bookingType: booking.booking_type,
      bookedBy: booking.title,
      userId: booking.user_id,
      guestsCount: booking.guests_count,
      notes: booking.notes,
    },
  };
}

function formatEventClock(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// One all-day background wash per holiday/eve date — same unified
// fc-bg-weekend-holiday class as WEEKEND_BACKGROUND_EVENTS above,
// regardless of holiday.type (chag and erev-chag render identically).
//
// Plain 'YYYY-MM-DD' strings + allDay:true, deliberately NOT
// Date#toISOString(): that converts to UTC and shifts the boundary by
// Israel's UTC offset (local midnight becomes ~21:00 the prior day),
// which a timeGrid view can still paint (the shifted wash still lands
// somewhere in a 7-day week) but a single Day view or dayGridMonth
// cannot — Month view specifically needs a clean all-day date match to
// shade a whole cell, which a UTC-shifted timed range doesn't satisfy.
// This was the actual cause of holidays showing in Week but not Day/Month.
function holidayMapToBackgroundEvents(holidayMap) {
  const events = [];
  for (const [dateKey, holiday] of holidayMap) {
    const nextDay = new Date(`${dateKey}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    events.push({
      start: dateKey,
      end: toDateKey(nextDay),
      allDay: true,
      display: 'background',
      classNames: ['fc-bg-weekend-holiday'],
    });
  }
  return events;
}

// Maps the friendly value stored in public.users.default_calendar_view
// (0031_partner_calendar_view_preference.sql) to/from FullCalendar's
// own view names — keeps the DB/preference API decoupled from this
// specific calendar library's naming.
export const VIEW_PREFERENCE_TO_FULLCALENDAR = {
  day: 'timeGridDay',
  week: 'timeGridWeek',
  month: 'dayGridMonth',
};
const FULLCALENDAR_TO_VIEW_PREFERENCE = {
  timeGridDay: 'day',
  timeGridWeek: 'week',
  dayGridMonth: 'month',
};

export default function YachtCalendar({
  bookings,
  onSelectRange,
  onEventClick,
  initialView = 'timeGridWeek',
  onViewChange,
  onRefresh,
  isRefreshing = false,
}) {
  const calendarRef = useRef(null);
  const fetchTokenRef = useRef(0);
  const lastViewTypeRef = useRef(initialView);
  const [holidayMap, setHolidayMap] = useState(new Map());

  // (pointer: coarse) is the standards-based "primary input is touch"
  // check — unlike a screen-width breakpoint, it isn't fooled by a
  // narrow desktop window and correctly matches a touch device even
  // in landscape/tablet width. On a mouse, drag-select (`selectable`)
  // and a plain tap (`dateClick`) are unambiguous — a real drag only
  // ever happens via mousedown+move. On touch, both gestures start
  // from the exact same touchstart, and FullCalendar has to guess
  // which one you meant; that guess is what made tapping a free slot
  // to book unreliable. Turning off drag-select specifically on touch
  // devices removes the ambiguity outright — dateClick alone handles
  // every tap, on both the Day and Week (timeGrid) views.
  const isCoarsePointer =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;

  const holidayEvents = useMemo(() => holidayMapToBackgroundEvents(holidayMap), [holidayMap]);

  // "רענן יומן" — a custom entry in FullCalendar's own headerToolbar
  // (so it sits inline with today/prev/next and the view switcher,
  // inheriting the shared .fc-button styling) that re-runs the parent's
  // bookings/sail fetch straight from Supabase, no browser reload. The
  // leading ⟳ glyph plus the swap to "מרענן…" is the in-progress cue —
  // FullCalendar renders customButton text as plain text, so the label
  // change is the feedback channel. Only wired when onRefresh is passed.
  const headerToolbar = useMemo(
    () => ({
      start: 'title',
      center: '',
      end: `${onRefresh ? 'refreshCalendar ' : ''}today prev,next dayGridMonth,timeGridWeek,timeGridDay`,
    }),
    [onRefresh]
  );

  const customButtons = useMemo(
    () =>
      onRefresh
        ? {
            refreshCalendar: {
              text: isRefreshing ? '⟳ מרענן…' : '⟳ רענן יומן',
              hint: 'רענן יומן',
              click: () => {
                if (!isRefreshing) onRefresh();
              },
            },
          }
        : undefined,
    [onRefresh, isRefreshing]
  );

  const events = useMemo(
    () => [
      ...WEEKEND_BACKGROUND_EVENTS,
      ...NIGHT_BACKGROUND_EVENTS,
      ...holidayEvents,
      ...bookings.map(mapBookingToEvent),
    ],
    [bookings, holidayEvents]
  );

  const handleDatesSet = useCallback(
    (arg) => {
      // Pad a week either side so an erev-chag just outside the visible
      // range (or a holiday whose "eve" background needs the prior day)
      // is still available without a second fetch on the next nav click.
      const rangeStart = new Date(arg.start);
      rangeStart.setDate(rangeStart.getDate() - 7);
      const rangeEnd = new Date(arg.end);
      rangeEnd.setDate(rangeEnd.getDate() + 7);

      const token = ++fetchTokenRef.current;
      fetchIsraeliHolidayMap(rangeStart, rangeEnd)
        .then((map) => {
          if (fetchTokenRef.current !== token) return; // a newer request superseded this one
          setHolidayMap(map);
        })
        .catch((err) => {
          console.error('Failed to load Israeli holidays', err);
        });

      // datesSet also fires on every prev/next/today click, not just an
      // actual view switch — only persist when the view TYPE itself
      // changed, so navigating dates within the same view doesn't spam
      // writes to the partner's saved preference.
      if (arg.view.type !== lastViewTypeRef.current) {
        lastViewTypeRef.current = arg.view.type;
        const preference = FULLCALENDAR_TO_VIEW_PREFERENCE[arg.view.type];
        if (preference) onViewChange?.(preference);
      }
    },
    [onViewChange]
  );

  return (
    <div className="flex flex-col h-[calc(100dvh-205px)] overflow-hidden bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-2 sm:p-4">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={initialView}
        locale={heLocale}
        direction="rtl"
        firstDay={0}
        headerToolbar={headerToolbar}
        customButtons={customButtons}
        buttonText={{ month: 'חודשית', week: 'שבועית', day: 'יומית', today: 'היום' }}
        height="100%"
        expandRows
        allDaySlot={false}
        nowIndicator
        // Bookings must land exactly on the hour (matches the DB's
        // bookings_hour_aligned constraint), so slots snap to 1h.
        slotDuration="01:00:00"
        snapDuration="01:00:00"
        slotLabelInterval="01:00"
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        selectable={!isCoarsePointer}
        selectMirror={!isCoarsePointer}
        select={(info) => onSelectRange(info.start, info.end)}
        // A plain tap/click (no drag) doesn't fire `select` at all — on
        // touch devices FullCalendar's default selectable interaction
        // needs a ~1s long-press-then-drag to define a range, which is
        // unreliable and unintuitive on a phone (especially in the
        // already-narrow weekly view), so mobile taps effectively did
        // nothing. dateClick fires on a simple tap/click, opening a
        // 1-hour booking at the tapped slot as a fast mobile-friendly
        // path — drag-select for a custom range still works alongside
        // it (the two are mutually exclusive per gesture, never both).
        dateClick={(info) => onSelectRange(info.date, new Date(info.date.getTime() + 3_600_000))}
        eventClick={(info) => {
          if (!info.event.extendedProps.bookingType) return; // decorative background washes aren't clickable bookings
          onEventClick?.(info.event);
        }}
        datesSet={handleDatesSet}
        events={events}
        eventContent={(arg) => {
          const { bookingType } = arg.event.extendedProps;
          if (!bookingType) return null; // decorative weekend/night/holiday background washes
          const typeLabel = bookingTypeLabelHe(bookingType);
          return (
            <div className="px-1.5 py-1 leading-tight overflow-hidden">
              {/* Booker's name is the primary line — the type is already
                  conveyed by the event's own color (see bookingColors.js),
                  so it's kept as a secondary line rather than the headline. */}
              <div className="font-semibold text-xs truncate">{arg.event.title}</div>
              <div className="text-[10px] opacity-80 truncate">{typeLabel}</div>
              <div className="text-[11px] opacity-90 truncate">
                {formatEventClock(arg.event.start)} - {formatEventClock(arg.event.end)}
              </div>
            </div>
          );
        }}
        dayHeaderContent={(arg) => {
          const holiday = holidayMap.get(toDateKey(arg.date));
          return (
            <div className="leading-tight py-0.5">
              <div>{arg.text}</div>
              {holiday && (
                <div
                  className={`text-[10px] font-medium truncate ${
                    holiday.type === 'holiday' ? 'text-amber-700 dark:text-amber-300' : 'text-amber-600 dark:text-amber-300'
                  }`}
                  title={holiday.label}
                >
                  {holiday.label}
                </div>
              )}
            </div>
          );
        }}
        // dayHeaderContent above only fires once per weekday-name column
        // in dayGridMonth (it shows "א' ב' ג'..." once, not per date), so
        // Month view needs its own per-cell hook to show the holiday
        // label under each specific day number.
        dayCellContent={(arg) => {
          const holiday = holidayMap.get(toDateKey(arg.date));
          return (
            <div className="leading-tight py-0.5 px-1">
              <div>{arg.dayNumberText}</div>
              {holiday && (
                <div
                  className={`text-[9px] font-medium truncate ${
                    holiday.type === 'holiday' ? 'text-amber-700 dark:text-amber-300' : 'text-amber-600 dark:text-amber-300'
                  }`}
                  title={holiday.label}
                >
                  {holiday.label}
                </div>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
