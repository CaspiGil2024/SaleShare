// Placeholder data so the Dashboard/Calendar are demonstrable without
// full data wiring. The logged-in user now comes from AuthProvider's
// currentUser (real auth.users + public.users profile) instead of a
// mock — replace mockWallet/mockKpiStats/mockBookings with live
// Supabase queries (user_wallets, bookings, maintenance_issues,
// debts...) once that integration lands.

export const mockWallet = {
  coins_weekend_day: 14,
  coins_weekend_night: 6,
  coins_midweek_day: 22,
  coins_midweek_night: 9,
};

export const mockKpiStats = {
  totalCoins: 51,
  upcomingBookings: 3,
  openMaintenanceIssues: 0,
};

// Full partner roster (source: user-provided list, 2026-08-26). Kept as
// mock/UI data for now — see the accompanying migration discussion for
// why this hasn't been pushed into public.users/user_wallets yet.
export const mockPartners = [
  { id: 'p1', full_name: 'Adir Nulman', email: 'nulman.adr@gmail.com', phone: '053-2767969', roles: ['Lab Tester', 'Maintenance'], active: true, balance: 50 },
  { id: 'p2', full_name: 'Uri Ben David', email: 'uribd11@gmail.com', phone: '054-4497550', roles: ['Partner'], active: true, balance: 38 },
  { id: 'p3', full_name: 'Eyal Rashelbach', email: 'eyal.rashelbach@gmail.com', phone: '054-7750141', roles: ['Treasurer', 'Admin', 'Maintenance', 'Lab Tester'], active: true, balance: 88 },
  { id: 'p4', full_name: 'Eyal Adanya', email: 'eyal.adanya@gmail.com', phone: '054-4223272', roles: ['Partner'], active: true, balance: 30 },
  { id: 'p5', full_name: 'Elad Fahima', email: 'eladfh47@gmail.com', phone: '054-2133449', roles: ['Partner'], active: true, balance: 90 },
  { id: 'p6', full_name: 'Amnon Levy', email: 'levy.amnon@gmail.com', phone: '054-2476767', roles: ['Partner'], active: true, balance: 70 },
  { id: 'p7', full_name: 'Erez Shalev', email: 'erez7075@gmail.com', phone: '050-4343410', roles: ['Partner'], active: true, balance: 90 },
  { id: 'p8', full_name: 'Guy Natanson', email: 'guy.natanson@gmail.com', phone: '050-5885569', roles: ['Partner'], active: true, balance: 0 },
  { id: 'p9', full_name: 'Gil Caspi', email: 'caspigil@gmail.com', phone: '052-3844744', roles: ['Admin', 'Treasurer'], active: true, balance: 90 },
  { id: 'p10', full_name: 'David Kabas', email: 'kabas@netpath.co.il', phone: '052-3513478', roles: ['Partner'], active: true, balance: 90 },
  { id: 'p11', full_name: 'Dror Lederman', email: 'dror.lederman@gmail.com', phone: '050-2285052', roles: ['CEO', 'Admin'], active: true, balance: 90 },
  { id: 'p12', full_name: 'Dror (QA Mock Partner)', email: 'lederman.dror@gmail.com', phone: '050-2285052', roles: ['Partner (Test)'], active: true, balance: 85 },
  { id: 'p13', full_name: 'Zohar Ronen', email: 'mailzohar@gmail.com', phone: '052-4286520', roles: ['Partner'], active: true, balance: 45 },
  { id: 'p14', full_name: 'Igal Smadja', email: 'igalstar1@gmail.com', phone: '054-6098375', roles: ['Partner'], active: true, balance: 90 },
  { id: 'p15', full_name: 'Yossi Apelbaum', email: 'Yossound@gmail.com', phone: '052-5290669', roles: ['Partner'], active: true, balance: 86 },
  { id: 'p16', full_name: 'Michael Wexler', email: 'mwexler101@gmail.com', phone: '054-2993303', roles: ['Admin'], active: true, balance: 32 },
  { id: 'p17', full_name: 'Nir Engel', email: 'ariinpire@gmail.com', phone: '053-9822597', roles: ['Partner'], active: true, balance: 14 },
  { id: 'p18', full_name: 'Amer Yosri', email: 'Hason25@gmail.com', phone: '050-5355872', roles: ['Partner'], active: true, balance: 45 },
  { id: 'p19', full_name: 'Oded Gutentag', email: 'oded@bnc-il.com', phone: '054-3928909', roles: ['CEO', 'Admin'], active: true, balance: 158 },
  { id: 'p20', full_name: 'Einel Chaimovitz', email: 'Einel00h@gmail.com', phone: '052-9259933', roles: ['Partner'], active: true, balance: 0 },
  { id: 'p21', full_name: 'Pavel Razdoyolovsky', email: 'bugpwr@gmail.com', phone: '054-4818021', roles: ['Partner'], active: true, balance: 90 },
];

export const mockBookings = [
  {
    id: 'b1',
    title: 'גיל כספי',
    start: '2026-08-25T09:00:00',
    end: '2026-08-25T13:00:00',
    booking_type: 'Private',
  },
  {
    id: 'b2',
    title: 'דנה לוי',
    start: '2026-08-28T18:00:00',
    end: '2026-08-28T22:00:00',
    booking_type: 'Shared',
  },
  {
    id: 'b3',
    title: 'רועי אבן',
    start: '2026-08-30T10:00:00',
    end: '2026-08-31T02:00:00',
    booking_type: 'Dockside',
  },
];
