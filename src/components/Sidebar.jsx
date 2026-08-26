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
  LogOut,
  X,
} from 'lucide-react';
import { roleLabelHe } from '../auth/AuthProvider';
import { isAdminOrTreasurer } from '../lib/permissions';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'לוח בקרה', icon: LayoutDashboard },
  { key: 'calendar', label: 'יומן', icon: Calendar },
  { key: 'coins', label: 'מטבעות', icon: Coins },
  { key: 'partners', label: 'שותפים', icon: Users },
  { key: 'info', label: 'מידע חשוב', icon: Info },
  { key: 'checklists', label: "צ'קליסטים", icon: ListChecks },
  { key: 'reports', label: 'דוחות', icon: FileBarChart },
  { key: 'maintenance-data', label: 'תחזוקה ונתונים', icon: DatabaseBackup },
  // Parameters is admin/treasurer-only (0024) — filtered into the
  // rendered list below rather than removed from this array outright,
  // so adding another gated item later follows the same pattern.
  { key: 'parameters', label: 'פרמטרים', icon: Settings, managementOnly: true },
];

function UserProfile({ user, onSignOut }) {
  const displayName = user.full_name ?? user.email;
  const initials = displayName
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-50">
      <div className="w-10 h-10 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 truncate">{displayName}</p>
        <p className="text-xs text-slate-500 truncate">{roleLabelHe(user.role)}</p>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        title="התנתקות"
        aria-label="התנתקות"
        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-600"
      >
        <LogOut size={16} />
      </button>
    </div>
  );
}

// Shared between the always-visible desktop rail and the mobile
// off-canvas drawer below, so nav items/branding never drift between
// the two — only the outer wrapper (fixed drawer vs. static column)
// differs per breakpoint.
function SidebarContent({ active, onNavigate, user, onSignOut }) {
  return (
    <>
      <div className="px-5 py-6 border-b border-slate-100 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-700 to-blue-900 flex items-center justify-center shadow-sm">
          <Anchor size={24} className="text-white" strokeWidth={2.25} />
        </div>
        <p className="mt-2 text-lg font-extrabold tracking-tight text-blue-900">OBOR</p>
        <p className="text-xs text-slate-400 mt-1">שיט משותף בשיטת מיכאל</p>
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
              className={`w-full flex items-center gap-3 text-start px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon size={18} className={isActive ? 'text-blue-600' : 'text-slate-400'} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-100">
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
      {/* Desktop / tablet: unchanged always-visible column. */}
      <aside className="hidden md:flex w-64 shrink-0 h-screen sticky top-0 bg-white border-s border-slate-200 flex-col">
        <SidebarContent active={active} onNavigate={handleNavigate} user={user} onSignOut={onSignOut} />
      </aside>

      {/* Mobile: off-canvas drawer, opened via the hamburger button in
          App.jsx's mobile top bar. Only mounted while open, so it never
          affects layout/tab order when closed. */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={onCloseMobile} />
          <aside className="absolute inset-y-0 end-0 w-72 max-w-[85vw] bg-white border-s border-slate-200 flex flex-col shadow-xl">
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="סגירת תפריט"
              className="absolute top-3 start-3 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
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
