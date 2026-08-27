import { useEffect, useState } from 'react';
import WelcomeHeader from '../components/WelcomeHeader';
import SystemNoticesBanner from '../components/SystemNoticesBanner';
import QuickActions from '../components/QuickActions';
import SailingStatsChart from '../components/SailingStatsChart';
import KpiCards from '../components/KpiCards';
import WeatherWidget from '../components/WeatherWidget';
import NewBookingModal from '../components/NewBookingModal';
import CoinBreakdownModal from '../components/CoinBreakdownModal';
import UpcomingSailingsModal from '../components/UpcomingSailingsModal';
import OpenMaintenanceIssuesModal from '../components/OpenMaintenanceIssuesModal';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabaseClient';

function defaultBookingRange() {
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  return { start, end };
}

export default function Dashboard({ onNavigate }) {
  const { currentUser } = useAuth();

  // null = modal closed. Computed once, at click time, so re-renders
  // while the modal is open don't hand NewBookingModal a fresh Date
  // reference each time (that would re-trigger its reset effect and
  // wipe whatever the user already typed).
  const [bookingRange, setBookingRange] = useState(null);
  const [walletCoins, setWalletCoins] = useState(null); // null while loading — KpiCards shows '—' until then
  const [upcomingCount, setUpcomingCount] = useState(null);
  const [openIssuesCount, setOpenIssuesCount] = useState(null);
  const [openModal, setOpenModal] = useState(null); // null | 'totalCoins' | 'upcomingBookings' | 'openMaintenanceIssues'

  useEffect(() => {
    if (!currentUser?.id) return;
    let isCancelled = false;

    async function fetchWalletBalance() {
      // Ensures periods.is_current actually points at the real current
      // 20-week period (and that this partner has a wallet row for it,
      // granted its allocation) before reading it — without this,
      // whoever opens the dashboard first after a period rolls over
      // would see a stale prior-period balance until someone happens
      // to make a booking (the only other thing that calls this). See
      // 0021/0024_michael_method_*.sql.
      const { error: ensureError } = await supabase.rpc('ensure_current_period');
      if (ensureError) {
        console.error('Failed to ensure current period', ensureError);
      }

      const { data: period } = await supabase
        .from('periods')
        .select('id')
        .eq('is_current', true)
        .limit(1)
        .maybeSingle();

      if (!period) {
        if (!isCancelled) setWalletCoins(0);
        return;
      }

      const { data: wallet, error } = await supabase
        .from('user_wallets')
        .select('coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night')
        .eq('user_id', currentUser.id)
        .eq('period_id', period.id)
        .maybeSingle();

      if (isCancelled) return;

      if (error || !wallet) {
        console.error('Failed to load wallet balance', error);
        setWalletCoins(0);
        return;
      }

      setWalletCoins(
        wallet.coins_weekend_day + wallet.coins_weekend_night + wallet.coins_midweek_day + wallet.coins_midweek_night
      );
    }

    async function fetchKpiCounts() {
      const [{ count: bookingsCount, error: bookingsError }, { count: issuesCount, error: issuesError }] =
        await Promise.all([
          supabase
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .neq('status', 'Cancelled')
            .gte('start_time', new Date().toISOString()),
          supabase.from('maintenance_issues').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        ]);

      if (isCancelled) return;
      if (bookingsError) console.error('Failed to count upcoming bookings', bookingsError);
      else setUpcomingCount(bookingsCount ?? 0);

      if (issuesError) console.error('Failed to count open maintenance issues', issuesError);
      else setOpenIssuesCount(issuesCount ?? 0);
    }

    fetchWalletBalance();
    fetchKpiCounts();

    return () => {
      isCancelled = true;
    };
  }, [currentUser?.id]);

  return (
    <div className="flex flex-col gap-6 p-6 bg-slate-50 min-h-screen">
      <WelcomeHeader currentUser={currentUser} />

      <SystemNoticesBanner />

      <QuickActions
        onAddBooking={() => setBookingRange(defaultBookingRange())}
        onDepartureChecklist={() => onNavigate?.('checklists')}
      />

      <WeatherWidget />

      <SailingStatsChart onClick={() => onNavigate?.('calendar')} />

      <KpiCards
        stats={{ totalCoins: walletCoins, upcomingBookings: upcomingCount, openMaintenanceIssues: openIssuesCount }}
        onCardClick={setOpenModal}
      />

      <NewBookingModal
        isOpen={bookingRange !== null}
        onClose={() => setBookingRange(null)}
        initialStart={bookingRange?.start}
        initialEnd={bookingRange?.end}
        currentUser={currentUser}
        onBookingCreated={() => setBookingRange(null)}
      />

      <CoinBreakdownModal
        isOpen={openModal === 'totalCoins'}
        onClose={() => setOpenModal(null)}
        currentUser={currentUser}
      />
      <UpcomingSailingsModal isOpen={openModal === 'upcomingBookings'} onClose={() => setOpenModal(null)} />
      <OpenMaintenanceIssuesModal
        isOpen={openModal === 'openMaintenanceIssues'}
        onClose={() => setOpenModal(null)}
      />
    </div>
  );
}
