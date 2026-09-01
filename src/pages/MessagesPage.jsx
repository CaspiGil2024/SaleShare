import { useEffect, useState } from 'react';
import { Bell, Download, Plus, Wrench, CheckCircle2, ImagePlus, Megaphone, Pencil, X, TriangleAlert } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isManager } from '../lib/permissions';
import { exportMaintenanceIssuesToXlsx } from '../lib/xlsxExport';
import { formatDateHe } from '../lib/dateFormat';
import { sendMaintenanceResolvedNotificationEmails, sendVesselGroundingAlertEmails } from '../lib/emailNotifications';

const IMAGES_BUCKET = 'maintenance-images';

// ---------------------------------------------------------------------
// General System Notices (0036) — content-only (no title/summary),
// closed rather than deleted. Separate from the AnnouncementsPanel
// feed shown elsewhere on the dashboard — see the migration's header
// comment for why these are two distinct systems.
//
// Moved here (out of MaintenanceDataPage.jsx) along with
// MaintenanceIssuesSection below, into their own top-level "הודעות"
// section — both are message/notice feeds, not maintenance tooling.
// ---------------------------------------------------------------------
function NoticeCard({ notice, canManage, onChanged }) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(notice.content);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    setErrorMessage(null);
    const { data, error } = await supabase
      .from('system_notices')
      .update({ content: content.trim() })
      .eq('id', notice.id)
      .select();
    setSubmitting(false);
    if (error) {
      console.error('Failed to update notice', error);
      setErrorMessage(error.message ?? 'אירעה שגיאה בעדכון ההודעה.');
      return;
    }
    if (!data || data.length === 0) {
      setErrorMessage('העדכון לא בוצע — ייתכן שאין לכם הרשאה.');
      return;
    }
    setIsEditing(false);
    await onChanged();
  }

  async function handleClose() {
    if (!window.confirm('לסגור את ההודעה? היא תפסיק להופיע ללוח הבקרה של השותפים.')) return;
    setErrorMessage(null);
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('system_notices')
      .update({
        is_active: false,
        closed_by: authUser?.id ?? null,
        closed_by_name: authUser?.email ?? null,
        closed_at: new Date().toISOString(),
      })
      .eq('id', notice.id)
      .select();
    if (error) {
      console.error('Failed to close notice', error);
      setErrorMessage(error.message ?? 'אירעה שגיאה בסגירת ההודעה.');
      return;
    }
    if (!data || data.length === 0) {
      setErrorMessage('הסגירה לא בוצעה — ייתכן שאין לכם הרשאה.');
      return;
    }
    await onChanged();
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex flex-col gap-2">
      {isEditing ? (
        <form onSubmit={handleSaveEdit} className="flex flex-col gap-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          />
          {errorMessage && <p className="text-xs text-rose-600 dark:text-rose-300">{errorMessage}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold px-3.5 py-1.5 transition-colors"
            >
              {submitting ? 'שומר...' : 'שמירה'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setContent(notice.content);
              }}
              className="rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold px-3.5 py-1.5 transition-colors"
            >
              ביטול
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{notice.content}</p>
          <span
            className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
              notice.is_active ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
            }`}
          >
            {notice.is_active ? 'פעילה' : 'סגורה'}
          </span>
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        {notice.created_by_name ?? 'שותף'} · {formatDateHe(notice.created_at)}
        {!notice.is_active && notice.closed_at && (
          <> · נסגרה ע"י {notice.closed_by_name ?? 'שותף'} ב-{formatDateHe(notice.closed_at)}</>
        )}
      </p>

      {canManage && !isEditing && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300"
          >
            <Pencil size={14} />
            עריכה
          </button>
          {notice.is_active && (
            <button
              type="button"
              onClick={handleClose}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X size={14} />
              סגירת הודעה
            </button>
          )}
        </div>
      )}
      {errorMessage && !isEditing && <p className="text-xs text-rose-600 dark:text-rose-300">{errorMessage}</p>}
    </div>
  );
}

function NewNoticeForm({ onCreated }) {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!content.trim()) {
      setErrorMessage('יש להזין תוכן להודעה.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);

    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from('system_notices').insert({
      content: content.trim(),
      created_by: authUser?.id ?? null,
      created_by_name: authUser?.email ?? null,
    });

    setSubmitting(false);
    if (error) {
      console.error('Failed to create notice', error);
      setErrorMessage(error.message ?? 'אירעה שגיאה בפרסום ההודעה.');
      return;
    }
    setContent('');
    setIsOpen(false);
    await onCreated();
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 transition-colors self-start"
      >
        <Plus size={16} />
        הודעה חדשה
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">תוכן ההודעה</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
        />
      </div>
      {errorMessage && (
        <p className="text-sm text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">{errorMessage}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition-colors"
        >
          {submitting ? 'מפרסם...' : 'פרסום הודעה'}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          disabled={submitting}
          className="rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold px-4 py-2 transition-colors"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}

function SystemNoticesSection({ currentUser }) {
  const canManage = isManager(currentUser);
  const [notices, setNotices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  async function fetchNotices() {
    setIsLoading(true);
    setErrorMessage(null);
    const { data, error } = await supabase
      .from('system_notices')
      .select('*')
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to load system notices', error);
      setErrorMessage('אירעה שגיאה בטעינת ההודעות.');
    } else {
      setNotices(data);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    fetchNotices();
  }, []);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Megaphone size={18} className="text-blue-600 dark:text-blue-300" />
          הודעות מערכת
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">הודעות פעילות מוצגות ללוח הבקרה של כל השותפים</p>
      </div>

      {canManage && <NewNoticeForm onCreated={fetchNotices} />}

      {isLoading ? (
        <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">טוען...</p>
      ) : errorMessage ? (
        <p className="p-10 text-center text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
      ) : notices.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">אין הודעות מערכת.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {notices.map((notice) => (
            <NoticeCard key={notice.id} notice={notice} canManage={canManage} onChanged={fetchNotices} />
          ))}
        </div>
      )}
    </div>
  );
}

function imagePublicUrl(storagePath) {
  return supabase.storage.from(IMAGES_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

// ---------------------------------------------------------------------
// New issue form — summary + description + one or more images.
// Images upload to storage first; the issue row (and its image rows)
// are only inserted once every upload succeeds, so a partial failure
// doesn't leave an issue with some images silently missing.
// ---------------------------------------------------------------------
function NewIssueForm({ onCreated }) {
  const [isOpen, setIsOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [isGrounding, setIsGrounding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  function handleFilesChange(e) {
    setFiles(Array.from(e.target.files ?? []));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage(null);
    if (!summary.trim() || !description.trim()) {
      setErrorMessage('יש למלא תקציר ותיאור הבעיה.');
      return;
    }

    setSubmitting(true);
    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();

      const { data: issue, error: issueError } = await supabase
        .from('maintenance_issues')
        .insert({
          summary: summary.trim(),
          description: description.trim(),
          created_by: authUser?.id ?? null,
          is_grounding: isGrounding,
        })
        .select()
        .single();
      if (issueError) throw issueError;

      // Fire-and-forget, same soft-no-op-if-unconfigured behavior as
      // every other email call in this app — never risks the report
      // that already succeeded above, and dispatched immediately rather
      // than waiting on the (unrelated) image upload below.
      if (isGrounding) {
        supabase
          .from('users')
          .select('email, full_name')
          .eq('emails_enabled', true)
          .eq('receive_critical_updates', true)
          .then(({ data: recipientRows, error: recipientsError }) => {
            if (recipientsError) {
              console.error('Failed to load critical-update recipients', recipientsError);
              return;
            }
            sendVesselGroundingAlertEmails({
              recipients: (recipientRows ?? []).map((u) => ({ email: u.email, name: u.full_name })),
              summary: issue.summary,
              description: issue.description,
            });
          });
      }

      const uploadedPaths = [];
      for (const file of files) {
        const storagePath = `${issue.id}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from(IMAGES_BUCKET).upload(storagePath, file);
        if (uploadError) throw uploadError;
        uploadedPaths.push(storagePath);
      }

      if (uploadedPaths.length > 0) {
        const { error: imagesError } = await supabase
          .from('maintenance_issue_images')
          .insert(uploadedPaths.map((storage_path) => ({ issue_id: issue.id, storage_path })));
        if (imagesError) throw imagesError;
      }

      setSummary('');
      setDescription('');
      setFiles([]);
      setIsGrounding(false);
      setIsOpen(false);
      await onCreated();
    } catch (err) {
      console.error('Failed to create maintenance issue', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בדיווח התקלה.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 transition-colors self-start"
      >
        <Plus size={16} />
        דיווח תקלה חדשה
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">תקציר</label>
        <input
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">תיאור הבעיה</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer">
          <ImagePlus size={16} />
          {files.length > 0 ? `${files.length} תמונות נבחרו` : 'הוספת תמונות'}
          <input type="file" accept="image/*" multiple className="hidden" onChange={handleFilesChange} />
        </label>
      </div>

      <label className="flex items-center gap-2 rounded-lg border-2 border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2.5 text-sm font-semibold text-rose-800 dark:text-rose-300 cursor-pointer hover:bg-rose-100 dark:hover:bg-rose-900">
        <input
          type="checkbox"
          checked={isGrounding}
          onChange={(e) => setIsGrounding(e.target.checked)}
          className="w-4 h-4 rounded border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-400 focus:ring-rose-500 dark:focus:ring-rose-400"
        />
        <TriangleAlert size={16} className="shrink-0" />
        השבתת יאכטה — הסירה אינה כשירה לשייט עד לפתרון התקלה
      </label>

      {errorMessage && (
        <p className="text-sm text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">{errorMessage}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition-colors"
        >
          {submitting ? 'שומר...' : 'דיווח תקלה'}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          disabled={submitting}
          className="rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold px-4 py-2 transition-colors"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------
// One issue row — image thumbnails, and (for managers, on an open
// issue) a "mark resolved" control that reveals a solution memo.
// ---------------------------------------------------------------------
function IssueCard({ issue, canManage, onResolved }) {
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleResolve(e) {
    e.preventDefault();
    if (!resolutionNotes.trim()) {
      setErrorMessage('יש לתאר את הפתרון.');
      return;
    }
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('maintenance_issues')
        .update({
          status: 'resolved',
          resolution_notes: resolutionNotes.trim(),
          resolved_by: authUser?.id ?? null,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', issue.id)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('העדכון לא בוצע בפועל — ייתכן שאין לכם הרשאה.');
      }

      // Fire-and-forget, same soft-no-op-if-unconfigured behavior as
      // every other email call — never risks the resolution that
      // already succeeded above. Only for a grounding issue: everything
      // else being marked resolved doesn't need a fleet-wide notice.
      if (issue.is_grounding) {
        supabase
          .from('users')
          .select('email, full_name')
          .eq('emails_enabled', true)
          .eq('receive_critical_updates', true)
          .then(({ data: recipientRows, error: recipientsError }) => {
            if (recipientsError) {
              console.error('Failed to load critical-update recipients', recipientsError);
              return;
            }
            sendMaintenanceResolvedNotificationEmails({
              recipients: (recipientRows ?? []).map((u) => ({ email: u.email, name: u.full_name })),
              summary: issue.summary,
              resolutionNotes: resolutionNotes.trim(),
            });
          });
      }

      await onResolved();
    } catch (err) {
      console.error('Failed to resolve maintenance issue', err);
      setErrorMessage(err.message ?? 'אירעה שגיאה בסימון התקלה כנפתרה.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
            {issue.is_grounding && (
              <span
                title="השבתת יאכטה"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-300 text-[11px] font-bold"
              >
                <TriangleAlert size={12} />
                השבתת יאכטה
              </span>
            )}
            {issue.summary}
          </h4>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{issue.description}</p>
        </div>
        <span
          className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
            issue.status === 'resolved' ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300' : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
          }`}
        >
          {issue.status === 'resolved' ? 'נפתרה' : 'פתוחה'}
        </span>
      </div>

      {issue.images?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {issue.images.map((img) => (
            <a key={img.id} href={imagePublicUrl(img.storage_path)} target="_blank" rel="noopener noreferrer">
              <img
                src={imagePublicUrl(img.storage_path)}
                alt=""
                className="w-20 h-20 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
              />
            </a>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        דווח ע"י {issue.createdByName ?? 'שותף'} · {formatDateHe(issue.created_at)}
      </p>

      {issue.status === 'resolved' && (
        <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-100 dark:border-green-900 px-3 py-2 text-sm text-green-800 dark:text-green-300">
          <p className="font-medium">פתרון:</p>
          <p className="whitespace-pre-wrap">{issue.resolution_notes}</p>
          <p className="text-xs text-green-600 dark:text-green-300 mt-1">
            ע"י {issue.resolvedByName ?? 'שותף'} · {formatDateHe(issue.resolved_at)}
          </p>
        </div>
      )}

      {canManage && issue.status === 'open' && (
        <div>
          {!isResolving ? (
            <button
              type="button"
              onClick={() => setIsResolving(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-300 hover:text-green-800 dark:hover:text-green-300"
            >
              <CheckCircle2 size={16} />
              סמן כנפתרה
            </button>
          ) : (
            <form onSubmit={handleResolve} className="flex flex-col gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">פתרון הבעיה</label>
              <textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
              {errorMessage && <p className="text-xs text-rose-600 dark:text-rose-300">{errorMessage}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-semibold px-3.5 py-1.5 transition-colors"
                >
                  {submitting ? 'שומר...' : 'אישור פתרון'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsResolving(false)}
                  disabled={submitting}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 text-sm font-semibold px-3.5 py-1.5 transition-colors"
                >
                  ביטול
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function MaintenanceIssuesSection({ currentUser }) {
  const canManage = isManager(currentUser);
  const [issues, setIssues] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  async function fetchIssues() {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const { data: issueRows, error: issuesError } = await supabase
        .from('maintenance_issues')
        .select(
          'id, summary, description, status, is_grounding, resolution_notes, created_at, resolved_at, creator:users!maintenance_issues_created_by_fkey(full_name, email), resolver:users!maintenance_issues_resolved_by_fkey(full_name, email)'
        )
        .order('status', { ascending: true }) // 'open' sorts before 'resolved'
        .order('created_at', { ascending: false });
      if (issuesError) throw issuesError;

      const { data: imageRows, error: imagesError } = await supabase
        .from('maintenance_issue_images')
        .select('id, issue_id, storage_path');
      if (imagesError) throw imagesError;

      const imagesByIssue = new Map();
      for (const img of imageRows) {
        if (!imagesByIssue.has(img.issue_id)) imagesByIssue.set(img.issue_id, []);
        imagesByIssue.get(img.issue_id).push(img);
      }

      setIssues(
        issueRows.map((r) => ({
          ...r,
          createdByName: r.creator?.full_name ?? r.creator?.email,
          resolvedByName: r.resolver?.full_name ?? r.resolver?.email,
          images: imagesByIssue.get(r.id) ?? [],
        }))
      );
    } catch (err) {
      console.error('Failed to load maintenance issues', err);
      setErrorMessage('אירעה שגיאה בטעינת רשימת התקלות.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchIssues();
  }, []);

  function handleExport() {
    exportMaintenanceIssuesToXlsx({ rows: issues });
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Wrench size={18} className="text-blue-600 dark:text-blue-300" />
            הודעות תקלות תחזוקה
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">רשימת כל התקלות שדווחו, פתוחות וסגורות</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={isLoading || issues.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold px-3.5 py-2 transition-colors"
        >
          <Download size={15} />
          יצוא לאקסל
        </button>
      </div>

      {canManage && <NewIssueForm onCreated={fetchIssues} />}

      {isLoading ? (
        <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">טוען...</p>
      ) : errorMessage ? (
        <p className="p-10 text-center text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
      ) : issues.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">לא דווחו תקלות.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} canManage={canManage} onResolved={fetchIssues} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MessagesPage() {
  const { currentUser } = useAuth();

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Bell size={22} className="text-blue-600 dark:text-blue-300" />
          הודעות
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">הודעות מערכת ותקלות תחזוקה</p>
      </header>

      <SystemNoticesSection currentUser={currentUser} />

      <MaintenanceIssuesSection currentUser={currentUser} />
    </div>
  );
}
