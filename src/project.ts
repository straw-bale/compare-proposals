import { DISCIPLINES, toDisciplines } from "../lib/disciplines";
import { askProjectName, confirmModal, confirmTyped, formModal, noticeModal } from "./modal";
import { deleteProject, projectLabel, listComparisons, listConsultants, listProjects, savesShared, listRfps, saveComparison, saveProject, saveRfp, type SavedComparison, type SavedProject, type SavedRfp } from "./store";
import { formatWhen, parseDay, proposalDue, servicesMatrix } from "./rfp";
import { copyShareLink } from "./share";
import { esc, firmName } from "./table";

// A project page: its RFP review, the comparisons linked to it, and its consultants by discipline.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let project: SavedProject | null = null;
let rfp: SavedRfp | undefined;
let comparisons: SavedComparison[] = [];

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
  const [rfps, cmps] = await Promise.all([listRfps(), listComparisons()]);
  rfp = rfps.find((r) => r.id === project!.rfpId) ?? rfps.find((r) => r.projectId === id);
  comparisons = cmps.filter((c) => c.projectId === id);
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

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function render() {
  if (!project) return;
  const p = project;
  const cmpList = comparisons
    .map(
      (c) => `<li>
        <a class="link open" href="#proposals/${encodeURIComponent(c.id)}"><b>${esc(c.proposals.map((x) => firmName(x.firm)).join(", "))}</b></a>
        <span class="when">${esc(day(c.savedAt))}</span>
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
      <div class="actions"><button class="btn" data-add-consultant>Add consultant</button></div>
    </div>`;
}

/**
 * The project's disciplines in governing-list order: those the RFP asks for, plus any a consultant on the project
 * covers. Each lists the firms covering it: from linked proposals, and added by hand (removable).
 */
function consultantsHtml(p: SavedProject): string {
  const requested = new Set(rfp ? requestedDisciplines(rfp) : []);
  const rows = DISCIPLINES.map((d) => {
    const fromProposals = new Map<string, string>(); // firm → comparison id
    for (const c of comparisons)
      for (const x of c.proposals) if (x.firm && toDisciplines(x.disciplines ?? []).includes(d)) fromProposals.set(firmName(x.firm), c.id);
    const added = (p.consultants ?? []).map((c, i) => ({ ...c, i })).filter((c) => c.disciplines.includes(d));
    return { d, fromProposals, added, needed: requested.has(d) };
  }).filter((r) => r.needed || r.fromProposals.size || r.added.length);
  if (!rows.length) return `<p class="none">${rfp ? "The RFP review doesn't list any of the standard disciplines yet." : "No RFP review or consultants yet."}</p>`;
  return `<table class="grid facts team">${rows
    .map((r) => {
      const firms = [
        ...[...r.fromProposals].map(([firm, id]) => `<a class="link" href="#proposals/${encodeURIComponent(id)}">${esc(firm)}</a> <span class="note">proposal</span>`),
        ...r.added.map((c) => `${esc(c.name)} <button class="link" data-remove-consultant="${c.i}" aria-label="Remove ${esc(c.name)}">Remove</button>`),
      ];
      return `<tr><th scope="row">${esc(r.d)}</th><td>${firms.length ? firms.join("<br />") : `<span class="needed">Needed</span>`}</td></tr>`;
    })
    .join("")}</table>`;
}

/** Governing disciplines the RFP requests. */
const requestedDisciplines = (r: SavedRfp) => servicesMatrix(r.rfp).filter((x) => x.requested === "yes").map((x) => x.discipline);

/** Adds a firm from the directory (or a new name) to the project for the disciplines ticked. */
async function addConsultant() {
  if (!project) return;
  const p = project;
  const directory = await listConsultants();
  const values = await formModal({
    title: "Add consultant",
    fields: [
      { label: "Firm", value: "", required: true, placeholder: "Start typing a firm from the directory", suggestions: directory.map((c) => c.name).sort() },
      { label: "Disciplines on this project", value: "", required: true, options: DISCIPLINES },
    ],
    confirm: "Add",
  });
  if (!values) return;
  const [name, picked] = values;
  const disciplines = toDisciplines(picked.split("\n"));
  const list = p.consultants ?? [];
  const same = list.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (same) same.disciplines = toDisciplines([...same.disciplines, ...disciplines]);
  else list.push({ name, disciplines });
  p.consultants = list;
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
    body: `Its RFP review and comparisons are kept; they just won't be linked to a project. ${
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
  else if (t.closest("[data-add-consultant]")) await addConsultant();
  else if (t.closest("[data-remove-consultant]")) await removeConsultant(Number(t.closest("[data-remove-consultant]")!.getAttribute("data-remove-consultant")));
  else if (t.closest("[data-rename]")) await rename();
  else if (t.closest("[data-unlink]")) await unlink(t.closest("[data-unlink]")!.getAttribute("data-unlink")!);
  else if (t.closest("[data-compare]") && project) {
    pending = { id: project.id, name: projectLabel(project) };
    location.hash = "#proposals";
  }
}
