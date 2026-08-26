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
      return;
    }

    let isCancelled = false;
    supabase
      .from('users')
      .select('id, full_name, email, role')
      .eq('id', authUser.id)
      .single()
      .then(({ data, error }) => {
        if (isCancelled) return;
        if (error) {
          console.error('Failed to load user profile', error);
          setProfile(null);
          return;
        }
        setProfile(data);
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
        roles,
      }
    : null;

  const value = {
    session,
    user: authUser,
    currentUser,
    loading,
    signInWithPassword: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUpWithPassword: (email, password) => supabase.auth.signUp({ email, password }),
    signInWithGoogle: () =>
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      }),
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
