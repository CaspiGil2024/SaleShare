import { useEffect, useState } from 'react';
import WelcomeHeader from '../components/WelcomeHeader';
import QuickActions from '../components/QuickActions';
import SailingStatsChart from '../components/SailingStatsChart';
import KpiCards from '../components/KpiCards';
import WeatherWidget from '../components/WeatherWidget';
import AnnouncementsPanel from '../components/AnnouncementsPanel';
import NewBookingModal from '../components/NewBookingModal';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabaseClient';
import { mockKpiStats } from '../data/mockData';

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

  useEffect(() => {
    if (!currentUser?.id) return;
    let isCancelled = false;

    async function fetchWalletBalance() {
      // Ensures periods.is_current actually points at the real current
      // calendar quarter (and that this partner has a wallet row for
      // it, granted the 400-coin allowance) before reading it — without
      // this, whoever opens the dashboard first after a quarter rolls
      // over would see a stale prior-quarter balance until someone
      // happens to make a booking (the only other thing that calls
      // this). See 0014_coin_quota_system.sql.
      const { error: ensureError } = await supabase.rpc('ensure_current_quarter_period');
      if (ensureError) {
        console.error('Failed to ensure current quarter period', ensureError);
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

    fetchWalletBalance();

    return () => {
      isCancelled = true;
    };
  }, [currentUser?.id]);

  return (
    <div className="flex flex-col gap-6 p-6 bg-slate-50 min-h-screen">
      <WelcomeHeader currentUser={currentUser} />

      <QuickActions
        onAddBooking={() => setBookingRange(defaultBookingRange())}
        onDepartureChecklist={() => onNavigate?.('checklists')}
      />

      <WeatherWidget />

      <SailingStatsChart />

      <KpiCards stats={{ ...mockKpiStats, totalCoins: walletCoins }} />

      <AnnouncementsPanel />

      <NewBookingModal
        isOpen={bookingRange !== null}
        onClose={() => setBookingRange(null)}
        initialStart={bookingRange?.start}
        initialEnd={bookingRange?.end}
        currentUser={currentUser}
        onBookingCreated={() => setBookingRange(null)}
      />
    </div>
  );
}
