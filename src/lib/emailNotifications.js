// =====================================================================
// SailShare — EmailJS integration (booking confirmation, shared-sail
// creation + cancellation notifications, critical maintenance/grounding
// resolution notices)
// =====================================================================
// EmailJS is a BROWSER SDK — it sends mail directly from the client
// using a public key (by design; that key isn't a secret the way a
// service-role key is). There is no way to call it from a Postgres
// trigger (no HTTP client in plpgsql here, and EmailJS doesn't offer a
// server-callable REST endpoint suited to this without its own paid
// backend features). So "send on booking creation/cancellation" is
// implemented as a plain function call made from NewBookingModal.jsx /
// EditBookingModal.jsx right after the insert/update succeeds — not a
// database trigger. Emails are fire-and-forget: a failure here is
// logged and surfaced softly, never blocks or unwinds an already-
// successful booking change.
//
// Requires real EmailJS account setup this codebase can't do for you
// (external SaaS, its own login) — see the 7 VITE_EMAILJS_* env vars
// below and the template variable names each function documents.
// Until those are set, every function here no-ops with a console.warn
// rather than throwing, so a booking still works with email
// notifications simply not configured yet.
//
// EmailJS's free tier caps outgoing mail at 200/month — sending one
// shared-sail notification per opted-in partner on every shared
// booking can add up fast with ~21 partners; worth knowing before
// relying on this at scale.
// =====================================================================

import emailjs from '@emailjs/browser';
import { bookingTypeLabelHe } from './bookingColors';

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
const TEMPLATE_BOOKING_CONFIRMATION = import.meta.env.VITE_EMAILJS_TEMPLATE_BOOKING_CONFIRMATION;
const TEMPLATE_SHARED_SAIL_NOTIFICATION = import.meta.env.VITE_EMAILJS_TEMPLATE_SHARED_SAIL_NOTIFICATION;
const TEMPLATE_CANCEL_SHARED_SAIL = import.meta.env.VITE_EMAILJS_TEMPLATE_CANCEL_SHARED_SAIL;
const TEMPLATE_MAINTENANCE_RESOLVED = import.meta.env.VITE_EMAILJS_TEMPLATE_MAINTENANCE_RESOLVED;
const TEMPLATE_VESSEL_GROUNDING = import.meta.env.VITE_EMAILJS_TEMPLATE_VESSEL_GROUNDING;

let hasWarnedMissingConfig = false;

function isConfigured() {
  const configured = Boolean(SERVICE_ID && PUBLIC_KEY);
  if (!configured && !hasWarnedMissingConfig) {
    hasWarnedMissingConfig = true;
    console.warn(
      'EmailJS is not configured (VITE_EMAILJS_SERVICE_ID / VITE_EMAILJS_PUBLIC_KEY missing) — email notifications are disabled. See .env.example.'
    );
  }
  return configured;
}

