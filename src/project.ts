import { DISCIPLINES, toDisciplines } from "../lib/disciplines";
import { askProjectName, confirmModal, confirmTyped, formModal, noticeModal } from "./modal";
import { makeFee, proposalHtml, withWaiting } from "./fee";
import { SCHEDULE_TEMPLATES } from "./schedule/lib/data/templates.js";
import { post } from "./api";
import { estimateScheduleDraft, usdRange, type Usage } from "../lib/cost";
import type { ScheduleDraft } from "../lib/claude";
import { proposalTable } from "./fee-calc";
import { deleteProject, listFees, saveFee, type SavedFee, projectLabel, listComparisons, listProjects, listSchedules, savesShared, listRfps, saveComparison, saveProject, saveRfp, saveSchedule, listConsultants, type SavedConsultant, type SavedComparison, type SavedProject, type SavedRfp, type SavedSchedule } from "./store";
import { addAddendum, formatWhen, parseDay, projectDisciplines, proposalDue } from "./rfp";
import { copyShareLink } from "./share";
import { esc, firmName } from "./table";
import { contactsHtml, copyEmail, keyOf, siteLink } from "./consultants";
import { parseContacts } from "./contacts";

// A project page: its RFP review, the comparisons linked to it, and its consultants by discipline.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let project: SavedProject | null = null;
let rfp: SavedRfp | undefined;
let comparisons: SavedComparison[] = [];
let schedules: SavedSchedule[] = [];
let fees: SavedFee[] = [];
/** the Consultants directory, for contact details */
let directory: SavedConsultant[] = [];

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
  const [rfps, cmps, scheds, fs, dir] = await Promise.all([listRfps(), listComparisons(), listSchedules(), listFees(), listConsultants().catch(() => [] as SavedConsultant[])]);
  directory = dir;
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
      ${
        rfp
          ? `<p class="none"><a class="link" href="#rfp/${encodeURIComponent(rfp.id)}">${esc(rfp.rfp.project_name)}</a> · ${esc(rfp.rfp.client)}${
              rfp.addenda?.length ? ` · ${rfp.addenda.length} addend${rfp.addenda.length === 1 ? "um" : "a"}` : ""
            }</p>
            <div class="actions"><label class="btn">Add addendum<input type="file" accept="application/pdf,.pdf" multiple hidden data-addendum /></label><span class="status" id="addendum-status"></span></div>`
          : `<p class="none">None linked.</p>`
      }
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
const AI_SCHEDULE = "Draft from the RFP review (AI)";
const DEFAULT_SCHEDULE_NOTES = [
  "Project schedules are reliant on timely Owner input and approvals.",
  "R3A does not provide accurate projections for construction duration or timelines beyond the Construction Documentation phase.",
].join("\n");
// The colours the schedule templates use, by kind of task, so drafted schedules look like the rest.
const KIND_COLOR: Record<string, string> = {
  design: "#00914D",
  review: "#949494",
  permit: "#D83968",
  bidding: "#282829",
  construction: "#6D245D",
  closeout: "#282829",
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Makes the project's schedule (a project has at most one; if it already has one, that opens). Starts from the same
 * templates as the Schedule tab, or is drafted by AI from the RFP review. Either way it's named after the project, and
 * a template also gets the RFP's dated items as milestones.
 */
async function makeSchedule() {
  if (!project) return;
  const p = project;
  const existing = (await listSchedules()).find((s) => s.workspaceProjectId === p.id);
  if (existing) {
    location.hash = `#schedule/${encodeURIComponent(existing.id)}`;
    return;
  }
  const options = [...(rfp ? [AI_SCHEDULE] : []), ...SCHEDULE_TEMPLATES.map((t) => t.label)];
  const picked = await formModal({
    title: "New schedule",
    fields: [{ label: "Start from", value: SCHEDULE_TEMPLATES[2].label, options, single: true, required: true }],
    confirm: "Make schedule",
  });
  if (!picked || project !== p) return;

  let schedule: SavedSchedule;
  if (picked[0] === AI_SCHEDULE && rfp) {
    const ok = await confirmModal({
      title: "Draft the schedule with AI?",
      body: `Claude reads the RFP review and drafts the phases, reviews and milestones, with its assumptions in the schedule's notes. Estimated cost ${usdRange(estimateScheduleDraft())}.`,
      confirm: "Draft",
    });
    if (!ok) return;
    const review = rfp;
    const res = await withWaiting("Drafting the schedule from the RFP review…", () =>
      post<{ draft: ScheduleDraft; usage: Usage }>("/api/schedule-ai", JSON.stringify({ rfp: review.rfp }), { "content-type": "application/json", "x-action": "draft" }),
    ).catch((err: Error) => noticeModal("Couldn't draft the schedule", err.message).then(() => null));
    if (!res) return;
    schedule = scheduleFromDraft(res.draft);
  } else {
    const tpl = SCHEDULE_TEMPLATES.find((t) => t.label === picked[0]) ?? SCHEDULE_TEMPLATES[2];
    schedule = withRfpMilestones(tpl.make() as unknown as SavedSchedule);
  }
  Object.assign(schedule, {
    savedAt: Date.now(),
    createdAt: Date.now(),
    workspaceProjectId: p.id,
    title: p.name,
    number: p.number ?? "",
    client: rfp?.rfp.client ?? "",
    colorVersion: 2,
  });
  try {
    await saveSchedule(schedule);
  } catch (err) {
    return noticeModal("Schedule not saved", (err as Error).message);
  }
  location.hash = `#schedule/${encodeURIComponent(schedule.id)}`;
}

/** Adds the RFP review's dated items (proposal due, interviews, construction start…) to a template as milestones. */
function withRfpMilestones(s: SavedSchedule): SavedSchedule {
  const dated = (rfp?.rfp.dates ?? []).filter((d) => parseDay(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (!dated.length) return s;
  const tasks = (s.tasks as { id: number }[]) ?? [];
  let next = Math.max(0, ...tasks.map((t) => t.id)) + 1;
  const added = dated.map((d) => ({ id: next++, name: d.label, type: "milestone", date: d.date }));
  const times = dated.map((d) => parseDay(d.date)!.getTime());
  const vs = parseDay(String(s.viewStart))?.getTime() ?? Date.now();
  const ve = parseDay(String(s.viewEnd))?.getTime() ?? Date.now();
  return {
    ...s,
    tasks: [...added, ...tasks],
    nextTaskId: next,
    viewStart: iso(firstOfMonth(Math.min(vs, ...times))),
    viewEnd: iso(firstOfMonth(Math.max(ve, ...times.map((t) => t + MONTH_MS)))),
  };
}

/** Turns an AI draft into a schedule in the editor's format: known colours, checked dates, a month of space each side. */
function scheduleFromDraft(d: ScheduleDraft): SavedSchedule {
  const tasks = d.tasks
    .map((t, i) => {
      const id = i + 1;
      if (t.kind === "milestone") return ISO_DAY.test(t.date) ? { id, name: t.name, type: "milestone", date: t.date } : null;
      if (!ISO_DAY.test(t.start) || !ISO_DAY.test(t.end)) return null;
      const [start, end] = t.start <= t.end ? [t.start, t.end] : [t.end, t.start];
      return { id, name: t.name, type: "bar", color: KIND_COLOR[t.kind] ?? "#00914D", start, end };
    })
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t, i) => ({ ...t, id: i + 1 }));
  const days = tasks.flatMap((t) => ("date" in t ? [t.date] : [t.start, t.end])).map((x) => parseDay(x ?? "")?.getTime()).filter((x): x is number => x != null);
  const first = days.length ? Math.min(...days) : Date.now();
  const last = days.length ? Math.max(...days) : Date.now() + 12 * MONTH_MS;
  const start = firstOfMonth(first - MONTH_MS);
  const end = firstOfMonth(last + MONTH_MS);
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    savedAt: Date.now(),
    notes: [...d.notes, DEFAULT_SCHEDULE_NOTES].join("\n"),
    date: "",
    viewStart: iso(start),
    viewEnd: iso(end),
    todayMark: iso(new Date()),
    nextTaskId: tasks.length + 1,
    tasks: tasks.length ? tasks : [{ id: 1, name: "Project Kick-Off", type: "milestone", date: iso(start) }],
    legend: { deliverables: [], milestones: [], estimates: [], approvals: [] },
  };
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
        ...[...r.fromProposals].map(([firm, id]) => `${contactButton(firm)} <a class="link note" href="#proposals/${encodeURIComponent(id)}">proposal</a>`),
        // Firms the team is reaching out to (added here), as removable pills; one whose proposal is in shows as the proposal.
        ...r.added
          .filter((c) => !r.fromProposals.has(firmName(c.name)))
          .map((c) => `<span class="reach">${contactButton(c.name)}<button class="reach-x" data-remove-consultant="${c.i}" data-discipline="${esc(r.d)}" aria-label="Remove ${esc(c.name)}" title="Remove">×</button></span>`),
      ];
      // Architecture (and interiors and FF&E) are the firm's own work, so they don't get consultants.
      const add = IN_HOUSE.includes(r.d) ? "" : `<button class="link reach-add" data-add-consultant="${esc(r.d)}" aria-label="Add a consultant for ${esc(r.d)}">+ Add</button>`;
      return `<tr><th scope="row">${esc(r.d)}</th><td>${
        firms.length
          ? `${firms.join(" ")} ${add}`
          : IN_HOUSE.includes(r.d)
            ? `In house`
            : `<span class="needed">Needed</span> ${add} <button class="link" data-remove-discipline="${esc(r.d)}" aria-label="Remove ${esc(r.d)}">Remove</button>`
      }</td></tr>`;
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

