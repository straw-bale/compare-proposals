export const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Parse an ISO string (YYYY-MM-DD) or Date into a local-time Date */
export function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Format a Date as YYYY-MM-DD */
export function toISO(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : parseDate(d);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const dy = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

/** Array of the first day of each month between viewStart and viewEnd */
export function monthList(viewStart, viewEnd) {
  const list = [];
  let d = new Date(viewStart.getFullYear(), viewStart.getMonth(), 1);
  const end = new Date(viewEnd.getFullYear(), viewEnd.getMonth(), 1);
  while (d <= end) {
    list.push(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return list;
}

/** Total calendar days between two dates */
export function totalDays(viewStart, viewEnd) {
  return (viewEnd - viewStart) / 864e5;
}

/** Convert a date string to a pixel offset within the Gantt */
export function dateToPx(dateStr, viewStart, viewEnd, ganttWidth) {
  const d = parseDate(dateStr);
  if (!d) return 0;
  return ((d - viewStart) / (totalDays(viewStart, viewEnd) * 864e5)) * ganttWidth;
}

/**
 * Month-zoom variant: each month column is colW px wide regardless of day count.
 * viewStart must be the first day of a month (as produced by timeColumns).
 */
export function dateToPxMonth(dateStr, viewStart, colW) {
  const d = parseDate(dateStr);
  if (!d) return 0;
  const monthOffset = (d.getFullYear() - viewStart.getFullYear()) * 12 + (d.getMonth() - viewStart.getMonth());
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const dayFraction = (d.getDate() - 1) / daysInMonth;
  return (monthOffset + dayFraction) * colW;
}

/** Inverse of dateToPxMonth */
export function pxToDateMonth(xPx, viewStart, colW) {
  const raw = xPx / colW;
  const wholeMonths = Math.floor(raw);
  const fraction    = raw - wholeMonths;
  const base = new Date(viewStart.getFullYear(), viewStart.getMonth() + wholeMonths, 1);
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const day = Math.min(Math.round(fraction * daysInMonth) + 1, daysInMonth);
  return toISO(new Date(base.getFullYear(), base.getMonth(), day));
}

/**
 * Week/biweek zoom: each column is exactly `periodDays` days wide = colW px.
 * This is exact because all columns have the same day count.
 */
export function dateToPxPeriod(dateStr, viewStart, colW, periodDays) {
  const d = parseDate(dateStr);
  if (!d) return 0;
  return ((d - viewStart) / (periodDays * 864e5)) * colW;
}

/** Inverse of dateToPxPeriod */
export function pxToDatePeriod(xPx, viewStart, colW, periodDays) {
  const ms = viewStart.getTime() + (xPx / colW) * periodDays * 864e5;
  const d  = new Date(ms);
  return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Move a weekend date to the nearest weekday (Sat → Fri, Sun → Mon). Returns ISO. */
export function toWeekday(iso) {
  if (!iso) return iso;
  const d = parseDate(iso);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() - 1);
  else if (day === 0) d.setDate(d.getDate() + 1);
  else return iso;
  return toISO(d);
}

/** True if hex colour is light enough to need dark text */
export function isLightColor(hex) {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

/** Earliest task start and latest task end across all tasks */
export function projectDateRange(tasks) {
  const dates = tasks.flatMap(t =>
    t.type === 'milestone' ? [t.date] : [t.start, t.end]
  ).filter(Boolean);
  if (!dates.length) return { start: null, end: null };
  return {
    start: dates.reduce((a, b) => a < b ? a : b),
    end:   dates.reduce((a, b) => a > b ? a : b),
  };
}

/** Compact random ID for project records */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Column width (px) for each zoom level */
export const ZOOM_COL_W = { month: 72, biweek: 54, week: 40 };

/** Array of column start Dates for the given zoom level */
export function timeColumns(viewStart, viewEnd, zoom) {
  const cols = [];
  const d = new Date(viewStart.getFullYear(), viewStart.getMonth(), viewStart.getDate());
  if (zoom === 'biweek') {
    while (d < viewEnd) { cols.push(new Date(d)); d.setDate(d.getDate() + 14); }
  } else if (zoom === 'week') {
    while (d < viewEnd) { cols.push(new Date(d)); d.setDate(d.getDate() + 7); }
  } else {
    const end = new Date(viewEnd.getFullYear(), viewEnd.getMonth(), 1);
    const cur = new Date(viewStart.getFullYear(), viewStart.getMonth(), 1);
    while (cur <= end) { cols.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }
  }
  return cols;
}
