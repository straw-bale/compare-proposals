import { budgetBy, budgetOf, readAmount, readArea, consultantTotal, proposalTable, taskCost, taskHours, totals, type ProposalTable } from "./fee-calc";
import { DEFAULT_ROLES, shortPhase, shortRole, TEMPLATES, templateFor, templatePhases } from "./fee-templates";
import { confirmDelete, formModal, noticeModal } from "./modal";
import { projectDisciplines } from "./rfp";
import { getWorldView, deleteFee, listComparisons, listFees, listProjects, listRfps, projectLabel, saveFee, savesShared, type SavedFee, type SavedProject } from "./store";
import { esc, firmName } from "./table";
import { post } from "./api";
import { feeCurveAt, type FeePoint } from "../lib/worldview";
import { contextForRfp } from "./worldview";
import type { FeeDraft } from "../lib/claude";
import { usd, type Usage } from "../lib/cost";

// Fee builder: labor by phase (hours per role × the role's rate), consultants with a management markup, and a
// construction budget to check the total against as a percentage. One fee per project; also usable on its own.

const $ = (id: string) => document.getElementById(id)!;

let fee: SavedFee | null = null;
// Undo: snapshots of the fee kept in memory while it's open (cleared on leaving it or reloading). A snapshot is
// taken each time an edit is finished (leaving a box, adding or removing a row), so one undo steps back one edit.
const UNDO_LIMIT = 50;
let undoStack: string[] = [];
let committed = "";

/** Records the finished edit, so Undo can step back to before it. */
function checkpoint() {
  if (!fee) return;
  const now = JSON.stringify(fee);
  if (now === committed) return;
  undoStack.push(committed);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  committed = now;
  updateUndo();
}

function updateUndo() {
  const b = document.querySelector<HTMLButtonElement>("#fee-page [data-undo]");
  if (b) b.disabled = !undoStack.length;
}

/** Steps back one finished edit, and saves the fee as it was. */
function undo() {
  if (!fee) return;
  checkpoint(); // an edit still being typed counts as finished
  const prev = undoStack.pop();
  if (!prev) return;
  fee = JSON.parse(prev) as SavedFee;
  committed = prev;
  rerender(false);
  changed();
}

/** phases whose task tables are open (the rest show one summary line each) */
const openPhases = new Set<string>();
let projects: SavedProject[] = [];
let initialized = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const hrs = (n: number) => (n ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—");
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);
/** "$1,250,000", "12.5%", "1,200" → number; blank or unreadable → null. */
const parseNum = (s: string) => {
  const n = parseFloat(s.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
/** A number as shown in an input: with thousands commas ("4,500,000"), blank for none. */
const numValue = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/**
 * Adds thousands commas to a number box while typing, keeping the caret beside the same digit. Whatever has been
 * typed after a decimal point is left alone, so "12." and "1.50" stay as typed.
 */
function addCommas(el: HTMLInputElement) {
  const before = el.value;
  const caret = el.selectionStart ?? before.length;
  const digitsBefore = before.slice(0, caret).replace(/[^\d.]/g, "").length;
  const clean = before.replace(/[^\d.-]/g, "");
  const [int, ...dec] = clean.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = int.replace(/-/g, "").replace(/^0+(?=\d)/, "");
  const next = sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (dec.length ? "." + dec.join("") : "");
  if (next === before) return;
  el.value = next;
  // Put the caret after the same number of digits (and decimal point) as before.
  let pos = 0;
  for (let seen = 0; pos < next.length && seen < digitsBefore; pos++) if (/[\d.]/.test(next[pos])) seen++;
  el.setSelectionRange(pos, pos);
}

// ---------- Entry points ----------

// The World view's fee curve (expected fee percent by construction budget), loaded with the page.
let curve: FeePoint[] = [];
const curveTarget = (budget: number | null) => {
  const p = feeCurveAt(curve, budget);
  return p == null ? null : Math.round(p * 10) / 10;
};

/** Moves a curve-based target to the curve's value at the fee's current budget, in the model and its box. */
function followCurve(f: SavedFee) {
  const p = curveTarget(budgetOf(f));
  if (p == null) return;
  f.targetPercent = p;
  const box = document.querySelector<HTMLInputElement>('#fee-page [data-k="targetPercent"]');
  if (box) box.value = numValue(p);
}

export async function showFee(id: string | null) {
  curve = (await getWorldView().catch(() => null))?.feeCurve ?? [];
  if (!initialized) {
    initialized = true;
    const page = $("fee-page");
    page.addEventListener("click", onClick);
    page.addEventListener("input", onInput);
    // Fires when an edited box is left or Enter is pressed: recalculate then.
    page.addEventListener("change", (e) => {
      if (fee && (e.target as HTMLElement).matches(".fee-in")) {
        refresh();
        checkpoint();
      }
    });
    // Ctrl+Z / Cmd+Z undoes the last finished edit, except while typing in a box (where it undoes the typing).
    addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      if (!fee || page.closest("[hidden]") || document.querySelector("dialog[open]")) return;
      if ((e.target as HTMLElement).matches?.("input, textarea, select")) return;
      e.preventDefault();
      undo();
    });
    page.addEventListener("keydown", (e) => {
      const el = e.target as HTMLInputElement;
      if (e.key === "Enter" && el.matches(".fee-in")) el.blur();
    });
    addEventListener("pagehide", () => flushFee(true));
  }
  if (fee && fee.id !== id) flushFee();
  if (id) return openFee(id);
  fee = null;
  return showList();
}

