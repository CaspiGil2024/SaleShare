import { roleLabelHe } from '../auth/AuthProvider';

const ROLE_BADGE_STYLES = {
  admin: 'bg-blue-100 text-blue-700',
  treasurer: 'bg-emerald-100 text-emerald-700',
  partner: 'bg-emerald-100 text-emerald-700',
};

function RoleBadge({ role }) {
  if (!role) return null;
  const style = ROLE_BADGE_STYLES[role] ?? 'bg-white/20 text-white border border-white/30';
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${style}`}>
      {roleLabelHe(role)}
    </span>
  );
}

// "caspigil@gmail.com" -> "Caspigil". Used until the user's public.users
// row has a real full_name filled in (see AuthProvider) — a raw email
// in the greeting reads worse than a guessed first name.
function emailToDisplayName(email) {
  const localPart = (email ?? '').split('@')[0];
  if (!localPart) return '';
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

function getDisplayFirstName(currentUser) {
  if (currentUser?.full_name) {
    return currentUser.full_name.split(' ')[0];
  }
  if (currentUser?.email) {
    return emailToDisplayName(currentUser.email);
  }
  return 'גיל';
}

export default function WelcomeHeader({ currentUser }) {
  const firstName = getDisplayFirstName(currentUser);

  return (
    <div className="rounded-2xl bg-gradient-to-l from-blue-600 to-sky-500 px-6 py-6 sm:px-8 sm:py-8 shadow-sm">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xl sm:text-2xl font-bold text-white">שלום, {firstName}!</h2>
        <RoleBadge role={currentUser?.role} />
      </div>
      <p className="mt-2 text-sm text-blue-50/90">הנה מה שקורה על הסירה השבוע</p>
    </div>
  );
}
