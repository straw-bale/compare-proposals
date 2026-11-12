import { estimateFitCheck, estimateRfp, estimateSuggest, usd, usdRange, type Usage } from "../lib/cost";
import type { Fit, Rfp } from "../lib/claude";
import { FEATURES } from "../lib/prompts";
import {
  feeCurveAt,
  OUTCOMES,
  pursuitLine,
  worldViewText,
  type FeePoint,
  type Outcome,
  type PhaseShare,
  type Pursuit,
  type PursuitRfp,
  type WorldView,
} from "../lib/worldview";
import { post } from "./api";
import { readAmount } from "./fee-calc";
import { confirmDelete, confirmModal, noticeModal } from "./modal";
import { servicesMatrix, uploadRfpPdf } from "./rfp";
import { deletePursuit, getWorldView, listPursuits, listRfps, savePursuit, saveWorldView, savesShared, type SavedRfp } from "./store";
import { esc } from "./table";

// The World view: what the AI is told when it judges RFPs, in plain sight and editable by the team. The team's
// world view and fee curve, the past pursuits that show what wins, a check of the world view against those
// outcomes, and every feature's built-in instructions word for word.

const $ = (id: string) => document.getElementById(id)!;
const MAX_PURSUITS = 20;

let wv: WorldView | null = null;
let pursuits: Pursuit[] = [];
let rfps: SavedRfp[] = [];
let initialized = false;
/** the pursuit being added or edited ("new" for a new one) */
let editingPursuit: string | null = null;
let check: { results: CheckResult[]; costUsd: number } | null = null;
let suggestion: string | null = null;
let busy = false;

type CheckResult = { pursuit: Pursuit; name: string; fit: Fit };

// ---------- Context for the AI (also used by the RFP review) ----------

/** What a past pursuit's RFP was, in a few words. */
function pursuitRfp(r: Rfp): PursuitRfp {
  const f = r.facts as Partial<Record<string, { value: string }>>;
  return {
    name: r.project_name,
    client: r.client,
    summary: r.summary,
    budget: f.construction_budget?.value ?? "",
    size: f.building_size?.value ?? "",
    services: servicesMatrix(r)
      .filter((s) => s.requested === "yes" || s.requested === "needed")
      .map((s) => s.discipline),
  };
}

/** A pursuit's RFP: read from its own PDFs, or (older pursuits) the saved review it points at. */
const rfpOf = (p: Pursuit, all: SavedRfp[]): Rfp | undefined => p.rfp ?? all.find((r) => r.id === p.rfpId)?.rfp;

const budgetOfRfp = (r: Rfp) => readAmount((r.facts as Partial<Record<string, { value: string }>>).construction_budget?.value ?? "");

/** How alike two RFPs are, for picking the most relevant past pursuits: budget band, client, disciplines. */
function similarity(target: Rfp, p: Pursuit, r: Rfp): number {
  let score = 0;
  const a = budgetOfRfp(target);
  const b = p.budget ?? budgetOfRfp(r);
  if (a && b) score += 3 - Math.min(3, Math.abs(Math.log(a / b)));
  if (target.client && target.client.toLowerCase() === r.client.toLowerCase()) score += 2;
  const da = new Set(pursuitRfp(target).services);
  const db = pursuitRfp(r).services;
  if (da.size && db.length) score += (2 * db.filter((d) => da.has(d)).length) / (da.size + db.length);
  return score;
}

/**
 * The world view and past pursuits to send with a request. For a new review the RFP isn't read yet, so the most
 * recent pursuits go; for a check, the ones most like that RFP, never the pursuit being checked.
 */
function contextFrom(w: WorldView, ps: Pursuit[], all: SavedRfp[], target?: { rfp: Rfp; exclude: string }) {
  let usable = ps.map((p) => ({ p, r: rfpOf(p, all) })).filter((x): x is { p: Pursuit; r: Rfp } => !!x.r && x.p.id !== target?.exclude);
  usable = target
    ? usable.sort((x, y) => similarity(target.rfp, y.p, y.r) - similarity(target.rfp, x.p, x.r))
    : usable.sort((x, y) => y.p.savedAt - x.p.savedAt);
  const text = worldViewText(w);
  return {
    worldView: text,
    pursuits: usable.slice(0, MAX_PURSUITS).map((x) => pursuitLine(x.p, pursuitRfp(x.r))),
    lens: { text, savedAt: w.savedAt },
  };
}

/** For a new RFP review: the latest world view and past pursuits. Never throws; reviews still run without them. */
export async function reviewContext() {
  try {
    const [w, ps, all] = await Promise.all([getWorldView(), listPursuits(), listRfps()]);
    return { ...contextFrom(w, ps, all), sections: w.proposalSections ?? [] };
  } catch {
    return { worldView: "", pursuits: [] as string[], lens: { text: "", savedAt: 0 }, sections: [] as string[] };
  }
}

/** For work on one RFP (e.g. a fee draft): the latest world view and the past pursuits most like it. Never throws. */
export async function contextForRfp(rfp: SavedRfp) {
  try {
    const [w, ps, all] = await Promise.all([getWorldView(), listPursuits(), listRfps()]);
    const own = ps.find((p) => p.rfpId === rfp.id);
    return contextFrom(w, ps, all, { rfp: rfp.rfp, exclude: own?.id ?? "" });
  } catch {
    return { worldView: "", pursuits: [] as string[], lens: { text: "", savedAt: 0 } };
  }
}

// ---------- Page ----------

