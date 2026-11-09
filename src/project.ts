import { DISCIPLINES, toDisciplines } from "../lib/disciplines";
import { askProjectName, confirmModal, confirmTyped, noticeModal } from "./modal";
import { makeFee, proposalHtml } from "./fee";
import { proposalTable } from "./fee-calc";
import { deleteProject, listFees, saveFee, type SavedFee, projectLabel, listComparisons, listProjects, listSchedules, savesShared, listRfps, saveComparison, saveProject, saveRfp, saveSchedule, type SavedComparison, type SavedProject, type SavedRfp, type SavedSchedule } from "./store";
import { formatWhen, parseDay, projectDisciplines, proposalDue } from "./rfp";
import { copyShareLink } from "./share";
import { esc, firmName } from "./table";

// A project page: its RFP review, the comparisons linked to it, and its consultants by discipline.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let project: SavedProject | null = null;
let rfp: SavedRfp | undefined;
let comparisons: SavedComparison[] = [];
let schedules: SavedSchedule[] = [];
let fees: SavedFee[] = [];

// "Compare proposals" on a project page: the next comparison is linked to this project.
let pending: { id: string; name: string } | null = null;
export const pendingProject = () => pending;
export const clearPendingProject = () => (pending = null);

export function initProject() {
  $("project-page").addEventListener("click", onClick);
}

export async function openProject(id: string) {
  const found = (await listProjects()).find((p) => p.id === id);
  if (!found) return noticeModal("Project not found", "It may have been deleted.");
  project = found;
  await load();
  render();
  scrollTo(0, 0);
}

async function load() {
  if (!project) return;
  const id = project.id;
  const [rfps, cmps, scheds, fs] = await Promise.all([listRfps(), listComparisons(), listSchedules(), listFees()]);
  rfp = rfps.find((r) => r.id === project!.rfpId) ?? rfps.find((r) => r.projectId === id);
  comparisons = cmps.filter((c) => c.projectId === id);
  schedules = scheds.filter((s) => s.workspaceProjectId === id);
  fees = fs.filter((f) => f.workspaceProjectId === id);
}


/** All projects, newest first, each opening its page. */
export async function showProjectList() {
  project = null;
  const [projects, rfps] = await Promise.all([listProjects(), listRfps()]);
  // Sorted by proposal due date: upcoming soonest first, then past ones (most recent first), then those without one.
  const today = new Date().setHours(0, 0, 0, 0);
  const rows = projects.map((p) => {
    const r = rfps.find((x) => x.id === p.rfpId) ?? rfps.find((x) => x.projectId === p.id);
    const due = r ? proposalDue(r.rfp) : undefined;
    return { p, r, due, t: due ? parseDay(due.date)?.getTime() : undefined };
  });
  const rank = (t?: number) => (t == null ? 2 : t >= today ? 0 : 1);
  rows.sort((a, b) => rank(a.t) - rank(b.t) || (rank(a.t) === 0 ? a.t! - b.t! : rank(a.t) === 1 ? b.t! - a.t! : b.p.savedAt - a.p.savedAt));
  const items = rows
    .map(({ p, r, due }) => {
      return `<li>
        <a class="link open" href="#project/${encodeURIComponent(p.id)}"><b>${esc(projectLabel(p))}</b> <span>${esc(r?.rfp.client ?? "")}</span></a>
        <span class="when">${due ? `Due ${esc(formatWhen(due))}` : ""}</span>
        <button class="link" data-delete-project="${esc(p.id)}">Delete</button>
      </li>`;
    })
    .join("");
  $("project-page").innerHTML = `
    <div class="saved project-list"><h2 class="label">Projects</h2>
    ${items ? `<ol>${items}</ol>` : `<p class="none">No projects yet. Start one from an RFP review.</p>`}</div>`;
}

