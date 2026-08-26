import { useEffect, useState } from 'react';
import { Phone, FileText, Link2, Plus, Pencil, Trash2, Download, ExternalLink, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../auth/AuthProvider';
import { isManager } from '../lib/permissions';
import EditPhoneModal from '../components/EditPhoneModal';

const TABS = [
  { key: 'phones', label: 'טלפונים חשובים', icon: Phone },
  { key: 'files', label: 'קבצים חשובים', icon: FileText },
  { key: 'links', label: 'קישורים חשובים', icon: Link2 },
];

const FILES_BUCKET = 'important-files';

function EmptyRow({ label }) {
  return <p className="p-8 text-center text-sm text-slate-400">{label}</p>;
}

function PhonesTab({ phones, canManage, onDelete, onAdd, onEdit }) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setSubmitting(true);
    const ok = await onAdd({ name: name.trim(), phone: phone.trim() });
    setSubmitting(false);
    if (ok) {
      setName('');
      setPhone('');
      setIsAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div>
          {!isAdding ? (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus size={16} /> הוספת מספר טלפון
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 bg-slate-50 rounded-xl p-3">
              <input
                type="text"
                placeholder="שם איש הקשר"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 min-w-[140px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="tel"
                placeholder="מספר טלפון"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 min-w-[140px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold px-4 py-2"
              >
                {submitting ? 'שומר...' : 'שמור'}
              </button>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200"
              >
                <X size={16} />
              </button>
            </form>
          )}
        </div>
      )}

      {phones.length === 0 ? (
        <EmptyRow label="לא נמצאו מספרי טלפון." />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-50">
          {phones.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                <p className="text-sm text-slate-500">{p.phone}</p>
              </div>
              <div className="flex items-center gap-1">
                <a
                  href={`tel:${p.phone}`}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-green-600 hover:bg-green-50"
                  aria-label={`חייג ל${p.name}`}
                >
                  <Phone size={16} />
                </a>
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => onEdit(p)}
                      className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      aria-label="ערוך"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(p)}
                      className="w-9 h-9 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50"
                      aria-label="מחק"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinksTab({ links, canManage, onDelete, onAdd }) {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;
    setSubmitting(true);
    const ok = await onAdd({ title: title.trim(), url: url.trim() });
    setSubmitting(false);
    if (ok) {
      setTitle('');
      setUrl('');
      setIsAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div>
          {!isAdding ? (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus size={16} /> הוספת קישור
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 bg-slate-50 rounded-xl p-3">
              <input
                type="text"
                placeholder="כותרת"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="flex-1 min-w-[140px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="url"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold px-4 py-2"
              >
                {submitting ? 'שומר...' : 'שמור'}
              </button>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200"
              >
                <X size={16} />
              </button>
            </form>
          )}
        </div>
      )}

      {links.length === 0 ? (
        <EmptyRow label="לא נמצאו קישורים." />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-50">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{l.title}</p>
                <p className="text-sm text-slate-500 truncate">{l.url}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50"
                  aria-label={`פתח את ${l.title}`}
                >
                  <ExternalLink size={16} />
                </a>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onDelete(l)}
                    className="w-9 h-9 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50"
                    aria-label="מחק"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilesTab({ files, canManage, onDelete, onUpload, onDownload, isUploading }) {
  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (file) onUpload(file);
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div>
          <label className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 cursor-pointer">
            <Plus size={16} />
            {isUploading ? 'מעלה...' : 'העלאת קובץ'}
            <input type="file" className="hidden" onChange={handleFileChange} disabled={isUploading} />
          </label>
        </div>
      )}

      {files.length === 0 ? (
        <EmptyRow label="לא נמצאו קבצים." />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-50">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between py-3">
              <div className="min-w-0 flex items-center gap-2.5">
                <FileText size={18} className="text-slate-400 shrink-0" />
                <p className="text-sm font-semibold text-slate-800 truncate">{f.file_name}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onDownload(f)}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50"
                  aria-label={`הורד את ${f.file_name}`}
                >
                  <Download size={16} />
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onDelete(f)}
                    className="w-9 h-9 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50"
                    aria-label="מחק"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ImportantInfoPage() {
  const { currentUser } = useAuth();
  const canManage = isManager(currentUser);

  const [activeTab, setActiveTab] = useState('phones');
  const [phones, setPhones] = useState([]);
  const [links, setLinks] = useState([]);
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [editingPhone, setEditingPhone] = useState(null);

  async function fetchAll() {
    setIsLoading(true);
    setErrorMessage(null);

    const [phonesRes, linksRes, filesRes] = await Promise.all([
      supabase.from('important_phones').select('*').order('sort_order').order('created_at'),
      supabase.from('important_links').select('*').order('sort_order').order('created_at'),
      supabase.from('important_files').select('*').order('created_at', { ascending: false }),
    ]);

    if (phonesRes.error || linksRes.error || filesRes.error) {
      console.error('Failed to load important info', {
        phones: phonesRes.error,
        links: linksRes.error,
        files: filesRes.error,
      });
      setErrorMessage('אירעה שגיאה בטעינת המידע.');
    } else {
      setPhones(phonesRes.data);
      setLinks(linksRes.data);
      setFiles(filesRes.data);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    fetchAll();
  }, []);

  async function handleAddPhone({ name, phone }) {
    setActionError(null);
    const { error } = await supabase.from('important_phones').insert({ name, phone }).select();
    if (error) {
      console.error('Failed to add phone', error);
      setActionError('אין הרשאה להוסיף מספר טלפון, או שאירעה שגיאה.');
      return false;
    }
    await fetchAll();
    return true;
  }

  async function handleDeletePhone(phone) {
    if (!window.confirm(`למחוק את "${phone.name}"?`)) return;
    setActionError(null);
    const { data, error } = await supabase.from('important_phones').delete().eq('id', phone.id).select();
    if (error) {
      console.error('Failed to delete phone', error);
      setActionError('אין הרשאה למחוק, או שאירעה שגיאה.');
      return;
    }
    if (!data || data.length === 0) {
      // RLS silently matched zero rows rather than raising an error —
      // same class of false-positive-success bug fixed in EditPartnerModal.
      setActionError('המחיקה לא בוצעה בפועל — ייתכן שאין לכם הרשאה לכך.');
      return;
    }
    await fetchAll();
  }

  async function handleAddLink({ title, url }) {
    setActionError(null);
    const { error } = await supabase.from('important_links').insert({ title, url }).select();
    if (error) {
      console.error('Failed to add link', error);
      setActionError('אין הרשאה להוסיף קישור, או שאירעה שגיאה.');
      return false;
    }
    await fetchAll();
    return true;
  }

  async function handleDeleteLink(link) {
    if (!window.confirm(`למחוק את "${link.title}"?`)) return;
    setActionError(null);
    const { data, error } = await supabase.from('important_links').delete().eq('id', link.id).select();
    if (error) {
      console.error('Failed to delete link', error);
      setActionError('אין הרשאה למחוק, או שאירעה שגיאה.');
      return;
    }
    if (!data || data.length === 0) {
      setActionError('המחיקה לא בוצעה בפועל — ייתכן שאין לכם הרשאה לכך.');
      return;
    }
    await fetchAll();
  }

  async function handleUploadFile(file) {
    setActionError(null);
    setIsUploading(true);

    const storagePath = `${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(FILES_BUCKET).upload(storagePath, file);
    if (uploadError) {
      console.error('Failed to upload file', uploadError);
      setActionError('אין הרשאה להעלות קובץ, או שאירעה שגיאה בהעלאה.');
      setIsUploading(false);
      return;
    }

    const { error: insertError } = await supabase
      .from('important_files')
      .insert({
        file_name: file.name,
        storage_path: storagePath,
        file_size: file.size,
        content_type: file.type || null,
      })
      .select();

    if (insertError) {
      console.error('Failed to save file metadata', insertError);
      // Storage upload succeeded but the metadata row didn't — clean up
      // rather than leaving an orphaned object nothing will ever list.
      await supabase.storage.from(FILES_BUCKET).remove([storagePath]);
      setActionError('אירעה שגיאה בשמירת פרטי הקובץ. הקובץ לא נשמר.');
      setIsUploading(false);
      return;
    }

    await fetchAll();
    setIsUploading(false);
  }

  async function handleDeleteFile(file) {
    if (!window.confirm(`למחוק את הקובץ "${file.file_name}"?`)) return;
    setActionError(null);

    const { error: removeError } = await supabase.storage.from(FILES_BUCKET).remove([file.storage_path]);
    if (removeError) {
      console.error('Failed to remove file from storage', removeError);
      setActionError('אין הרשאה למחוק, או שאירעה שגיאה.');
      return;
    }

    const { data: deleteData, error: deleteError } = await supabase
      .from('important_files')
      .delete()
      .eq('id', file.id)
      .select();
    if (deleteError) {
      console.error('Failed to delete file metadata', deleteError);
      setActionError('הקובץ נמחק מהאחסון אך אירעה שגיאה במחיקת הרשומה.');
      return;
    }
    if (!deleteData || deleteData.length === 0) {
      setActionError('הקובץ נמחק מהאחסון אך לא הייתה הרשאה למחוק את הרשומה.');
      return;
    }

    await fetchAll();
  }

  async function handleDownloadFile(file) {
    setActionError(null);
    const { data, error } = await supabase.storage
      .from(FILES_BUCKET)
      .createSignedUrl(file.storage_path, 60);

    if (error || !data?.signedUrl) {
      console.error('Failed to create signed url', error);
      setActionError('אירעה שגיאה בהורדת הקובץ.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="flex flex-col gap-6 p-6" dir="rtl">
      <header>
        <h2 className="text-2xl font-bold text-slate-800">מידע חשוב</h2>
        <p className="text-sm text-slate-500">טלפונים, קבצים וקישורים חשובים</p>
      </header>

      {actionError && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-4 py-2.5">
          {actionError}
        </p>
      )}

      <div className="flex items-center gap-2 border-b border-slate-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        {isLoading ? (
          <EmptyRow label="טוען נתונים..." />
        ) : errorMessage ? (
          <EmptyRow label={errorMessage} />
        ) : (
          <>
            {activeTab === 'phones' && (
              <PhonesTab
                phones={phones}
                canManage={canManage}
                onDelete={handleDeletePhone}
                onAdd={handleAddPhone}
                onEdit={setEditingPhone}
              />
            )}
            {activeTab === 'links' && (
              <LinksTab links={links} canManage={canManage} onDelete={handleDeleteLink} onAdd={handleAddLink} />
            )}
            {activeTab === 'files' && (
              <FilesTab
                files={files}
                canManage={canManage}
                onDelete={handleDeleteFile}
                onUpload={handleUploadFile}
                onDownload={handleDownloadFile}
                isUploading={isUploading}
              />
            )}
          </>
        )}
      </div>

      <EditPhoneModal
        isOpen={editingPhone !== null}
        onClose={() => setEditingPhone(null)}
        phoneEntry={editingPhone}
        onSaved={fetchAll}
      />
    </div>
  );
}