export async function showWorldView() {
  if (!initialized) {
    initialized = true;
    const page = $("worldview-page");
    page.addEventListener("click", onClick);
    page.addEventListener("input", onInput);
    page.addEventListener("change", onChange);
    page.addEventListener("submit", onSubmit);
    page.addEventListener("mousemove", onChartMove);
    page.addEventListener("mouseleave", () => hideChartTip(), true);
    // Escape leaves the world view's edit form without saving (a dialog on top handles its own Escape first).
    addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !(editingView || curveDraft || phasesDraft || sectionsDraft != null) || page.closest("[hidden]") || document.querySelector("dialog[open]")) return;
      editingView = false;
      sectionsDraft = null;
      curveDraft = null;
      phasesDraft = null;
      rerender();
    });
    // Closing the page with a box still being edited: send it in a way that survives the page going away.
    addEventListener("pagehide", () => void save(true));
  }
  [wv, pursuits, rfps] = await Promise.all([getWorldView(), listPursuits(), listRfps()]);
  render();
}

// The four parts of the world view. Read-only until someone clicks Edit, and saved only after they confirm, so a
// stray keystroke can't change what every AI tool is told.
type ViewKey = "whoWeAre" | "goodPursuit" | "redFlags" | "weighing" | "marketConditions";
const VIEW_PARTS: [ViewKey, string, string][] = [
  ["whoWeAre", "Who we are", "Project types, sweet-spot size, geography, typical clients"],
  ["goodPursuit", "What makes a good pursuit", "e.g. Repeat clients, lab and higher-ed work, budgets $3M–$20M"],
  ["redFlags", "Deal-breakers and red flags", "e.g. Unlimited duty to defend, design-build bridging documents, fee caps"],
  ["weighing", "How to weigh things", "e.g. A fee cap under 6% is a pass unless it's a repeat client"],
  ["marketConditions", "Market conditions", "Where the market is, with the date and source (e.g. AIA Architecture Billings Index)"],
];
let editingView = false;
// The fee curve and the phase split are edited as drafts: nothing changes until Save is confirmed.
let curveDraft: FeePoint[] | null = null;
let phasesDraft: PhaseShare[] | null = null;
const curvePoints = () => curveDraft ?? wv!.feeCurve;

function curveHtml(): string {
  const pts = curvePoints();
  if (!curveDraft)
    return `<table class="grid facts wv-points">${[...pts]
      .sort((a, b) => a.budget - b.budget)
      .map((p) => `<tr><th scope="row">${esc(money(p.budget))}</th><td class="num">${p.percent}%</td></tr>`)
      .join("")}</table>
      <div class="actions"><button class="btn" data-edit-curve>Edit</button></div>`;
  return `<form class="rfp-edit" data-curve-form>
    <div class="scroll"><table class="grid fee-table wv-points">
      <thead><tr><th class="num">Construction budget</th><th class="num">Architectural fee</th><th></th></tr></thead>
      <tbody>${pts
        .map(
          (p, i) => `<tr>
            <td class="num"><input class="fee-in num" inputmode="decimal" data-point="${i}" data-f="budget" value="${p.budget ? p.budget.toLocaleString("en-US") : ""}" aria-label="Construction budget" placeholder="$" /></td>
            <td class="num"><span class="fee-pair"><input class="fee-in pct" inputmode="decimal" data-point="${i}" data-f="percent" value="${p.percent}" aria-label="Fee percent" /> %</span></td>
            <td><button type="button" class="link" data-remove-point="${i}">Remove</button></td>
          </tr>`,
        )
        .join("")}</tbody>
    </table></div>
    <button type="button" class="link" data-add-point>+ Add point</button>
    <div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-cancel-curve>Cancel</button></div>
  </form>`;
}

const phaseTotal = (ps: PhaseShare[]) => Math.round(ps.reduce((s, p) => s + (Number(p.percent) || 0), 0) * 10) / 10;

function phasesHtml(): string {
  const ps = phasesDraft ?? wv!.phaseShares;
  if (!phasesDraft)
    return `<table class="grid facts wv-points">${ps.map((p) => `<tr><th scope="row">${esc(p.name)}</th><td class="num">${p.percent}%</td></tr>`).join("")}
      <tr class="wv-total"><th scope="row">Total</th><td class="num">${phaseTotal(ps)}%</td></tr></table>
      <div class="actions"><button class="btn" data-edit-phases>Edit</button></div>`;
  return `<form class="rfp-edit" data-phases-form>
    <div class="scroll"><table class="grid fee-table wv-points">
      <thead><tr><th>Phase</th><th class="num">Share of fee</th><th></th></tr></thead>
      <tbody>${ps
        .map(
          (p, i) => `<tr>
            <td><input class="fee-in" data-phase-row="${i}" data-f="name" value="${esc(p.name)}" aria-label="Phase" /></td>
            <td class="num"><span class="fee-pair"><input class="fee-in pct" inputmode="decimal" data-phase-row="${i}" data-f="percent" value="${p.percent}" aria-label="${esc(p.name)} percent" /> %</span></td>
            <td><button type="button" class="link" data-remove-phase-row="${i}">Remove</button></td>
          </tr>`,
        )
        .join("")}</tbody>
      <tfoot><tr><th scope="row">Total</th><td class="num" id="wv-phase-total">${phaseTotal(ps)}%</td><td></td></tr></tfoot>
    </table></div>
    <button type="button" class="link" data-add-phase-row>+ Add phase</button>
    <div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-cancel-phases>Cancel</button></div>
  </form>`;
}

let sectionsDraft: string | null = null;

function sectionsHtml(): string {
  const list = wv!.proposalSections ?? [];
  if (sectionsDraft == null)
    return `<ol class="wv-sections">${list.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <div class="actions"><button class="btn" data-edit-sections>Edit</button></div>`;
  return `<form class="rfp-edit" data-sections-form>
    <label class="edit-field"><span>One section per line, in order</span><textarea name="sections" rows="${Math.max(6, list.length + 1)}">${esc(sectionsDraft)}</textarea></label>
    <div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-cancel-sections>Cancel</button></div>
  </form>`;
}

