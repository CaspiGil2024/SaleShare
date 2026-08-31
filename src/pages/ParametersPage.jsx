import { useState, useEffect } from 'react';
import { Settings, SlidersHorizontal } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isAdminOrTreasurer } from '../lib/permissions';

function SystemSettingsForm({ currentUser }) {
  const [sMultiplier, setSMultiplier] = useState(1);
  const [overdraftPercent, setOverdraftPercent] = useState(20);
  const [rolloverPercent, setRolloverPercent] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabase
        .from('system_settings')
        .select('s_multiplier, overdraft_percent, rollover_percent')
        .eq('id', true)
        .maybeSingle();

      if (error) {
        console.error('Failed to load system settings', error);
        setErrorMessage('אירעה שגיאה בטעינת הפרמטרים.');
      } else if (data) {
        setSMultiplier(data.s_multiplier);
        setOverdraftPercent(data.overdraft_percent);
        setRolloverPercent(data.rollover_percent);
      }
      setIsLoading(false);
    }
    load();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .update({
          s_multiplier: Number(sMultiplier),
          overdraft_percent: Number(overdraftPercent),
          rollover_percent: Number(rolloverPercent),
          updated_by: currentUser.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', true)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('השמירה לא בוצעה בפועל — ייתכן שאין לכם הרשאה. אנא רעננו ונסו שוב.');
      }
      setSuccessMessage('הפרמטרים נשמרו בהצלחה.');
    } catch (err) {
      console.error('Failed to save system settings', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בשמירת הפרמטרים.');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <p className="p-10 text-center text-sm text-slate-400">טוען...</p>;

  return (
    <form onSubmit={handleSave} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col gap-5 max-w-xl">
      <div className="flex items-center gap-2 text-slate-800 font-bold">
        <SlidersHorizontal size={18} className="text-blue-600" />
        <h3>הגדרות כלליות</h3>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">מכפיל S (מקסימום הזמנות עתידיות מכל סוג)</label>
        <input
          type="number"
          min={1}
          step={1}
          value={sMultiplier}
          onChange={(e) => setSMultiplier(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-slate-400">
          המלצת מיכאל: 1 או 2. שותף יוכל להיות רשום למקסימום S הפלגות עתידיות מכל סוג מטבע (סעיף 60/80).
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">אחוז אוברדרפט (יתרה שלילית מותרת)</label>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={overdraftPercent}
          onChange={(e) => setOverdraftPercent(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-slate-400">
          שותף יוכל לרדת עד {overdraftPercent}% מתחת ל-0 ביחס למכסה שקיבל באותו סוג מטבע לתקופה זו (סעיף 110).
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">אחוז צבירה בין תקופות</label>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={rolloverPercent}
          onChange={(e) => setRolloverPercent(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          שימו לב: ערך זה נשמר לשימוש עתידי בלבד — הלוגיקה בפועל להעברת מטבעות בין תקופות (סעיף 130,
          כולל כלל האיזון של עד 10% הפרש בין שותפים) עדיין לא מיושמת. כרגע אין צבירה בפועל בין תקופות,
          ללא קשר לערך שכאן.
        </p>
      </div>

      {errorMessage && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{errorMessage}</p>
      )}
      {successMessage && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
          {successMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="self-start rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 transition-colors"
      >
        {saving ? 'שומר...' : 'שמירת פרמטרים'}
      </button>
    </form>
  );
}

export default function ParametersPage() {
  const { currentUser } = useAuth();

  const canManage = isAdminOrTreasurer(currentUser);

  if (!canManage) {
    return (
      <div className="p-10 text-center text-slate-400" dir="rtl">
        <p className="text-lg font-medium text-slate-500">מסך זה זמין למנהל או גזבר בלבד.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header>
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Settings size={22} className="text-blue-600" />
          פרמטרים
        </h2>
        <p className="text-sm text-slate-500">הגדרות מערכת שיטת חלוקת הזמן</p>
      </header>

      <SystemSettingsForm currentUser={currentUser} />
    </div>
  );
}
