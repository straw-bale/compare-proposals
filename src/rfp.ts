import { RFP_FACTS, type Rfp, type RfpFactKey } from "../lib/claude";
import { DISCIPLINES, toDisciplines, type Discipline } from "../lib/disciplines";
import { estimateRfp, usd, usdRange, type Usage } from "../lib/cost";
import { post, postPdf } from "./api";
import { deleteRfp, listRfps, projectLabel, saveProject, saveRfp, savesShared, type SavedProject, type SavedRfp } from "./store";
import { askProjectName, confirmDelete, confirmModal, noticeModal } from "./modal";
import { copyShareLink } from "./share";
import { esc } from "./table";

// Vercel rejects request bodies over 4.5 MB, so larger PDFs go straight to storage first (see uploadRfpPdf).
// Locally there's no limit. Storage takes up to 50 MB per file.
const MAX_BYTES = import.meta.env.PROD ? 4.4 * 1024 * 1024 : Infinity;
const MAX_STORED = 50 * 1024 * 1024;
/** tokens value for a large file, which can't be measured before it's uploaded */
const UNMEASURED = -2;

type Entry = { file: File; tokens?: number; error?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let entries: Entry[] = [];
let busy = false;
let current: SavedRfp | null = null;

export function initRfp() {
  const drop = $<HTMLLabelElement>("rfp-drop");
  const input = $<HTMLInputElement>("rfp-input");
  input.addEventListener("change", () => {
    if (input.files) addFiles(input.files);
    input.value = "";
  });
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add("over")));
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  });
  $("rfp-files").addEventListener("click", (e) => {
    const i = (e.target as HTMLElement).closest("[data-remove]")?.getAttribute("data-remove");
    if (i == null || busy) return;
    entries.splice(Number(i), 1);
    renderFiles();
  });
  $("rfp-run").addEventListener("click", run);
  $("rfp-saved-list").addEventListener("click", onSavedClick);
  $("rfp-results").addEventListener("click", onResultsClick);
  $("rfp-results").addEventListener("submit", addQuestion);
  $("rfp-results").addEventListener("submit", onEditSubmit);
  // Escape leaves an open edit form without saving (a dialog on top handles its own Escape first).
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !editing || $("rfp-results").hidden || document.querySelector("dialog[open]")) return;
    e.preventDefault();
    editing = null;
    rerenderInPlace();
  });
  renderSaved();
}

// ---------- Intake ----------

function addFiles(list: FileList) {
  for (const file of Array.from(list)) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const entry: Entry = { file };
    if (!isPdf) entry.error = "Not a PDF";
    else if (file.size > MAX_STORED) entry.error = "Over 50 MB, compress or split it first";
    else if (file.size > MAX_BYTES) entry.tokens = UNMEASURED;
    else
      post<{ input_tokens: number }>("/api/upload", file, { "content-type": "application/pdf", "x-action": "estimate" })
        .then((r) => (entry.tokens = r.input_tokens))
        .catch(() => (entry.tokens = -1))
        .finally(renderFiles);
    entries.push(entry);
  }
  renderFiles();
}

function renderFiles() {
  $("rfp-files").innerHTML = entries
    .map(
      (e, i) => `<li>
        <span class="name">${esc(e.file.name)}</span>
        <span class="state ${e.error ? "error" : ""}">${esc(e.error ?? "")}</span>
        <span>${busy ? "" : `<button data-remove="${i}">Remove</button>`}</span>
      </li>`,
    )
    .join("");
  const usable = entries.filter((e) => !e.error);
  const run = $<HTMLButtonElement>("rfp-run");
  run.disabled = busy || usable.length === 0;
  run.textContent = busy ? "Reviewing…" : "Review";
  const known = usable.every((e) => e.tokens != null && e.tokens >= 0);
  $("rfp-estimate").textContent = busy
    ? ""
    : usable.some((e) => e.tokens === UNMEASURED)
      ? "No cost estimate for files over 4.4 MB"
      : usable.length && known
        ? `Estimated cost ${usdRange(estimateRfp(usable.reduce((a, e) => a + e.tokens!, 0)))}`
        : "";
}