async function saveSections(form: HTMLFormElement) {
  if (!wv) return;
  const next = (form.querySelector<HTMLTextAreaElement>('[name="sections"]')?.value ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!next.length) return noticeModal("Add a section", "The list needs at least one section.");
  const ok = await confirmModal({
    title: "Save the proposal sections?",
    body: "New RFP reviews outline proposals in this order. Reviews already made keep their outlines.",
    confirm: "Save",
  });
  if (!ok || !wv) return;
  wv.proposalSections = next;
  sectionsDraft = null;
  changed();
  await save();
  rerender();
}

/** Asked before any part of the world view opens for editing, since every AI tool relies on it. */
const confirmEdit = (what: string) =>
  confirmModal({
    title: `Edit ${what}?`,
    body: "Every AI tool in the app uses it. Nothing changes until you save, and saving asks again.",
    confirm: "Edit",
  });

/** Saves a drafted fee curve or phase split after a confirmation. */
async function saveDraft(kind: "curve" | "phases") {
  if (!wv) return;
  if (kind === "curve") {
    const pts = (curveDraft ?? []).filter((p) => p.budget > 0);
    if (!pts.length) return noticeModal("Add a point", "The fee curve needs at least one budget and fee.");
  } else {
    const ps = (phasesDraft ?? []).filter((p) => p.name.trim());
    if (!ps.length) return noticeModal("Add a phase", "The split needs at least one phase.");
    if (phaseTotal(ps) !== 100) return noticeModal("Doesn't add up", `The phases add up to ${phaseTotal(ps)}%. Adjust them to 100% before saving.`);
  }
  const ok = await confirmModal({
    title: kind === "curve" ? "Save the fee curve?" : "Save the phase split?",
    body: "Every AI tool and new fee uses it from now on. Reviews and fees already made keep what they used.",
    confirm: "Save",
  });
  if (!ok || !wv) return;
  if (kind === "curve") {
    wv.feeCurve = curveDraft!.filter((p) => p.budget > 0).sort((a, b) => a.budget - b.budget);
    curveDraft = null;
  } else {
    wv.phaseShares = phasesDraft!.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), percent: Number(p.percent) || 0 }));
    phasesDraft = null;
  }
  changed();
  await save();
  rerender();
}

function viewHtml(): string {
  if (editingView)
    return `<form class="block rfp-edit" data-view-form>
      ${VIEW_PARTS.map(
        ([key, label, placeholder]) =>
          `<label class="edit-field wv-field"><span>${esc(label)}</span><textarea name="${key}" rows="${Math.max(4, wv![key].split("\n").length + 1)}" placeholder="${esc(placeholder)}">${esc(wv![key])}</textarea></label>`,
      ).join("")}
      <div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-cancel-view>Cancel</button></div>
    </form>`;
  return `<div class="block wv-view">
    ${VIEW_PARTS.map(
      ([key, label]) =>
        `<div class="wv-part"><h3>${esc(label)}</h3>${wv![key].trim() ? `<p>${esc(wv![key].trim()).replace(/\n/g, "<br />")}</p>` : `<p class="none">Not written yet.</p>`}</div>`,
    ).join("")}
    <div class="actions"><button class="btn" data-edit-view>Edit</button></div>
  </div>`;
}

/** Saves the edited world view after a confirmation, since every AI tool uses it from the next request on. */
async function saveView(form: HTMLFormElement) {
  if (!wv) return;
  const next = Object.fromEntries(VIEW_PARTS.map(([key]) => [key, (form.querySelector<HTMLTextAreaElement>(`[name="${key}"]`)?.value ?? "").trim()])) as Record<ViewKey, string>;
  if (VIEW_PARTS.every(([key]) => next[key] === wv![key].trim())) {
    editingView = false;
    return rerender();
  }
  const ok = await confirmModal({
    title: "Save the world view?",
    body: "Every AI tool uses it from the next request on. Reviews and fees already made keep the version they used.",
    confirm: "Save",
  });
  if (!ok || !wv) return;
  Object.assign(wv, next);
  editingView = false;
  changed();
  await save();
  rerender();
}

function render() {
  if (!wv) return;
  $("worldview-page").innerHTML = `
    <h1 class="headline">World view</h1>
    <p class="wv-intro">Our firm's perspective. Every AI tool in the app keeps it in mind, so its answers fit our work.</p>
    <span class="status" id="wv-status"></span>
    ${savesShared() ? "" : `<p class="estimate">Saved in this browser only until the database is set up.</p>`}

    ${viewHtml()}

    <div class="block">
      <h2 class="label">Expected fee by construction budget</h2>
      <div id="wv-chart" class="wv-chart"></div>
      ${curveHtml()}
    </div>

    <div class="block">
      <h2 class="label">Standard split by phase</h2>
      ${phasesHtml()}
    </div>

    <div class="block">
      <h2 class="label">Standard proposal sections</h2>
      <p class="wv-intro">The order our proposals follow. Only the RFP review's proposal outline uses this; the RFP's own requirements come first.</p>
      ${sectionsHtml()}
    </div>

    <div class="block saved">
      <h2 class="label">Past pursuits</h2>
      ${pursuitsHtml()}
      ${editingPursuit ? pursuitForm() : `<div class="actions"><button class="btn" data-add-pursuit>Add past pursuit</button></div>`}
    </div>

    <div class="block">
      <h2 class="label">Check the world view</h2>
      ${checkHtml()}
    </div>

    <div class="block">
      <h2 class="label">How each tool works</h2>
      <p class="wv-intro">Each tool's own instructions: what to do and in what format. Fixed in the app's code; the world view above is added after them.</p>
      ${FEATURES.map(
        (f) => `<details class="wv-prompt"><summary>${esc(f.name)} <span class="note">${f.usesWorldView ? "with the world view" : "reads documents as written, without the world view"}</span></summary><pre>${esc(f.prompt)}</pre></details>`,
      ).join("")}
    </div>`;
  drawChart();
}

