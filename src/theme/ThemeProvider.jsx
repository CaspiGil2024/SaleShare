import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(undefined);

const STORAGE_KEY = 'sailshare-theme';

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // No saved preference yet — fall back to the OS setting once, but
  // from here on the user's own toggle always wins (see darkMode:
  // 'class' in tailwind.config.js — this app never re-reads the OS
  // preference after the first visit, so it can't silently flip under
  // a saved choice).
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Foundation pass (2026-09-02): applies to the app shell/sidebar chrome
// only — most page content (tables, cards, forms across 40+ files) is
// still hardcoded light-mode Tailwind classes and doesn't react to this
// yet. Extending dark: variants to individual pages is a follow-up, not
// done here (see PR discussion / CHANGELOG.md).
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
