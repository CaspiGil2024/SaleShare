import { useEffect, useState } from 'react';
import { Megaphone, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isManager } from '../lib/permissions';

function timeAgoHe(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'עכשיו';
  if (diffMinutes < 60) return `לפני ${diffMinutes} דקות`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `לפני ${diffHours} שעות`;
  const diffDays = Math.floor(diffHours / 24);
  return `לפני ${diffDays} ימים`;
}

export default function AnnouncementsPanel() {
  const { currentUser } = useAuth();
  const canManage = isManager(currentUser);

  const [announcements, setAnnouncements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function fetchAnnouncements() {
    setIsLoading(true);
    setErrorMessage(null);
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Failed to load announcements', error);
      setErrorMessage('אירעה שגיאה בטעינת ההודעות.');
    } else {
      setAnnouncements(data);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setActionError(null);
    setSubmitting(true);

    const { error } = await supabase
      .from('announcements')
      .insert({
        title: title.trim(),
        body: body.trim() ? body.trim() : null,
        created_by_name: currentUser?.full_name ?? currentUser?.email,
      })
      .select();

    setSubmitting(false);

    if (error) {
      console.error('Failed to add announcement', error);
      setActionError('אין הרשאה להוסיף הודעה, או שאירעה שגיאה.');
      return;
    }
    setTitle('');
    setBody('');
    setIsAdding(false);
    await fetchAnnouncements();
  }

  async function handleDelete(announcement) {
    if (!window.confirm(`למחוק את ההודעה "${announcement.title}"?`)) return;
    setActionError(null);

    const { data, error } = await supabase.from('announcements').delete().eq('id', announcement.id).select();
    if (error) {
      console.error('Failed to delete announcement', error);
      setActionError('אין הרשאה למחוק, או שאירעה שגיאה.');
      return;
    }
    if (!data || data.length === 0) {
      setActionError('המחיקה לא בוצעה בפועל — ייתכן שאין לכם הרשאה לכך.');
      return;
    }
    await fetchAnnouncements();
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Megaphone size={18} className="text-blue-600 dark:text-blue-300" />
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">הודעות ועדכונים</h3>
        </div>
        {canManage && !isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 min-h-[36px]"
          >
            <Plus size={16} /> הודעה חדשה
          </button>
        )}
      </div>

      {actionError && (
        <p className="text-sm text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2 mb-3">
          {actionError}
        </p>
      )}

      {canManage && isAdding && (
        <form onSubmit={handleAdd} className="flex flex-col gap-2 bg-slate-50 dark:bg-slate-800 rounded-xl p-3 mb-4">
          <input
            type="text"
            placeholder="כותרת ההודעה"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
          />
          <textarea
            placeholder="תוכן ההודעה (אופציונלי)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold px-4 py-2"
            >
              {submitting ? 'מפרסם...' : 'פרסום'}
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600"
            >
              <X size={16} />
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">טוען...</p>
      ) : errorMessage ? (
        <p className="p-6 text-center text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
      ) : announcements.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">אין הודעות חדשות.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-50 dark:divide-slate-800">
          {announcements.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{a.title}</p>
                {a.body && <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{a.body}</p>}
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  {a.created_by_name} · {timeAgoHe(a.created_at)}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleDelete(a)}
                  className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-rose-400 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900"
                  aria-label="מחק הודעה"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
