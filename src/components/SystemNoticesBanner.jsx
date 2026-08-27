import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// Read-only — closing a notice is a manager action on the Maintenance
// & Data screen (0036_system_notices.sql), not a per-viewer dismiss
// here. Every active notice shows to every partner until a manager
// closes it there.
export default function SystemNoticesBanner() {
  const [notices, setNotices] = useState([]);

  useEffect(() => {
    let isCancelled = false;
    supabase
      .from('system_notices')
      .select('id, content, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (isCancelled) return;
        if (error) {
          console.error('Failed to load system notices', error);
          return;
        }
        setNotices(data ?? []);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  if (notices.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {notices.map((n) => (
        <div
          key={n.id}
          className="flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4 shadow-sm"
        >
          <Megaphone size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-amber-900 whitespace-pre-wrap">{n.content}</p>
        </div>
      ))}
    </div>
  );
}