const IN_HOUSE: string[] = ["Architecture", "Interiors", "FF&E"];

/** Adds firms to reach out to for a discipline: from the Consultants directory (those covering it), or typed in. */
async function addConsultant(discipline: string) {
  if (!project) return;
  const p = project;
  const taken = new Set((p.consultants ?? []).filter((c) => c.disciplines.includes(discipline)).map((c) => c.name.toLowerCase()));
  const directory = (await listConsultants().catch(() => [] as SavedConsultant[]))
    .filter((c) => toDisciplines(c.disciplines).includes(discipline as (typeof DISCIPLINES)[number]) && !taken.has(c.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = directory.map((c) => c.name);
  const values = await formModal({
    title: `Consultants for ${discipline}`,
    fields: [
      ...(names.length ? [{ label: "From the directory", value: "", options: names }] : []),
      { label: names.length ? "Or another firm" : "Firm", value: "", placeholder: "Firm name" },
    ],
    confirm: "Add",
    validate: (v) => v.some((x) => x.trim()),
  });
  if (!values || project !== p) return;
  const picked = names.length ? values[0].split("\n").filter(Boolean) : [];
  const typed = values[values.length - 1].trim();
  const add = [...picked, ...(typed && !picked.some((n) => n.toLowerCase() === typed.toLowerCase()) ? [typed] : [])].filter((n) => !taken.has(n.toLowerCase()));
  if (!add.length) return;
  const list = p.consultants ?? [];
  for (const name of add) {
    const same = list.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (same) same.disciplines = [...new Set([...same.disciplines, discipline])];
    else list.push({ name, disciplines: [discipline] });
  }
  p.consultants = list;
  await saveProject(p).catch((err) => noticeModal("Not saved", (err as Error).message));
  render();
}

/** Takes a firm off one discipline (and off the project when it's left with none). */
async function removeConsultant(i: number, discipline?: string) {
  const c = project?.consultants?.[i];
  if (!project || !c) return;
  c.disciplines = discipline ? c.disciplines.filter((d) => d !== discipline) : [];
  if (!c.disciplines.length) project.consultants!.splice(i, 1);
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
  const contact = t.closest<HTMLElement>("[data-contact]");
  if (contact) return openContactCard(contact);
  const del = t.closest("[data-delete-project]")?.getAttribute("data-delete-project");
  if (del) await remove(del);
  else if (t.closest("[data-share]") && project) await copyShareLink("project", project.id, t.closest("[data-share]") as HTMLElement);
  else if (t.closest("[data-remove-discipline]")) await removeDiscipline(t.closest("[data-remove-discipline]")!.getAttribute("data-remove-discipline")!);
  else if (t.closest("[data-make-schedule]")) await makeSchedule();
  else if (t.closest("[data-make-fee]") && project) await makeFee(project);
  else if (t.closest("[data-add-consultant]")) await addConsultant(t.closest("[data-add-consultant]")!.getAttribute("data-add-consultant")!);
  else if (t.closest("[data-remove-consultant]")) {
    const el = t.closest("[data-remove-consultant]")!;
    await removeConsultant(Number(el.getAttribute("data-remove-consultant")), el.getAttribute("data-discipline") ?? undefined);
  }
  else if (t.closest("[data-rename]")) await rename();
  else if (t.closest("[data-unlink]")) await unlink(t.closest("[data-unlink]")!.getAttribute("data-unlink")!);
  else if (t.closest("[data-compare]") && project) {
    pending = { id: project.id, name: projectLabel(project) };
    location.hash = "#proposals";
  }
}

// ---------- Contact cards ----------
// A consultant's name opens a small card with their contacts from the Consultants directory.

const findFirm = (name: string) => directory.find((c) => keyOf(c.name) === keyOf(name));

const contactButton = (name: string) => `<button class="contact-name" data-contact="${esc(name)}" aria-haspopup="dialog">${esc(name)}</button>`;

function closeContactCard() {
  document.getElementById("contact-card")?.remove();
}

function openContactCard(button: HTMLElement) {
  const already = document.getElementById("contact-card");
  closeContactCard();
  if (already?.dataset.for === button.dataset.contact) return; // a second click closes it
  const name = button.dataset.contact ?? "";
  const firm = findFirm(name);
  const contacts = firm ? (firm.contacts ?? parseContacts(firm.contact)) : [];
  const card = document.createElement("div");
  card.id = "contact-card";
  card.className = "contact-card";
  card.dataset.for = name;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", `${name} contacts`);
  card.innerHTML = firm
    ? `<h3>${esc(firm.name)}</h3>
       ${contacts.length ? contactsHtml(contacts) : `<p class="none">No contacts saved.</p>`}
       ${firm.website ? `<p>${siteLink(firm.website)}</p>` : ""}
       <p><a class="link" href="#consultants">Open the directory</a></p>`
    : `<h3>${esc(name)}</h3><p class="none">Not in the Consultants directory yet.</p><p><a class="link" href="#consultants">Add them there</a></p>`;
  document.body.appendChild(card);
  const box = button.getBoundingClientRect();
  const left = Math.min(box.left + scrollX, scrollX + document.documentElement.clientWidth - card.offsetWidth - 12);
  card.style.left = `${Math.max(scrollX + 12, left)}px`;
  card.style.top = `${box.bottom + scrollY + 6}px`;
}

// Clicks inside the card (copying an email) stay open; anywhere else, Escape or leaving the page closes it.
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const copy = t.closest<HTMLElement>("#contact-card [data-copy-email]");
  if (copy) return void copyEmail(copy);
  if (t.closest("#contact-card") || t.closest("[data-contact]")) return;
  closeContactCard();
});
addEventListener("keydown", (e) => e.key === "Escape" && closeContactCard());
addEventListener("hashchange", closeContactCard);