function render() {
  if (!project) return;
  const p = project;
  const cmpList = comparisons
    .map(
      (c) => `<li>
        <a class="link open" href="#proposals/${encodeURIComponent(c.id)}"><b>${esc(c.proposals.map((x) => firmName(x.firm)).join(", "))}</b></a>
        <span></span>
        <button class="link" data-unlink="${esc(c.id)}">Remove</button>
      </li>`,
    )
    .join("");


  $("project-page").innerHTML = `
    <div class="rfp-top">
      <a class="link" href="#project">← All projects</a>
      <span class="tools"><button class="btn" data-rename>Edit</button><button class="btn" data-share>Share</button><button class="btn" data-delete-project="${esc(p.id)}">Delete</button></span>
    </div>
    <h1 class="headline">${esc(projectLabel(p))}</h1>

    <div class="block">
      <h2 class="label">RFP review</h2>
      ${rfp ? `<p class="none"><a class="link" href="#rfp/${encodeURIComponent(rfp.id)}">${esc(rfp.rfp.project_name)}</a> · ${esc(rfp.rfp.client)}</p>` : `<p class="none">None linked.</p>`}
    </div>

    <div class="block saved">
      <h2 class="label">Proposals</h2>
      ${cmpList ? `<ol>${cmpList}</ol>` : `<p class="none">None yet.</p>`}
      <div class="actions"><button class="btn" data-compare>Compare proposals</button></div>
    </div>

    <div class="block">
      <h2 class="label">Consultants</h2>
      ${consultantsHtml(p)}
    </div>

    <div class="block saved">
      <h2 class="label">Schedule</h2>
      ${
        schedules.length
          ? `<ol>${schedules
              .map(
                (s) => `<li>
                  <a class="link open" href="#schedule/${encodeURIComponent(s.id)}"><b>${esc(String(s.title || "Untitled schedule"))}</b></a>
                  <span></span>
                  <span></span>
                </li>`,
              )
              .join("")}</ol>`
          : `<p class="none">None yet.</p>`
      }
      ${schedules.length ? "" : `<div class="actions"><button class="btn" data-make-schedule>Make schedule</button></div>`}
    </div>

    <div class="block saved">
      <h2 class="label">Fee</h2>
      ${
        fees.length
          ? `<ol>${fees
              .map(
                (f) => `<li>
                  <a class="link open" href="#fee/${encodeURIComponent(f.id)}"><b>${esc(f.title || "Untitled fee")}</b></a>
                  <span></span>
                  <span></span>
                </li>`,
              )
              .join("")}</ol>`
          : `<p class="none">None yet.</p>`
      }
      ${(() => {
        // The fee as it goes in the proposal, once it has amounts.
        const table = fees[0] && proposalTable(fees[0]);
        return table?.rows.length ? `<div class="scroll fee-on-project">${proposalHtml(table)}</div>` : "";
      })()}
      ${fees.length ? "" : `<div class="actions"><button class="btn" data-make-fee>Make fee</button></div>`}
    </div>`;
}

const MONTH_MS = 31 * 864e5;
const firstOfMonth = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1);
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Starts a schedule for this project, in the schedule editor's own format (as its blank template makes them), with the
 * RFP's dated items (proposal due, interviews, award, design and construction milestones) as milestones.
 */
