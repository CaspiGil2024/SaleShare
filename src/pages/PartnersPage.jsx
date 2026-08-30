import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Phone,
  Mail,
  MoreVertical,
  Pencil,
  History,
  KeyRound,
  Snowflake,
  Archive,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { roleLabelHe } from '../lib/partnerRoles';
import { isManager, isAdminOrTreasurer, isAdminRole, canSeePartnerManagementMenu } from '../lib/permissions';
import EditPartnerModal from '../components/EditPartnerModal';
import AddPartnerModal from '../components/AddPartnerModal';
import BookingHistoryModal from '../components/BookingHistoryModal';
import ChangePasswordModal from '../components/ChangePasswordModal';

// Per-item role gate (2026-08-26 rule). Deliberately narrower/different
// from the general isManager() set used to edit a partner's ordinary
// fields — Freeze/Soft-Delete require admin/treasurer/sailing_officer
// (isAdminOrTreasurer; 0047 gave sailing_officer full admin parity),
// Hard-Delete requires admin/sailing_officer only (isAdminRole) — ceo
// and maintenance pass the broader isManager() set but not this one.
// The real enforcement is server-side (0015_partner_freeze_and_delete_gates.sql
// — RLS + a trigger that raises a real exception on the wrong role, so
// a UI mismatch here would surface as a loud error, not a silent
// no-op). isSelf items ignore role entirely — self-service only.
function buildMenuItems({ isSelf, canEditGeneral, canFreezeOrSoftDelete, canHardDelete }) {
  const items = [];
  if (canEditGeneral) {
    items.push({ key: 'edit', label: 'עריכה', icon: Pencil });
  }
  items.push({ key: 'order_history', label: 'היסטוריית הזמנות', icon: History });
  if (isSelf) {
    items.push({ key: 'change_password', label: 'שינוי סיסמה', icon: KeyRound });
  }
  if (canFreezeOrSoftDelete) {
    items.push({ key: 'freeze', label: 'הקפאה', icon: Snowflake });
    items.push({ key: 'soft_delete', label: 'מחיקה רכה', icon: Archive });
  }
  if (canHardDelete) {
    items.push({ key: 'hard_delete', label: 'מחיקה לצמיתות', icon: Trash2, destructive: true });
  }
  return items;
}

