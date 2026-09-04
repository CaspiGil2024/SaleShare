// =====================================================================
// SailShare — Scenario A / Scenario B integration tests for the
// shared-sail coin engine (deferred settlement model — see
// supabase/migrations/0061_deferred_shared_sail_coin_settlement.sql)
// and organizer handover (0060_organizer_leave_reassigns_shared_
// booking.sql).
// =====================================================================
// REAL integration tests: they call the actual Postgres RPCs through
// supabase-js, signed in as real (freshly created) auth users, exactly
// as the app itself does — not a JS reimplementation of the coin math.
// The engine's source of truth lives entirely in SQL; a unit test that
// re-derived the formula in JS would only prove the JS copy agrees
// with itself; the point of this suite is to double as a spec against
// the actual server-side functions.
//
// MUST run against a LOCAL Supabase stack — see .env.test.example for
// setup (`supabase start`, then copy its printed URL/keys into
// `.env.test.local`). These tests create real auth users, real
// bookings, and directly rewrite bookings.start_time to force
// settlement without waiting in real time; never point them at a
// production project.
//
// Coin type picked per scenario keeps every other one of the 4 types
// untouched and easy to reason about: Scenario A's sail is 3 straight
// midweek-day hours (only coins_midweek_day ever moves), Scenario B's
// is 2 straight weekend-night hours (only coins_weekend_night moves).
// =====================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { formatCoinAmount } from '../src/lib/coinCalculator.js';

const SUPABASE_URL = process.env.SUPABASE_TEST_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

if (!ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing SUPABASE_TEST_ANON_KEY / SUPABASE_TEST_SERVICE_ROLE_KEY.\n' +
      'See .env.test.example — these tests need a local `supabase start` stack, never production.'
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TEST_PASSWORD = 'Sailshare-test-1!';

// ---------------------------------------------------------------------
// Asia/Jerusalem-local time helpers — every classification rule in
// this codebase (fn_classify_hours) buckets by local Jerusalem
// weekday/hour, so a test booking's UTC instant has to be computed
// with that in mind rather than assumed to line up with UTC weekdays.
// ---------------------------------------------------------------------
function jerusalemOffsetMinutes(utcDate) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(utcDate)
      .map((p) => [p.type, p.value])
  );
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return (asUtc - utcDate.getTime()) / 60000;
}

function jerusalemWallTimeToUtc(year, month, day, hour, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = jerusalemOffsetMinutes(new Date(guess));
  return new Date(guess - offset * 60000);
}

function jerusalemDow(utcDate) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(utcDate);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
}

// Next UTC instant, at least `minDaysAhead` from now, whose
// Asia/Jerusalem-local weekday/hour matches the target — used to pick
// a booking slot far enough out that the whole interactive test phase
// finishes before it's reached, then shifted a week into the past (see
// ONE_WEEK_MS usage below) to trigger settlement without waiting.
function nextJerusalemSlot(targetDow, hour, minDaysAhead) {
  const now = new Date();
  for (let d = minDaysAhead; d < minDaysAhead + 9; d++) {
    const probe = new Date(now.getTime() + d * 86400000);
    const slot = jerusalemWallTimeToUtc(probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate(), hour, 0);
    if (jerusalemDow(slot) === targetDow && slot.getTime() > now.getTime()) return slot;
  }
  throw new Error(`could not find a matching Jerusalem slot for dow=${targetDow} hour=${hour}`);
}

// ---------------------------------------------------------------------
// Test-partner helpers
// ---------------------------------------------------------------------
const createdUserIds = [];
const createdBookingIds = [];