// ---------- Addenda ----------
// Picking an addendum's PDF reads it into the project's RFP review, which then lists what changed.
document.addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  if (!input.matches?.("#project-page [data-addendum]") || !rfp || !project) return;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (!files.length) return;
  if (files.some((f) => !/\.pdf$/i.test(f.name) && f.type !== "application/pdf")) return noticeModal("Not a PDF", "Addenda have to be PDFs.");
  const status = document.getElementById("addendum-status");
  const started = Date.now();
  const tick = setInterval(() => status && (status.textContent = `Reading… ${Math.round((Date.now() - started) / 1000)}s`), 1000);
  try {
    const updated = await addAddendum(rfp, files);
    if (!updated) return;
    rfp = updated;
    render();
    const last = updated.addenda!.at(-1)!;
    const go = await confirmModal({
      title: `Addendum ${last.number} added`,
      body: `${last.changes.length} change${last.changes.length === 1 ? "" : "s"} to the RFP review. The review lists each one.`,
      confirm: "See what changed",
    });
    if (go) location.hash = `#rfp/${encodeURIComponent(updated.id)}`;
  } catch (err) {
    await noticeModal("Couldn't read the addendum", (err as Error).message);
  } finally {
    clearInterval(tick);
    if (status) status.textContent = "";
  }
});