/** Saves the open fee now (when leaving it, or with keepalive when the page is closing). */
export function flushFee(keepalive = false) {
  clearTimeout(saveTimer);
  if (!fee || !dirty) return;
  dirty = false;
  saveFee({ ...fee, savedAt: Date.now() }, keepalive).catch((err) => showSaveError((err as Error).message));
}

/**
 * Makes a fee and opens it. From a project, it's named after the project, starts with the RFP review's budget and
 * area (when they're plain numbers), the template that suits that budget, and a row per discipline it needs.
 * A project has at most one fee: if it already has one, that opens instead.
 */
export async function makeFee(project?: SavedProject) {
  const [fees, rfps, cmps] = await Promise.all([listFees(), project ? listRfps() : [], project ? listComparisons() : []]);
  if (project) {
    const existing = fees.find((f) => f.workspaceProjectId === project.id);
    if (existing) return void (location.hash = `#fee/${encodeURIComponent(existing.id)}`);
  }
  const rfp = project && (rfps.find((r) => r.id === project.rfpId) ?? rfps.find((r) => r.projectId === project.id));
  const budget = rfp ? readAmount(rfp.rfp.facts.construction_budget?.value ?? "") : null;
  const area = rfp ? readArea(rfp.rfp.facts.building_size?.value ?? "") : null;

  // Make fee can run from a project page before the Fee tab has loaded the fee curve.
  const world = await getWorldView().catch(() => null);
  curve = world?.feeCurve ?? curve;
  const suggested = templateFor(budget);
  const options = [...(rfp ? [AI_DRAFT] : []), ...TEMPLATES.map((t) => t.name)];
  const picked = await formModal({
    title: "New fee",
    fields: [{ label: "Start from", value: suggested.name, options, single: true, required: true }],
    confirm: "Make fee",
  });
  if (!picked) return;
  const template = TEMPLATES.find((t) => t.name === picked[0]) ?? suggested;

  // Firms already proposing on the project, by discipline.
  const firms = new Map<string, string>();
  for (const c of cmps.filter((c) => project && c.projectId === project.id))
    for (const p of c.proposals) for (const d of p.disciplines ?? []) if (p.firm && !firms.has(d)) firms.set(d, firmName(p.firm));
  // Consultant rows for the disciplines the project needs, apart from the firm's own work.
  const IN_HOUSE: string[] = ["Architecture", "Interiors", "FF&E"];
  const disciplines = project ? projectDisciplines(rfp?.rfp, project.disciplinesRemoved).filter((d) => !IN_HOUSE.includes(d)) : [];

  const record: SavedFee = {
    id: crypto.randomUUID(),
    savedAt: Date.now(),
    title: project ? projectLabel(project) : "Untitled fee",
    workspaceProjectId: project?.id,
    template: template.key,
    budget: { by: area ? "area" : "amount", amount: area ? null : budget, area, costPerSf: area && budget ? Math.round(budget / area) : null },
    // From the World view's fee curve when there's a budget, else the template's typical percent.
    targetPercent: curveTarget(budget) ?? template.targetPercent,
    targetFromCurve: curveTarget(budget) != null,
    roles: DEFAULT_ROLES.map((r) => ({ ...r })),
    phases: templatePhases(template, world?.phaseShares),
    consultants: disciplines.map((d) => ({ id: crypto.randomUUID(), discipline: d, firm: firms.get(d) ?? "", byPhase: {} })),
    markupPercent: 10,
    expenses: null,
  };
  if (picked[0] === AI_DRAFT && rfp) {
    const context = await contextForRfp(rfp);
    const drafted = await withWaiting("Drafting the fee from the RFP review…", () =>
      post<{ draft: FeeDraft; usage: Usage }>(
        "/api/fee-draft",
        JSON.stringify({ rfp: rfp.rfp, roles: record.roles, worldView: context.worldView, pursuits: context.pursuits }),
        { "content-type": "application/json" },
      ),
    ).catch((err: Error) => noticeModal("Couldn't draft the fee", err.message).then(() => null));
    if (!drafted) return;
    record.lens = context.lens;
    applyDraft(record, drafted.draft, drafted.usage);
  }
  try {
    await saveFee(record);
  } catch (err) {
    return noticeModal("Not saved", (err as Error).message);
  }
  location.hash = `#fee/${encodeURIComponent(record.id)}`;
}

const AI_DRAFT = "Draft from the RFP review (AI)";

/** Shows a "please wait" dialog while `work` runs. */
async function withWaiting<T>(message: string, work: () => Promise<T>): Promise<T> {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.innerHTML = `<h2>${esc(message)}</h2><p>This usually takes under a minute.</p>`;
  dialog.addEventListener("cancel", (e) => e.preventDefault()); // stays up until the draft is back
  document.body.appendChild(dialog);
  dialog.showModal();
  try {
    return await work();
  } finally {
    dialog.close();
    dialog.remove();
  }
}