async function createTestPartner(label) {
  const email = `sailshare-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (error) throw error;
  const userId = data.user.id;
  createdUserIds.push(userId);

  // handle_new_auth_user() (0003) auto-provisions public.users; set a
  // predictable name and make sure it's active (default is already
  // true, set explicitly so the test doesn't depend on that default).
  const { error: updateError } = await admin.from('users').update({ full_name: label, is_active: true, is_frozen: false }).eq('id', userId);
  if (updateError) throw updateError;

  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signInError) throw signInError;

  return { userId, email, client };
}

async function setWallet(userId, amount) {
  const { data: periodId, error: periodError } = await admin.rpc('ensure_current_period');
  if (periodError) throw periodError;
  const { error } = await admin.from('user_wallets').upsert(
    {
      user_id: userId,
      period_id: periodId,
      coins_weekend_day: amount,
      coins_weekend_night: amount,
      coins_midweek_day: amount,
      coins_midweek_night: amount,
    },
    { onConflict: 'user_id,period_id' }
  );
  if (error) throw error;
  return periodId;
}

async function getWallet(userId, periodId) {
  const { data, error } = await admin.from('user_wallets').select('*').eq('user_id', userId).eq('period_id', periodId).single();
  if (error) throw error;
  return data;
}

async function shiftBookingOneWeekIntoThePast(bookingId, start, end) {
  const pastStart = new Date(start.getTime() - ONE_WEEK_MS);
  const pastEnd = new Date(end.getTime() - ONE_WEEK_MS);
  const { error } = await admin
    .from('bookings')
    .update({ start_time: pastStart.toISOString(), end_time: pastEnd.toISOString() })
    .eq('id', bookingId);
  if (error) throw error;
}

// Force a booking's start/end to an absolute instant (used to place a
// sail inside the 24h §H window without waiting in real time).
async function setBookingWindow(bookingId, startMs, durationHours) {
  const { error } = await admin
    .from('bookings')
    .update({
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(startMs + durationHours * 3600000).toISOString(),
    })
    .eq('id', bookingId);
  if (error) throw error;
}

async function cleanupAll() {
  for (const id of createdBookingIds) {
    await admin.from('bookings').delete().eq('id', id);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

// =====================================================================
// Scenario A — midweek-day sail, dynamic guest changes
// =====================================================================
describe('Scenario A — midweek-day sail & dynamic guest changes', () => {
  let michael, uri, periodId, bookingId;
  // Tuesday 10:00 local, >= 2 days out; +3h keeps the whole booking
  // inside 08:00-20:00 (midweek day) with no weekend/night hours.
  const start = nextJerusalemSlot(2, 10, 2);
  const end = new Date(start.getTime() + 3 * 3600000);

  beforeAll(async () => {
    michael = await createTestPartner('scenario-a-michael');
    uri = await createTestPartner('scenario-a-uri');
    periodId = await setWallet(michael.userId, 40);
    await setWallet(uri.userId, 40);
  });

  afterAll(cleanupAll);

  it('Michael creates the sail — charged the full 3 midweek-day coins alone', async () => {
    const { data, error } = await michael.client.rpc('fn_create_shared_booking', {
      p_booking_type: 'Shared',
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_notes: null,
      p_participants: [{ user_id: michael.userId, guest_count: 2 }],
    });
    expect(error).toBeNull();
    bookingId = data;
    createdBookingIds.push(bookingId);

    const m = await getWallet(michael.userId, periodId);
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('37.00');
  });

  it('Uri joins with 3 guests — each charged the full price independently, Michael untouched', async () => {
    const { error } = await uri.client.rpc('fn_join_shared_booking', { p_booking_id: bookingId, p_guest_count: 3 });
    expect(error).toBeNull();

    const [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('37.00');
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('37.00');
  });

  it('Uri removes all guests — coin-neutral', async () => {
    const { error } = await uri.client.rpc('fn_update_my_shared_participation_guests', { p_booking_id: bookingId, p_guest_count: 0 });
    expect(error).toBeNull();

    const [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('37.00');
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('37.00');
  });

  it('Uri adds 1 guest — coin-neutral', async () => {
    const { error } = await uri.client.rpc('fn_update_my_shared_participation_guests', { p_booking_id: bookingId, p_guest_count: 1 });
    expect(error).toBeNull();

    const [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('37.00');
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('37.00');
  });

  it('sail time passes — settlement applies the true guest-weighted split (3:2 shares)', async () => {
    await shiftBookingOneWeekIntoThePast(bookingId, start, end);

    const { error } = await michael.client.rpc('fn_settle_due_shared_bookings');
    expect(error).toBeNull();

    const [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    // total_shares = (1+2) + (1+1) = 5; cost 3 coins split 3/5 : 2/5
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('38.20');
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('38.80');
  });
});

// =====================================================================
// Scenario B — weekend-night sail, capacity limits, organizer handover
// =====================================================================
describe('Scenario B — weekend-night sail, capacity limits & organizer handover', () => {
  let michael, uri, guy, periodId, bookingId;
  // Friday 22:00 local, >= 2 days out; +2h stays entirely within
  // Friday night (22:00-00:00) — weekend + night both hours.
  const start = nextJerusalemSlot(5, 22, 2);
  const end = new Date(start.getTime() + 2 * 3600000);

  beforeAll(async () => {
    michael = await createTestPartner('scenario-b-michael');
    uri = await createTestPartner('scenario-b-uri');
    guy = await createTestPartner('scenario-b-guy');
    periodId = await setWallet(michael.userId, 40);
    await setWallet(uri.userId, 40);
    await setWallet(guy.userId, 40);
  });

  afterAll(cleanupAll);

  it('Michael creates the sail — charged the full 2 weekend-night coins alone', async () => {
    const { data, error } = await michael.client.rpc('fn_create_shared_booking', {
      p_booking_type: 'Shared',
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_notes: null,
      p_participants: [{ user_id: michael.userId, guest_count: 1 }],
    });
    expect(error).toBeNull();
    bookingId = data;
    createdBookingIds.push(bookingId);

    const m = await getWallet(michael.userId, periodId);
    expect(formatCoinAmount(m.coins_weekend_night)).toBe('38.00');
  });

  it('Uri joins with 2 guests — charged independently, Michael untouched', async () => {
    const { error } = await uri.client.rpc('fn_join_shared_booking', { p_booking_id: bookingId, p_guest_count: 2 });
    expect(error).toBeNull();

    const [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    expect(formatCoinAmount(m.coins_weekend_night)).toBe('38.00');
    expect(formatCoinAmount(u.coins_weekend_night)).toBe('38.00');
  });

  it('Guy joins with 3 guests — charged independently, others untouched', async () => {
    const { error } = await guy.client.rpc('fn_join_shared_booking', { p_booking_id: bookingId, p_guest_count: 3 });
    expect(error).toBeNull();

    const [m, u, g] = await Promise.all([
      getWallet(michael.userId, periodId),
      getWallet(uri.userId, periodId),
      getWallet(guy.userId, periodId),
    ]);
    expect(formatCoinAmount(m.coins_weekend_night)).toBe('38.00');
    expect(formatCoinAmount(u.coins_weekend_night)).toBe('38.00');
    expect(formatCoinAmount(g.coins_weekend_night)).toBe('38.00');
  });

  it('Guy attempting a 4th guest is blocked by the capacity error, nothing changes', async () => {
    const { error } = await guy.client.rpc('fn_update_my_shared_participation_guests', { p_booking_id: bookingId, p_guest_count: 4 });
    expect(error).not.toBeNull();
    expect(error.message).toContain('עברת את כושר השיט - לא ניתן להוסיף אורחים');

    const [m, u, g] = await Promise.all([
      getWallet(michael.userId, periodId),
      getWallet(uri.userId, periodId),
      getWallet(guy.userId, periodId),
    ]);
    expect(formatCoinAmount(m.coins_weekend_night)).toBe('38.00');
    expect(formatCoinAmount(u.coins_weekend_night)).toBe('38.00');
    expect(formatCoinAmount(g.coins_weekend_night)).toBe('38.00');
  });

  it('Uri removes 2 guests — coin-neutral', async () => {
    const { error } = await uri.client.rpc('fn_update_my_shared_participation_guests', { p_booking_id: bookingId, p_guest_count: 0 });
    expect(error).toBeNull();

    const [m, u, g] = await Promise.all([
      getWallet(michael.userId, periodId),
      getWallet(uri.userId, periodId),
      getWallet(guy.userId, periodId),
    ]);
    expect(formatCoinAmount(m.coins_weekend_night)).toBe('38.00');
    expect(formatCoinAmount(u.coins_weekend_night)).toBe('38.00');
    expect(formatCoinAmount(g.coins_weekend_night)).toBe('38.00');
  });

  it('Michael leaves as organizer — sail survives, organizer role transfers to a remaining participant', async () => {
    const { data, error } = await michael.client.rpc('fn_organizer_leave_shared_booking', { p_booking_id: bookingId });
    expect(error).toBeNull();
    expect(data).toBe('reassigned');

    const { data: booking, error: fetchError } = await admin.from('bookings').select('user_id, status').eq('id', bookingId).single();
    expect(fetchError).toBeNull();
    expect(booking.status).not.toBe('Cancelled');
    expect([uri.userId, guy.userId]).toContain(booking.user_id);

    // Michael stepped down, but is still aboard as a full participant
    // (untouched guest_count/charge) — settlement below must still
    // deduct from his balance.
    const { data: michaelRow, error: rowError } = await admin
      .from('booking_participants')
      .select('user_id')
      .eq('booking_id', bookingId)
      .eq('user_id', michael.userId)
      .maybeSingle();
    expect(rowError).toBeNull();
    expect(michaelRow).not.toBeNull();
  });

  it('sail time passes — settlement applies the true guest-weighted split across all three, ex-organizer included (2:1:4 shares)', async () => {
    await shiftBookingOneWeekIntoThePast(bookingId, start, end);

    const { error } = await michael.client.rpc('fn_settle_due_shared_bookings');
    expect(error).toBeNull();

    const [m, u, g] = await Promise.all([
      getWallet(michael.userId, periodId),
      getWallet(uri.userId, periodId),
      getWallet(guy.userId, periodId),
    ]);
    // total_shares = (1+1) + (1+0) + (1+3) = 7; cost 2 coins split 2:1:4
    expect(formatCoinAmount(m.coins_weekend_night)).toBe('39.43'); // 40 - 4/7
    expect(formatCoinAmount(u.coins_weekend_night)).toBe('39.71'); // 40 - 2/7
    expect(formatCoinAmount(g.coins_weekend_night)).toBe('38.86'); // 40 - 8/7
  });
});

// =====================================================================
// Scenario C — reported-bug regressions:
//   #1 exact guest-weighted settlement split for Uri(+0) / Michael-
//      organizer(+1) on a 3-coin midweek-day sail  -> 2 : 1
//   #2/#3 a "deleted" sail stays deleted: after the organizer hands off,
//      the new organizer's fn_cancel_shared_booking really cancels
//      (no reassign-back "resurrection"), and a partner who stepped down
//      can no longer cancel it.
// =====================================================================
describe('Scenario C — settlement split & cancellation after handoff (bugs #1/#2/#3)', () => {
  let michael, uri, periodId, bookingId;
  const start = nextJerusalemSlot(3, 11, 2); // Wednesday 11:00 local, +3h => 3 midweek-day hours
  const end = new Date(start.getTime() + 3 * 3600000);

  beforeAll(async () => {
    michael = await createTestPartner('scenario-c-michael');
    uri = await createTestPartner('scenario-c-uri');
    periodId = await setWallet(michael.userId, 40);
    await setWallet(uri.userId, 40);
  });

  afterAll(cleanupAll);

  it('#1 — settlement splits 3 coins as 2 (Michael, +1 guest) : 1 (Uri, +0 guests)', async () => {
    const { data, error } = await michael.client.rpc('fn_create_shared_booking', {
      p_booking_type: 'Shared',
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_notes: null,
      p_participants: [{ user_id: michael.userId, guest_count: 1 }],
    });
    expect(error).toBeNull();
    bookingId = data;
    createdBookingIds.push(bookingId);

    const { error: joinError } = await uri.client.rpc('fn_join_shared_booking', {
      p_booking_id: bookingId,
      p_guest_count: 0,
    });
    expect(joinError).toBeNull();

    // Pre-settlement: each charged the full 3 independently.
    let [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('37.00');
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('37.00');

    await shiftBookingOneWeekIntoThePast(bookingId, start, end);
    const { error: settleError } = await michael.client.rpc('fn_settle_due_shared_bookings');
    expect(settleError).toBeNull();

    [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    // total_shares = (1+1) + (1+0) = 3; 3 coins split 2/3 : 1/3
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('38.00'); // 40 - 2
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('39.00'); // 40 - 1
  });

  it('#2/#3 — after Michael hands off, Uri can cancel for good and the ex-organizer cannot', async () => {
    const { data: freshId, error } = await michael.client.rpc('fn_create_shared_booking', {
      p_booking_type: 'Shared',
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_notes: null,
      p_participants: [{ user_id: michael.userId, guest_count: 1 }],
    });
    expect(error).toBeNull();
    createdBookingIds.push(freshId);

    await uri.client.rpc('fn_join_shared_booking', { p_booking_id: freshId, p_guest_count: 0 });

    const { data: handoff, error: handoffError } = await michael.client.rpc('fn_organizer_leave_shared_booking', {
      p_booking_id: freshId,
    });
    expect(handoffError).toBeNull();
    expect(handoff).toBe('reassigned');

    // Ex-organizer Michael is blocked from cancelling.
    const { error: deniedError } = await michael.client.rpc('fn_cancel_shared_booking', { p_booking_id: freshId });
    expect(deniedError).not.toBeNull();

    // Current organizer Uri really cancels — no reassignment back to Michael.
    const { error: cancelError } = await uri.client.rpc('fn_cancel_shared_booking', { p_booking_id: freshId });
    expect(cancelError).toBeNull();

    const { data: row } = await admin.from('bookings').select('status, user_id').eq('id', freshId).single();
    expect(row.status).toBe('Cancelled');
    expect(row.user_id).toBe(uri.userId); // stayed with Uri, did not resurrect to Michael

    // Settlement sweep leaves a cancelled sail alone.
    await shiftBookingOneWeekIntoThePast(freshId, start, end);
    const { error: settleError } = await uri.client.rpc('fn_settle_due_shared_bookings');
    expect(settleError).toBeNull();
    const { data: after } = await admin.from('bookings').select('status').eq('id', freshId).single();
    expect(after.status).toBe('Cancelled');
  });
});

// =====================================================================
// Scenario D — §H withdrawal rules (0063):
//   * MORE than 24h before start_time: leaving is a full refund of the
//     provisional flat charge, remaining partners untouched.
//   * LESS than 24h before start_time: the leaver is settled at their
//     guest-weighted share of the sail as it stood with them still on
//     it, then removed; remaining partners are NOT re-settled early —
//     they settle normally at sail time over the smaller roster.
// 3 straight midweek-day hours (only coins_midweek_day moves).
// =====================================================================
describe('Scenario D — §H: >24h leave = full refund, <24h leave = settled share', () => {
  let michael, uri, periodId, bookingId;
  const start = nextJerusalemSlot(4, 10, 3); // Thursday 10:00 local, +3h => 3 midweek-day hours
  const end = new Date(start.getTime() + 3 * 3600000);

  beforeAll(async () => {
    michael = await createTestPartner('scenario-d-michael');
    uri = await createTestPartner('scenario-d-uri');
    periodId = await setWallet(michael.userId, 40);
    await setWallet(uri.userId, 40);
  });

  afterAll(cleanupAll);

  it('Michael creates (+1 guest), Uri joins (+0) — each charged the full 3 independently', async () => {
    const { data, error } = await michael.client.rpc('fn_create_shared_booking', {
      p_booking_type: 'Shared',
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_notes: null,
      p_participants: [{ user_id: michael.userId, guest_count: 1 }],
    });
    expect(error).toBeNull();
    bookingId = data;
    createdBookingIds.push(bookingId);

    const { error: joinError } = await uri.client.rpc('fn_join_shared_booking', { p_booking_id: bookingId, p_guest_count: 0 });
    expect(joinError).toBeNull();

    const [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('37.00');
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('37.00');
  });

  it('>24h out — Uri leaves: fully refunded, Michael untouched', async () => {
    // start_time is still days away.
    const { error } = await uri.client.rpc('fn_leave_shared_booking', { p_booking_id: bookingId });
    expect(error).toBeNull();

    const [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('40.00'); // full refund
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('37.00'); // remaining partner untouched
  });

  it('<24h out — Uri re-joins then leaves: charged their 1/3 share, Michael untouched', async () => {
    const { error: rejoinError } = await uri.client.rpc('fn_join_shared_booking', { p_booking_id: bookingId, p_guest_count: 0 });
    expect(rejoinError).toBeNull();

    let [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('37.00'); // provisional full charge again

    // Slide the sail to ~2h from now — inside the 24h §H window, still future.
    await setBookingWindow(bookingId, Date.now() + 2 * 3600000, 3);

    const { error: leaveError } = await uri.client.rpc('fn_leave_shared_booking', { p_booking_id: bookingId });
    expect(leaveError).toBeNull();

    [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    // total_shares = (1+1) + (1+0) = 3; Uri's share = 1/3 of 3 coins = 1.
    // Uri: 37 -> +3 (delete-trigger refund) -> 40 -> -1 (share) => 39.
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('39.00');
    // Michael is NOT re-settled early.
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('37.00');
  });

  it('sail time passes — Michael settles solo (full 3), Uri already gone and untouched', async () => {
    await setBookingWindow(bookingId, Date.now() - 4 * 3600000, 3);
    const { error } = await michael.client.rpc('fn_settle_due_shared_bookings');
    expect(error).toBeNull();

    const [m, u] = await Promise.all([getWallet(michael.userId, periodId), getWallet(uri.userId, periodId)]);
    // Only Michael remains: share = (1+1)/(1+1) = 1 => full 3 coins.
    expect(formatCoinAmount(m.coins_midweek_day)).toBe('37.00'); // 40 - 3
    expect(formatCoinAmount(u.coins_midweek_day)).toBe('39.00'); // untouched by the sweep
  });
});
