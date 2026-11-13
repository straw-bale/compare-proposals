// The fee over time: each phase's labor hours spread over its own stretch of the project, in order, as weekly
// billable hours. Each phase's stretch is a typical share of the project's duration, so the shape follows the
// months entered: a light start in programming, the documents peak, a long lighter construction phase.
import { totals } from "./fee-calc";
import { shortPhase } from "./fee-templates";
import type { SavedFee } from "./store";
import { esc } from "./table";

const WEEKS_PER_MONTH = 52 / 12;
const FULL_TIME = 40;

/**
 * Typical share of a project's calendar time for each phase, by name. Construction administration runs as long as
 * construction, so it takes the largest share; documents phases are short and dense. Shares are rescaled to the
 * phases the fee actually has.
 */
const TIME_SHARE: [RegExp, number][] = [
  [/program|pre-?design|feasib/i, 6],
  [/schematic|\bsd\b/i, 10],
  [/design dev|\bdd\b/i, 12],
  [/construction doc|\bcd\b|documents/i, 16],
  [/bid|procure|negotiat|permit/i, 6],
  [/construction|\bca\b/i, 45],
  [/close/i, 5],
];
const OTHER_SHARE = 8;
const timeShare = (name: string) => TIME_SHARE.find(([re]) => re.test(name))?.[1] ?? OTHER_SHARE;

export const weeksIn = (months: number) => Math.max(1, Math.round(months * WEEKS_PER_MONTH));

export type PhaseSpan = { name: string; hours: number; start: number; end: number };

/** Each phase's stretch of the project, in weeks (fractional), in order, with its hours. */
export function phaseSpans(f: SavedFee, weeks: number): PhaseSpan[] {
  const t = totals(f);
  const shares = f.phases.map((p) => timeShare(p.name));
  const sum = shares.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  return f.phases.map((p, i) => {
    const len = (shares[i] / sum) * weeks;
    const span = { name: p.name, hours: t.phases[i].hours, start: at, end: at + len };
    at += len;
    return span;
  });
}

