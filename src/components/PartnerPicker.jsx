import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Selectable list is public.users (real signed-up accounts) — a
// participant has to be a real user_id so it can actually be stored in
// booking_participants (its FK target). The query itself has never
// filtered by login status — it selects every row in public.users,
// unfiltered, no .limit(). It only ever showed a short list because
// few accounts existed yet; once everyone's actually signed up, this
// same query returns everyone. (If it still looks short, that's a
// data question — verify with a SELECT count(*) FROM public.users in
// the SQL Editor — not a query bug.)
//
// Frozen/inactive partners are excluded here too — this is a UX nicety
// on top of the real server-side block (0015's
// trg_block_frozen_or_inactive_participant trigger); even if a stale
// client somehow submitted one anyway, the insert would be rejected.
export default function PartnerPicker({ excludeUserId, selectedIds, onChange }) {
  const [partners, setPartners] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    let isCancelled = false;

    async function fetchPartners() {
      setIsLoading(true);
      setErrorMessage(null);
      let query = supabase
        .from('users')
        .select('id, full_name, email')
        .eq('is_active', true)
        .eq('is_frozen', false)
        .order('full_name');
      if (excludeUserId) {
        query = query.neq('id', excludeUserId);
      }
      const { data, error } = await query;

      if (isCancelled) return;
      if (error) {
        console.error('Failed to load partner list', error);
        setErrorMessage('אירעה שגיאה בטעינת רשימת השותפים.');
      } else {
        setPartners(data);
      }
      setIsLoading(false);
    }

    fetchPartners();
    return () => {
      isCancelled = true;
    };
  }, [excludeUserId]);

  function toggle(id) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700">שותפים נוספים להפלגה</label>
        {!isLoading && !errorMessage && partners.length > 0 && (
          <span className="text-xs text-slate-400">{partners.length} שותפים זמינים</span>
        )}
      </div>
      {isLoading ? (
        <p className="text-xs text-slate-400">טוען שותפים...</p>
      ) : errorMessage ? (
        <p className="text-xs text-rose-600">{errorMessage}</p>
      ) : partners.length === 0 ? (
        <p className="text-xs text-slate-400">
          אין עדיין שותפים רשומים (מחוברים) במערכת מלבדכם. רק שותפים שהתחברו לפחות פעם אחת מופיעים כאן.
        </p>
      ) : (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
          {partners.map((partner) => (
            <label
              key={partner.id}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(partner.id)}
                onChange={() => toggle(partner.id)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{partner.full_name ?? partner.email}</span>
            </label>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400">יש לבחור לפחות שותף אחד נוסף.</p>
    </div>
  );
}
