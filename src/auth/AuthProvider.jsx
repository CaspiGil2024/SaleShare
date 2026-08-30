import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext(undefined);

const ROLE_LABELS_HE = {
  admin: 'מנהל',
  treasurer: 'גזבר',
  partner: 'שותף',
};

export function roleLabelHe(role) {
  return ROLE_LABELS_HE[role] ?? role;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Initial session + subscribe to sign-in/sign-out/token-refresh events.
  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Once we know who's authenticated, load their public.users profile
  // row (full_name, role) — auth.users itself only has id/email.
  useEffect(() => {
    const authUser = session?.user;
    if (!authUser) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    let isCancelled = false;
    setProfileLoading(true);
    supabase
      .from('users')
      .select(
        'id, full_name, email, role, default_calendar_view, emails_enabled, receive_shared_sail_notifications, must_change_password'
      )
      .eq('id', authUser.id)
      .single()
      .then(({ data, error }) => {
        if (isCancelled) return;
        if (error) {
          console.error('Failed to load user profile', error);
          setProfile(null);
        } else {
          setProfile(data);
        }
        setProfileLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [session?.user?.id]);

  // profile.role only ever holds 'treasurer' or 'partner' (see
  // fn_apply_partner_roster) — it can't represent 'ceo'/'admin'/
  // 'maintenance'/'lab_tester', or more than one role per person. The
  // full picture lives in user_roles.
  useEffect(() => {
    const authUser = session?.user;
    if (!authUser) {
      setRoles([]);
      return;
    }

    let isCancelled = false;
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', authUser.id)
      .then(({ data, error }) => {
        if (isCancelled) return;
        if (error) {
          console.error('Failed to load user roles', error);
          setRoles([]);
          return;
        }
        setRoles(data.map((row) => row.role));
      });

    return () => {
      isCancelled = true;
    };
  }, [session?.user?.id]);

  const authUser = session?.user ?? null;

  // The shape every existing component (Sidebar, NewBookingModal, ...)
  // already expects: { id, full_name, email, ... }. id here is the
  // auth.users id, which is exactly what RLS's auth.uid() = user_id
  // checks against. `roles` is the full multi-role list from
  // user_roles (e.g. ['treasurer','admin']) — use this, not `role`,
  // for any permission check beyond the legacy treasurer/partner split.
  const currentUser = authUser
    ? {
        id: authUser.id,
        email: authUser.email,
        full_name: profile?.full_name ?? null,
        role: profile?.role ?? 'partner',
        default_calendar_view: profile?.default_calendar_view ?? 'week',
        emails_enabled: profile?.emails_enabled ?? false,
        receive_shared_sail_notifications: profile?.receive_shared_sail_notifications ?? false,
        must_change_password: profile?.must_change_password ?? false,
        roles,
      }
    : null;

  // Writes the preference AND updates local profile state immediately
  // — without this, currentUser.default_calendar_view would stay
  // stale (still the old value) until a full reload, since `profile`
  // is only fetched once per session on sign-in.
  async function updateDefaultCalendarView(view) {
    if (!authUser) return;
    const { error } = await supabase.from('users').update({ default_calendar_view: view }).eq('id', authUser.id);
    if (error) {
      console.error('Failed to save calendar view preference', error);
      return;
    }
    setProfile((prev) => (prev ? { ...prev, default_calendar_view: view } : prev));
  }

  // Used by the forced first-login password screen: sets a real,
  // partner-chosen password via Supabase Auth, then clears the
  // must_change_password gate so AppShell lets them into the app.
  // The two steps aren't atomic — if the flag update fails after the
  // password succeeded, the user just gets asked to change it again
  // next login, which is safe (no more than one extra prompt), unlike
  // failing open would be.
  async function changePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error };

    const { error: flagError } = await supabase
      .from('users')
      .update({ must_change_password: false })
      .eq('id', authUser.id);
    if (flagError) {
      console.error('Failed to clear must_change_password flag', flagError);
      return { error: flagError };
    }

    setProfile((prev) => (prev ? { ...prev, must_change_password: false } : prev));
    return { error: null };
  }

  const value = {
    session,
    updateDefaultCalendarView,
    changePassword,
    user: authUser,
    currentUser,
    loading,
    profileLoading,
    signInWithPassword: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    resetPassword: (email) =>
      supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
    signOut: () => supabase.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
