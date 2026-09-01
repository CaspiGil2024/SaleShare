import { useEffect, useState } from 'react';
import { CheckSquare, LogOut, Plus, Trash2, X, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isManager } from '../lib/permissions';
import { formatDateTimeHe } from '../lib/dateFormat';

const CHECKLIST_TYPES = [
  { key: 'departure', label: "צ'קליסט יציאה להפלגה", icon: CheckSquare },
  { key: 'closing', label: "צ'קליסט סגירת סירה", icon: LogOut },
];

function AddItemForm({ onAdd, onCancel }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    const ok = await onAdd(text.trim());
    setSubmitting(false);
    if (ok) setText('');
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 bg-slate-50 rounded-xl p-3">
      <input
        type="text"
        placeholder="טקסט הפריט"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="flex-1 rounded-lg border border-slate-300 px-3 py-3 text-base min-h-[44px]"
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold px-5 py-3 min-h-[44px]"
      >
        {submitting ? 'שומר...' : 'הוסף'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200"
      >
        <X size={18} />
      </button>
    </form>
  );
}

export default function ChecklistsPage() {
  const { currentUser } = useAuth();
  const canManage = isManager(currentUser);

  const [activeType, setActiveType] = useState('departure');
  const [items, setItems] = useState([]);
  const [checkedIds, setCheckedIds] = useState({});
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastSubmission, setLastSubmission] = useState(null);

  async function fetchItems() {
    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from('checklist_items')
      .select('*')
      .order('checklist_type')
      .order('sort_order');

    if (error) {
      console.error('Failed to load checklist items', error);
      setErrorMessage('אירעה שגיאה בטעינת רשימת הבדיקות.');
    } else {
      setItems(data);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    fetchItems();
  }, []);

  // Switching tabs starts a fresh checklist run — a departure checklist
  // being half-checked shouldn't bleed into the closing one.
  useEffect(() => {
    setCheckedIds({});
    setNotes('');
    setActionError(null);
    setLastSubmission(null);
  }, [activeType]);

  const activeItems = items.filter((item) => item.checklist_type === activeType);
  const allChecked = activeItems.length > 0 && activeItems.every((item) => checkedIds[item.id]);

  function toggleItem(id) {
    setCheckedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleAddItem(text) {
    setActionError(null);
    const sortOrder = activeItems.length;
    const { error } = await supabase
      .from('checklist_items')
      .insert({ checklist_type: activeType, item_text: text, sort_order: sortOrder })
      .select();

    if (error) {
      console.error('Failed to add checklist item', error);
      setActionError('אין הרשאה להוסיף פריט, או שאירעה שגיאה.');
      return false;
    }
    await fetchItems();
    setIsAddingItem(false);
    return true;
  }

  async function handleDeleteItem(item) {
    if (!window.confirm(`למחוק את הפריט "${item.item_text}"?`)) return;
    setActionError(null);

    const { data, error } = await supabase.from('checklist_items').delete().eq('id', item.id).select();
    if (error) {
      console.error('Failed to delete checklist item', error);
      setActionError('אין הרשאה למחוק, או שאירעה שגיאה.');
      return;
    }
    if (!data || data.length === 0) {
      setActionError('המחיקה לא בוצעה בפועל — ייתכן שאין לכם הרשאה לכך.');
      return;
    }
    setCheckedIds((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    await fetchItems();
  }

  async function handleSubmitChecklist() {
    setActionError(null);

    if (!allChecked) {
      setActionError('יש לסמן את כל הפריטים ברשימה לפני החתימה על הצ׳קליסט.');
      return;
    }

    setSubmitting(true);
    const snapshot = activeItems.map((item) => ({ item_text: item.item_text, checked: true }));

    const { error } = await supabase
      .from('checklist_submissions')
      .insert({
        checklist_type: activeType,
        completed_by: currentUser.id,
        completed_by_name: currentUser.full_name ?? currentUser.email,
        checked_items: snapshot,
        notes: notes.trim() ? notes.trim() : null,
      })
      .select();

    setSubmitting(false);

    if (error) {
      console.error('Failed to submit checklist', error);
      setActionError('אירעה שגיאה בשמירת החתימה. אנא נסו שוב.');
      return;
    }

    setLastSubmission({
      name: currentUser.full_name ?? currentUser.email,
      at: new Date(),
    });
    setCheckedIds({});
    setNotes('');
  }

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header>
        <h2 className="text-2xl font-bold text-slate-800">בדיקות לפני / אחרי הפלגה</h2>
        <p className="text-sm text-slate-500">סמנו כל פריט ברשימה וחתמו בסיום</p>
      </header>

      {actionError && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-4 py-2.5">
          {actionError}
        </p>
      )}

      <div className="flex items-center gap-2 border-b border-slate-200">
        {CHECKLIST_TYPES.map((type) => {
          const Icon = type.icon;
          const isActive = activeType === type.key;
          return (
            <button
              key={type.key}
              type="button"
              onClick={() => setActiveType(type.key)}
              className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 -mb-px transition-colors min-h-[44px] ${
                isActive
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon size={18} />
              {type.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex flex-col gap-4">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-slate-400">טוען...</p>
        ) : errorMessage ? (
          <p className="p-8 text-center text-sm text-rose-600">{errorMessage}</p>
        ) : (
          <>
            {canManage && (
              <div>
                {!isAddingItem ? (
                  <button
                    type="button"
                    onClick={() => setIsAddingItem(true)}
                    className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 min-h-[44px] px-2 -mx-2 rounded-lg"
                  >
                    <Plus size={18} /> הוספת פריט לרשימה
                  </button>
                ) : (
                  <AddItemForm onAdd={handleAddItem} onCancel={() => setIsAddingItem(false)} />
                )}
              </div>
            )}

            {activeItems.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">
                אין עדיין פריטים ברשימה זו{canManage ? ' — הוסיפו את הפריט הראשון למעלה.' : '.'}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-50">
                {activeItems.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 py-4">
                    <label className="flex items-center gap-4 text-base text-slate-700 cursor-pointer flex-1 min-h-[44px]">
                      <input
                        type="checkbox"
                        checked={!!checkedIds[item.id]}
                        onChange={() => toggleItem(item.id)}
                        className="w-6 h-6 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span
                        className={`font-semibold ${
                          checkedIds[item.id] ? 'text-slate-400 line-through' : 'text-slate-800'
                        }`}
                      >
                        {item.item_text}
                      </span>
                    </label>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => handleDeleteItem(item)}
                        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-rose-400 hover:bg-rose-50"
                        aria-label="מחק פריט"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {activeItems.length > 0 && (
              <div className="flex flex-col gap-3 pt-2 border-t border-slate-100">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">הערות נוספות</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="הערות אופציונליות..."
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 px-3 py-3 text-base resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSubmitChecklist}
                  disabled={!allChecked || submitting}
                  className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-base font-semibold py-4 min-h-[48px] transition-colors"
                >
                  {submitting
                    ? 'שומר חתימה...'
                    : allChecked
                    ? `חתימה על הצ'קליסט בתור ${currentUser?.full_name ?? currentUser?.email}`
                    : 'יש לסמן את כל הפריטים כדי לחתום'}
                </button>

                {lastSubmission && (
                  <p className="flex items-center gap-1.5 text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                    <CheckCircle2 size={16} />
                    נחתם בהצלחה על ידי {lastSubmission.name} ב-{formatDateTimeHe(lastSubmission.at)}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
