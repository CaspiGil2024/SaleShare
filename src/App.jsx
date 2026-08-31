import { useState } from 'react';
import { Menu } from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import Login from './pages/Login';
import ForcePasswordChange from './components/ForcePasswordChange';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import CalendarPage from './pages/CalendarPage';
import PartnersPage from './pages/PartnersPage';
import ImportantInfoPage from './pages/ImportantInfoPage';
import ChecklistsPage from './pages/ChecklistsPage';
import CoinsPage from './pages/CoinsPage';
import ReportsPage from './pages/ReportsPage';
import MaintenanceDataPage from './pages/MaintenanceDataPage';
import MessagesPage from './pages/MessagesPage';
import ParametersPage from './pages/ParametersPage';
import SailingLogPage from './pages/SailingLogPage';

function AuthenticatedApp() {
  const [active, setActive] = useState('dashboard');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const { currentUser, signOut } = useAuth();

  return (
    <div className="flex min-h-screen bg-slate-50" dir="rtl">
      <Sidebar
        active={active}
        onNavigate={setActive}
        user={currentUser}
        onSignOut={signOut}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />
      {/*
        min-w-0 is load-bearing, not decorative: without it a flex
        child defaults to min-width:auto, so a wide table inside (even
        one wrapped in its own overflow-x-auto, as every table in this
        app is) can force THIS whole column wider than the viewport
        instead of scrolling within its own wrapper — the classic
        flexbox mobile-overflow bug.
      */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
          <button
            type="button"
            onClick={() => setIsMobileNavOpen(true)}
            aria-label="פתיחת תפריט"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <Menu size={20} />
          </button>
          <span className="text-sm font-bold text-blue-900">OBOR</span>
          <span className="w-9" aria-hidden="true" />
        </header>
        <main className="flex-1 overflow-y-auto min-w-0">
          {active === 'dashboard' && <Dashboard onNavigate={setActive} />}
          {active === 'calendar' && <CalendarPage />}
          {active === 'partners' && <PartnersPage />}
          {active === 'info' && <ImportantInfoPage />}
          {active === 'checklists' && <ChecklistsPage />}
          {active === 'coins' && <CoinsPage />}
          {active === 'reports' && <ReportsPage />}
          {active === 'messages' && <MessagesPage />}
          {active === 'maintenance-data' && <MaintenanceDataPage />}
          {active === 'parameters' && <ParametersPage />}
          {active === 'sailing-log' && <SailingLogPage />}
        </main>
      </div>
    </div>
  );
}

function AppShell() {
  const { user, loading, currentUser, profileLoading } = useAuth();

  if (loading || (user && profileLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-400">
        Loading...
      </div>
    );
  }

  if (!user) return <Login />;
  if (currentUser?.must_change_password) return <ForcePasswordChange />;
  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
