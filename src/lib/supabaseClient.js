import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// createClient() throws synchronously on an empty/invalid URL, which
// would take down the whole app before React even renders (a blank
// white screen, not even the Login page). Fall back to a syntactically
// valid placeholder so the app still boots — every auth/data call will
// then fail as a normal network error, caught and shown inline by
// whichever component made the call.
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase env vars are missing (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). ' +
      'Copy .env.example to .env.local and fill in your project credentials — ' +
      'auth and data calls will fail until then.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);
