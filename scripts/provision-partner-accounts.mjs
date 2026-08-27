// =====================================================================
// SailShare — one-off: auto-provision real accounts for every
// partner_roster member who doesn't have one yet, using their phone
// number (digits only) as the password.
// =====================================================================
//
// !! DANGER — SERVICE ROLE KEY !!
// This script needs your Supabase project's SERVICE ROLE key, which
// bypasses every RLS policy in the database and has full admin access
// to auth and every table. Treat it like a root password:
//   - NEVER put it in .env.local or anything Vite loads. Anything
//     prefixed VITE_ gets bundled into the public client JS — but even
//     unprefixed, .env.local is the wrong place for this, since it's
//     meant for values that end up in a browser bundle.
//   - NEVER commit it, paste it into chat, or leave it in shell
//     history longer than necessary.
//   - Pass it as a one-off environment variable when you run this
//     script, from a terminal, on your own machine — see "Usage" below.
//
// What this does:
//   1. Reads every row from public.partner_roster (this requires the
//      service role key — that table is normally treasurer/manager-only
//      under RLS).
//   2. Skips anyone who already has a public.users row (already has a
//      real account — re-running this is safe).
//   3. For everyone else, creates a real Supabase Auth account via the
//      Admin API: email_confirm:true (no confirmation email sent — no
//      manual invites, per the request this was built for), password =
//      their phone number with all non-digit characters stripped, e.g.
//      hyphens (see src/lib/phonePassword.js, imported directly below
//      rather than re-implemented here so there's only one place this
//      logic lives).
//   4. The existing handle_new_auth_user trigger fires automatically on
//      account creation (it's a real INSERT into auth.users under the
//      hood), so public.users / user_wallets / user_roles and the
//      roster-data sync all happen on their own — nothing else to do
//      here.
//
// Usage (PowerShell):
//   $env:SUPABASE_URL="https://xxxx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="ey..."
//   node scripts/provision-partner-accounts.mjs
//
// Usage (bash):
//   SUPABASE_URL="https://xxxx.supabase.co" SUPABASE_SERVICE_ROLE_KEY="ey..." \
//     node scripts/provision-partner-accounts.mjs
//
// Run from the project root (needs @supabase/supabase-js, already a
// project dependency).
// =====================================================================

import { createClient } from '@supabase/supabase-js';
import { phoneToPassword } from '../src/lib/phonePassword.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables before running this.');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MIN_PASSWORD_LENGTH = 6; // Supabase Auth's default minimum

async function main() {
  const { data: roster, error: rosterError } = await supabaseAdmin
    .from('partner_roster')
    .select('email, full_name, phone')
    .order('full_name');
  if (rosterError) {
    console.error('Failed to read partner_roster:', rosterError.message);
    process.exit(1);
  }

  const { data: existingUsers, error: usersError } = await supabaseAdmin.from('users').select('email');
  if (usersError) {
    console.error('Failed to read public.users:', usersError.message);
    process.exit(1);
  }
  const existingEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const partner of roster) {
    const emailKey = partner.email.toLowerCase();

    if (existingEmails.has(emailKey)) {
      console.log(`skip (already has an account): ${partner.full_name} <${partner.email}>`);
      skipped++;
      continue;
    }
    if (!partner.phone) {
      console.warn(`skip (no phone on file, can't derive a password): ${partner.full_name} <${partner.email}>`);
      skipped++;
      continue;
    }

    const password = phoneToPassword(partner.phone);
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.warn(
        `skip (phone-derived password "${password}" is under Supabase's ${MIN_PASSWORD_LENGTH}-char minimum): ${partner.full_name} <${partner.email}>`
      );
      skipped++;
      continue;
    }

    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: partner.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: partner.full_name },
    });

    if (createError) {
      console.error(`FAILED: ${partner.full_name} <${partner.email}> — ${createError.message}`);
      failed++;
    } else {
      console.log(`created: ${partner.full_name} <${partner.email}>`);
      created++;
    }
  }

  console.log(`\nDone. created=${created} skipped=${skipped} failed=${failed}`);
}

main();
