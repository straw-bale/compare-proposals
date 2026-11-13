// A read-only snapshot of a schedule for the project page: task names, bars in the schedule's own colours, milestones
// as diamonds, month marks and today. Drawn from the saved schedule, so it matches the schedule maker without loading it.
import type { SavedSchedule } from "./store";
import { esc } from "./table";

type Task = { id?: number; name?: string; type?: string; start?: string; end?: string; date?: string; extraDates?: unknown; color?: string };
/** A milestone row's marks: its date, then any more on the same line. */
const marks = (t: Task) => [t.date, ...(Array.isArray(t.extraDates) ? t.extraDates : [])].map(day).filter((d): d is number => d != null);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (s: unknown) => (typeof s === "string" && ISO.test(s) ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null);
const colour = (c: unknown) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c) ? c : "#00914D");
const MILESTONE = "#20ABE2"; // the schedule maker's milestone colour
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_ROWS = 40;

// Geometry (SVG units; the snapshot scales to its box).
const W = 760;
const NAME_W = 210;
const ROW = 18;
const HEAD = 22;
/** About how many characters of a task name fit the name column at the snapshot's type size. */
const NAME_CHARS = 32;

/** The snapshot, linked to the schedule; "" when the schedule has no dated tasks yet. */
export function scheduleSnapshotHtml(s: SavedSchedule): string {
  const all = ((s.tasks as Task[] | undefined) ?? []).filter((t) => (t.type === "milestone" ? day(t.date) != null : day(t.start) != null && day(t.end) != null));
  if (!all.length) return "";
  const tasks = all.slice(0, MAX_ROWS);
  const times = all.flatMap((t) => (t.type === "milestone" ? marks(t) : [day(t.start)!, day(t.end)!]));
  // The schedule's own view, widened if a task falls outside it.
  let from = day(s.viewStart) ?? Math.min(...times);
  let to = day(s.viewEnd) ?? Math.max(...times);
  from = Math.min(from, ...times);
  to = Math.max(to, ...times);
  if (to <= from) to = from + 30 * 86_400_000;
  const x = (t: number) => NAME_W + ((t - from) / (to - from)) * (W - NAME_W - 8);
  const H = HEAD + tasks.length * ROW + 6;

  // Month marks, thinned to about a dozen labels.
  const start = new Date(from);
  const months: number[] = [];
  for (let d = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (start.getUTCDate() > 1 ? 1 : 0), 1); d <= to; ) {
    months.push(d);
    const n = new Date(d);
    d = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1);
  }
  const every = Math.max(1, Math.ceil(months.length / 12));
  const today = Date.now();
  let labelledYear = 0;
  const clipId = `snap-clip-${String(s.id).replace(/[^\w-]/g, "")}`;

  const rows = tasks
    .map((t, i) => {
      const y = HEAD + i * ROW;
      // Names stay in their column: shortened with "…" to fit (full name on hover), and clipped as a backstop.
      const full = String(t.name ?? "");
      const shown = full.length > NAME_CHARS ? `${full.slice(0, NAME_CHARS - 1).trimEnd()}…` : full;
      const name = `<text class="snap-name" x="0" y="${y + 13}" clip-path="url(#${clipId})">${esc(shown)}<title>${esc(full)}</title></text>`;
      if (t.type === "milestone") {
        const cy = y + ROW / 2;
        return `${name}${marks(t)
          .map((d) => {
            const cx = x(d);
            return `<path d="M${cx},${cy - 5}L${cx + 5},${cy}L${cx},${cy + 5}L${cx - 5},${cy}Z" fill="${MILESTONE}"><title>${esc(String(t.name ?? ""))}: ${new Date(d).toISOString().slice(0, 10)}</title></path>`;
          })
          .join("")}`;
      }
      const x0 = x(day(t.start)!);
      const x1 = Math.max(x(day(t.end)!), x0 + 3);
      return `${name}<rect x="${x0}" y="${y + 4}" width="${x1 - x0}" height="${ROW - 8}" fill="${colour(t.color)}"><title>${esc(String(t.name ?? ""))}: ${esc(String(t.start))} to ${esc(String(t.end))}</title></rect>`;
    })
    .join("");

  return `<a class="schedule-snap" href="#schedule/${encodeURIComponent(s.id)}" aria-label="Open the schedule">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Schedule snapshot">
      <defs><clipPath id="${clipId}"><rect x="0" y="0" width="${NAME_W - 8}" height="${H}"/></clipPath></defs>
      ${months
        .map((m, i) => {
          const d = new Date(m);
          const mx = x(m);
          // The year on the first label, and on the first label of each new year.
          const year = d.getUTCFullYear();
          const showYear = i % every === 0 && year !== labelledYear;
          if (showYear) labelledYear = year;
          const label = i % every === 0 ? `<text class="snap-month" x="${mx + 2}" y="12">${MONTHS[d.getUTCMonth()]}${showYear ? ` ’${String(year).slice(2)}` : ""}</text>` : "";
          return `<line class="snap-grid" x1="${mx}" x2="${mx}" y1="${HEAD - 4}" y2="${H}"/>${label}`;
        })
        .join("")}
      ${rows}
      ${today >= from && today <= to ? `<line class="snap-today" x1="${x(today)}" x2="${x(today)}" y1="${HEAD - 6}" y2="${H}"><title>Today</title></line>` : ""}
    </svg>
    ${all.length > MAX_ROWS ? `<span class="note">and ${all.length - MAX_ROWS} more</span>` : ""}
  </a>`;
}