function setStatus(msg: string, isError = false) {
  const el = $("rfp-status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

async function run() {
  const usable = entries.filter((e) => !e.error);
  if (!usable.length || busy) return;
  busy = true;
  renderFiles();
  const started = Date.now();
  const tick = setInterval(() => setStatus(`Reading… ${Math.round((Date.now() - started) / 1000)}s`), 1000);
  setStatus("Reading…");
  try {
    const files = await Promise.all(
      usable.map(async (e) => ({ file_id: await uploadRfpPdf(e.file), filename: e.file.name })),
    );
    const res = await post<{ rfp: Rfp; usage: Usage }>("/api/rfp", JSON.stringify({ files }), { "content-type": "application/json" });
    current = { id: crypto.randomUUID(), savedAt: Date.now(), files: files.map((f) => f.filename), rfp: res.rfp, costUsd: res.usage.cost_usd };
    editing = null;
    entries = [];
    setStatus("");
    showResults();
    // The review is already paid for, so a failed save keeps it on screen and says so.
    await saveRfp(current).catch((err) =>
      $("rfp-results").insertAdjacentHTML("afterbegin", `<p class="status error">Not saved: ${esc((err as Error).message)}</p>`),
    );
  } catch (err) {
    setStatus((err as Error).message, true);
  } finally {
    clearInterval(tick);
    busy = false;
    renderFiles();
  }
}

/** Hands one PDF to Anthropic and returns its file_id: directly when small, through storage when over 4.4 MB. */
async function uploadRfpPdf(file: File): Promise<string> {
  if (file.size <= MAX_BYTES) return (await postPdf<{ file_id: string }>("/api/upload", file)).file_id;
  const json = { "content-type": "application/json" };
  const { url, path } = await post<{ url: string; path: string }>("/api/upload", "{}", { ...json, "x-action": "sign" });
  const put = await fetch(url, { method: "PUT", body: file, headers: { "content-type": "application/pdf", "x-upsert": "false" } });
  if (!put.ok) throw new Error(`Couldn't upload ${file.name} (${put.status}).`);
  return (await post<{ file_id: string }>("/api/upload", JSON.stringify({ path, filename: file.name }), json)).file_id;
}

// ---------- Saved ----------

async function renderSaved() {
  const all = await listRfps();
  $("rfp-saved").hidden = all.length === 0;
  $("rfp-saved-list").innerHTML = all
    .map((s) => {
      const due = proposalDue(s.rfp);
      return `<li>
        <button class="link open" data-open="${esc(s.id)}"><b>${esc(s.project ?? s.rfp.project_name)}</b> <span>${esc(s.rfp.client)}</span></button>
        <span class="when">${due ? `Due ${esc(formatWhen(due))}` : ""}</span>
        <button class="link" data-delete="${esc(s.id)}">Delete</button>
      </li>`;
    })
    .join("");
}

/** Creates a project from this review (name confirmed by the user) and links the review to it. */
async function startProject(review: SavedRfp) {
  const entered = await askProjectName("Start a project", "Start project", { name: review.project || review.rfp.project_name });
  if (!entered) return;
  const project: SavedProject = { id: crypto.randomUUID(), savedAt: Date.now(), ...entered, rfpId: review.id };
  try {
    await saveProject(project);
    review.projectId = project.id;
    review.project = projectLabel(project);
    await saveRfp(review);
  } catch (err) {
    return noticeModal("Project not saved", (err as Error).message);
  }
  if (current === review) showResults();
}

/** The review on screen, if any. */
export const getCurrentRfp = () => current;

/** Opens a saved review by id (from the list or a shared link). */
export async function openRfp(id: string) {
  const found = (await listRfps()).find((s) => s.id === id);
  if (!found) return noticeModal("Review not found", "It may have been deleted.");
  current = found;
  editing = null;
  showResults();
}

async function onSavedClick(e: Event) {
  const t = e.target as HTMLElement;
  const openId = t.closest("[data-open]")?.getAttribute("data-open");
  const deleteId = t.closest("[data-delete]")?.getAttribute("data-delete");
  if (openId && !busy) {
    await openRfp(openId);
  } else if (deleteId && (await confirmDelete("RFP review"))) {
    try {
      await deleteRfp(deleteId);
    } catch (err) {
      await noticeModal("Couldn't delete", (err as Error).message);
    }
    renderSaved();
  }
}

// ---------- Results ----------

/** Local-midnight date for "YYYY-MM-DD", or null. */
export const parseDay = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * One display format for every date, whatever the RFP's wording: "Jul 12, 2023, 9:30 AM" for a specific day
 * (time kept when stated), "Sep 2023" for a month, and the original words otherwise ("After proposals, date TBD").
 */
export function formatWhen(d: { date: string; when: string }): string {
  const day = parseDay(d.date);
  if (day) {
    const t = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?/i.exec(d.when) ?? /\b(noon)\b/i.exec(d.when);
    const time = !t ? "" : t[1].toLowerCase() === "noon" ? "12:00 PM" : `${+t[1]}:${t[2] ?? "00"} ${t[3].toUpperCase()}M`;
    return `${MONTHS[day.getMonth()]} ${day.getDate()}, ${day.getFullYear()}${time ? `, ${time}` : ""}`;
  }
  const m = /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\s*$/i.exec(d.when);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1, 3).toLowerCase()} ${m[2]}`;
  const ym = /^\s*(\d{1,2})\/(\d{4})\s*$/.exec(d.when);
  if (ym && +ym[1] >= 1 && +ym[1] <= 12) return `${MONTHS[+ym[1] - 1]} ${ym[2]}`;
  return d.when;
}


export function proposalDue(rfp: Rfp) {
  return rfp.dates.find((d) => /proposal|submission|submittal|response|qualifications/i.test(d.label) && /due|deadline|submi/i.test(d.label));
}

const pg = (n: number) => (Number(n) > 0 ? ` <span class="pg">p. ${Math.trunc(Number(n))}</span>` : "");

function showResults() {
  if (!current) return;
  const { rfp } = current;
  const due = proposalDue(rfp);

  const dates = rfp.dates
    .map((d) => {
      return `<tr class="${d === due ? "due" : ""}">
        <td class="when">${esc(formatWhen(d))}</td>
        <td>${esc(d.label)}${d.mandatory ? ' <span class="must">Mandatory</span>' : ""}</td>
      </tr>`;
    })
    .join("");

  const notes = (rfp as RfpWithNotes).notes ?? "";
  const canEditFacts = !Array.isArray(rfp.facts);
  $("rfp-results").innerHTML = `
    <div class="rfp-top">
      <button class="link" data-back>← All RFPs</button>
      <span class="project-name">${
        current.projectId
          ? `Project: <a class="link" href="#project/${encodeURIComponent(current.projectId)}"><b>${esc(current.project ?? "")}</b></a>`
          : current.project
            ? `Project: <b>${esc(current.project)}</b>`
            : ""
      }</span>
      <span class="tools">${current.projectId ? "" : '<button class="btn" data-start-project>Start project</button>'}<button class="btn" data-share>Share</button><button class="btn" data-print>Print</button></span>
    </div>
    ${
      editing === "header"
        ? editForm(
            "header",
            `${field("Project name", `<input type="text" name="project_name" value="${esc(rfp.project_name)}" />`)}
             ${field("Client", `<input type="text" name="client" value="${esc(rfp.client)}" />`)}
             ${field("Summary", `<textarea name="summary" rows="5">${esc(rfp.summary)}</textarea>`)}`,
          )
        : `<h1 class="headline">${esc(rfp.project_name)} ${editLink("header")}</h1>
    <p class="rfp-sub">${esc(rfp.client)}${due ? ` · <mark>Due ${esc(formatWhen(due))}</mark>` : ""}</p>
    <p class="overview">${esc(rfp.summary)}</p>`
    }
    ${
      editing === "notes"
        ? `<div class="block"><h2 class="label">Notes</h2>${editForm(
            "notes",
            `<textarea name="notes" rows="6" aria-label="Notes" placeholder="What you know beyond the RFP: calls with the client, site visits, past work with them, things to read between the lines…">${esc(notes)}</textarea>`,
          )}</div>`
        : notes
          ? `<div class="block rfp-notes"><h2 class="label">Notes ${editLink("notes")}</h2><p>${esc(notes).replace(/\n/g, "<br />")}</p></div>`
          : `<p class="rfp-add-notes"><button class="link" data-edit="notes">Add notes</button></p>`
    }

    <div class="rfp-cols">
      <div>
        ${
          editing === "dates"
            ? editSection("Key dates", "dates", rowsHtml("dates", rfp.dates))
            : section(`Key dates ${editLink("dates")}`, `<table class="grid dates">${dates}</table>`, rfp.dates.length)
        }
        ${
          editing === "watch"
            ? editSection("Critical components", "watch", rowsHtml("watch", rfp.watch_outs))
            : section(
                `Critical components ${editLink("watch")}`,
                `<ul class="watch">${rfp.watch_outs
                  .map((w) => `<li class="${w.critical ? "critical" : ""}"><b>${esc(w.title)}</b>${pg(w.page)}<p>${esc(w.detail)}</p></li>`)
                  .join("")}</ul>`,
                rfp.watch_outs.length,
                "None found.",
              )
        }
        ${
          editing === "questions"
            ? editSection("Questions to ask", "questions", rowsHtml("questions", rfp.questions))
            : section(
          `Questions to ask <button class="link" data-copy>Copy</button> ${editLink("questions")}`,
          (rfp.questions.length
            ? `<ol class="qs">${rfp.questions
                .map((q, i) => `<li><button class="q-remove" data-remove-q="${i}" title="Remove this question" aria-label="Remove this question">×</button><span>${i + 1}. ${esc(q)}</span></li>`)
                .join("")}</ol>`
            : `<p class="none">None.</p>`) +
            `<form class="q-add" data-add-q><input type="text" aria-label="New question" placeholder="Add a question" autocomplete="off" /><button class="btn" type="submit">Add</button></form>`,
          1,
        )
        }
      </div>
      <div>
        ${
          editing === "facts" && canEditFacts
            ? editSection(
                "Key facts",
                "facts",
                (Object.keys(RFP_FACTS) as RfpFactKey[])
                  .map((k) => field(RFP_FACTS[k], `<input type="text" name="fact:${k}" value="${esc(rfp.facts[k]?.value ?? "")}" />`))
                  .join(""),
              )
            : section(`Key facts ${canEditFacts ? editLink("facts") : ""}`, `<table class="grid facts">${factsRows(rfp.facts)}</table>`, 1)
        }
        ${
          editing === "services"
            ? editSection(
                "Disciplines requested",
                "services",
                `<table class="grid services-edit">${servicesMatrix(rfp)
                  .map(
                    (r) => `<tr><th scope="row">${esc(r.discipline)}</th>
                      <td><select name="req:${esc(r.discipline)}" aria-label="${esc(r.discipline)}">${(Object.keys(REQUESTED) as ServiceRow["requested"][])
                        .map((k) => `<option value="${k}" ${k === r.requested ? "selected" : ""}>${REQUESTED[k]}</option>`)
                        .join("")}</select></td>
                      <td><input type="text" name="detail:${esc(r.discipline)}" value="${esc(r.detail)}" aria-label="${esc(r.discipline)} detail" placeholder="Detail" /></td></tr>`,
                  )
                  .join("")}</table>`,
              )
            : servicesBlock(rfp)
        }
        ${
          editing === "scoring"
            ? editSection("Scoring", "scoring", rowsHtml("scoring", rfp.scoring))
            : section(
                `Scoring ${editLink("scoring")}`,
                `<table class="grid facts">${rfp.scoring.map((s) => `<tr><th scope="row">${esc(s.criterion)}</th><td class="num">${esc(s.weight)}</td></tr>`).join("")}</table>`,
                rfp.scoring.length,
              )
        }
      </div>
    </div>
    <p class="estimate">${esc(current.files.join(", "))}${current.costUsd != null ? ` · ${usd(current.costUsd)}` : ""}</p>
    <p class="print-note">AI can make mistakes, so check important details against the original documents.</p>`;

  $("rfp-intake").hidden = true;
  $("rfp-results").hidden = false;
  scrollTo(0, 0);
}

/** A titled block. Every review shows the same blocks in the same order; an empty one says so. */
const section = (title: string, body: string, count: number, empty = "Not stated in the RFP.") =>
  `<div class="block"><h2 class="label">${title}</h2>${count ? body : `<p class="none">${empty}</p>`}</div>`;

/** "needed": the RFP doesn't ask for it, but the team knows the project needs it (set by hand). */
export type ServiceRow = { discipline: Discipline; requested: "yes" | "needed" | "no" | "unclear" | "unknown"; detail: string; page: number };

/**
 * Every governing discipline with whether the RFP requests it. Reads reviews in every saved shape: the current
 * matrix; the earlier free-text list (listed = yes, the rest = no); and the oldest one-line summary (matches = yes,
 * the rest unknown). Anything that isn't a governing discipline is left out.
 */
/** Disciplines a project needs: those its RFP review requests, minus any removed on the project page. */
export function projectDisciplines(rfp: Rfp | undefined, removed: string[] = []): Discipline[] {
  if (!rfp) return [];
  return servicesMatrix(rfp)
    .filter((x) => (x.requested === "yes" || x.requested === "needed") && !removed.includes(x.discipline))
    .map((x) => x.discipline);
}

export function servicesMatrix(rfp: Rfp): ServiceRow[] {
  type Saved = { discipline: string; detail: string; page: number; requested?: string };
  const list = (rfp as { services?: Saved[] }).services;
  const byName = new Map<Discipline, ServiceRow>();
  let rest: ServiceRow["requested"] = "unknown";
  if (Array.isArray(list) && list.some((s) => s.requested)) {
    for (const s of list) if ((DISCIPLINES as readonly string[]).includes(s.discipline)) byName.set(s.discipline as Discipline, s as ServiceRow);
  } else if (Array.isArray(list)) {
    rest = "no";
    for (const s of list) for (const d of toDisciplines([s.discipline])) byName.set(d, { discipline: d, requested: "yes", detail: s.detail, page: s.page });
  } else {
    const old = (rfp.facts as Partial<Record<string, { value: string; page: number }>>).services;
    for (const d of toDisciplines((old?.value ?? "").split(/[,;]/))) byName.set(d, { discipline: d, requested: "yes", detail: "", page: old?.page ?? 0 });
  }
  return DISCIPLINES.map((d) => byName.get(d) ?? { discipline: d, requested: rest, detail: "", page: 0 });
}

const REQUESTED = { yes: "Requested", needed: "Not requested, but needed", no: "Not requested", unclear: "Unclear", unknown: "Not stated" } as const;

/** Disciplines requested: every governing discipline, marked requested or not. */
function servicesBlock(rfp: Rfp): string {
  const rows = servicesMatrix(rfp)
    .map(
      (r) =>
        `<tr class="req-${r.requested}"><th scope="row">${esc(r.discipline)}</th><td class="req">${REQUESTED[r.requested]}</td><td>${esc(r.detail)}${pg(r.page)}</td></tr>`,
    )
    .join("");
  return section(`Disciplines requested ${editLink("services")}`, `<table class="grid services">${rows}</table>`, 1);
}

/** Key facts in a fixed order. Reviews saved before the fixed list keep their own label/value pairs. */
function factsRows(facts: Rfp["facts"] | { label: string; value: string; page: number }[]): string {
  const rows = Array.isArray(facts)
    ? facts.map((f) => [f.label, f.value, f.page] as const)
    : (Object.keys(RFP_FACTS) as RfpFactKey[]).filter((k) => facts[k]).map((k) => [RFP_FACTS[k], facts[k].value, facts[k].page] as const);
  return rows
    .map(([label, value, page]) => `<tr><th scope="row">${esc(label)}${value ? pg(page) : ""}</th><td>${value ? esc(value) : "Not stated"}</td></tr>`)
    .join("");
}

/** Adds the typed question to the end of the list and saves the review. */
async function addQuestion(e: Event) {
  const form = (e.target as HTMLElement).closest("[data-add-q]");
  if (!form || !current) return;
  e.preventDefault();
  const text = form.querySelector("input")!.value.trim();
  if (!text) return;
  current.rfp.questions.push(text);
  const y = scrollY;
  showResults();
  scrollTo(0, y);
  $("rfp-results").querySelector<HTMLInputElement>("[data-add-q] input")?.focus();
  await saveRfp(current).catch((err) => noticeModal("Not saved", (err as Error).message));
}

async function onResultsClick(e: Event) {
  const t = e.target as HTMLElement;
  if (onEditClick(t)) return;
  if (t.closest("[data-back]")) {
    editing = null;
    current = null;
    history.replaceState(null, "", "#rfp");
    $("rfp-results").hidden = true;
    $("rfp-intake").hidden = false;
    renderSaved();
  } else if (t.closest("[data-print]")) {
    print();
  } else if (t.closest("[data-start-project]") && current) {
    await startProject(current);
  } else if (t.closest("[data-share]") && current) {
    await copyShareLink("rfp", current.id, t.closest("[data-share]") as HTMLElement);
  } else if (t.closest("[data-remove-q]") && current) {
    // Answered or not useful: drop it from the saved review, after a warning that it can't come back.
    const i = Number(t.closest("[data-remove-q]")!.getAttribute("data-remove-q"));
    const ok = await confirmModal({
      title: "Remove this question?",
      body: savesShared()
        ? "It will be permanently removed from this review for everyone. This can't be undone."
        : "It will be permanently removed from this review. This can't be undone.",
      confirm: "Remove",
      danger: true,
    });
    if (!ok || !current) return;
    current.rfp.questions.splice(i, 1);
    const y = scrollY;
    showResults();
    scrollTo(0, y);
    await saveRfp(current).catch((err) => noticeModal("Not saved", (err as Error).message));
  } else if (t.closest("[data-copy]") && current) {
    await navigator.clipboard.writeText(current.rfp.questions.map((q, i) => `${i + 1}. ${q}`).join("\n"));
    t.textContent = "Copied";
    setTimeout(() => (t.textContent = "Copy"), 1500);
  }
}

// ---------- Editing ----------
// Any section can be corrected or added to by hand: mistakes, things read between the lines, or information from
// outside the RFP. Text that's changed loses its page reference, since it no longer comes from the document.

/** The team's own notes, kept with the review (and passed to the AI with it). */
type RfpWithNotes = Rfp & { notes?: string };
type EditKey = "header" | "notes" | "dates" | "watch" | "questions" | "facts" | "services" | "scoring";
let editing: EditKey | null = null;

const editLink = (key: EditKey) => `<button class="link edit-link" data-edit="${key}">Edit</button>`;
const field = (label: string, control: string) => `<label class="edit-field"><span>${esc(label)}</span>${control}</label>`;
const editForm = (key: EditKey, inner: string) =>
  `<form class="rfp-edit" data-edit-form="${key}">${inner}<div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-cancel-edit>Cancel</button></div></form>`;
const editSection = (title: string, key: EditKey, inner: string) => `<div class="block"><h2 class="label">${esc(title)}</h2>${editForm(key, inner)}</div>`;

type RowKey = "dates" | "watch" | "questions" | "scoring";
const ADD_LABEL: Record<RowKey, string> = { dates: "+ Add date", watch: "+ Add item", questions: "+ Add question", scoring: "+ Add criterion" };

/** One editable row; `item` undefined gives a blank one. The original text and page ride along to keep page refs. */
function rowHtml(key: RowKey, item?: unknown): string {
  const keep = (text: string, page: number) => `<input type="hidden" name="orig" value="${esc(text)}" /><input type="hidden" name="page" value="${page}" />`;
  const remove = `<button type="button" class="link" data-remove-row>Remove</button>`;
  if (key === "dates") {
    const d = (item as Rfp["dates"][number] | undefined) ?? { label: "", date: "", when: "", mandatory: false, page: 0 };
    return `<div class="edit-row edit-date">
      <input type="text" name="label" value="${esc(d.label)}" placeholder="What (e.g. Proposal due)" aria-label="What" />
      <input type="date" name="date" value="${esc(d.date)}" aria-label="Date" />
      <input type="text" name="when" value="${esc(d.when)}" placeholder="Time, or e.g. Spring 2028" aria-label="Time or wording" />
      <label class="check"><input type="checkbox" name="mandatory" ${d.mandatory ? "checked" : ""} /> Mandatory</label>
      ${keep(d.label + "|" + d.date + "|" + d.when, d.page)}${remove}</div>`;
  }
  if (key === "watch") {
    const w = (item as Rfp["watch_outs"][number] | undefined) ?? { critical: false, title: "", detail: "", page: 0 };
    return `<div class="edit-row edit-watch">
      <input type="text" name="title" value="${esc(w.title)}" placeholder="Title" aria-label="Title" />
      <textarea name="detail" rows="2" placeholder="Detail" aria-label="Detail">${esc(w.detail)}</textarea>
      <label class="check"><input type="checkbox" name="critical" ${w.critical ? "checked" : ""} /> Critical</label>
      ${keep(w.title + "|" + w.detail, w.page)}${remove}</div>`;
  }
  if (key === "questions") {
    const q = (item as string | undefined) ?? "";
    return `<div class="edit-row edit-question"><textarea name="text" rows="2" aria-label="Question" placeholder="Question">${esc(q)}</textarea>${remove}</div>`;
  }
  const s = (item as Rfp["scoring"][number] | undefined) ?? { criterion: "", weight: "" };
  return `<div class="edit-row edit-scoring">
    <input type="text" name="criterion" value="${esc(s.criterion)}" placeholder="Criterion" aria-label="Criterion" />
    <input type="text" name="weight" value="${esc(s.weight)}" placeholder="Weight (e.g. 25%)" aria-label="Weight" />
    ${remove}</div>`;
}

const rowsHtml = (key: RowKey, items: unknown[]) =>
  `<div class="edit-rows" data-rows="${key}">${items.map((it) => rowHtml(key, it)).join("")}</div><button type="button" class="link" data-add-row="${key}">${ADD_LABEL[key]}</button>`;

/** Reads a submitted edit form back into the review. */
function applyEdit(key: EditKey, form: HTMLFormElement) {
  if (!current) return;
  const rfp = current.rfp as RfpWithNotes;
  const val = (el: ParentNode, name: string) => (el.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? "").trim();
  const checked = (el: ParentNode, name: string) => !!el.querySelector<HTMLInputElement>(`[name="${name}"]`)?.checked;
  const rows = [...form.querySelectorAll<HTMLElement>(".edit-row")];
  // A row keeps its page reference only while its text is unchanged.
  const pageIf = (row: HTMLElement, text: string) => (val(row, "orig") === text ? Number(val(row, "page")) || 0 : 0);

  if (key === "header") {
    rfp.project_name = val(form, "project_name") || rfp.project_name;
    rfp.client = val(form, "client");
    rfp.summary = val(form, "summary");
  } else if (key === "notes") {
    rfp.notes = val(form, "notes") || undefined;
  } else if (key === "facts") {
    for (const k of Object.keys(RFP_FACTS) as RfpFactKey[]) {
      const value = val(form, `fact:${k}`);
      const before = rfp.facts[k] ?? { value: "", page: 0 };
      rfp.facts[k] = { value, page: value === before.value ? before.page : 0 };
    }
  } else if (key === "services") {
    const before = servicesMatrix(rfp);
    (rfp as { services: unknown }).services = before.map((r) => {
      const requested = val(form, `req:${r.discipline}`) as ServiceRow["requested"];
      const detail = val(form, `detail:${r.discipline}`);
      return { discipline: r.discipline, requested, detail, page: detail === r.detail ? r.page : 0 };
    });
  } else if (key === "dates") {
    const dates = rows
      .map((row) => {
        const label = val(row, "label");
        const date = val(row, "date");
        const when = val(row, "when");
        return { label, date, when, mandatory: checked(row, "mandatory"), page: pageIf(row, `${label}|${date}|${when}`) };
      })
      .filter((d) => d.label || d.date || d.when);
    // Dated items in date order, then the rest as entered.
    rfp.dates = [...dates.filter((d) => parseDay(d.date)).sort((a, b) => a.date.localeCompare(b.date)), ...dates.filter((d) => !parseDay(d.date))];
  } else if (key === "watch") {
    rfp.watch_outs = rows
      .map((row) => {
        const title = val(row, "title");
        const detail = val(row, "detail");
        return { critical: checked(row, "critical"), title, detail, page: pageIf(row, `${title}|${detail}`) };
      })
      .filter((w) => w.title || w.detail);
  } else if (key === "questions") {
    rfp.questions = rows.map((row) => val(row, "text")).filter(Boolean);
  } else if (key === "scoring") {
    rfp.scoring = rows.map((row) => ({ criterion: val(row, "criterion"), weight: val(row, "weight") })).filter((s) => s.criterion || s.weight);
  }
}

/** Re-renders the review where it was, so opening or closing a form doesn't jump the page. */
function rerenderInPlace(focusKey?: EditKey) {
  const y = scrollY;
  showResults();
  scrollTo(0, y);
  if (focusKey) $("rfp-results").querySelector<HTMLElement>(`[data-edit-form="${focusKey}"] input:not([type=hidden]), [data-edit-form="${focusKey}"] textarea`)?.focus();
}

async function onEditSubmit(e: Event) {
  const form = (e.target as HTMLElement).closest<HTMLFormElement>("[data-edit-form]");
  if (!form || !current) return;
  e.preventDefault();
  applyEdit(form.getAttribute("data-edit-form") as EditKey, form);
  editing = null;
  rerenderInPlace();
  await saveRfp(current).catch((err) => noticeModal("Not saved", (err as Error).message));
}

/** Handles the edit links and the buttons inside edit forms. Returns true when it handled the click. */
function onEditClick(t: HTMLElement): boolean {
  const open = t.closest("[data-edit]")?.getAttribute("data-edit") as EditKey | null;
  if (open) {
    editing = open;
    rerenderInPlace(open);
    return true;
  }
  if (t.closest("[data-cancel-edit]")) {
    editing = null;
    rerenderInPlace();
    return true;
  }
  const add = t.closest("[data-add-row]")?.getAttribute("data-add-row") as RowKey | null;
  if (add) {
    const rows = $("rfp-results").querySelector(`[data-rows="${add}"]`)!;
    rows.insertAdjacentHTML("beforeend", rowHtml(add));
    rows.lastElementChild?.querySelector<HTMLElement>("input:not([type=hidden]), textarea")?.focus();
    return true;
  }
  if (t.closest("[data-remove-row]")) {
    t.closest(".edit-row")?.remove();
    return true;
  }
  return false;
}
