import type { ProjectCheck, Proposal } from "../lib/claude";
import { estimateCheck, usd, usdRange, type Usage } from "../lib/cost";
import { post } from "./api";
import { confirmModal, confirmTyped, noticeModal } from "./modal";
import { askProjectName, deleteProject, projectLabel, listComparisons, listProjects, savesShared, listRfps, saveComparison, saveProject, saveRfp, type SavedComparison, type SavedProject, type SavedRfp } from "./store";
import { copyShareLink } from "./share";
import { esc, firmName } from "./table";

// A project page: its RFP review, the comparisons linked to it, and a check of those proposals against the RFP.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let project: SavedProject | null = null;
let rfp: SavedRfp | undefined;
let comparisons: SavedComparison[] = [];
let checking = false;

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

/** Every proposal across the linked comparisons, once each (the same PDF can be in several comparisons). */
function proposalsOf(cmps: SavedComparison[]): Proposal[] {
  const seen = new Set<string>();
  const out: Proposal[] = [];
  for (const c of cmps)
    for (const p of c.proposals) {
      const key = p.source_hash ?? `${p.firm}|${p.source_file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { source_file, file_id, pdf_tokens, source_hash, ...data } = p;
      out.push(data);
    }
  return out;
}

/** All projects, newest first, each opening its page. */
export async function showProjectList() {
  project = null;
  const [projects, rfps] = await Promise.all([listProjects(), listRfps()]);
  const items = projects
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((p) => {
      const r = rfps.find((x) => x.id === p.rfpId);
      return `<li>
        <a class="link open" href="#project/${encodeURIComponent(p.id)}"><b>${esc(projectLabel(p))}</b> <span>${esc(r?.rfp.client ?? "")}</span></a>
        <span class="when">${esc(day(p.savedAt))}</span>
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
  const proposals = proposalsOf(comparisons);
  const cmpList = comparisons
    .map(
      (c) => `<li>
        <a class="link open" href="#proposals/${encodeURIComponent(c.id)}"><b>${esc(c.proposals.map((x) => firmName(x.firm)).join(", "))}</b></a>
        <span class="when">${esc(day(c.savedAt))}</span>
        <button class="link" data-unlink="${esc(c.id)}">Remove</button>
      </li>`,
    )
    .join("");

  const canCheck = !!rfp && proposals.length > 0;
  const stale = p.check && (p.check.comparisonIds.join() !== comparisons.map((c) => c.id).sort().join());
  const est = canCheck ? usdRange(estimateCheck(proposals.length)) : "";

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
      <h2 class="label">Check against RFP</h2>
      ${p.check ? checkHtml(p.check) : `<p class="none">${canCheck ? "Finds requested services no proposal covers, and proposals that don't match the RFP." : rfp ? "Add proposals to check them against the RFP." : "Link an RFP review to check proposals against it."}</p>`}
      <div class="actions">
        <button class="btn primary" data-check ${canCheck && !checking ? "" : "disabled"}>${checking ? "Checking…" : p.check ? "Check again" : "Check"}</button>
        <span class="status" id="project-status">${p.check && !checking ? `Checked ${esc(day(p.check.checkedAt))}${p.check.costUsd != null ? ` · ${usd(p.check.costUsd)}` : ""}${stale ? " · proposals have changed since" : ""}` : ""}</span>
      </div>
      ${canCheck && !checking ? `<p class="estimate">Estimated cost ${est}</p>` : ""}
    </div>`;
}

const COVER = { covered: "Covered", partial: "Partial", missing: "Missing", in_house: "In-house" } as const;
const LEVEL = { high: "Act", medium: "Clarify", low: "Note" } as const;

function checkHtml(c: NonNullable<SavedProject["check"]>): string {
  const names = (ix: number[]) => ix.map((i) => c.firms[i]).filter(Boolean).map(firmName).join(", ");
  const rows = c.coverage
    .map(
      (r) => `<tr class="cv-${r.status}"><th scope="row">${esc(r.discipline)}</th><td class="cv">${COVER[r.status]}</td><td>${esc(names(r.firm_indexes))}${r.note ? `${r.firm_indexes.length ? " · " : ""}${esc(r.note)}` : ""}</td></tr>`,
    )
    .join("");
  const issues = c.issues
    .map(
      (f) => `<li class="lv-${f.level}"><span class="lv">${LEVEL[f.level]}</span><div><b>${esc(f.title)}</b>${
        f.firm_indexes.length ? ` <span class="who">${esc(names(f.firm_indexes))}</span>` : ""
      }<p>${esc(f.detail)}</p></div></li>`,
    )
    .join("");
  return `<p class="overview">${esc(c.summary)}</p>
    ${rows ? `<table class="grid facts coverage">${rows}</table>` : ""}
    ${issues ? `<h3 class="label">Issues</h3><ol class="flags">${issues}</ol>` : ""}`;
}

async function check() {
  if (!project || !rfp || checking) return;
  const p = project;
  const proposals = proposalsOf(comparisons);
  if (!proposals.length) return;
  checking = true;
  render();
  try {
    const res = await post<{ check: ProjectCheck; usage: Usage }>("/api/check", JSON.stringify({ rfp: rfp.rfp, proposals }), {
      "content-type": "application/json",
    });
    p.check = {
      ...res.check,
      firms: proposals.map((x) => x.firm),
      comparisonIds: comparisons.map((c) => c.id).sort(),
      checkedAt: Date.now(),
      costUsd: res.usage.cost_usd,
    };
    await saveProject(p).catch((err) => noticeModal("Check not saved", (err as Error).message));
  } catch (err) {
    await noticeModal("Check failed", (err as Error).message);
  } finally {
    checking = false;
    if (project === p) render();
  }
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
  else if (t.closest("[data-check]")) await check();
  else if (t.closest("[data-rename]")) await rename();
  else if (t.closest("[data-unlink]")) await unlink(t.closest("[data-unlink]")!.getAttribute("data-unlink")!);
  else if (t.closest("[data-compare]") && project) {
    pending = { id: project.id, name: projectLabel(project) };
    location.hash = "#proposals";
  }
}