/**
 * Fills a new fee from an AI draft: budget, target, and the firm's own phases and tasks (known roles only).
 * Consultant rows stay as they were, without fees, to be filled in from their proposals.
 */
function applyDraft(f: SavedFee, d: FeeDraft, usage: Usage) {
  const roleIds = new Set(f.roles.map((r) => r.id));
  const whole = (n: number) => Math.max(0, Math.round(n));
  f.template = "ai";
  f.budget = {
    by: d.budget.by,
    amount: d.budget.amount != null ? whole(d.budget.amount) : null,
    area: d.budget.area != null ? whole(d.budget.area) : null,
    costPerSf: d.budget.cost_per_sf != null ? whole(d.budget.cost_per_sf) : null,
  };
  f.targetPercent = Math.round(d.target_percent * 10) / 10;
  f.targetFromCurve = false;
  f.phases = d.phases.map((p) => ({
    id: crypto.randomUUID(),
    name: p.name,
    targetShare: Math.round(p.target_share),
    tasks: p.tasks.map((t) => ({
      id: crypto.randomUUID(),
      name: t.name,
      hours: Object.fromEntries(t.hours.filter((h) => roleIds.has(h.role_id) && h.hours > 0).map((h) => [h.role_id, whole(h.hours)])),
    })),
  }));
  f.expenses = d.expenses != null ? whole(d.expenses) : null;
  f.draft = { basis: d.budget.basis, assumptions: d.assumptions, costUsd: usage.cost_usd ?? null, at: Date.now() };
}


/**
 * Keeps a fee's phases in line with the World view's standard split: "Pre-design" is called Programming, and a phase
 * with the same name as one in the split takes its typical share from there. Returns whether anything changed.
 */
function matchPhaseSplit(f: SavedFee, split: { name: string; percent: number }[]): boolean {
  let changed = false;
  const key = (n: string) => n.trim().toLowerCase();
  for (const p of f.phases) {
    if (/^pre-?\s?design$/i.test(p.name.trim())) {
      p.name = "Programming";
      changed = true;
    }
    const s = split.find((x) => key(x.name) === key(p.name));
    if (s && s.percent !== p.targetShare) {
      p.targetShare = s.percent;
      changed = true;
    }
  }
  return changed;
}

/**
 * A fee with no rates entered at all (made before the rate sheet was the default) gets the standard roles and rates.
 * Roles with the same id keep their hours; names follow the rate sheet. Returns whether anything changed.
 */
function fillRates(f: SavedFee): boolean {
  if (f.roles.some((r) => r.rate != null)) return false;
  const custom = f.roles.filter((r) => !DEFAULT_ROLES.some((d) => d.id === r.id));
  f.roles = [...DEFAULT_ROLES.map((r) => ({ ...r })), ...custom];
  return true;
}

// ---------- List ----------

async function showList() {
  const [fees, ps] = await Promise.all([listFees(), listProjects()]);
  projects = ps;
  const items = [...fees]
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((f) => {
      const p = ps.find((x) => x.id === f.workspaceProjectId);
      return `<li>
        <a class="link open" href="#fee/${encodeURIComponent(f.id)}"><b>${esc(f.title || "Untitled fee")}</b></a>
        <span class="when">${esc(money(totals(f).total))}</span>
        <span>${p ? "" : `<span class="note">no project</span>`}</span>
      </li>`;
    })
    .join("");
  $("fee-page").innerHTML = `
    <div class="saved"><h2 class="label">Fees</h2>
      ${items ? `<ol>${items}</ol>` : `<p class="none">None yet. Make one from a project page, or start one here.</p>`}
      <div class="actions"><button class="btn" data-new-fee>New fee</button></div>
      ${savesShared() ? "" : `<p class="estimate">Saved in this browser only until the database is set up.</p>`}
    </div>`;
}

// ---------- Editor ----------

async function openFee(id: string) {
  const [fees, ps] = await Promise.all([listFees(), listProjects()]);
  projects = ps;
  const found = fees.find((f) => f.id === id);
  if (!found) {
    fee = null;
    $("fee-page").innerHTML = `<p class="none">This fee wasn't found. It may have been deleted. <a class="link" href="#fee">All fees</a></p>`;
    return;
  }
  if (fee?.id !== id) {
    fee = found;
    undoStack = [];
    // A fee with no hours yet opens every phase, ready to fill in; otherwise each phase is one line.
    openPhases.clear();
    if (!found.phases.some((p) => p.tasks.some((t) => Object.values(t.hours).some((h) => h > 0)))) found.phases.forEach((p) => openPhases.add(p.id));
    if (fillRates(fee)) changed();
    if (matchPhaseSplit(fee, (await getWorldView().catch(() => null))?.phaseShares ?? [])) changed();
    committed = JSON.stringify(fee); // undo goes back no further than the fee as opened
  }
  render();
  scrollTo(0, 0);
}

const input = (attrs: string, value: string, cls = "", placeholder = "") =>
  `<input type="text" class="fee-in ${cls}" ${attrs} value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" />`;

