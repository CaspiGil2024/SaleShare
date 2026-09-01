import { useState } from 'react';
import {
  Anchor,
  LayoutDashboard,
  Calendar,
  Coins,
  Users,
  Info,
  ListChecks,
  FileBarChart,
  DatabaseBackup,
  Settings,
  BookOpen,
  Bell,
  LogOut,
  X,
  HelpCircle,
  Sun,
  Moon,
} from 'lucide-react';
import { roleLabelHe } from '../auth/AuthProvider';
import { isAdminOrTreasurer } from '../lib/permissions';
import { useTheme } from '../theme/ThemeProvider';
import WhatsNewModal from './WhatsNewModal';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'לוח בקרה', icon: LayoutDashboard },
  { key: 'calendar', label: 'יומן', icon: Calendar },
  { key: 'coins', label: 'מטבעות', icon: Coins },
  { key: 'partners', label: 'שותפים', icon: Users },
  { key: 'info', label: 'מידע חשוב', icon: Info },
  { key: 'checklists', label: "צ'קליסטים", icon: ListChecks },
  { key: 'reports', label: 'דוחות', icon: FileBarChart },
  // Universal access, same as reports — every partner should see and
  // use this, not just managers.
  { key: 'sailing-log', label: 'יומן הפלגות', icon: BookOpen },
  // System messages + maintenance-fault reports — split out of
  // "תחזוקה ונתונים" into their own top-level section.
  { key: 'messages', label: 'הודעות', icon: Bell },
  { key: 'maintenance-data', label: 'תחזוקה ונתונים', icon: DatabaseBackup },
  // Parameters is admin/treasurer-only (0024) — filtered into the
  // rendered list below rather than removed from this array outright,
  // so adding another gated item later follows the same pattern.
  { key: 'parameters', label: 'פרמטרים', icon: Settings, managementOnly: true },
];

// Sun/moon toggle — flips the whole app's saved theme (ThemeProvider,
// persisted to localStorage). Icon shows the mode a click will switch
// TO (moon while light, sun while dark), matching the usual convention
// for this kind of control.
function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? 'מעבר למצב יום' : 'מעבר למצב לילה'}
      aria-label={isDark ? 'מעבר למצב יום' : 'מעבר למצב לילה'}
      className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-300"
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function UserProfile({ user, onSignOut }) {
  const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
  const displayName = user.full_name ?? user.email;
  const initials = displayName
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <>
      <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 transition-colors duration-300">
        <div className="w-10 h-10 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{displayName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{roleLabelHe(user.role)}</p>
        </div>
        <ThemeToggleButton />
        <button
          type="button"
          onClick={() => setIsWhatsNewOpen(true)}
          title="מה חדש?"
          aria-label="מה חדש?"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <HelpCircle size={16} />
        </button>
        <button
          type="button"
          onClick={onSignOut}
          title="התנתקות"
          aria-label="התנתקות"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <LogOut size={16} />
        </button>
      </div>

      <WhatsNewModal isOpen={isWhatsNewOpen} onClose={() => setIsWhatsNewOpen(false)} />
    </>
  );
}

// Shared between the always-visible desktop rail and the mobile
// off-canvas drawer below, so nav items/branding never drift between
// the two — only the outer wrapper (fixed drawer vs. static column)
// differs per breakpoint.
function SidebarContent({ active, onNavigate, user, onSignOut }) {
  return (
    <>
      <div className="px-5 py-6 border-b border-slate-100 dark:border-slate-800 flex flex-col items-center text-center transition-colors duration-300">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-700 to-blue-900 flex items-center justify-center shadow-sm">
          <Anchor size={24} className="text-white" strokeWidth={2.25} />
        </div>
        <p className="mt-2 text-lg font-extrabold tracking-tight text-blue-900 dark:text-blue-300">OBOR</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">שיט משותף</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.filter((item) => !item.managementOnly || isAdminOrTreasurer(user)).map((item) => {
          const isActive = active === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              className={`w-full flex items-center gap-3 text-start px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-300 ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon size={18} className={isActive ? 'text-blue-600 dark:text-blue-300' : 'text-slate-400 dark:text-slate-500'} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-100 dark:border-slate-800 transition-colors duration-300">
        <UserProfile user={user} onSignOut={onSignOut} />
      </div>
    </>
  );
}

// isMobileOpen/onCloseMobile are undefined-safe (default to closed/no-op)
// so any existing caller that doesn't pass them still renders the
// desktop rail correctly with no mobile drawer ever shown.
export default function Sidebar({ active, onNavigate, user, onSignOut, isMobileOpen = false, onCloseMobile }) {
  function handleNavigate(key) {
    onNavigate(key);
    onCloseMobile?.();
  }

  return (
    <>
      {/* Desktop / tablet: unchanged always-visible column. pb-16 keeps
          the bottom user/logout row clear of Netlify's "Powered by
          Netlify" badge, which floats fixed over the page's bottom
          corner and was sitting directly on top of it otherwise. */}
      <aside className="hidden md:flex w-64 shrink-0 h-screen sticky top-0 bg-white dark:bg-slate-900 border-s border-slate-200 dark:border-slate-800 flex-col pb-16 transition-colors duration-300">
        <SidebarContent active={active} onNavigate={handleNavigate} user={user} onSignOut={onSignOut} />
      </aside>

      {/* Mobile: off-canvas drawer, opened via the hamburger button in
          App.jsx's mobile top bar. Only mounted while open, so it never
          affects layout/tab order when closed. */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={onCloseMobile} />
          {/*
            start-0, not end-0: this app is RTL (dir="rtl" at the App
            root), where CSS logical "end" resolves to the LEFT edge —
            the drawer was opening on the wrong side. "start" is the
            right edge in RTL, matching the desktop rail's own
            placement (border-s further down = border on the right).
          */}
          <aside className="absolute inset-y-0 start-0 w-72 max-w-[85vw] bg-white dark:bg-slate-900 border-e border-slate-200 dark:border-slate-800 flex flex-col shadow-xl pb-16 transition-colors duration-300">
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="סגירת תפריט"
              className="absolute top-3 start-3 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X size={18} />
            </button>
            <SidebarContent active={active} onNavigate={handleNavigate} user={user} onSignOut={onSignOut} />
          </aside>
        </div>
      )}
    </>
  );
}