// ---------- Saving ----------

// Saved once per finished entry (leaving a box, or adding / removing a point), not on every keystroke.
let dirty = false;

function changed() {
  dirty = true;
  const status = document.getElementById("wv-status");
  if (status) status.textContent = "";
}

async function save(keepalive = false) {
  if (!wv || !dirty) return;
  dirty = false;
  wv.savedAt = Date.now();
  const s = () => document.getElementById("wv-status");
  try {
    await saveWorldView(wv, keepalive);
    s()?.classList.remove("error");
    if (s()) s()!.textContent = "Saved";
  } catch (err) {
    dirty = true; // try again with the next change
    s()?.classList.add("error");
    if (s()) s()!.textContent = `Not saved: ${(err as Error).message}`;
  }
}

const parseNum = (s: string) => {
  const n = parseFloat(s.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function onInput(e: Event) {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (!wv) return;
  if (el.dataset.point != null && curveDraft) {
    const p = curveDraft[Number(el.dataset.point)];
    if (!p) return;
    const n = parseNum(el.value);
    if (el.dataset.f === "budget") p.budget = n ?? 0;
    else p.percent = n ?? 0;
  } else if (el.dataset.phaseRow != null && phasesDraft) {
    const p = phasesDraft[Number(el.dataset.phaseRow)];
    if (!p) return;
    if (el.dataset.f === "name") p.name = el.value;
    else p.percent = parseNum(el.value) ?? 0;
    const total = document.getElementById("wv-phase-total");
    if (total) total.textContent = `${phaseTotal(phasesDraft)}%`;
  }
}

/** Leaving a box saves it; the chart redraws then too, not on every keystroke. */
function onChange(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.matches("[data-rfp-choice]")) {
    // The upload is only for "Upload the RFP PDF".
    const upload = el.closest("form")?.querySelector<HTMLElement>("[data-rfp-upload]");
    if (upload) upload.hidden = !!el.value;
    return;
  }

  if (el.dataset.point != null) {
    if (el.dataset.f === "budget" && parseNum(el.value) != null) el.value = parseNum(el.value)!.toLocaleString("en-US");
    drawChart();
  }
}

// ---------- Fee curve chart ----------
// Budget on a log scale across the bottom, fee percent up the side. The team's line, plus past pursuits as dots:
// filled = won, ring = lost, grey = shortlisted or no bid (shape and fill, not color alone, carry the outcome).

const W = 720;
const H = 300;
const PAD = { l: 48, r: 28, t: 16, b: 40 };
const X0 = 500_000;
const X1 = 100_000_000;

const sx = (budget: number) => PAD.l + ((Math.log(budget) - Math.log(X0)) / (Math.log(X1) - Math.log(X0))) * (W - PAD.l - PAD.r);
const bx = (x: number) => Math.exp(Math.log(X0) + ((x - PAD.l) / (W - PAD.l - PAD.r)) * (Math.log(X1) - Math.log(X0)));
let yMax = 12;
const sy = (pct: number) => PAD.t + (1 - pct / yMax) * (H - PAD.t - PAD.b);
const short = (n: number) => (n >= 1e6 ? `$${n / 1e6}M` : `$${n / 1e3}K`);

type Dot = { x: number; y: number; name: string; outcome: Outcome; pct: number; budget: number };
let dots: Dot[] = [];

function drawChart() {
  const el = document.getElementById("wv-chart");
  if (!el || !wv) return;
  const pts: FeePoint[] = curvePoints().filter((p) => p.budget > 0).sort((a, b) => a.budget - b.budget);
  dots = pursuits
    .filter((p) => p.budget && p.ourFee)
    .map((p) => {
      const pct = (p.ourFee! / p.budget!) * 100;
      return { x: 0, y: 0, name: rfpOf(p, rfps)?.project_name ?? "Past pursuit", outcome: p.outcome, pct, budget: p.budget! };
    });
  yMax = Math.max(12, Math.ceil(Math.max(0, ...pts.map((p) => p.percent), ...dots.map((d) => d.pct)) / 2) * 2 + 2);
  for (const d of dots) {
    d.x = sx(Math.min(X1, Math.max(X0, d.budget)));
    d.y = sy(d.pct);
  }
  const xTicks = [500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000];
  const yTicks = Array.from({ length: yMax / 2 + 1 }, (_, i) => i * 2);
  // The line runs across the whole chart, flat beyond the first and last points, like feeCurveAt.
  const samples = pts.length ? Array.from({ length: 61 }, (_, i) => X0 * Math.pow(X1 / X0, i / 60)) : [];
  const path = samples.map((b, i) => `${i ? "L" : "M"}${sx(b).toFixed(1)},${sy(feeCurveAt(pts, b)!).toFixed(1)}`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Expected architectural fee as a percent of construction, by construction budget">
    ${yTicks.map((t) => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(t)}" y2="${sy(t)}"/><text class="tick" x="${PAD.l - 8}" y="${sy(t) + 4}" text-anchor="end">${t}%</text>`).join("")}
    ${xTicks.map((t) => `<text class="tick" x="${sx(t)}" y="${H - PAD.b + 18}" text-anchor="middle">${short(t)}</text>`).join("")}
    <text class="axis" x="${(PAD.l + W - PAD.r) / 2}" y="${H - 4}" text-anchor="middle">Construction budget</text>
    <path class="curve" d="${path}"/>
    ${pts.map((p) => `<circle class="point" cx="${sx(Math.min(X1, Math.max(X0, p.budget)))}" cy="${sy(p.percent)}" r="4"/>`).join("")}
    ${dots
      .map(
        (d, i) =>
          `<circle class="dot dot-${d.outcome.replace(" ", "-")}" data-dot="${i}" cx="${d.x}" cy="${d.y}" r="5"><title>${esc(d.name)}: ${d.outcome}, ${d.pct.toFixed(1)}% of ${short(d.budget)}</title></circle>`,
      )
      .join("")}
    <line class="cross" id="wv-cross" x1="0" x2="0" y1="${PAD.t}" y2="${H - PAD.b}" visibility="hidden"/>
  </svg>
  <div class="wv-tip" id="wv-tip" hidden></div>
  ${
    dots.length
      ? `<p class="wv-legend"><span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" class="dot dot-won"/></svg> Won</span><span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" class="dot dot-lost"/></svg> Lost</span><span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" class="dot dot-shortlisted"/></svg> Shortlisted or no bid</span></p>`
      : ""
  }`;
}

/** Hover: a crosshair with the expected fee at that budget, or a past pursuit's details when on its dot. */
function onChartMove(e: MouseEvent) {
  const svg = (e.target as Element).closest?.("#wv-chart svg") as SVGSVGElement | null;
  if (!svg || !wv) return hideChartTip();
  const box = svg.getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * W;
  const y = ((e.clientY - box.top) / box.height) * H;
  if (x < PAD.l || x > W - PAD.r) return hideChartTip();
  const tip = document.getElementById("wv-tip")!;
  const cross = document.getElementById("wv-cross")!;
  const near = dots.find((d) => Math.hypot(d.x - x, d.y - y) < 10);
  let html: string;
  let tx = x;
  if (near) {
    html = `<b>${esc(near.name)}</b><br />${esc(near.outcome)} · ${near.pct.toFixed(1)}% of ${esc(short(Math.round(near.budget / 1e5) * 1e5))}`;
    tx = near.x;
  } else {
    const b = bx(x);
    const pct = feeCurveAt(curvePoints(), b);
    if (pct == null) return hideChartTip();
    html = `At ${esc(b >= 1e6 ? `$${(b / 1e6).toFixed(1)}M` : `$${Math.round(b / 1e3)}K`)}: <b>${pct.toFixed(1)}%</b>`;
  }
  cross.setAttribute("x1", String(tx));
  cross.setAttribute("x2", String(tx));
  cross.setAttribute("visibility", "visible");
  tip.innerHTML = html;
  tip.hidden = false;
  const left = (tx / W) * box.width;
  tip.style.left = `${Math.min(box.width - tip.offsetWidth, Math.max(0, left + 10))}px`;
}

function hideChartTip() {
  document.getElementById("wv-tip")?.setAttribute("hidden", "");
  document.getElementById("wv-cross")?.setAttribute("visibility", "hidden");
}

// ---------- Past pursuits ----------

const OUTCOME_LABEL: Record<Outcome, string> = { won: "Won", shortlisted: "Shortlisted", lost: "Lost", "no bid": "No bid" };
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function pursuitsHtml(): string {
  if (!pursuits.length) return `<p class="none">None yet.</p>`;
  return `<ol>${[...pursuits]
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((p) => {
      const r = rfpOf(p, rfps);
      // The fee chart plots a pursuit only with both numbers; say which is missing rather than leave it off silently.
      const missing = [!p.budget && "budget", !p.ourFee && "our fee"].filter(Boolean).join(" and ");
      const pct = missing ? ` · <span class="note">add ${missing} to show it on the chart</span>` : ` · ${((p.ourFee! / p.budget!) * 100).toFixed(1)}%`;
      return `<li>
        <span><b>${esc(r?.project_name ?? "RFP missing")}</b> <span>${esc(r?.client ?? "")}</span></span>
        <span class="when">${OUTCOME_LABEL[p.outcome]}${pct}</span>
        <span><button class="link" data-edit-pursuit="${esc(p.id)}">Edit</button> <button class="link" data-delete-pursuit="${esc(p.id)}">Remove</button></span>
      </li>`;
    })
    .join("")}</ol>`;
}

/**
 * Adding a past pursuit starts from its RFP: either a review already on the RFP tab (copied in, no cost), or its PDFs,
 * read once and kept with the pursuit so they never show up on the RFP tab or among projects. Editing a pursuit
 * changes everything but its RFP.
 */
function pursuitForm(): string {
  const p = pursuits.find((x) => x.id === editingPursuit);
  const outcome = p?.outcome ?? "won";
  const r = p && rfpOf(p, rfps);
  return `<form class="rfp-edit wv-pursuit" data-pursuit-form>
    ${
      p
        ? `<p class="wv-rfp-name"><b>${esc(r?.project_name ?? "RFP missing")}</b> ${esc(r?.client ?? "")}${p.files?.length ? ` <span class="note">${esc(p.files.join(", "))}</span>` : ""}</p>`
        : rfpChoice()
    }
    <fieldset class="edit-field wv-outcome"><span>Outcome</span><div class="fee-choice">${OUTCOMES.map(
      (o) => `<label><input type="radio" name="outcome" value="${o}" ${o === outcome ? "checked" : ""} /> ${OUTCOME_LABEL[o]}</label>`,
    ).join("")}</div></fieldset>
    <div class="wv-pair">
      <label class="edit-field"><span>Construction budget</span><input type="text" inputmode="decimal" name="budget" value="${p?.budget ? p.budget.toLocaleString("en-US") : ""}" placeholder="From the RFP if left blank" /></label>
      <label class="edit-field"><span>Our fee</span><input type="text" inputmode="decimal" name="ourFee" value="${p?.ourFee ? p.ourFee.toLocaleString("en-US") : ""}" placeholder="$" /></label>
    </div>
    <label class="edit-field"><span>Our proposal</span><textarea name="ourProposal" rows="4" placeholder="What we emphasised: team, approach, fee basis">${esc(p?.ourProposal ?? "")}</textarea></label>
    <div><label class="link wv-upload">Summarize our proposal PDF<input type="file" accept="application/pdf" data-own-pdf hidden /></label> <span class="status" id="wv-pdf-status"></span></div>
    <label class="edit-field"><span>Debrief</span><textarea name="debrief" rows="3" placeholder="What the client said, who won and why">${esc(p?.debrief ?? "")}</textarea></label>
    <div class="actions"><button class="btn primary" type="submit" ${busy ? "disabled" : ""}>Save</button><button class="btn" type="button" data-cancel-pursuit>Cancel</button><span class="status" id="wv-read-status"></span></div>
  </form>`;
}

/** The past RFP for a new pursuit: a saved review (not one already used by a pursuit), or its PDFs to upload. */
function rfpChoice(): string {
  const used = new Set(pursuits.map((x) => x.rfpId).filter(Boolean));
  const reviews = [...rfps].filter((r) => !used.has(r.id)).sort((a, b) => b.savedAt - a.savedAt);
  const upload = `<label class="edit-field" data-rfp-upload><span>Past RFP (PDF, with any addenda)</span><input type="file" name="rfpFiles" accept="application/pdf,.pdf" multiple /></label>`;
  if (!reviews.length) return upload;
  return `<label class="edit-field"><span>Past RFP</span><select name="rfpId" data-rfp-choice>
      <option value="">Upload the RFP PDF</option>
      ${reviews.map((r) => `<option value="${esc(r.id)}">${esc([r.rfp.project_name, r.rfp.client].filter(Boolean).join(" · ") || "Untitled review")}</option>`).join("")}
    </select></label>
    ${upload}`;
}

// Vercel's request limit; larger PDFs go through storage, and can't be measured for an estimate first.
const DIRECT_BYTES = 4.4 * 1024 * 1024;

/** Reads a past RFP's PDFs once (billed, so it asks first, with an estimate when one can be measured). */
async function readPastRfp(files: File[]): Promise<{ rfp: Rfp; costUsd: number | null } | null> {
  let estimate = "Reading PDFs costs roughly 1–2 cents a page.";
  if (files.every((f) => f.size <= DIRECT_BYTES)) {
    try {
      const tokens = await Promise.all(
        files.map((f) => post<{ input_tokens: number }>("/api/upload", f, { "content-type": "application/pdf", "x-action": "estimate" }).then((r) => r.input_tokens)),
      );
      estimate = `Estimated cost ${usdRange(estimateRfp(tokens.reduce((a, b) => a + b, 0)))}.`;
    } catch {
      /* the plain rule of thumb stays */
    }
  }
  const ok = await confirmModal({
    title: "Read this RFP?",
    body: `Claude reads ${files.map((f) => f.name).join(", ")} once and keeps what it needs with this past pursuit. ${estimate}`,
    confirm: "Read",
  });
  if (!ok) return null;
  const status = document.getElementById("wv-read-status");
  const started = Date.now();
  const tick = setInterval(() => status && (status.textContent = `Reading… ${Math.round((Date.now() - started) / 1000)}s`), 1000);
  try {
    const uploaded = await Promise.all(files.map(async (f) => ({ file_id: await uploadRfpPdf(f), filename: f.name })));
    // A plain read: the world view isn't sent, so the record of what the RFP said stays neutral.
    const res = await post<{ rfp: Rfp; usage: Usage }>("/api/rfp", JSON.stringify({ files: uploaded }), { "content-type": "application/json" });
    return { rfp: res.rfp, costUsd: res.usage.cost_usd ?? null };
  } finally {
    clearInterval(tick);
    if (status) status.textContent = "";
  }
}

async function onSubmit(e: Event) {
  const view = (e.target as HTMLElement).closest<HTMLFormElement>("[data-view-form]");
  if (view) {
    e.preventDefault();
    return saveView(view);
  }
  if ((e.target as HTMLElement).closest("[data-sections-form]")) {
    e.preventDefault();
    return saveSections((e.target as HTMLElement).closest<HTMLFormElement>("[data-sections-form]")!);
  }
  if ((e.target as HTMLElement).closest("[data-curve-form]")) {
    e.preventDefault();
    return saveDraft("curve");
  }
  if ((e.target as HTMLElement).closest("[data-phases-form]")) {
    e.preventDefault();
    return saveDraft("phases");
  }
  const form = (e.target as HTMLElement).closest<HTMLFormElement>("[data-pursuit-form]");
  if (!form) return;
  e.preventDefault();
  if (busy) return;
  const val = (name: string) => (form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? "").trim();
  const before = pursuits.find((x) => x.id === editingPursuit);
  const record: Pursuit = {
    ...before,
    id: before?.id ?? crypto.randomUUID(),
    savedAt: Date.now(),
    outcome: (form.querySelector<HTMLInputElement>('[name="outcome"]:checked')?.value as Outcome) ?? "won",
    ourProposal: val("ourProposal"),
    debrief: val("debrief"),
    budget: parseNum(val("budget")),
    ourFee: parseNum(val("ourFee")),
  };
  const chosen = !before ? rfps.find((r) => r.id === val("rfpId")) : undefined;
  if (chosen) {
    // A saved review: linked, and copied in so the pursuit keeps it if the review is deleted later.
    record.rfpId = chosen.id;
    record.rfp = chosen.rfp;
    record.files = chosen.files;
    record.budget ??= readAmount((chosen.rfp.facts as Partial<Record<string, { value: string }>>).construction_budget?.value ?? "");
  } else if (!before) {
    const files = [...(form.querySelector<HTMLInputElement>('[name="rfpFiles"]')?.files ?? [])];
    if (!files.length) return noticeModal("Add the RFP", "Choose the past RFP's PDF first.");
    if (files.some((f) => !/\.pdf$/i.test(f.name) && f.type !== "application/pdf")) return noticeModal("Not a PDF", "The RFP has to be a PDF.");
    busy = true;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const read = await readPastRfp(files);
      if (!read) return;
      record.rfp = read.rfp;
      record.files = files.map((f) => f.name);
      record.reviewCostUsd = read.costUsd;
      record.budget ??= readAmount((read.rfp.facts as Partial<Record<string, { value: string }>>).construction_budget?.value ?? "");
    } catch (err) {
      return noticeModal("Couldn't read the RFP", (err as Error).message);
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }
  try {
    await savePursuit(record);
  } catch (err) {
    return noticeModal("Not saved", (err as Error).message);
  }
  pursuits = [...pursuits.filter((x) => x.id !== record.id), record];
  editingPursuit = null;
  check = null;
  suggestion = null;
  rerender();
}

/** Reads a PDF of our own proposal and puts its summary in the form. Billed, so it asks first. */
async function summarizeOwnPdf(input: HTMLInputElement) {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const ok = await confirmModal({
    title: "Summarize this proposal?",
    body: `Claude reads ${file.name} once and writes about 150 words on what it emphasised. Reading PDFs costs roughly 1–2 cents a page.`,
    confirm: "Summarize",
  });
  if (!ok) return;
  const status = document.getElementById("wv-pdf-status");
  if (status) status.textContent = "Reading…";
  try {
    const fileId = await uploadRfpPdf(file);
    const res = await post<{ summary: string; usage: Usage }>("/api/extract", JSON.stringify({ file_id: fileId, filename: file.name }), {
      "content-type": "application/json",
      "x-action": "summarize-own",
    });
    const box = document.querySelector<HTMLTextAreaElement>('[data-pursuit-form] [name="ourProposal"]');
    if (box) box.value = res.summary;
    if (status) status.textContent = res.usage.cost_usd != null ? usd(res.usage.cost_usd) : "";
  } catch (err) {
    if (status) {
      status.classList.add("error");
      status.textContent = (err as Error).message;
    }
  }
}

// ---------- Check ----------

/** Whether a verdict matches how things went: pursue with a win or shortlist, consider with a shortlist, pass with a loss or no bid. */
const agrees = (v: Fit["verdict"], o: Outcome) =>
  v === "pursue" ? o === "won" || o === "shortlisted" : v === "pass" ? o === "lost" || o === "no bid" : o === "shortlisted";

const VERDICT: Record<Fit["verdict"], string> = { pursue: "Pursue", consider: "Consider", pass: "Pass" };

function checkHtml(): string {
  const usable = checkable();
  if (!usable.length) return `<p class="none">Add past pursuits to check the world view against how they turned out.</p>`;
  const button = `<div class="actions"><button class="btn" data-run-check ${busy ? "disabled" : ""}>${busy ? "Checking…" : check ? "Check again" : "Check the world view"}</button></div>`;
  if (!check) return button;
  const agreed = check.results.filter((r) => agrees(r.fit.verdict, r.pursuit.outcome)).length;
  return `<p class="wv-score">Agreed with how ${agreed} of ${check.results.length} turned out.</p>
    <table class="grid wv-results">
      <thead><tr><th>Pursuit</th><th>Verdict</th><th>Outcome</th><th>Reasons</th></tr></thead>
      <tbody>${check.results
        .map(
          (r) => `<tr class="${agrees(r.fit.verdict, r.pursuit.outcome) ? "" : "miss"}">
            <th scope="row">${esc(r.name)}</th>
            <td>${VERDICT[r.fit.verdict]}</td>
            <td>${OUTCOME_LABEL[r.pursuit.outcome]}${agrees(r.fit.verdict, r.pursuit.outcome) ? "" : " · missed"}</td>
            <td>${r.fit.reasons.map(esc).join("<br />")}</td>
          </tr>`,
        )
        .join("")}</tbody>
    </table>
    <p class="estimate">Cost ${usd(check.costUsd)}</p>
    ${button}
    ${
      suggestion
        ? `<div class="wv-suggestion"><h3>Suggested changes <button class="link" data-copy-suggestion>Copy</button></h3><pre>${esc(suggestion)}</pre></div>`
        : `<div class="actions"><button class="btn" data-suggest ${busy ? "disabled" : ""}>Suggest changes</button></div>`
    }`;
}

const checkable = () => pursuits.filter((p) => rfpOf(p, rfps));

async function runCheck() {
  if (!wv || busy) return;
  const usable = checkable();
  const ok = await confirmModal({
    title: "Check the world view?",
    body: `Claude gives a verdict on each of the ${usable.length} past pursuits, as if deciding today, and it's compared with how each turned out. Estimated cost ${usdRange(estimateFitCheck(usable.length))}.`,
    confirm: "Check",
  });
  if (!ok) return;
  busy = true;
  rerender();
  const results: CheckResult[] = [];
  let cost = 0;
  try {
    // A few at a time; each leaves its own pursuit out of the examples.
    for (let i = 0; i < usable.length; i += 4) {
      const batch = await Promise.all(
        usable.slice(i, i + 4).map(async (p) => {
          const r = rfpOf(p, rfps)!;
          const ctx = contextFrom(wv!, pursuits, rfps, { rfp: r, exclude: p.id });
          const { fit: _fit, ...rfp } = r as Rfp & { fit?: Fit };
          const res = await post<{ fit: Fit; usage: Usage }>("/api/rfp", JSON.stringify({ rfp, worldView: ctx.worldView, pursuits: ctx.pursuits }), {
            "content-type": "application/json",
            "x-action": "fit-check",
          });
          cost += res.usage.cost_usd ?? 0;
          return { pursuit: p, name: r.project_name, fit: res.fit };
        }),
      );
      results.push(...batch);
    }
    check = { results, costUsd: cost };
    suggestion = null;
  } catch (err) {
    await noticeModal("Check stopped", (err as Error).message);
  } finally {
    busy = false;
    rerender();
  }
}

async function runSuggest() {
  if (!wv || !check || busy) return;
  const ok = await confirmModal({
    title: "Suggest changes?",
    body: `Claude reads the world view and these results, and suggests edits. Estimated cost ${usdRange(estimateSuggest(check.results.length))}.`,
    confirm: "Suggest",
  });
  if (!ok) return;
  busy = true;
  rerender();
  try {
    const results = check.results.map((r) => ({
      pursuit: r.name,
      verdict: r.fit.verdict,
      outcome: r.pursuit.outcome,
      matched: agrees(r.fit.verdict, r.pursuit.outcome),
      reasons: r.fit.reasons,
      debrief: r.pursuit.debrief,
    }));
    const res = await post<{ text: string; usage: Usage }>("/api/rfp", JSON.stringify({ worldView: worldViewText(wv), results }), {
      "content-type": "application/json",
      "x-action": "suggest",
    });
    suggestion = res.text.trim();
    check.costUsd += res.usage.cost_usd ?? 0;
  } catch (err) {
    await noticeModal("Couldn't suggest changes", (err as Error).message);
  } finally {
    busy = false;
    rerender();
  }
}

// ---------- Clicks ----------

function rerender() {
  const y = scrollY;
  render();
  scrollTo(0, y);
}

async function onClick(e: Event) {
  const t = e.target as HTMLElement;
  if (!wv) return;
  const attr = (name: string) => t.closest(`[${name}]`)?.getAttribute(name) ?? null;
  let id: string | null;
  if (t.closest("[data-edit-view]")) {
    if (!(await confirmEdit("the world view"))) return;
    editingView = true;
    rerender();
    document.querySelector<HTMLTextAreaElement>("[data-view-form] textarea")?.focus();
  } else if (t.closest("[data-cancel-view]")) {
    editingView = false;
    rerender();
  } else if (t.closest("[data-edit-sections]")) {
    if (!(await confirmEdit("the proposal sections")) || !wv) return;
    sectionsDraft = (wv.proposalSections ?? []).join("\n");
    rerender();
  } else if (t.closest("[data-cancel-sections]")) {
    sectionsDraft = null;
    rerender();
  } else if (t.closest("[data-edit-curve]")) {
    if (!(await confirmEdit("the fee curve")) || !wv) return;
    curveDraft = wv.feeCurve.map((p) => ({ ...p }));
    rerender();
  } else if (t.closest("[data-cancel-curve]")) {
    curveDraft = null;
    rerender();
  } else if (t.closest("[data-edit-phases]")) {
    if (!(await confirmEdit("the phase split")) || !wv) return;
    phasesDraft = wv.phaseShares.map((p) => ({ ...p }));
    rerender();
  } else if (t.closest("[data-cancel-phases]")) {
    phasesDraft = null;
    rerender();
  } else if (t.closest("[data-add-phase-row]") && phasesDraft) {
    phasesDraft.push({ name: "", percent: 0 });
    rerender();
  } else if ((id = attr("data-remove-phase-row")) != null && phasesDraft) {
    phasesDraft.splice(Number(id), 1);
    rerender();
  } else if (t.closest("[data-add-point]") && curveDraft) {
    const last = [...curveDraft].sort((a, b) => a.budget - b.budget).at(-1);
    curveDraft.push({ budget: last ? last.budget * 2 : 1_000_000, percent: last?.percent ?? 8 });
    rerender();
  } else if ((id = attr("data-remove-point")) != null && curveDraft) {
    curveDraft.splice(Number(id), 1);
    rerender();
  } else if (t.closest("[data-add-pursuit]")) {
    editingPursuit = "new";
    rerender();
  } else if ((id = attr("data-edit-pursuit"))) {
    editingPursuit = id;
    rerender();
  } else if (t.closest("[data-cancel-pursuit]")) {
    editingPursuit = null;
    rerender();
  } else if ((id = attr("data-delete-pursuit"))) {
    if (!(await confirmDelete("past pursuit"))) return;
    try {
      await deletePursuit(id);
    } catch (err) {
      return noticeModal("Couldn't delete", (err as Error).message);
    }
    pursuits = pursuits.filter((p) => p.id !== id);
    check = null;
    suggestion = null;
    rerender();
  } else if (t.closest("[data-run-check]")) {
    await runCheck();
  } else if (t.closest("[data-suggest]")) {
    await runSuggest();
  } else if (t.closest("[data-copy-suggestion]") && suggestion) {
    await navigator.clipboard.writeText(suggestion).catch(() => {});
    t.textContent = "Copied";
    setTimeout(() => (t.textContent = "Copy"), 1500);
  }
}

// The PDF picker is a change on a file input.
document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.matches?.("#worldview-page [data-own-pdf]")) void summarizeOwnPdf(el);
});