function formatIcsDate(date) {
  // YYYYMMDDTHHMMSSZ, per RFC 5545 — must be UTC ("Z" suffix).
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// A pre-filled Google Calendar "add event" link — works with zero
// setup on either end (no attachment support needed), which is why
// this is the primary "add to calendar" mechanism for these emails
// rather than a true .ics attachment (EmailJS attachments need their
// paid plan and a publicly hosted file URL per send, which this
// project has no server to provide).
export function buildGoogleCalendarLink({ title, description, startTime, endTime }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${formatIcsDate(new Date(startTime))}/${formatIcsDate(new Date(endTime))}`,
    details: description ?? '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Raw .ics content, in case it's ever wired into a "download calendar
// file" link elsewhere in the app (not currently attached to the
// EmailJS-sent mail itself — see the module header).
export function buildIcsContent({ title, description, startTime, endTime }) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SailShare//OBOR//HE',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@sailshare`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(new Date(startTime))}`,
    `DTEND:${formatIcsDate(new Date(endTime))}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${(description ?? '').replace(/\n/g, '\\n')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function formatHebrewDateTime(iso) {
  return new Date(iso).toLocaleString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Sends the booking-confirmation email to the organizer. No-ops
// silently (after one console.warn) if EmailJS isn't configured, or if
// the organizer has emails disabled — callers don't need to check
// either condition themselves.
//
// Template variables this expects to exist in your EmailJS template
// (VITE_EMAILJS_TEMPLATE_BOOKING_CONFIRMATION):
//   to_email, to_name, booking_type_label, start_time_he, end_time_he,
//   duration_hours, google_calendar_link
export async function sendBookingConfirmationEmail({ toEmail, toName, bookingType, startTime, endTime, emailsEnabled }) {
  if (!emailsEnabled || !toEmail) return;
  if (!isConfigured() || !TEMPLATE_BOOKING_CONFIRMATION) return;

  const durationHours = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 3_600_000);
  const bookingTypeLabel = bookingTypeLabelHe(bookingType);

  try {
    await emailjs.send(
      SERVICE_ID,
      TEMPLATE_BOOKING_CONFIRMATION,
      {
        to_email: toEmail,
        to_name: toName ?? toEmail,
        booking_type_label: bookingTypeLabel,
        start_time_he: formatHebrewDateTime(startTime),
        end_time_he: formatHebrewDateTime(endTime),
        duration_hours: durationHours,
        google_calendar_link: buildGoogleCalendarLink({
          title: `שיט: ${bookingTypeLabel}`,
          description: 'הפלגה שנקבעה במערכת OBOR',
          startTime,
          endTime,
        }),
      },
      { publicKey: PUBLIC_KEY }
    );
  } catch (err) {
    console.error('Failed to send booking confirmation email', err);
  }
}

// Sends the shared-sail notification to every recipient in the list,
// independently (EmailJS has no batch-send — one call per recipient),
// via Promise.allSettled so one failed address never blocks the rest.
// Callers are responsible for filtering the recipient list down to
// people who actually want mail — see NewBookingModal.jsx, which
// queries emails_enabled (and, for the "everyone else" audience,
// receive_shared_sail_notifications too).
//
// Template variables (VITE_EMAILJS_TEMPLATE_SHARED_SAIL_NOTIFICATION):
//   to_email, to_name, organizer_name, booking_type_label,
//   start_time_he, end_time_he, google_calendar_link
export async function sendSharedSailNotificationEmails({ recipients, organizerName, bookingType, startTime, endTime }) {
  if (!recipients?.length) return;
  if (!isConfigured() || !TEMPLATE_SHARED_SAIL_NOTIFICATION) return;

  const bookingTypeLabel = bookingTypeLabelHe(bookingType);
  const googleCalendarLink = buildGoogleCalendarLink({
    title: `שיט שותפים: ${bookingTypeLabel}`,
    description: `מפליג/ה: ${organizerName}`,
    startTime,
    endTime,
  });

  const results = await Promise.allSettled(
    recipients.map((r) =>
      emailjs.send(
        SERVICE_ID,
        TEMPLATE_SHARED_SAIL_NOTIFICATION,
        {
          to_email: r.email,
          to_name: r.name ?? r.email,
          organizer_name: organizerName,
          booking_type_label: bookingTypeLabel,
          start_time_he: formatHebrewDateTime(startTime),
          end_time_he: formatHebrewDateTime(endTime),
          google_calendar_link: googleCalendarLink,
        },
        { publicKey: PUBLIC_KEY }
      )
    )
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`Failed to send ${failures.length}/${recipients.length} shared-sail notification emails`, failures);
  }
}

// Same opted-in broadcast audience and shape as sendSharedSailNotification
// Emails above ("a shared sailing exists"), just the mirror-image event
// ("...and it no longer does") — see EditBookingModal.jsx's
// handleCancelSail, which fetches the recipient list the same way
// NewBookingModal.jsx does (emails_enabled + receive_shared_sail_
// notifications, excluding whoever triggered the cancellation).
//
// Template variables (VITE_EMAILJS_TEMPLATE_CANCEL_SHARED_SAIL):
//   to_email, to_name, organizer_name, booking_type_label,
//   start_time_he, end_time_he — no google_calendar_link here, there's
//   nothing left to add to a calendar for a cancelled sailing.
export async function sendCancelSharedSailNotificationEmails({ recipients, organizerName, bookingType, startTime, endTime }) {
  if (!recipients?.length) return;
  if (!isConfigured() || !TEMPLATE_CANCEL_SHARED_SAIL) return;

  const bookingTypeLabel = bookingTypeLabelHe(bookingType);

  const results = await Promise.allSettled(
    recipients.map((r) =>
      emailjs.send(
        SERVICE_ID,
        TEMPLATE_CANCEL_SHARED_SAIL,
        {
          to_email: r.email,
          to_name: r.name ?? r.email,
          organizer_name: organizerName,
          booking_type_label: bookingTypeLabel,
          start_time_he: formatHebrewDateTime(startTime),
          end_time_he: formatHebrewDateTime(endTime),
        },
        { publicKey: PUBLIC_KEY }
      )
    )
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`Failed to send ${failures.length}/${recipients.length} shared-sail cancellation emails`, failures);
  }
}

