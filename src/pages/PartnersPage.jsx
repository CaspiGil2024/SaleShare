import { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { roleLabelHe } from '../lib/partnerRoles';
import { isManager, isAdminOrTreasurer, isAdminRole } from '../lib/permissions';
import EditPartnerModal from '../components/EditPartnerModal';
import BookingHistoryModal from '../components/BookingHistoryModal';
import ChangePasswordModal from '../components/ChangePasswordModal';

// Per-item role gate (2026-08-26 rule). Deliberately narrower/different
// from the general isManager() set used to edit a partner's ordinary
// fields — "Manager" in this specific rule means the admin role alone,
// not the broader treasurer/ceo/lab_tester/maintenance group. The real
// enforcement is server-side (0015_partner_freeze_and_delete_gates.sql
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
  const containerRef = useRef(null);

  const isSelf = partner.email?.toLowerCase() === currentUser?.email?.toLowerCase();
  const canEditGeneral = isManager(currentUser);
  const canFreezeOrSoftDelete = isAdminOrTreasurer(currentUser);
  const canHardDelete = isAdminRole(currentUser);
  const menuItems = buildMenuItems({ isSelf, canEditGeneral, canFreezeOrSoftDelete, canHardDelete });

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="פעולות נוספות"
        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <MoreVertical size={16} />
      </button>

      {isOpen && (
        <div className="absolute z-10 top-9 start-0 w-48 rounded-xl bg-white border border-slate-200 shadow-lg py-1.5">
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
        </div>
      )}
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

  async function fetchPartners() {
    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase.from('partner_roster').select('*').order('full_name');

    if (error) {
      console.error('Failed to load partners', error);
      setErrorMessage('אירעה שגיאה בטעינת רשימת השותפים.');
      setPartners([]);
    } else {
      setPartners(data);
    }
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
      <header>
        <h2 className="text-2xl font-bold text-slate-800">שותפים</h2>
        <p className="text-sm text-slate-500">רשימת כל השותפים במערכת</p>
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
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {/*
                        partner_roster only has one flat `balance` column
                        (no weekday/weekend split — that lives on
                        user_wallets, keyed by user_id, which most of
                        these partners don't have yet). Showing the real
                        number rather than fabricating a split.
                      */}
                      <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                        {partner.balance ?? 0} מטבעות
                      </span>
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
