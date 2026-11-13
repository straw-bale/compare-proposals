// The fee over time: the labor hours spread across the project's duration as weekly billable hours, starting and
// ending slower (spin-up and closeout), with what that averages out to per week and per month.
import { totals } from "./fee-calc";
import type { SavedFee } from "./store";
import { esc } from "./table";

const WEEKS_PER_MONTH = 52 / 12;
/** Pace at the very start and end, as a share of full pace. */
const RAMP_FROM = 0.2;
/** Share of the project spent ramping up (and again ramping down), within a sensible range of weeks. */
const RAMP_SHARE = 0.12;
const FULL_TIME = 40;

export const weeksIn = (months: number) => Math.max(1, Math.round(months * WEEKS_PER_MONTH));

/** Weekly hours that add up to `total`: ramping up from RAMP_FROM of full pace, steady, then ramping down. */
export function weeklyHours(total: number, weeks: number): number[] {
  const ramp = Math.min(Math.floor(weeks / 2), Math.max(1, Math.round(weeks * RAMP_SHARE)));
  const pace = Array.from({ length: weeks }, (_, i) => {
    const edge = Math.min(i + 0.5, weeks - i - 0.5); // weeks from the nearer end
    return edge >= ramp ? 1 : RAMP_FROM + (1 - RAMP_FROM) * (edge / ramp);
  });
  const sum = pace.reduce((a, b) => a + b, 0);
  return pace.map((p) => (total * p) / sum);
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const hrs = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const people = (h: number) => (h / FULL_TIME).toLocaleString("en-US", { maximumFractionDigits: 1 });

// Chart geometry (SVG units; the chart scales to its box).
const W = 760;
const H = 260;
const PAD = { l: 48, r: 12, t: 12, b: 40 };

/** The numbers and the chart, or a prompt for the duration. Re-run whenever the fee's figures change. */
export function feeTimeHtml(f: SavedFee): string {
  const months = f.durationMonths ?? null;
  const t = totals(f);
  if (!months) return `<p class="none">Enter the project duration to see the weekly hours.</p>`;
  if (!t.laborHours) return `<p class="none">Add hours to the phases to see them over time.</p>`;
  const weeks = weeksIn(months);
  const series = weeklyHours(t.laborHours, weeks);
  const peak = Math.max(...series);
  const avg = t.laborHours / weeks;
  const rate = t.labor / t.laborHours; // blended $ per hour
  const rows: [string, string][] = [
    ["Average per week", `${hrs(avg)} hours · about ${people(avg)} people full time`],
    ["Peak per week", `${hrs(peak)} hours · about ${people(peak)} people full time`],
    ["Our labor per month", money(t.labor / months)],
    ["Total fee per month", `${money(t.total / months)} <span class="note">with consultants and expenses</span>`],
  ];
  return `
    <table class="grid facts fee-time-facts">${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("")}</table>
    <div class="fee-time-chart" data-weeks="${weeks}" data-rate="${rate}">${chartSvg(series, months)}<div class="fee-time-tip" hidden></div></div>
    <p class="note">Spread over ${weeks} weeks, starting and finishing at a slower pace for spin-up and closeout. A rough guide, not a staffing plan.</p>`;
}

function chartSvg(series: number[], months: number): string {
  const weeks = series.length;
  const top = niceMax(Math.max(...series));
  const sx = (w: number) => PAD.l + (weeks <= 1 ? 0 : (w / (weeks - 1)) * (W - PAD.l - PAD.r));
  const sy = (h: number) => H - PAD.b - (h / top) * (H - PAD.t - PAD.b);
  const yStep = top / 4;
  const yTicks = Array.from({ length: 5 }, (_, i) => i * yStep);
  // Month marks: every month, or every 2, 3, 6 or 12 for longer projects.
  const every = [1, 2, 3, 6, 12].find((n) => months / n <= 12) ?? 12;
  const monthTicks = Array.from({ length: Math.floor(months / every) + 1 }, (_, i) => i * every).filter((m) => m <= months);
  const path = series.map((h, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(h).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Billable hours per week across the project">
    <line class="axis-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(0)}" y2="${sy(0)}"/>
    <line class="axis-line" x1="${PAD.l}" x2="${PAD.l}" y1="${PAD.t}" y2="${sy(0)}"/>
    ${yTicks.map((v) => `<line class="tick-mark" x1="${PAD.l - 4}" x2="${PAD.l}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${PAD.l - 8}" y="${sy(v) + 4}" text-anchor="end">${hrs(v)}</text>`).join("")}
    ${monthTicks
      .map((m) => {
        const x = sx(Math.min(weeks - 1, m * WEEKS_PER_MONTH));
        return `<line class="tick-mark" x1="${x}" x2="${x}" y1="${sy(0)}" y2="${sy(0) + 4}"/><text class="tick" x="${x}" y="${sy(0) + 18}" text-anchor="middle">${m}</text>`;
      })
      .join("")}
    <text class="axis" x="${(PAD.l + W - PAD.r) / 2}" y="${H - 4}" text-anchor="middle">Month</text>
    <text class="axis" transform="translate(12 ${(PAD.t + sy(0)) / 2}) rotate(-90)" text-anchor="middle">Hours per week</text>
    <path class="curve" d="${path}"/>
    <line class="cross" x1="0" x2="0" y1="${PAD.t}" y2="${sy(0)}" visibility="hidden"/>
  </svg>`;
}

/** A round top for the hours axis (e.g. 87 → 100, 130 → 150). */
function niceMax(v: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((n) => n >= v * 1.05) ?? 10 * mag);
}

/** Hover: the week under the pointer, its hours and labor $. Wired once on the fee page. */
export function onFeeTimeMove(e: MouseEvent, f: SavedFee | null) {
  const box = (e.target as Element).closest?.(".fee-time-chart") as HTMLElement | null;
  const svg = box?.querySelector("svg");
  const tip = box?.querySelector<HTMLElement>(".fee-time-tip");
  const cross = svg?.querySelector(".cross");
  if (!box || !svg || !tip || !cross || !f?.durationMonths) return hideFeeTimeTip();
  const weeks = Number(box.dataset.weeks);
  const rate = Number(box.dataset.rate);
  const r = svg.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  if (x < PAD.l || x > W - PAD.r) return hideFeeTimeTip();
  const i = Math.round(((x - PAD.l) / (W - PAD.l - PAD.r)) * (weeks - 1));
  const h = weeklyHours(totals(f).laborHours, weeks)[Math.max(0, Math.min(weeks - 1, i))];
  const cx = PAD.l + (weeks <= 1 ? 0 : (i / (weeks - 1)) * (W - PAD.l - PAD.r));
  cross.setAttribute("x1", String(cx));
  cross.setAttribute("x2", String(cx));
  cross.setAttribute("visibility", "visible");
  tip.innerHTML = `Week ${i + 1} (month ${Math.floor(i / WEEKS_PER_MONTH) + 1}): <b>${esc(hrs(h))} hours</b> · ${esc(money(h * rate))}`;
  tip.hidden = false;
  const left = (cx / W) * r.width;
  tip.style.left = `${Math.min(r.width - tip.offsetWidth, Math.max(0, left + 10))}px`;
}

export function hideFeeTimeTip() {
  document.querySelectorAll<HTMLElement>(".fee-time-tip").forEach((t) => (t.hidden = true));
  document.querySelectorAll(".fee-time-chart .cross").forEach((c) => c.setAttribute("visibility", "hidden"));
}
