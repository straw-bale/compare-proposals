import { writable } from 'svelte/store';

// Which schedule screen the address asks for. Set by mount.ts; read by App.svelte.
//   #schedule                  → list
//   #schedule/<id>             → editor
//   #schedule-share/<id>       → read-only view
//   #schedule-print?<options>  → print preview (opened in its own window by the editor)
//   #schedule-prompt           → the assistant's instructions
export const route = writable({ view: 'list', id: null, params: null });

export function parseScheduleHash(hash) {
  const h = hash.replace(/^#/, '');
  const [path, query = ''] = h.split('?');
  const [head, rawId] = path.split('/');
  const id = rawId ? decodeURIComponent(rawId) : null;
  if (head === 'schedule') return id ? { view: 'editor', id } : { view: 'list' };
  if (head === 'schedule-share' && id) return { view: 'share', id };
  if (head === 'schedule-prompt') return { view: 'prompt' };
  if (head === 'schedule-print') {
    const q = new URLSearchParams(query);
    return {
      view: 'print',
      params: {
        paper: q.get('paper') ?? 'letter',
        autoprint: q.get('autoprint') === '1',
        // Opened by the server to make a PDF: use the options given, but don't open the print dialog.
        pdf: q.get('pdf') === '1',
        showToday: q.get('today') !== '0',
        showLegend: q.get('legend') !== '0',
        title: q.get('title') ?? '',
      },
    };
  }
  return null;
}
