// Stands in for SvelteKit's goto(): the schedule maker's paths become hash routes in this app.
//   /                → #schedule          (schedule list)
//   /project/<id>    → #schedule/<id>     (editor)
//   /system-prompt   → #schedule-prompt
export function goto(path) {
  const m = /^\/project\/(.+)$/.exec(path);
  location.hash = m ? `#schedule/${encodeURIComponent(m[1])}` : path === '/system-prompt' ? '#schedule-prompt' : '#schedule';
}
