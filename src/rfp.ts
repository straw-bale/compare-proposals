import { RFP_FACTS, type Rfp, type RfpFactKey } from "../lib/claude";
import { estimateRfp, usd, usdRange, type Usage } from "../lib/cost";
import { post, postPdf } from "./api";
import { deleteRfp, fillProjectNames, listRfps, saveRfp, savesShared, type SavedRfp } from "./store";
import { confirmDelete, confirmModal, noticeModal } from "./modal";
import { copyShareLink } from "./share";
import { esc } from "./table";

// Vercel rejects request bodies over 4.5 MB; locally there's no limit.
const MAX_BYTES = import.meta.env.PROD ? 4.4 * 1024 * 1024 : Infinity;

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
  $("rfp-results").addEventListener("focusin", (e) => {
    if ((e.target as HTMLElement).matches("[data-project]")) fillProjectNames(current?.rfp.project_name);
  });
  $("rfp-results").addEventListener("change", async (e) => {
    const el = e.target as HTMLInputElement;
    if (!current || !el.matches("[data-project]")) return;
    current.project = el.value.trim() || null;
    await saveRfp(current).catch((err) => alert(`Not saved: ${(err as Error).message}`));
  });
  renderSaved();
}

// ---------- Intake ----------

function addFiles(list: FileList) {
  for (const file of Array.from(list)) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const entry: Entry = { file };
    if (!isPdf) entry.error = "Not a PDF";
    else if (file.size > MAX_BYTES) entry.error = "Over 4.4 MB, compress it first";
    else
      post<{ input_tokens: number }>("/api/estimate", file, { "content-type": "application/pdf" })
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
  $("rfp-estimate").textContent =
    usable.length && known && !busy ? `Estimated cost ${usdRange(estimateRfp(usable.reduce((a, e) => a + e.tokens!, 0)))}` : "";
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
      usable.map(async (e) => ({ file_id: (await postPdf<{ file_id: string }>("/api/upload", e.file)).file_id, filename: e.file.name })),
    );
    const res = await post<{ rfp: Rfp; usage: Usage }>("/api/rfp", JSON.stringify({ files }), { "content-type": "application/json" });
    current = { id: crypto.randomUUID(), savedAt: Date.now(), files: files.map((f) => f.filename), rfp: res.rfp, costUsd: res.usage.cost_usd };
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

/** Opens a saved review by id (from the list or a shared link). */
export async function openRfp(id: string) {
  const found = (await listRfps()).find((s) => s.id === id);
  if (!found) return noticeModal("Review not found", "It may have been deleted.");
  current = found;
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
const parseDay = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * One display format for every date, whatever the RFP's wording: "Jul 12, 2023, 9:30 AM" for a specific day
 * (time kept when stated), "Sep 2023" for a month, and the original words otherwise ("After proposals, date TBD").
 */
function formatWhen(d: { date: string; when: string }): string {
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


function proposalDue(rfp: Rfp) {
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

  $("rfp-results").innerHTML = `
    <div class="rfp-top">
      <button class="link" data-back>← All RFPs</button>
      <input class="project" data-project list="project-names" placeholder="Add to project" autocomplete="off" value="${esc(current.project ?? "")}" />
      <span class="tools"><button class="btn" data-share>Share</button><button class="btn" data-print>Print</button></span>
    </div>
    <h1 class="headline">${esc(rfp.project_name)}</h1>
    <p class="rfp-sub">${esc(rfp.client)}${
      due ? ` · <mark>Due ${esc(formatWhen(due))}</mark>` : ""
    }</p>
    <p class="overview">${esc(rfp.summary)}</p>

    <div class="rfp-cols">
      <div>
        ${section("Key dates", `<table class="grid dates">${dates}</table>`, rfp.dates.length)}
        ${section(
          "Critical components",
          `<ul class="watch">${rfp.watch_outs
            .map((w) => `<li class="${w.critical ? "critical" : ""}"><b>${esc(w.title)}</b>${pg(w.page)}<p>${esc(w.detail)}</p></li>`)
            .join("")}</ul>`,
          rfp.watch_outs.length,
          "None found.",
        )}
        ${section(
          `Questions to ask <button class="link" data-copy>Copy</button>`,
          `<ol class="qs">${rfp.questions
            .map((q, i) => `<li><button class="q-remove" data-remove-q="${i}" title="Remove this question" aria-label="Remove this question">×</button><span>${i + 1}. ${esc(q)}</span></li>`)
            .join("")}</ol>`,
          rfp.questions.length,
          "None.",
        )}
      </div>
      <div>
        ${section(
          "Key facts",
          `<table class="grid facts">${factsRows(rfp.facts)}</table>`,
          1,
        )}
        ${section(
          "Scoring",
          `<table class="grid facts">${rfp.scoring.map((s) => `<tr><th scope="row">${esc(s.criterion)}</th><td class="num">${esc(s.weight)}</td></tr>`).join("")}</table>`,
          rfp.scoring.length,
        )}
      </div>
    </div>
    <p class="estimate">${esc(current.files.join(", "))}${current.costUsd != null ? ` · ${usd(current.costUsd)}` : ""}</p>`;

  $("rfp-intake").hidden = true;
  $("rfp-results").hidden = false;
  scrollTo(0, 0);
}

/** A titled block. Every review shows the same blocks in the same order; an empty one says so. */
const section = (title: string, body: string, count: number, empty = "Not stated in the RFP.") =>
  `<div class="block"><h2 class="label">${title}</h2>${count ? body : `<p class="none">${empty}</p>`}</div>`;

/** Key facts in a fixed order. Reviews saved before the fixed list keep their own label/value pairs. */
function factsRows(facts: Rfp["facts"] | { label: string; value: string; page: number }[]): string {
  const rows = Array.isArray(facts)
    ? facts.map((f) => [f.label, f.value, f.page] as const)
    : (Object.keys(RFP_FACTS) as RfpFactKey[]).map((k) => [RFP_FACTS[k], facts[k]?.value ?? "", facts[k]?.page ?? 0] as const);
  return rows
    .map(([label, value, page]) => `<tr><th scope="row">${esc(label)}</th><td>${value ? esc(value) + pg(page) : "Not stated"}</td></tr>`)
    .join("");
}

async function onResultsClick(e: Event) {
  const t = e.target as HTMLElement;
  if (t.closest("[data-back]")) {
    current = null;
    history.replaceState(null, "", "#rfp");
    $("rfp-results").hidden = true;
    $("rfp-intake").hidden = false;
    renderSaved();
  } else if (t.closest("[data-print]")) {
    print();
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