// Sent when a GROUNDING maintenance issue (maintenance_issues.is_grounding)
// is marked resolved — see MessagesPage.jsx's IssueCard.handleResolve,
// which fetches the recipient list the same way the shared-sail
// functions above do (emails_enabled + receive_critical_updates this
// time, instead of receive_shared_sail_notifications — a partner opts
// into critical/grounding updates separately from shared-sail chatter).
//
// status_message is passed as its own merge tag (fixed Hebrew text, not
// caller-configurable) so the template can use it directly without
// having to hardcode the exact wording itself.
//
// Template variables (VITE_EMAILJS_TEMPLATE_MAINTENANCE_RESOLVED):
//   to_email, to_name, status_message, summary, resolution_notes
export async function sendMaintenanceResolvedNotificationEmails({ recipients, summary, resolutionNotes }) {
  if (!recipients?.length) return;
  if (!isConfigured() || !TEMPLATE_MAINTENANCE_RESOLVED) return;

  const results = await Promise.allSettled(
    recipients.map((r) =>
      emailjs.send(
        SERVICE_ID,
        TEMPLATE_MAINTENANCE_RESOLVED,
        {
          to_email: r.email,
          to_name: r.name ?? r.email,
          status_message: 'התקלה נפתרה והיאכטה מוכנה לשימוש',
          summary,
          resolution_notes: resolutionNotes ?? '',
        },
        { publicKey: PUBLIC_KEY }
      )
    )
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`Failed to send ${failures.length}/${recipients.length} maintenance-resolved emails`, failures);
  }
}

// Opposite end of sendMaintenanceResolvedNotificationEmails above — sent
// the moment a NEW grounding issue is reported (is_grounding checked in
// MessagesPage.jsx's "דיווח תקלה חדשה" form), not when it's resolved.
// Same recipient audience (emails_enabled + receive_critical_updates).
//
// Template variables (VITE_EMAILJS_TEMPLATE_VESSEL_GROUNDING):
//   to_email, to_name, status_message, summary, description
export async function sendVesselGroundingAlertEmails({ recipients, summary, description }) {
  if (!recipients?.length) return;
  if (!isConfigured() || !TEMPLATE_VESSEL_GROUNDING) return;

  const results = await Promise.allSettled(
    recipients.map((r) =>
      emailjs.send(
        SERVICE_ID,
        TEMPLATE_VESSEL_GROUNDING,
        {
          to_email: r.email,
          to_name: r.name ?? r.email,
          status_message: 'היאכטה הושבתה עקב תקלה ואינה כשירה לשייט',
          summary,
          description: description ?? '',
        },
        { publicKey: PUBLIC_KEY }
      )
    )
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`Failed to send ${failures.length}/${recipients.length} vessel-grounding alert emails`, failures);
  }
}