/** Weekly hours: each phase's hours spread evenly over its stretch (a week shared by two phases gets part of each). */
export function weeklyHours(spans: PhaseSpan[], weeks: number): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const s of spans) {
    const len = s.end - s.start;
    if (len <= 0 || !s.hours) continue;
    const perWeek = s.hours / len;
    for (let w = Math.floor(s.start); w < Math.min(weeks, Math.ceil(s.end)); w++) {
      const overlap = Math.min(w + 1, s.end) - Math.max(w, s.start);
      if (overlap > 0) out[w] += perWeek * overlap;
    }
  }
  return out;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const hrs = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const people = (h: number) => {
  const n = Math.round((h / FULL_TIME) * 10) / 10;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${n === 1 ? "person" : "people"}`;
};
const months1 = (weeks: number) => (weeks / WEEKS_PER_MONTH).toLocaleString("en-US", { maximumFractionDigits: 1 });

// Chart geometry (SVG units; the chart scales to its box).
const W = 760;
const H = 280;
const PAD = { l: 48, r: 12, t: 30, b: 40 };

/** The numbers and the chart, or a prompt for the duration. Re-run whenever the fee's figures change. */
export function feeTimeHtml(f: SavedFee): string {
  const months = f.durationMonths ?? null;
  const t = totals(f);
  if (!months) return `<p class="none">Enter the project duration to see the weekly hours.</p>`;
  if (!t.laborHours) return `<p class="none">Add hours to the phases to see them over time.</p>`;
  const weeks = weeksIn(months);
  const spans = phaseSpans(f, weeks);
  const series = weeklyHours(spans, weeks);
  const peak = Math.max(...series);
  const peakWeek = series.indexOf(peak);
  const peakPhase = spans.find((s) => peakWeek + 0.5 >= s.start && peakWeek + 0.5 < s.end)?.name ?? "";
  const avg = t.laborHours / weeks;
  const rate = t.labor / t.laborHours; // blended $ per hour
  const rows: [string, string][] = [
    ["Average per week", `${hrs(avg)} hours · about ${people(avg)} full time`],
    ["Peak per week", `${hrs(peak)} hours · about ${people(peak)} full time${peakPhase ? ` <span class="note">in ${esc(peakPhase)}</span>` : ""}`],
    ["Our labor per month", money(t.labor / months)],
    ["Total fee per month", `${money(t.total / months)} <span class="note">with consultants and expenses</span>`],
  ];
  return `
    <table class="grid facts fee-time-facts">${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("")}</table>
    <div class="fee-time-chart" data-weeks="${weeks}" data-rate="${rate}">${chartSvg(series, spans, months)}<div class="fee-time-tip" hidden></div></div>
    <p class="note">Each phase's hours spread over its typical share of the ${esc(String(months))} months (${spans
      .map((s) => `${esc(shortPhase(s.name))} ${months1(s.end - s.start)}`)
      .join(", ")}). A rough guide, not a staffing plan.</p>`;
}

function chartSvg(series: number[], spans: PhaseSpan[], months: number): string {
  const weeks = series.length;
  const step = niceStep(Math.max(...series) / 4);
  const top = Math.ceil((Math.max(...series) * 1.05) / step) * step;
  // x is in weeks from the start (0 … weeks); each week's hours sit at its middle.
  const sx = (w: number) => PAD.l + (w / weeks) * (W - PAD.l - PAD.r);
  const sy = (h: number) => H - PAD.b - (h / top) * (H - PAD.t - PAD.b);
  const yTicks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  // Month marks: every month, or every 2, 3, 6 or 12 for longer projects.
  const every = [1, 2, 3, 6, 12].find((n) => months / n <= 12) ?? 12;
  const monthTicks = Array.from({ length: Math.floor(months / every) + 1 }, (_, i) => i * every).filter((m) => m <= months);
  // A step per week, so each phase reads as its own level.
  const path = series.map((h, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(h).toFixed(1)}L${sx(i + 1).toFixed(1)},${sy(h).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Billable hours per week across the project, phase by phase">
    ${spans
      .map((s, i) => {
        const x0 = sx(s.start);
        const x1 = sx(s.end);
        const label = x1 - x0 > 26 ? `<text class="phase" x="${(x0 + x1) / 2}" y="${PAD.t - 10}" text-anchor="middle">${esc(shortPhase(s.name))}</text>` : "";
        return `${i ? `<line class="phase-line" x1="${x0}" x2="${x0}" y1="${PAD.t - 22}" y2="${sy(0)}"/>` : ""}${label}`;
      })
      .join("")}
    <line class="axis-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(0)}" y2="${sy(0)}"/>
    <line class="axis-line" x1="${PAD.l}" x2="${PAD.l}" y1="${PAD.t}" y2="${sy(0)}"/>
    ${yTicks.map((v) => `<line class="tick-mark" x1="${PAD.l - 4}" x2="${PAD.l}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${PAD.l - 8}" y="${sy(v) + 4}" text-anchor="end">${hrs(v)}</text>`).join("")}
    ${monthTicks
      .map((m) => {
        const x = sx(m * WEEKS_PER_MONTH * (weeks / (months * WEEKS_PER_MONTH)));
        return `<line class="tick-mark" x1="${x}" x2="${x}" y1="${sy(0)}" y2="${sy(0) + 4}"/><text class="tick" x="${x}" y="${sy(0) + 18}" text-anchor="middle">${m}</text>`;
      })
      .join("")}
    <text class="axis" x="${(PAD.l + W - PAD.r) / 2}" y="${H - 4}" text-anchor="middle">Month</text>
    <text class="axis" transform="translate(12 ${(PAD.t + sy(0)) / 2}) rotate(-90)" text-anchor="middle">Hours per week</text>
    <path class="curve" d="${path}"/>
    <line class="cross" x1="0" x2="0" y1="${PAD.t}" y2="${sy(0)}" visibility="hidden"/>
  </svg>`;
}

/** A round step for the hours axis (e.g. 33 → 50, 18 → 20), so its labels are round numbers. */
function niceStep(v: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((n) => n >= v) ?? 10 * mag;
}

/** Hover: the week under the pointer, its phase, hours and labor $. Wired once on the fee page. */
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
  const i = Math.max(0, Math.min(weeks - 1, Math.floor(((x - PAD.l) / (W - PAD.l - PAD.r)) * weeks)));
  const spans = phaseSpans(f, weeks);
  const h = weeklyHours(spans, weeks)[i];
  const phase = spans.find((s) => i + 0.5 >= s.start && i + 0.5 < s.end)?.name ?? "";
  const cx = PAD.l + ((i + 0.5) / weeks) * (W - PAD.l - PAD.r);
  cross.setAttribute("x1", String(cx));
  cross.setAttribute("x2", String(cx));
  cross.setAttribute("visibility", "visible");
  tip.innerHTML = `Week ${i + 1} (month ${Math.floor(i / WEEKS_PER_MONTH) + 1})${phase ? `, ${esc(phase)}` : ""}: <b>${esc(hrs(h))} hours</b> · ${esc(money(h * rate))}`;
  tip.hidden = false;
  const left = (cx / W) * r.width;
  tip.style.left = `${Math.min(r.width - tip.offsetWidth, Math.max(0, left + 10))}px`;
}

export function hideFeeTimeTip() {
  document.querySelectorAll<HTMLElement>(".fee-time-tip").forEach((t) => (t.hidden = true));
  document.querySelectorAll(".fee-time-chart .cross").forEach((c) => c.setAttribute("visibility", "hidden"));
}
