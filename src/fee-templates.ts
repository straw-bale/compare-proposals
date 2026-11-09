import type { FeePhase, FeeRole } from "./store";

// Starting points for a fee, by project size. Hours are generic, editable starting numbers.

/** The firm's standard hourly billing rates. Every new fee starts with these; each fee can then change its own. */
export const DEFAULT_ROLES: FeeRole[] = [
  { id: "pr", name: "Principal", rate: 225 },
  { id: "pm", name: "Project Manager", rate: 185 },
  { id: "pa", name: "Project Architect", rate: 155 },
  { id: "pid", name: "Project Interior Designer", rate: 155 },
  { id: "tm", name: "Technology Manager", rate: 185 },
  { id: "de", name: "Architectural Designer", rate: 135 },
  { id: "id", name: "Interior Designer", rate: 135 },
  { id: "ad", name: "Administrative", rate: 100 },
  { id: "dr", name: "BIM Designer", rate: 80 },
];

type Hours = Partial<Record<"pr" | "pm" | "pa" | "de" | "dr" | "ad", number>>;

/** Standard phases with a typical share of labor (percent) and starter tasks, sized for a medium project. */
const PHASES: { name: string; targetShare: number; tasks: [string, Hours][] }[] = [
  {
    name: "Pre-design",
    targetShare: 5,
    tasks: [
      ["Kickoff and programming", { pr: 8, pm: 16, pa: 16, de: 8 }],
      ["Existing conditions survey", { pm: 4, pa: 16, de: 24, dr: 16 }],
      ["Code review", { pa: 12, de: 8 }],
    ],
  },
  {
    name: "Schematic Design",
    targetShare: 15,
    tasks: [
      ["Concept options", { pr: 12, pm: 16, pa: 40, de: 60 }],
      ["Schematic drawings", { pm: 12, pa: 40, de: 60, dr: 40 }],
      ["Owner meetings", { pr: 8, pm: 16, pa: 12 }],
      ["Consultant coordination", { pm: 12, pa: 12 }],
    ],
  },
  {
    name: "Design Development",
    targetShare: 20,
    tasks: [
      ["Design development drawings", { pm: 20, pa: 80, de: 80, dr: 100 }],
      ["Outline specifications", { pa: 30, de: 10 }],
      ["Consultant coordination", { pm: 20, pa: 24 }],
      ["Owner reviews", { pr: 8, pm: 16, pa: 12 }],
    ],
  },
  {
    name: "Construction Documents",
    targetShare: 35,
    tasks: [
      ["Construction drawings", { pm: 30, pa: 160, de: 120, dr: 240 }],
      ["Specifications", { pa: 60, de: 20, ad: 8 }],
      ["QA/QC review", { pr: 16, pm: 16, pa: 16 }],
      ["Consultant coordination", { pm: 30, pa: 30 }],
      ["Permit submission", { pm: 8, pa: 16, ad: 4 }],
    ],
  },
  {
    name: "Bidding",
    targetShare: 5,
    tasks: [
      ["Bidder questions and addenda", { pm: 12, pa: 24, de: 8 }],
      ["Bid review", { pr: 4, pm: 8, pa: 4 }],
    ],
  },
  {
    name: "Construction Administration",
    targetShare: 18,
    tasks: [
      ["Site visits and meetings", { pr: 12, pm: 60, pa: 60 }],
      ["Submittals and RFIs", { pm: 20, pa: 80, de: 40 }],
      ["Pay applications", { pm: 16, ad: 8 }],
      ["Punch list", { pm: 12, pa: 24 }],
    ],
  },
  {
    name: "Closeout",
    targetShare: 2,
    tasks: [["Record drawings and closeout documents", { pm: 8, pa: 16, dr: 24, ad: 8 }]],
  },
];

export type FeeTemplate = {
  key: string;
  name: string;
  /** construction budgets it suits: [from, up to) */
  range: [number, number];
  /** typical fee, percent of construction */
  targetPercent: number | null;
  /** hours scale against the medium starter tasks; 0 leaves the phases empty */
  scale: number;
};

export const TEMPLATES: FeeTemplate[] = [
  { key: "small", name: "Small (under $2M)", range: [0, 2_000_000], targetPercent: 10, scale: 0.5 },
  { key: "medium", name: "Medium ($2M–$10M)", range: [2_000_000, 10_000_000], targetPercent: 8, scale: 1 },
  { key: "large", name: "Large (over $10M)", range: [10_000_000, Infinity], targetPercent: 6.5, scale: 2.5 },
  { key: "blank", name: "Blank (phases only)", range: [0, 0], targetPercent: null, scale: 0 },
];

/** The size template that suits a construction budget (medium when there's no budget). */
export const templateFor = (budget: number | null) =>
  budget == null ? TEMPLATES[1] : (TEMPLATES.find((t) => budget >= t.range[0] && budget < t.range[1]) ?? TEMPLATES[1]);

/** The template's phases and tasks, with fresh ids and hours rounded to whole hours. */
export function templatePhases(t: FeeTemplate): FeePhase[] {
  return PHASES.map((p) => ({
    id: crypto.randomUUID(),
    name: p.name,
    targetShare: p.targetShare,
    tasks: t.scale
      ? p.tasks.map(([name, hours]) => ({
          id: crypto.randomUUID(),
          name,
          hours: Object.fromEntries(Object.entries(hours).map(([r, h]) => [r, Math.max(1, Math.round(h! * t.scale))])),
        }))
      : [],
  }));
}
