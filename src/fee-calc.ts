import type { FeeConsultant, FeePhase, FeeRole, FeeTask, SavedFee } from "./store";

// Fee arithmetic, kept apart from the page so it's easy to check. All amounts are dollars; percents are 0–100.

const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** How the budget is set. Fees saved before the choice existed: by area when only area and cost are filled in. */
export const budgetBy = (f: SavedFee) => f.budget.by ?? (f.budget.amount == null && f.budget.area != null ? "area" : "amount");

/** The construction budget, from whichever way it's set. Null when that way isn't filled in. */
export function budgetOf(f: SavedFee): number | null {
  if (budgetBy(f) === "amount") return f.budget.amount;
  return f.budget.area != null && f.budget.costPerSf != null ? f.budget.area * f.budget.costPerSf : null;
}

export const taskHours = (t: FeeTask) => Object.values(t.hours).reduce((s, h) => s + num(h), 0);
export const taskCost = (t: FeeTask, roles: FeeRole[]) => roles.reduce((s, r) => s + num(t.hours[r.id]) * num(r.rate), 0);

/** A consultant's quoted fee in one phase, and across the fee's phases (amounts for removed phases don't count). */
export const consultantPhase = (c: FeeConsultant, phaseId: string) => num(c.byPhase?.[phaseId]);
export const consultantTotal = (c: FeeConsultant, phases: FeePhase[]) => phases.reduce((s, p) => s + consultantPhase(c, p.id), 0);

/**
 * Scales weights to whole percents that add up to exactly 100: each gets its rounded-down share, and the points left
 * over go to the largest remainders. All null when there's nothing to scale.
 */
export function wholePercents(weights: number[]): (number | null)[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!sum) return weights.map(() => null);
  const exact = weights.map((w) => (w / sum) * 100);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((s, x) => s + x, 0);
  for (const i of exact.map((x, i) => i).sort((a, b) => exact[b] - out[b] - (exact[a] - out[a]))) {
    if (left-- <= 0) break;
    out[i]++;
  }
  return out;
}

export type PhaseTotals = {
  phase: FeePhase;
  hours: number;
  cost: number;
  /** share of all labor, in percent */
  share: number | null;
  /** the phase's typical share in whole percent, scaled so the fee's phases add up to exactly 100% */
  typical: number | null;
};

export type FeeTotals = {
  phases: PhaseTotals[];
  laborHours: number;
  labor: number;
  /** hours by role id */
  roleHours: Record<string, number>;
  consultants: number;
  markup: number;
  expenses: number;
  total: number;
  budget: number | null;
  /** the total as a percent of the construction budget */
  percentOfBudget: number | null;
  /** the top-down fee: target percent × budget */
  target: number | null;
};

export function totals(f: SavedFee): FeeTotals {
  const roleHours: Record<string, number> = {};
  const phases = f.phases.map((phase) => {
    let hours = 0;
    let cost = 0;
    for (const t of phase.tasks) {
      hours += taskHours(t);
      cost += taskCost(t, f.roles);
      for (const r of f.roles) roleHours[r.id] = (roleHours[r.id] ?? 0) + num(t.hours[r.id]);
    }
    return { phase, hours, cost, share: null as number | null, typical: null as number | null };
  });
  const labor = phases.reduce((s, p) => s + p.cost, 0);
  const typical = wholePercents(f.phases.map((p) => num(p.targetShare)));
  phases.forEach((p, i) => {
    p.share = labor ? (p.cost / labor) * 100 : null;
    p.typical = typical[i];
  });
  const consultants = f.consultants.reduce((s, c) => s + consultantTotal(c, f.phases), 0);
  const markup = consultants * (num(f.markupPercent) / 100);
  const expenses = num(f.expenses);
  const total = labor + consultants + markup + expenses;
  const budget = budgetOf(f);
  return {
    phases,
    laborHours: phases.reduce((s, p) => s + p.hours, 0),
    labor,
    roleHours,
    consultants,
    markup,
    expenses,
    total,
    budget,
    percentOfBudget: budget ? (total / budget) * 100 : null,
    target: budget && f.targetPercent != null ? budget * (f.targetPercent / 100) : null,
  };
}

/**
 * The fee as it goes in a proposal: a row per phase, a column for architecture and one per consultant, with totals.
 * Architecture is the firm's labor plus its management markup on that phase's consultant fees; consultant columns
 * are their quoted fees. Expenses, when there are any, get their own row under architecture. Phases and
 * consultants with nothing in them are left out.
 */
export type ProposalTable = {
  columns: { firm: string; discipline: string }[];
  rows: { label: string; amounts: number[]; total: number }[];
  totals: number[];
  total: number;
};

export function proposalTable(f: SavedFee): ProposalTable {
  const markup = num(f.markupPercent) / 100;
  const consultants = f.consultants.filter((c) => consultantTotal(c, f.phases) > 0);
  const rows = f.phases
    .map((p) => {
      const quoted = consultants.map((c) => consultantPhase(c, p.id));
      const labor = p.tasks.reduce((s, t) => s + taskCost(t, f.roles), 0);
      const architecture = labor + quoted.reduce((s, x) => s + x, 0) * markup;
      const amounts = [architecture, ...quoted];
      return { label: p.name, amounts, total: amounts.reduce((s, x) => s + x, 0) };
    })
    .filter((r) => r.total > 0);
  const expenses = num(f.expenses);
  if (expenses) rows.push({ label: "Reimbursable Expenses", amounts: [expenses, ...consultants.map(() => 0)], total: expenses });
  const totals = [0, ...consultants.map(() => 0)].map((_, i) => rows.reduce((s, r) => s + r.amounts[i], 0));
  return {
    columns: [{ firm: "", discipline: "Architecture" }, ...consultants.map((c) => ({ firm: c.firm, discipline: c.discipline }))],
    rows,
    totals,
    total: totals.reduce((s, x) => s + x, 0),
  };
}

/** A single dollar amount ("$4.5 million", "$4,500,000", "4.5M"); ranges and anything unclear give null. */
export function readAmount(text: string): number | null {
  const hits = [...text.matchAll(/\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(million|mil|m|thousand|k)?\b/gi)].filter((m) => m[1].replace(/,/g, "").length);
  if (hits.length !== 1) return null;
  const n = parseFloat(hits[0][1].replace(/,/g, ""));
  const unit = (hits[0][2] ?? "").toLowerCase();
  const value = unit.startsWith("m") ? n * 1e6 : unit === "k" || unit === "thousand" ? n * 1e3 : n;
  return value >= 10_000 ? value : null;
}

/** Floor area in square feet ("12,000 SF", "12,000 sq ft", "12,000 GSF"). */
export function readArea(text: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(?:gsf|nsf|sf|sq\.?\s*ft|square\s+feet|gross\s+square\s+feet)\b/i.exec(text);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}