function RowActionsMenu({
  partner,
  currentUser,
  onEdit,
  onOrderHistory,
  onChangePassword,
  onFreeze,
  onSoftDelete,
  onHardDelete,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const isSelf = partner.email?.toLowerCase() === currentUser?.email?.toLowerCase();
  const canEditGeneral = isManager(currentUser);
  // Freeze/soft-delete write to partner_roster by email — meaningless
  // (and would silently no-op) for an orphan account that has no
  // roster row at all (see fetchPartners below). Hard-delete DOES
  // apply to orphans too, just via a different RPC for that case
  // (fn_admin_hard_delete_orphan_user, 0049) — handleHardDelete
  // branches on partner.inRoster to pick the right one.
  const canFreezeOrSoftDelete = isAdminOrTreasurer(currentUser) && partner.inRoster;
  const canHardDelete = isAdminRole(currentUser);
  const menuItems = buildMenuItems({ isSelf, canEditGeneral, canFreezeOrSoftDelete, canHardDelete });

  const MENU_WIDTH = 192; // w-48

  // Rendered via a portal into document.body (see below) rather than
  // as a normally-positioned absolute child — this table sits inside
  // an overflow-x-auto wrapper (needed for horizontal scroll on
  // narrow screens), and an absolutely-positioned popover nested
  // inside an overflow:auto/hidden ancestor gets CLIPPED by that
  // ancestor regardless of z-index. Computing fixed (viewport-relative)
  // coordinates from the button's own bounding rect sidesteps that
  // entirely, and also fixes the menu rendering misaligned near the
  // table's edges.
  function openMenu() {
    const rect = buttonRef.current.getBoundingClientRect();
    let left = rect.right - MENU_WIDTH; // align menu's end with the button's end (natural RTL placement)
    left = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));
    setMenuPosition({ top: rect.bottom + 4, left });
    setIsOpen(true);
  }

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e) {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target) &&
        menuRef.current &&
        !menuRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    function handleReposition() {
      setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    // capture:true so this also fires for scroll on the table's own
    // overflow-x-auto container, not just window-level scrolling —
    // scroll events don't bubble, but capture-phase listeners on
    // window still see them from any descendant.
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [isOpen]);

  // The menu itself still renders if there's at least ONE item this
  // viewer can use (self-service change-password included) — even a
  // plain partner with no management role sees a menu on their OWN row.
  if (menuItems.length === 0) return null;

  function handleAction(actionKey) {
    setIsOpen(false);

    if (actionKey === 'edit') {
      onEdit(partner);
      return;
    }
    if (actionKey === 'order_history') {
      onOrderHistory(partner);
      return;
    }
    if (actionKey === 'change_password') {
      onChangePassword(partner);
      return;
    }
    if (actionKey === 'freeze') {
      const verb = partner.is_frozen ? 'לבטל את ההקפאה של' : 'להקפיא את';
      if (window.confirm(`${verb} ${partner.full_name}? שותף מוקפא לא יוכל ליצור או להצטרף להזמנות.`)) {
        onFreeze(partner);
      }
      return;
    }
    if (actionKey === 'soft_delete') {
      if (window.confirm(`להשבית את ${partner.full_name}? הנתונים ההיסטוריים יישמרו, ניתן להפעיל מחדש בכל שלב.`)) {
        onSoftDelete(partner);
      }
      return;
    }
    if (actionKey === 'hard_delete') {
      if (
        window.confirm(
          `למחוק את ${partner.full_name} לצמיתות? פעולה זו בלתי הפיכה ותמחק את כל הרשומה וההיסטוריה (הזמנות, יתרות, יומן מטבעות).`
        )
      ) {
        onHardDelete(partner);
      }
      return;
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        aria-label="פעולות נוספות"
        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <MoreVertical size={16} />
      </button>

      {isOpen &&
        menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left, width: MENU_WIDTH }}
            className="z-50 rounded-xl bg-white border border-slate-200 shadow-lg py-1.5"
          >
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleAction(item.key)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-start hover:bg-slate-50 ${
                    item.destructive ? 'text-rose-600' : 'text-slate-700'
                  }`}
                >
                  <Icon size={15} className={item.destructive ? 'text-rose-500' : 'text-slate-400'} />
                  <span>{item.key === 'freeze' && partner.is_frozen ? 'ביטול הקפאה' : item.label}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

function formatCoinAmount(n) {
  if (n === null || n === undefined) return '0';
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

// Michael's Method's 4 coin types (0021+) as a compact 2x2 grid — one
// small labeled chip per type, so all four fit cleanly in a table row
// instead of one flat number. A partner with no real account yet (no
// wallet row — hasn't signed up) falls back to the legacy roster
// balance as a single "starting point" figure, clearly labeled as such
// rather than presented as if it were a real per-type balance.
const COIN_CELLS = [
  { key: 'coins_weekend_day', label: 'סופ"ש יום', className: 'bg-amber-50 text-amber-700' },
  { key: 'coins_weekend_night', label: 'סופ"ש לילה', className: 'bg-indigo-50 text-indigo-700' },
  { key: 'coins_midweek_day', label: 'אמצ"ש יום', className: 'bg-emerald-50 text-emerald-700' },
  { key: 'coins_midweek_night', label: 'אמצ"ש לילה', className: 'bg-slate-100 text-slate-600' },
];

function PartnerCoinBalances({ partner }) {
  if (!partner.wallet) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-medium w-fit">
          {formatCoinAmount(partner.balance)} מטבעות (טרם נרשם)
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-[130px]">
      {COIN_CELLS.map((cell) => (
        <div
          key={cell.key}
          className={`flex items-center justify-between gap-3 px-2.5 py-1 rounded-md text-xs whitespace-nowrap ${cell.className}`}
        >
          <span className="font-normal opacity-80">{cell.label}</span>
          <span className="font-semibold">{formatCoinAmount(partner.wallet[cell.key])}</span>
        </div>
      ))}
    </div>
  );
}

export default function PartnersPage() {
  const { currentUser } = useAuth();
  const [partners, setPartners] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [editingPartner, setEditingPartner] = useState(null);
  const [historyPartner, setHistoryPartner] = useState(null);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isAddPartnerOpen, setIsAddPartnerOpen] = useState(false);

  // Matches partner_roster's INSERT RLS exactly: can_edit_partners()
  // (isManager's 4 roles) OR is_admin() — see 0007/0015.
  const canAddPartner = canSeePartnerManagementMenu(currentUser);

  // Michael's Method (0021+): real per-type balances live in
  // user_wallets, keyed by user_id + period_id — partner_roster's old
  // flat `balance` column no longer feeds them (see
  // 0028_stop_roster_sync_touching_wallets.sql) and is only ever shown
  // for a partner who hasn't signed up yet (no user_id to look a
  // wallet up by at all). ensure_current_period() guarantees the
  // current period + every real account's wallet row for it exist
  // before reading — same pattern as Dashboard.jsx/CoinsPage.jsx.
  async function fetchPartners() {
    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase.from('partner_roster').select('*').order('full_name');

    if (error) {
      console.error('Failed to load partners', error);
      setErrorMessage('אירעה שגיאה בטעינת רשימת השותפים.');
      setPartners([]);
      setIsLoading(false);
      return;
    }

    const { error: ensureError } = await supabase.rpc('ensure_current_period');
    if (ensureError) console.error('Failed to ensure current period', ensureError);

    const { data: users, error: usersError } = await supabase.from('users').select('id, email, full_name, phone');
    if (usersError) console.error('Failed to load user accounts for wallet lookup', usersError);
    const userIdByEmail = new Map((users ?? []).map((u) => [u.email.toLowerCase(), u.id]));

    const { data: period } = await supabase.from('periods').select('id').eq('is_current', true).limit(1).maybeSingle();

    let walletByUserId = new Map();
    if (period) {
      const { data: wallets, error: walletsError } = await supabase
        .from('user_wallets')
        .select('user_id, coins_weekend_day, coins_weekend_night, coins_midweek_day, coins_midweek_night')
        .eq('period_id', period.id);
      if (walletsError) console.error('Failed to load partner wallets', walletsError);
      walletByUserId = new Map((wallets ?? []).map((w) => [w.user_id, w]));
    }

    const rosterPartners = data.map((partner) => {
      const userId = userIdByEmail.get(partner.email.toLowerCase());
      return { ...partner, inRoster: true, wallet: userId ? walletByUserId.get(userId) ?? null : null };
    });

    // Real accounts that signed up (old self-service flow, since
    // removed) but were never added to partner_roster — invisible on
    // this page otherwise, and with no sync mechanism to ever correct
    // full_name if it's still whatever handle_new_auth_user's fallback
    // set it to (the email's local part) at sign-up. Surfaced here so
    // there's at least one way to fix that, even though most of the
    // roster-only actions (freeze/soft-delete/roles/status) don't
    // apply — hard-delete does, via fn_admin_hard_delete_orphan_user
    // (0049), which is why `id` is carried here (partner_roster rows
    // have no id column at all, keyed by email instead, so this field
    // only exists on orphan rows — handleHardDelete branches on it).
    const rosterEmails = new Set(data.map((p) => p.email.toLowerCase()));
    const orphanPartners = (users ?? [])
      .filter((u) => !rosterEmails.has(u.email.toLowerCase()))
      .map((u) => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        phone: u.phone ?? null,
        roles: [],
        is_active: true,
        is_frozen: false,
        inRoster: false,
        wallet: walletByUserId.get(u.id) ?? null,
      }));

    setPartners([...rosterPartners, ...orphanPartners]);
    setIsLoading(false);
  }

  useEffect(() => {
    fetchPartners();
  }, []);

  // Every mutation below chains .select() and checks for an empty
  // result — an RLS/trigger-blocked write comes back as
  // { error: null, data: [] }, not a thrown error, EXCEPT the new
  // role-gate trigger in 0015, which DOES raise a real exception (a
  // genuinely wrong role gets a loud, specific Hebrew message instead
  // of a silent no-op).
  async function handleFreezeToggle(partner) {
    setActionError(null);
    const { data, error } = await supabase
      .from('partner_roster')
      .update({ is_frozen: !partner.is_frozen })
      .eq('email', partner.email)
      .select();

    if (error) {
      console.error('Failed to toggle freeze', error);
      setActionError(error.message ?? 'אירעה שגיאה בהקפאת השותף. אנא נסו שוב.');
      return;
    }
    if (!data || data.length === 0) {
      setActionError('הפעולה לא בוצעה — ייתכן שאין לכם הרשאה, או שהרשומה כבר לא קיימת.');
      return;
    }
    await fetchPartners();
  }

  async function handleSoftDelete(partner) {
    setActionError(null);
    const { data, error } = await supabase
      .from('partner_roster')
      .update({ is_active: false })
      .eq('email', partner.email)
      .select();

    if (error) {
      console.error('Failed to soft-delete partner', error);
      setActionError(error.message ?? 'אירעה שגיאה בהשבתת השותף. אנא נסו שוב.');
      return;
    }
    if (!data || data.length === 0) {
      setActionError('הפעולה לא בוצעה — ייתכן שאין לכם הרשאה, או שהרשומה כבר לא קיימת.');
      return;
    }
    await fetchPartners();
  }

  async function handleHardDelete(partner) {
    setActionError(null);

    // Roster-tracked partners go through the existing, already-audited
    // path (delete the partner_roster row -> 0015's trigger cascades
    // to public.users and everything under it). Orphan accounts have
    // no roster row to delete, so they go through the dedicated RPC
    // instead (0049_hard_delete_orphan_accounts.sql) — same admin-only
    // restriction, same cascade, just a different entry point.
    if (!partner.inRoster) {
      const { error } = await supabase.rpc('fn_admin_hard_delete_orphan_user', { p_user_id: partner.id });
      if (error) {
        console.error('Failed to permanently delete orphan account', error);
        setActionError(error.message ?? 'אירעה שגיאה במחיקת השותף. אנא נסו שוב.');
        return;
      }
      await fetchPartners();
      return;
    }

    const { data, error } = await supabase.from('partner_roster').delete().eq('email', partner.email).select();

    if (error) {
      console.error('Failed to permanently delete partner', error);
      setActionError(error.message ?? 'אירעה שגיאה במחיקת השותף. אנא נסו שוב.');
      return;
    }
    if (!data || data.length === 0) {
      setActionError('הפעולה לא בוצעה — ייתכן שאין לכם הרשאה, או שהרשומה כבר לא קיימת.');
      return;
    }
    await fetchPartners();
  }

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">שותפים</h2>
          <p className="text-sm text-slate-500">רשימת כל השותפים במערכת</p>
        </div>
        {canAddPartner && (
          <button
            type="button"
            onClick={() => setIsAddPartnerOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 transition-colors"
          >
            <UserPlus size={16} />
            הוספת שותף
          </button>
        )}
      </header>

      {actionError && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-4 py-2.5">
          {actionError}
        </p>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <p className="p-10 text-center text-sm text-slate-400">טוען נתוני שותפים...</p>
        ) : errorMessage ? (
          <p className="p-10 text-center text-sm text-rose-600">{errorMessage}</p>
        ) : partners.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-400">לא נמצאו שותפים.</p>
        ) : (
          <div className="overflow-x-auto">
            {/*
              Column order follows normal source order under dir="rtl":
              the FIRST column below lands on the visual right, the
              LAST lands on the visual left — matching the requested
              left-to-right layout (Actions | Coins | Status | Roles |
              Contact&Name) without fighting the RTL flow.
            */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-start text-slate-500">
                  <th className="px-4 py-3 font-medium text-start">שם מלא</th>
                  <th className="px-4 py-3 font-medium text-start">אימייל</th>
                  <th className="px-4 py-3 font-medium text-start">טלפון</th>
                  <th className="px-4 py-3 font-medium text-start">תפקידים</th>
                  <th className="px-4 py-3 font-medium text-start">סטטוס</th>
                  <th className="px-4 py-3 font-medium text-start">מטבעות</th>
                  <th className="px-4 py-3 font-medium text-start">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((partner) => (
                  <tr key={partner.email} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                      {partner.full_name}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{partner.email}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{partner.phone ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(partner.roles ?? []).map((role) => (
                          <span
                            key={role}
                            className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium"
                          >
                            {roleLabelHe(role)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {!partner.inRoster ? (
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700"
                            title="נרשם/ה ישירות למערכת ולא נוסף/ה לרשימת השותפים — ניתן לתקן כאן רק את השם המלא."
                          >
                            לא ברשימת שותפים
                          </span>
                        ) : (
                          <>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                partner.is_active
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {partner.is_active ? 'פעיל' : 'לא פעיל'}
                            </span>
                            {partner.is_frozen && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700">
                                מוקפא
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <PartnerCoinBalances partner={partner} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <a
                          href={`tel:${partner.phone ?? ''}`}
                          aria-label={`חייג ל${partner.full_name}`}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 ${
                            !partner.phone ? 'pointer-events-none opacity-30' : ''
                          }`}
                        >
                          <Phone size={15} />
                        </a>
                        <a
                          href={`mailto:${partner.email}`}
                          aria-label={`שלח אימייל ל${partner.full_name}`}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                          <Mail size={15} />
                        </a>
                        <RowActionsMenu
                          partner={partner}
                          currentUser={currentUser}
                          onEdit={setEditingPartner}
                          onOrderHistory={setHistoryPartner}
                          onChangePassword={() => setIsChangePasswordOpen(true)}
                          onFreeze={handleFreezeToggle}
                          onSoftDelete={handleSoftDelete}
                          onHardDelete={handleHardDelete}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddPartnerModal isOpen={isAddPartnerOpen} onClose={() => setIsAddPartnerOpen(false)} onSaved={fetchPartners} />

      <EditPartnerModal
        isOpen={editingPartner !== null}
        onClose={() => setEditingPartner(null)}
        partner={editingPartner}
        onSaved={fetchPartners}
      />

      <BookingHistoryModal
        isOpen={historyPartner !== null}
        onClose={() => setHistoryPartner(null)}
        partner={historyPartner}
      />

      <ChangePasswordModal isOpen={isChangePasswordOpen} onClose={() => setIsChangePasswordOpen(false)} />
    </div>
  );
}
