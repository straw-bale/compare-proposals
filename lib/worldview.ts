// The firm's world view: what the team tells the AI about who it is, what it pursues and how to weigh things, plus
// the expected fee by construction budget and the past pursuits that show what worked. Shared by the browser (the
// World view page) and the server (prompt assembly). No dependencies.

import type { Rfp } from "./claude.js";

export type FeePoint = { budget: number; percent: number };
/** One phase of the standard split of the architectural fee, in percent; the phases add up to 100. */
export type PhaseShare = { name: string; percent: number };

export type WorldView = {
  id: "worldview";
  savedAt: number;
  whoWeAre: string;
  goodPursuit: string;
  redFlags: string;
  weighing: string;
  /** where the market is (dated, with sources), so judgments reflect current conditions */
  marketConditions: string;
  /** expected architectural fee, percent of construction, at a few construction budgets */
  feeCurve: FeePoint[];
  /** the standard split of the architectural fee by phase, Programming through Closeout */
  phaseShares: PhaseShare[];
  /** the firm's usual proposal sections, in order; only the RFP review's proposal outline uses them */
  proposalSections: string[];
};

export type Outcome = "won" | "shortlisted" | "lost" | "no bid";
export const OUTCOMES: Outcome[] = ["won", "shortlisted", "lost", "no bid"];

/** A past pursuit: the RFP, the proposal we sent, and how it turned out. */
export type Pursuit = {
  id: string;
  savedAt: number;
  /** the past RFP: read from its PDFs when the pursuit was added, or copied from the saved review it came from */
  rfp?: Rfp;
  /** its PDF file names, and what reading them cost (none when it came from a saved review) */
  files?: string[];
  reviewCostUsd?: number | null;
  /** the saved RFP review it came from, if any (older pursuits have only this, without a copy) */
  rfpId?: string;
  outcome: Outcome;
  /** what our proposal emphasised: team, approach, fee basis */
  ourProposal: string;
  debrief: string;
  /** construction budget and our fee, both dollars, for the fee curve */
  budget: number | null;
  ourFee: number | null;
};

/** Placeholder baseline from the fee templates, for the team to replace. */
export const DEFAULT_CURVE: FeePoint[] = [
  { budget: 1_000_000, percent: 10 },
  { budget: 5_000_000, percent: 8 },
  { budget: 10_000_000, percent: 7 },
  { budget: 25_000_000, percent: 6 },
  { budget: 50_000_000, percent: 5.5 },
];

/** Placeholder split from the fee templates, for the team to replace. */
/** The firm's usual proposal, cover letter first (from its standard table of contents). */
export const DEFAULT_SECTIONS = [
  "Cover Letter",
  "Project Understanding",
  "Project Approach",
  "Project Team",
  "Relevant Project Experience",
  "Project Fee",
  "Notes + Qualifications",
];

/** The standard sections as the RFP review's outline sees them. */
export const sectionsText = (sections: string[] | undefined) =>
  sections?.length ? `## The firm's standard proposal sections, in order\n${sections.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "";

export const DEFAULT_PHASES: PhaseShare[] = [
  { name: "Programming", percent: 5 },
  { name: "Schematic Design", percent: 15 },
  { name: "Design Development", percent: 20 },
  { name: "Construction Documents", percent: 35 },
  { name: "Bidding", percent: 5 },
  { name: "Construction Administration", percent: 18 },
  { name: "Closeout", percent: 2 },
];

/**
 * Starting market conditions, from the AIA's July 2026 reports. Shown until the team edits the World view's
 * Market conditions; refresh it when new reports come out.
 */
export const MARKET_JULY_2026 = `As of July 2026 (AIA Architecture Billings Index, July 2026; AIA Consensus Construction Forecast, July 2026):
- Billings at architecture firms have been shrinking nationally since early 2023 (index 46.6 in July; below 50 means declining). The Northeast, which includes Pennsylvania, is the weakest region (44.8), for a second straight month.
- Expect more firms competing for each public RFP and pressure on fees. Be selective, and price carefully rather than chasing work.
- Nonresidential construction spending is forecast to dip 0.3% in 2026, then grow 3.0% in 2027.
- Institutional work (education, healthcare, public buildings) is the steadiest: forecast up 2.8% in 2026 and 2.7% in 2027.
- Commercial growth is almost all data centers; without them it's flat, and office work is falling. Manufacturing is forecast down 11.6% in 2026.`;