function render() {
  if (!fee) return;
  const f = fee;
  const project = projects.find((p) => p.id === f.workspaceProjectId);
  const by = budgetBy(f);
  $("fee-page").innerHTML = `
    <div class="rfp-top">
      <a class="link" href="#fee">← All fees</a>
      <span class="status error" id="fee-save-error"></span>
      <div class="actions"><button class="btn" data-undo title="Undo (Ctrl+Z)" ${undoStack.length ? "" : "disabled"}>Undo</button><button class="btn" data-delete-fee>Delete</button></div>
    </div>
    ${input('data-k="title" aria-label="Fee title"', f.title, "fee-title")}
    <p class="fee-project">${
      project
        ? `For project <a class="link" href="#project/${encodeURIComponent(project.id)}">${esc(projectLabel(project))}</a> <button class="link" data-unlink-fee>Unlink</button>`
        : `Not linked to a project. <button class="link" data-link-fee>Link to project</button>`
    }</p>
    ${
      f.draft
        ? `<div class="block fee-draft">
            <h2 class="label">Architecture and interiors drafted by AI from the RFP review. Check every number.</h2>
            <ul>${[f.draft.basis, ...f.draft.assumptions].filter(Boolean).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
            <p class="note">${[
              f.lens
                ? `Drafted with the <a class="link" href="#worldview">world view</a>${f.lens.savedAt ? ` of ${esc(new Date(f.lens.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}` : ""}${f.lens.text ? "" : " (none written yet)"}`
                : "",
              f.draft.costUsd != null ? `Draft cost ${esc(usd(f.draft.costUsd))}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}</p>
          </div>`
        : ""
    }

    <div class="fee-top">
    <div class="block">
      <h2 class="label">Construction budget</h2>
      <table class="grid facts fee-budget">
        <tr><th scope="row">Set by</th><td><div class="fee-choice" role="radiogroup" aria-label="Set the budget by">
          <label><input type="radio" name="fee-budget-by" value="amount" data-budget-by ${by === "amount" ? "checked" : ""} /> Amount</label>
          <label><input type="radio" name="fee-budget-by" value="area" data-budget-by ${by === "area" ? "checked" : ""} /> Area × cost per SF</label>
        </div></td></tr>
        ${
          by === "amount"
            ? `<tr><th scope="row">Construction budget</th><td>${input('data-k="budget.amount" inputmode="decimal" aria-label="Construction budget"', numValue(f.budget.amount), "money", "$")}</td></tr>`
            : `<tr><th scope="row">Area (SF)</th><td>${input('data-k="budget.area" inputmode="decimal" aria-label="Area in square feet"', numValue(f.budget.area), "", "SF")}</td></tr>
        <tr><th scope="row">Cost per SF</th><td>${input('data-k="budget.costPerSf" inputmode="decimal" aria-label="Cost per square foot"', numValue(f.budget.costPerSf), "", "$/SF")}</td></tr>
        <tr><th scope="row">Construction budget</th><td data-out="budget"></td></tr>`
        }
        <tr><th scope="row">Fee curve at this budget</th><td><span data-out="curve-at"></span> <span class="note">from the <a class="link" href="#worldview">World view</a></span></td></tr>
        <tr><th scope="row">Target fee, % of construction</th><td><div class="fee-pair">${input('data-k="targetPercent" inputmode="decimal" aria-label="Target fee percent"', numValue(f.targetPercent), "", "%")} <span data-out="target"></span></div></td></tr>
        <tr><th scope="row">Reimbursable expenses</th><td>${input('data-k="expenses" inputmode="decimal" aria-label="Reimbursable expenses"', numValue(f.expenses), "money", "$")}</td></tr>
      </table>
    </div>

    <div class="block">
      <h2 class="label">Rates</h2>
      <div class="scroll"><table class="grid fee-table fee-rates">
        <thead><tr><th>Role</th><th>Short</th><th class="num">Rate ($/hr)</th><th class="num">Hours</th><th class="num">Cost</th></tr></thead>
        <tbody>${f.roles
          .map(
            (r) => `<tr>
              <td>${input(`data-role="${esc(r.id)}" data-f="name" aria-label="Role name"`, r.name)}</td>
              <td class="fee-short">${input(`data-role="${esc(r.id)}" data-f="short" aria-label="${esc(r.name)} short name" maxlength="5"`, r.short ?? "", "", shortRole(r))}</td>
              <td class="num">${input(`data-role="${esc(r.id)}" data-f="rate" inputmode="decimal" aria-label="${esc(r.name)} rate"`, numValue(r.rate), "num")}</td>
              <td class="num" data-out="role-hours:${esc(r.id)}"></td>
              <td class="num" data-out="role-cost:${esc(r.id)}"></td>
            </tr>`,
          )
          .join("")}</tbody>
      </table></div>
      <div class="actions"><button class="btn" data-add-role>Add role</button></div>
    </div>
    </div>

    <div class="block">
      <h2 class="label">Phases <button class="link edit-link" data-phases-all>${f.phases.every((p) => openPhases.has(p.id)) ? "Close all" : "Open all"}</button></h2>
      <div class="fee-phases">${f.phases.map(phaseHtml).join("")}</div>
      <div class="actions"><button class="btn" data-add-phase>Add phase</button></div>
    </div>

    <div class="block">
      <h2 class="label">Consultants</h2>
      <div class="scroll"><table class="grid fee-table fee-cons">
        <thead><tr><th>Discipline</th><th>Firm</th>${f.phases.map((p) => `<th class="num" data-phase-head="${esc(p.id)}" title="${esc(p.name)}">${esc(shortPhase(p.name))}</th>`).join("")}<th class="num">Fee</th><th></th></tr></thead>
        <tbody>${f.consultants
          .map(
            (c) => `<tr>
              <td>${input(`data-cons="${esc(c.id)}" data-f="discipline" aria-label="Discipline"`, c.discipline)}</td>
              <td>${input(`data-cons="${esc(c.id)}" data-f="firm" aria-label="Firm"`, c.firm, "", "Firm")}</td>
              ${f.phases.map((p) => `<td class="num">${input(`data-cons="${esc(c.id)}" data-f="p:${esc(p.id)}" inputmode="decimal" aria-label="${esc(c.discipline || "Consultant")} ${esc(p.name)} fee"`, numValue(c.byPhase[p.id] ?? null), "num", "$")}</td>`).join("")}
              <td class="num" data-out="cons-total:${esc(c.id)}"></td>
              <td><button class="link" data-remove-cons="${esc(c.id)}" aria-label="Remove consultant" title="Remove">×</button></td>
            </tr>`,
          )
          .join("")}</tbody>
        <tfoot>
          <tr><th scope="row" colspan="${f.phases.length + 2}"><div class="fee-pair">Management markup ${input('data-k="markupPercent" inputmode="decimal" aria-label="Management markup percent"', numValue(f.markupPercent), "pct")} %</div></th><td class="num" data-out="markup"></td><td></td></tr>
          <tr><th scope="row" colspan="${f.phases.length + 2}">Consultants with markup</th><td class="num" data-out="consultants-total"></td><td></td></tr>
        </tfoot>
      </table></div>
      <div class="actions"><button class="btn" data-add-cons>Add consultant</button></div>
    </div>

    <div class="block">
      <h2 class="label">Summary</h2>
      <div id="fee-summary"></div>
    </div>

    <div class="block">
      <h2 class="label">Proposal table</h2>
      <div class="scroll"><div id="fee-proposal"></div></div>
      <div class="actions"><button class="btn" data-copy-table>Copy table</button><span class="status" id="fee-copy-status"></span></div>
    </div>`;
  refresh();
}

/** One line per phase (name, typical share, hours, cost); its task table opens below it. */
function phaseHtml(p: SavedFee["phases"][number]): string {
  const f = fee!;
  const open = openPhases.has(p.id);
  return `<div class="fee-phase${open ? " open" : ""}">
    <div class="fee-phase-head">
      <button class="fee-toggle" data-toggle-phase="${esc(p.id)}" aria-expanded="${open}" aria-label="${open ? "Close" : "Open"} ${esc(p.name)}">${open ? "▾" : "▸"}</button>
      ${input(`data-phase="${esc(p.id)}" data-f="name" aria-label="Phase name"`, p.name, "fee-phase-name")}
      <span class="note">Typical <span data-out="typical:${esc(p.id)}"></span></span>
      <span class="fee-phase-sum"><span data-out="phase-hours:${esc(p.id)}"></span> hrs · <b data-out="phase-cost:${esc(p.id)}"></b></span>
      <button class="link" data-remove-phase="${esc(p.id)}">Remove</button>
    </div>
    ${
      open
        ? `<div class="scroll"><table class="grid fee-table fee-tasks">
      <thead><tr><th>Task</th>${f.roles.map((r) => `<th class="num" data-role-head="${esc(r.id)}" title="${esc(r.name)}">${esc(shortRole(r))}</th>`).join("")}<th class="num">Hrs</th><th class="num">Cost</th><th></th></tr></thead>
      <tbody>${p.tasks
        .map(
          (t) => `<tr>
            <td>${input(`data-task="${esc(p.id)}:${esc(t.id)}" data-f="name" aria-label="Task"`, t.name)}</td>
            ${f.roles.map((r) => `<td class="num">${input(`data-task="${esc(p.id)}:${esc(t.id)}" data-f="h:${esc(r.id)}" inputmode="decimal" aria-label="${esc(r.name)} hours"`, numValue(t.hours[r.id] ?? null), "num")}</td>`).join("")}
            <td class="num" data-out="task-hours:${esc(t.id)}"></td>
            <td class="num" data-out="task-cost:${esc(t.id)}"></td>
            <td><button class="link" data-remove-task="${esc(p.id)}:${esc(t.id)}" aria-label="Remove task" title="Remove">×</button></td>
          </tr>`,
        )
        .join("")}</tbody>
    </table></div>
    <button class="link fee-add-task" data-add-task="${esc(p.id)}">+ Add task</button>`
        : ""
    }
  </div>`;
}

/** Updates every figure on the page from the fee, without touching the inputs (so typing keeps focus). */
function refresh() {
  if (!fee) return;
  const f = fee;
  const t = totals(f);
  const out = (key: string, text: string) => {
    document.querySelectorAll(`#fee-page [data-out="${CSS.escape(key)}"]`).forEach((el) => (el.textContent = text));
  };
  out("budget", money(budgetOf(f)));
  out("target", t.target != null ? `= ${money(t.target)}` : "");
  const atCurve = curveTarget(budgetOf(f));
  out("curve-at", atCurve != null && t.budget ? `${pct(atCurve)} = ${money((t.budget * atCurve) / 100)}` : "Set a budget");
  for (const r of f.roles) {
    out(`role-hours:${r.id}`, hrs(t.roleHours[r.id] ?? 0));
    out(`role-cost:${r.id}`, money((t.roleHours[r.id] ?? 0) * (r.rate ?? 0)));
  }
  for (const p of t.phases) {
    out(`typical:${p.phase.id}`, pct(p.typical));
    out(`phase-hours:${p.phase.id}`, hrs(p.hours));
    out(`phase-cost:${p.phase.id}`, money(p.cost));
    for (const task of p.phase.tasks) {
      out(`task-hours:${task.id}`, hrs(taskHours(task)));
      out(`task-cost:${task.id}`, money(taskCost(task, f.roles)));
    }
  }
  for (const c of f.consultants) out(`cons-total:${c.id}`, money(consultantTotal(c, f.phases)));
  out("markup", money(t.markup));
  out("consultants-total", money(t.consultants + t.markup));

  // A phase whose share of labor is more than 5 points off its typical share is marked.
  const off = (share: number | null, target: number) => share != null && Math.abs(share - target) > 5;
  const diff = t.target != null ? t.total - t.target : null;
  const diffPoints = t.percentOfBudget != null && f.targetPercent != null ? t.percentOfBudget - f.targetPercent : null;
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
  $("fee-proposal").innerHTML = proposalHtml(proposalTable(f));
  $("fee-summary").innerHTML = `
    <div class="scroll"><table class="grid fee-table fee-summary">
      <thead><tr><th>Phase</th><th class="num">Hours</th><th class="num">Labor</th><th class="num">Share</th><th class="num">Typical</th></tr></thead>
      <tbody>
        ${t.phases
          .map(
            (p) => `<tr${p.typical != null && off(p.share, p.typical) ? ' class="off"' : ""}><th scope="row">${esc(p.phase.name)}</th><td class="num">${hrs(p.hours)}</td><td class="num">${money(p.cost)}</td><td class="num">${pct(p.share)}</td><td class="num">${pct(p.typical)}</td></tr>`,
          )
          .join("")}
        <tr class="subtotal"><th scope="row">Labor</th><td class="num">${hrs(t.laborHours)}</td><td class="num">${money(t.labor)}</td><td></td><td></td></tr>
        <tr><th scope="row">Consultants</th><td></td><td class="num">${money(t.consultants)}</td><td></td><td></td></tr>
        <tr><th scope="row">Management markup (${pct(f.markupPercent)})</th><td></td><td class="num">${money(t.markup)}</td><td></td><td></td></tr>
        <tr><th scope="row">Expenses</th><td></td><td class="num">${money(t.expenses)}</td><td></td><td></td></tr>
        <tr class="total"><th scope="row">Total fee</th><td></td><td class="num">${money(t.total)}</td><td></td><td></td></tr>
      </tbody>
    </table></div>
    <table class="grid facts fee-check">
      <tr><th scope="row">Construction budget</th><td>${money(t.budget)}</td></tr>
      <tr><th scope="row">Fee as % of construction</th><td>${pct(t.percentOfBudget)}</td></tr>
      <tr><th scope="row">Target</th><td>${f.targetPercent != null ? `${pct(f.targetPercent)} = ${money(t.target)}${f.targetFromCurve ? ` <span class="note">from the <a class="link" href="#worldview">fee curve</a></span>` : ""}` : "—"}</td></tr>
      <tr><th scope="row">Difference from target</th><td>${diff != null ? `${sign(diff)}${money(Math.abs(diff))}${diffPoints != null ? ` (${sign(diffPoints)}${Math.abs(diffPoints).toLocaleString("en-US", { maximumFractionDigits: 1 })} points)` : ""}` : "—"}</td></tr>
    </table>`;
}

/** Links an unlinked fee to a project that doesn't have a fee yet (a project has at most one). */
async function linkToProject(f: SavedFee) {
  const [fees, ps] = await Promise.all([listFees(), listProjects()]);
  projects = ps;
  const taken = new Set(fees.filter((x) => x.id !== f.id).map((x) => x.workspaceProjectId));
  const free = ps.filter((p) => !taken.has(p.id)).sort((a, b) => projectLabel(a).localeCompare(projectLabel(b)));
  if (!free.length) return noticeModal("No projects to link", ps.length ? "Every project already has a fee." : "There are no projects yet.");
  const labels = free.map(projectLabel);
  const picked = await formModal({
    title: "Link to project",
    fields: [{ label: "Project", value: "", options: labels, single: true, required: true }],
    confirm: "Link",
  });
  const project = picked && free[labels.indexOf(picked[0])];
  if (!project || fee?.id !== f.id) return;
  f.workspaceProjectId = project.id;
  rerender();
}

// ---------- Proposal table ----------
// Laid out like the fee tables in the firm's proposals: blue header, a dark Total Fee column and a black Total row.
// Styles are inline so the formatting survives being pasted into Word, Google Docs or InDesign.

const PT = {
  font: "font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px;",
  border: "border: 1px solid #bcbec0;",
  head: "min-width: 120px; background: #20abe2; color: #ffffff; font-weight: 400; text-align: center; vertical-align: bottom; padding: 10px 12px;",
  headTotal: "min-width: 120px; background: #58595b; color: #ffffff; font-weight: 700; text-align: center; vertical-align: middle; padding: 10px 12px; text-transform: uppercase;",
  phase: "background: #ffffff; color: #231f20; font-weight: 700; text-align: left; padding: 12px;",
  cell: "min-width: 120px; background: #ffffff; color: #231f20; text-align: center; padding: 12px; white-space: nowrap;",
  cellTotal: "min-width: 120px; background: #6d6e71; color: #ffffff; text-align: center; padding: 12px; white-space: nowrap;",
  foot: "min-width: 120px; background: #231f20; color: #ffffff; text-align: center; padding: 12px; white-space: nowrap;",
  footLabel: "background: #231f20; color: #ffffff; font-weight: 700; text-align: left; padding: 12px; text-transform: uppercase;",
};
/** "$ 241,020.00"; nothing in it shows a dash. */
const ptMoney = (n: number) => (Math.round(n * 100) ? `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-");

export function proposalHtml(t: ProposalTable): string {
  if (!t.rows.length) return `<p class="none">Add hours, rates or consultant fees to fill in the table.</p>`;
  const th = (style: string, html: string) => `<th style="${PT.border} ${style}">${html}</th>`;
  const td = (style: string, html: string) => `<td style="${PT.border} ${style}">${html}</td>`;
  const head = t.columns
    .map((c) => th(PT.head, c.firm ? `${esc(c.firm)}<br />(${esc(c.discipline || "Consultant")})` : esc(c.discipline)))
    .join("");
  return `<table class="fee-proposal" style="${PT.font} border-collapse: collapse;">
    <thead><tr>${th(PT.head + " text-align: left;", "Phase")}${head}${th(PT.headTotal, "Total Fee")}</tr></thead>
    <tbody>${t.rows
      .map((r) => `<tr>${td(PT.phase, esc(r.label))}${r.amounts.map((a) => td(PT.cell, ptMoney(a))).join("")}${td(PT.cellTotal, ptMoney(r.total))}</tr>`)
      .join("")}</tbody>
    <tfoot><tr>${td(PT.footLabel, "Total")}${t.totals.map((a) => td(PT.foot, ptMoney(a))).join("")}${td(PT.foot, ptMoney(t.total))}</tr></tfoot>
  </table>`;
}

/** Plain-text version (tab-separated) for apps that don't take formatted text. */
function proposalText(t: ProposalTable): string {
  const head = ["Phase", ...t.columns.map((c) => (c.firm ? `${c.firm} (${c.discipline})` : c.discipline)), "Total Fee"];
  const rows = t.rows.map((r) => [r.label, ...r.amounts.map(ptMoney), ptMoney(r.total)]);
  return [head, ...rows, ["TOTAL", ...t.totals.map(ptMoney), ptMoney(t.total)]].map((r) => r.join("\t")).join("\n");
}

async function copyProposalTable() {
  if (!fee) return;
  const t = proposalTable(fee);
  const status = document.getElementById("fee-copy-status");
  const html = proposalHtml(t);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([proposalText(t)], { type: "text/plain" }),
      }),
    ]);
  } catch {
    // Clipboard API blocked: copy the table on the page as a selection instead.
    const el = document.getElementById("fee-proposal")!;
    const range = document.createRange();
    range.selectNode(el);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    document.execCommand("copy");
    getSelection()?.removeAllRanges();
  }
  if (status) {
    status.textContent = "Copied";
    setTimeout(() => (status.textContent = ""), 1500);
  }
}

function showSaveError(message: string) {
  const el = document.getElementById("fee-save-error");
  if (el) el.textContent = message ? `Not saved: ${message}` : "";
}

function changed() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!fee || !dirty) return;
    dirty = false;
    saveFee({ ...fee, savedAt: Date.now() })
      .then(() => showSaveError(""))
      .catch((err) => {
        dirty = true; // try again with the next change
        showSaveError((err as Error).message);
      });
  }, 800);
}

function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  if (!fee || !el.matches(".fee-in, [data-budget-by]")) return;
  if (el.matches("[data-budget-by]")) {
    fee.budget.by = el.value === "area" ? "area" : "amount";
    if (fee.targetFromCurve) followCurve(fee);
    return rerender();
  }
  if (el.inputMode === "decimal") addCommas(el);
  const f = fee;
  const v = el.value;
  const field = el.dataset.f ?? "";
  if (el.dataset.k) {
    const k = el.dataset.k;
    if (k === "title") f.title = v;
    else if (k === "budget.amount") f.budget.amount = parseNum(v);
    else if (k === "budget.area") f.budget.area = parseNum(v);
    else if (k === "budget.costPerSf") f.budget.costPerSf = parseNum(v);
    else if (k === "targetPercent") {
      f.targetPercent = parseNum(v);
      f.targetFromCurve = false; // typed by hand: it stays put from now on
    }
    else if (k === "markupPercent") f.markupPercent = parseNum(v) ?? 0;
    else if (k === "expenses") f.expenses = parseNum(v);
    // A target from the fee curve follows the budget.
    if (k.startsWith("budget.") && f.targetFromCurve) followCurve(f);
  } else if (el.dataset.role) {
    const r = f.roles.find((x) => x.id === el.dataset.role);
    if (!r) return;
    if (field === "name") r.name = v;
    else if (field === "short") r.short = v.trim() || undefined;
    else r.rate = parseNum(v);
    // Roles head the phase tables' columns by short name, with the full name on hover.
    document.querySelectorAll<HTMLElement>(`#fee-page [data-role-head="${CSS.escape(r.id)}"]`).forEach((th) => {
      th.textContent = shortRole(r);
      th.title = r.name;
    });
  } else if (el.dataset.phase) {
    const p = f.phases.find((x) => x.id === el.dataset.phase);
    if (!p) return;
    if (field === "name") {
      p.name = v;
      // Phases head the consultants' columns by short name, with the full name on hover.
      document.querySelectorAll<HTMLElement>(`#fee-page [data-phase-head="${CSS.escape(p.id)}"]`).forEach((th) => {
        th.textContent = shortPhase(v);
        th.title = v;
      });
    }
  } else if (el.dataset.task) {
    const [pid, tid] = el.dataset.task.split(":");
    const t = f.phases.find((x) => x.id === pid)?.tasks.find((x) => x.id === tid);
    if (!t) return;
    if (field === "name") t.name = v;
    else if (field.startsWith("h:")) {
      const n = parseNum(v);
      if (n == null) delete t.hours[field.slice(2)];
      else t.hours[field.slice(2)] = n;
    }
  } else if (el.dataset.cons) {
    const c = f.consultants.find((x) => x.id === el.dataset.cons);
    if (!c) return;
    if (field === "discipline") c.discipline = v;
    else if (field === "firm") c.firm = v;
    else if (field.startsWith("p:")) {
      const n = parseNum(v);
      if (n == null) delete c.byPhase[field.slice(2)];
      else c.byPhase[field.slice(2)] = n;
    }
  }
  // Saved as typed, but the figures only recalculate once the entry is finished (see the "change" listener), so
  // retyping 20 as 22 doesn't flash every total through 2 on the way.
  changed();
}

