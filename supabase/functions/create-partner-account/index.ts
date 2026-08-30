// SailShare — create-partner-account Edge Function
// =====================================================================
// Creates a real Supabase Auth login for a partner that's already been
// staged in partner_roster (see AddPartnerModal.jsx). This can't be
// done from the browser: creating an auth user needs the Admin API,
// which needs the service-role key — a key that must never reach
// client code. Edge Functions run server-side with that key available
// automatically (SUPABASE_SERVICE_ROLE_KEY), so this is the one place
// in the project that's actually allowed to do it.
//
// NOT auto-deployed — Claude Code can write this file but has no way
// to run `supabase functions deploy` against your project. Until you
// deploy it, AddPartnerModal's call to this function simply fails
// (caught, non-fatal) and falls back to the existing manual flow:
// create the account via Supabase Dashboard -> Authentication -> Add
// User, then run scripts/provision-phone-passwords.sql.
//
// To deploy: `supabase functions deploy create-partner-account`
// (requires the Supabase CLI, logged in and linked to this project).
// Leave JWT verification ON (the default) — this function also does
// its own can_edit_partners()/is_admin() check below, but that's
// defense in depth, not a replacement for requiring a logged-in caller
// at all.
//
// Password convention matches scripts/provision-phone-passwords.sql
// exactly: the partner's own phone number, cleaned of dashes/spaces
// and the +972/972 country code, e.g. '054-7750141' -> '0547750141'.
// must_change_password is set on their new public.users row so the
// app forces a real password on first login (see ForcePasswordChange.jsx).
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

function cleanPhoneAsPassword(phone: string): string {
  return phone
    .replace(/[-\s]/g, '')
    .replace(/^\+?972/, '0')
    .replace(/\D/g, '');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  // Caller-scoped client (their own JWT, respects RLS) — used ONLY to
  // verify they're actually allowed to add a partner, mirroring
  // partner_roster's own INSERT policy (can_edit_partners() OR
  // is_admin(), see 0007/0015_partner_freeze_and_delete_gates.sql).
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser();
  if (!caller) {
    return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), { status: 401 });
  }

  const { data: canEdit } = await callerClient.rpc('can_edit_partners');
  const { data: isAdmin } = await callerClient.rpc('is_admin');
  if (!canEdit && !isAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Not authorized to add partners' }), { status: 403 });
  }

  let body: { email?: string; full_name?: string; phone?: string | null };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid request body' }), { status: 400 });
  }

  const email = body.email?.trim();
  const fullName = body.full_name?.trim();
  const phone = body.phone?.trim();

  if (!email || !fullName) {
    return new Response(JSON.stringify({ ok: false, error: 'email and full_name are required' }), { status: 400 });
  }
  if (!phone) {
    return new Response(
      JSON.stringify({ ok: false, error: 'A phone number is required to set the temporary password' }),
      { status: 400 }
    );
  }

  const password = cleanPhoneAsPassword(phone);
  if (password.length < 6) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Cleaned phone number is too short to use as a password' }),
      { status: 400 }
    );
  }

  // Service-role client — bypasses RLS, has Admin API access. Only
  // ever used for this one createUser call plus the immediate
  // must_change_password follow-up, never returned to the client.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created?.user) {
    return new Response(JSON.stringify({ ok: false, error: createError?.message ?? 'Failed to create user' }), {
      status: 400,
    });
  }

  // handle_new_auth_user (0004) fires synchronously on the auth.users
  // insert above and already creates the public.users row (+ applies
  // partner_roster via fn_apply_partner_roster) before createUser
  // returns — safe to update it immediately.
  const { error: flagError } = await adminClient
    .from('users')
    .update({ must_change_password: true })
    .eq('id', created.user.id);

  if (flagError) {
    // Account exists and can log in either way — this only means they
    // won't be forced through the change-password screen, not fatal.
    console.error('Failed to set must_change_password', flagError);
  }

  return new Response(JSON.stringify({ ok: true, user_id: created.user.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