export const emptyWorldView = (): WorldView => ({
  id: "worldview",
  savedAt: 0,
  whoWeAre: "",
  goodPursuit: "",
  redFlags: "",
  weighing: "",
  marketConditions: MARKET_JULY_2026,
  feeCurve: DEFAULT_CURVE.map((p) => ({ ...p })),
  phaseShares: DEFAULT_PHASES.map((p) => ({ ...p })),
  proposalSections: [...DEFAULT_SECTIONS],
});

/**
 * The expected fee percent at a construction budget: straight lines between the points on a log budget scale, and
 * the end values held beyond the first and last points. Null when there are no usable points or no budget.
 */
export function feeCurveAt(points: FeePoint[], budget: number | null | undefined): number | null {
  const pts = points.filter((p) => p.budget > 0 && Number.isFinite(p.percent)).sort((a, b) => a.budget - b.budget);
  if (!pts.length || !budget || budget <= 0) return null;
  if (budget <= pts[0].budget) return pts[0].percent;
  const last = pts[pts.length - 1];
  if (budget >= last.budget) return last.percent;
  const i = pts.findIndex((p) => p.budget >= budget);
  const a = pts[i - 1];
  const b = pts[i];
  const t = (Math.log(budget) - Math.log(a.budget)) / (Math.log(b.budget) - Math.log(a.budget));
  return a.percent + t * (b.percent - a.percent);
}

const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M` : `$${Math.round(n).toLocaleString("en-US")}`;

/** The team's world view as it's given to the AI. Empty parts are left out; "" when there's nothing at all. */
export function worldViewText(w: WorldView | null | undefined): string {
  if (!w) return "";
  const part = (title: string, text: string) => (text.trim() ? `### ${title}\n${text.trim()}` : "");
  const curve = [...w.feeCurve]
    .filter((p) => p.budget > 0)
    .sort((a, b) => a.budget - b.budget)
    .map((p) => `${money(p.budget)}: ${p.percent}%`)
    .join(", ");
  return [
    part("Who we are", w.whoWeAre),
    part("What makes a good pursuit", w.goodPursuit),
    part("Deal-breakers and red flags", w.redFlags),
    part("How to weigh things", w.weighing),
    part("Market conditions", w.marketConditions),
    curve ? `### Expected architectural fee by construction budget\n${curve} (percent of construction; straight-line between points).` : "",
    w.phaseShares?.length
      ? `### Standard split of the architectural fee by phase\n${w.phaseShares.map((p) => `${p.name} ${p.percent}%`).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What a past pursuit's RFP was, in a few words, from its saved review. */
export type PursuitRfp = { name: string; client: string; summary: string; budget: string; size: string; services: string[] };

/** One line per past pursuit, as the AI sees it. */
export function pursuitLine(p: Pursuit, r: PursuitRfp): string {
  const fee = p.ourFee != null && p.budget ? ` Our fee ${money(p.ourFee)} (${((p.ourFee / p.budget) * 100).toFixed(1)}% of ${money(p.budget)}).` : "";
  return [
    `- ${r.name} for ${r.client}: ${p.outcome.toUpperCase()}.`,
    r.summary,
    [r.size && `Size ${r.size}.`, r.budget && `Budget ${r.budget}.`, r.services.length ? `Disciplines: ${r.services.join(", ")}.` : ""].filter(Boolean).join(" "),
    fee.trim(),
    p.ourProposal.trim() && `Our proposal: ${p.ourProposal.trim()}`,
    p.debrief.trim() && `Debrief: ${p.debrief.trim()}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The firm context appended to a feature's built-in instructions. "" when the team hasn't said anything. */
export function firmContext(worldView: string, pursuits: string[]): string {
  const parts: string[] = [];
  if (worldView.trim())
    parts.push(
      `## The firm's world view\nWritten by the firm about itself. Keep it in mind throughout, so the response fits the firm's work: what it pursues, what it charges, what it avoids. It reflects the firm's priorities and experience, not facts about the documents in front of you.\n\n${worldView.trim()}`,
    );
  if (pursuits.length)
    parts.push(
      `## Past pursuits\nRFPs the firm pursued or considered, with how each turned out. Use them as evidence of what wins and what doesn't; name one in fit.reasons when it's the basis for a point.\n${pursuits.join("\n")}`,
    );
  return parts.join("\n\n");
}