/** Re-renders after a structural change (rows added or removed), keeping the scroll position. */
function rerender(save = true) {
  const y = scrollY;
  render();
  scrollTo(0, y);
  if (save) {
    changed();
    checkpoint();
  }
  updateUndo();
}

async function onClick(e: Event) {
  const t = e.target as HTMLElement;
  const attr = (name: string) => t.closest(`[${name}]`)?.getAttribute(name) ?? null;
  if (t.closest("[data-new-fee]")) return makeFee();
  if (t.closest("[data-copy-table]")) return copyProposalTable();
  if (t.closest("[data-undo]")) return undo();
  if (!fee) return;
  const f = fee;
  let id: string | null;
  if (t.closest("[data-link-fee]")) return linkToProject(f);
  if (t.closest("[data-unlink-fee]")) {
    f.workspaceProjectId = undefined;
    return rerender();
  }
  if (t.closest("[data-delete-fee]")) {
    if (!(await confirmDelete("fee"))) return;
    clearTimeout(saveTimer);
    dirty = false;
    try {
      await deleteFee(f.id);
    } catch (err) {
      return noticeModal("Couldn't delete", (err as Error).message);
    }
    fee = null;
    location.hash = "#fee";
  } else if ((id = attr("data-toggle-phase"))) {
    if (openPhases.has(id)) openPhases.delete(id);
    else openPhases.add(id);
    rerender(false);
  } else if (t.closest("[data-phases-all]")) {
    const allOpen = f.phases.every((p) => openPhases.has(p.id));
    openPhases.clear();
    if (!allOpen) f.phases.forEach((p) => openPhases.add(p.id));
    rerender(false);
  } else if (t.closest("[data-add-role]")) {
    f.roles.push({ id: crypto.randomUUID(), name: "New role", rate: null });
    rerender();
  } else if (t.closest("[data-add-phase]")) {
    const phase = { id: crypto.randomUUID(), name: "New phase", targetShare: 0, tasks: [] };
    f.phases.push(phase);
    openPhases.add(phase.id);
    rerender();
  } else if ((id = attr("data-remove-phase"))) {
    f.phases = f.phases.filter((p) => p.id !== id);
    rerender();
  } else if ((id = attr("data-add-task"))) {
    f.phases.find((p) => p.id === id)?.tasks.push({ id: crypto.randomUUID(), name: "", hours: {} });
    openPhases.add(id);
    rerender();
    const inputs = document.querySelectorAll<HTMLInputElement>(`[data-task^="${CSS.escape(id)}:"][data-f="name"]`);
    inputs[inputs.length - 1]?.focus();
  } else if ((id = attr("data-remove-task"))) {
    const [pid, tid] = id.split(":");
    const p = f.phases.find((x) => x.id === pid);
    if (p) p.tasks = p.tasks.filter((x) => x.id !== tid);
    rerender();
  } else if (t.closest("[data-add-cons]")) {
    f.consultants.push({ id: crypto.randomUUID(), discipline: "", firm: "", byPhase: {} });
    rerender();
  } else if ((id = attr("data-remove-cons"))) {
    f.consultants = f.consultants.filter((c) => c.id !== id);
    rerender();
  }
}