/** Makes the project's schedule; a project has at most one, so if it already has one, opens that instead. */
async function makeSchedule() {
  if (!project) return;
  const p = project;
  const existing = (await listSchedules()).find((s) => s.workspaceProjectId === p.id);
  if (existing) {
    location.hash = `#schedule/${encodeURIComponent(existing.id)}`;
    return;
  }
  const dated = (rfp?.rfp.dates ?? []).filter((d) => parseDay(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  const times = dated.map((d) => parseDay(d.date)!.getTime());
  const start = firstOfMonth(Math.min(Date.now(), ...times));
  const end = firstOfMonth(Math.max(start.getTime() + 12 * MONTH_MS, ...times.map((t) => t + 2 * MONTH_MS)));
  const tasks = dated.length
    ? dated.map((d, i) => ({ id: i + 1, name: d.label, type: "milestone", date: d.date }))
    : [{ id: 1, name: "Project Kick-Off", type: "milestone", date: iso(start) }];
  const schedule: SavedSchedule = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    savedAt: Date.now(),
    createdAt: Date.now(),
    workspaceProjectId: p.id,
    title: p.name,
    notes: [
      "Project schedules are reliant on timely Owner input and approvals.",
      "R3A does not provide accurate projections for construction duration or timelines beyond the Construction Documentation phase.",
    ].join("\n"),
    date: "",
    number: p.number ?? "",
    client: rfp?.rfp.client ?? "",
    viewStart: iso(start),
    viewEnd: iso(end),
    todayMark: iso(new Date()),
    nextTaskId: tasks.length + 1,
    tasks,
    legend: { deliverables: [], milestones: [], estimates: [], approvals: [] },
    colorVersion: 2,
  };
  try {
    await saveSchedule(schedule);
  } catch (err) {
    return noticeModal("Schedule not saved", (err as Error).message);
  }
  location.hash = `#schedule/${encodeURIComponent(schedule.id)}`;
}

/**
 * The project's disciplines in governing-list order: those needed (see neededDisciplines), plus any a consultant on
 * the project covers. Each lists the firms covering it: from linked proposals, and added by hand (removable).
 */
function consultantsHtml(p: SavedProject): string {
  const requested = new Set(neededDisciplines(p));
  const rows = DISCIPLINES.map((d) => {
    const fromProposals = new Map<string, string>(); // firm → comparison id
    for (const c of comparisons)
      for (const x of c.proposals) if (x.firm && toDisciplines(x.disciplines ?? []).includes(d)) fromProposals.set(firmName(x.firm), c.id);
    const added = (p.consultants ?? []).map((c, i) => ({ ...c, i })).filter((c) => c.disciplines.includes(d));
    return { d, fromProposals, added, needed: requested.has(d) };
  }).filter((r) => r.needed || r.fromProposals.size || r.added.length);
  if (!rows.length) return `<p class="none">None yet.</p>`;
  return `<table class="grid facts team">${rows
    .map((r) => {
      const firms = [
        ...[...r.fromProposals].map(([firm, id]) => `<a class="link" href="#proposals/${encodeURIComponent(id)}">${esc(firm)}</a> <span class="note">proposal</span>`),
        ...r.added.map((c) => `${esc(c.name)} <button class="link" data-remove-consultant="${c.i}" aria-label="Remove ${esc(c.name)}">Remove</button>`),
      ];
      return `<tr><th scope="row">${esc(r.d)}</th><td>${firms.length ? firms.join("<br />") : `<span class="needed">Needed</span> <button class="link" data-remove-discipline="${esc(r.d)}" aria-label="Remove ${esc(r.d)}">Remove</button>`}</td></tr>`;
    })
    .join("")}</table>`;
}

const neededDisciplines = (p: SavedProject) => projectDisciplines(rfp?.rfp, p.disciplinesRemoved);

/** Takes a discipline the RFP review requests off this project's needed list (the review itself is unchanged). */
async function removeDiscipline(d: string) {
  if (!project) return;
  const p = project;
  p.disciplinesRemoved = toDisciplines([...(p.disciplinesRemoved ?? []), d]);
  await saveProject(p).catch((err) => noticeModal("Not saved", (err as Error).message));
  render();
}

async function removeConsultant(i: number) {
  if (!project?.consultants?.[i]) return;
  project.consultants.splice(i, 1);
  await saveProject(project).catch((err) => noticeModal("Not saved", (err as Error).message));
  render();
}

async function rename() {
  if (!project) return;
  const p = project;
  const entered = await askProjectName("Edit project", "Save", p);
  if (!entered || (entered.name === p.name && entered.number === p.number)) return;
  p.name = entered.name;
  p.number = entered.number;
  const name = projectLabel(p);
  try {
    await saveProject(p);
    // Reviews and comparisons show the project's name, so keep theirs in step.
    if (rfp) await saveRfp({ ...rfp, project: name });
    await Promise.all(comparisons.map((c) => saveComparison({ ...c, projectName: name })));
  } catch (err) {
    await noticeModal("Not saved", (err as Error).message);
  }
  await load();
  render();
}

async function unlink(id: string) {
  const c = comparisons.find((x) => x.id === id);
  if (!c) return;
  const ok = await confirmModal({
    title: "Remove from project?",
    body: "The comparison itself is kept. It just won't be part of this project.",
    confirm: "Remove",
  });
  if (!ok) return;
  try {
    await saveComparison({ ...c, projectId: undefined, projectName: null });
  } catch (err) {
    return noticeModal("Not saved", (err as Error).message);
  }
  await load();
  render();
}

/** Deletes a project. Its RFP review and comparisons are kept, just no longer linked to it. */
async function remove(id: string) {
  const target = (await listProjects()).find((p) => p.id === id);
  if (!target) return;
  const ok = await confirmTyped({
    title: "Delete this project?",
    name: projectLabel(target),
    body: `Its RFP review, comparisons and schedules are kept; they just won't be linked to a project. ${
      savesShared() ? "The project is removed for everyone who uses this app." : "The project is removed from this browser."
    } This can't be undone.`,
    confirm: "Delete project",
  });
  if (!ok) return;
  try {
    const [rfps, cmps] = await Promise.all([listRfps(), listComparisons()]);
    await Promise.all([
      ...rfps.filter((r) => r.projectId === id).map((r) => saveRfp({ ...r, projectId: undefined, project: null })),
      ...cmps.filter((c) => c.projectId === id).map((c) => saveComparison({ ...c, projectId: undefined, projectName: null })),
      ...(await listSchedules()).filter((s) => s.workspaceProjectId === id).map((s) => saveSchedule({ ...s, workspaceProjectId: undefined })),
      ...(await listFees()).filter((f) => f.workspaceProjectId === id).map((f) => saveFee({ ...f, workspaceProjectId: undefined })),
    ]);
    await deleteProject(id);
  } catch (err) {
    return noticeModal("Couldn't delete", (err as Error).message);
  }
  if (location.hash === "#project") showProjectList();
  else location.hash = "#project";
}

async function onClick(e: Event) {
  const t = e.target as HTMLElement;
  const del = t.closest("[data-delete-project]")?.getAttribute("data-delete-project");
  if (del) await remove(del);
  else if (t.closest("[data-share]") && project) await copyShareLink("project", project.id, t.closest("[data-share]") as HTMLElement);
  else if (t.closest("[data-remove-discipline]")) await removeDiscipline(t.closest("[data-remove-discipline]")!.getAttribute("data-remove-discipline")!);
  else if (t.closest("[data-make-schedule]")) await makeSchedule();
  else if (t.closest("[data-make-fee]") && project) await makeFee(project);
  else if (t.closest("[data-remove-consultant]")) await removeConsultant(Number(t.closest("[data-remove-consultant]")!.getAttribute("data-remove-consultant")));
  else if (t.closest("[data-rename]")) await rename();
  else if (t.closest("[data-unlink]")) await unlink(t.closest("[data-unlink]")!.getAttribute("data-unlink")!);
  else if (t.closest("[data-compare]") && project) {
    pending = { id: project.id, name: projectLabel(project) };
    location.hash = "#proposals";
  }
}
