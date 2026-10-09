import type { ChatResponse, Comparison, Proposal } from "../lib/claude";
import { deleteComparison, listComparisons, saveComparison, type ChatMessage, type SavedComparison } from "./store";
import { briefingHtml, esc, feeTable, notesHtml, scopeTable, type Sourced } from "./table";

// Vercel rejects request bodies over 4.5 MB; locally there's no limit.
const MAX_BYTES = import.meta.env.PROD ? 4.4 * 1024 * 1024 : Infinity;
const CONCURRENCY = 4;

type Entry = {
  id: number;
  file: File;
  state: "queued" | "reading" | "done" | "error";
  started?: number;
  result?: Proposal;
  fileId?: string;
  error?: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const drop = $<HTMLLabelElement>("drop");
const input = $<HTMLInputElement>("file-input");
const filesEl = $<HTMLOListElement>("files");
const runBtn = $<HTMLButtonElement>("run");
const clearBtn = $<HTMLButtonElement>("clear");
const statusEl = $<HTMLSpanElement>("status");
const projectEl = $<HTMLInputElement>("project");
const results = $<HTMLElement>("results");

let entries: Entry[] = [];
let nextId = 1;
let busy = false;

// ---------- File intake ----------

function addFiles(list: FileList | File[]) {
  for (const file of Array.from(list)) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const entry: Entry = { id: nextId++, file, state: "queued" };
    if (!isPdf) Object.assign(entry, { state: "error", error: "Not a PDF" });
    else if (file.size > MAX_BYTES) Object.assign(entry, { state: "error", error: "Over 4.4 MB — compress the PDF and retry" });
    entries.push(entry);
  }
  render();
}

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

filesEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-remove]");
  if (!btn || busy) return;
  entries = entries.filter((x) => x.id !== Number(btn.getAttribute("data-remove")));
  render();
});

clearBtn.addEventListener("click", () => {
  if (busy) return;
  entries = [];
  results.hidden = true;
  current = null;
  resetChat();
  setChatOpen(false);
  renderSaved();
  setStatus("");
  render();
});

// ---------- Rendering ----------

const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

function stateLabel(e: Entry) {
  if (e.state === "reading") return `Reading… ${Math.round((Date.now() - (e.started ?? Date.now())) / 1000)}s`;
  if (e.state === "error") return esc(e.error);
  if (e.state === "done") return "Done";
  return "Ready";
}

function render() {
  filesEl.innerHTML = entries
    .map(
      (e) => `<li>
        <span class="name">${esc(e.file.name)} ${e.result ? `<span class="firm">— ${esc(e.result.firm)}</span>` : ""}</span>
        <span class="state ${e.state}">${stateLabel(e)}</span>
        <span>${busy ? fmtSize(e.file.size) : `<button data-remove="${e.id}" title="Remove">Remove</button>`}</span>
      </li>`,
    )
    .join("");
  const usable = entries.filter((e) => e.state !== "error" || e.error?.startsWith("Server:"));
  runBtn.disabled = busy || usable.length < 2;
  runBtn.textContent = busy ? "Working…" : "Compare";
  clearBtn.hidden = entries.length === 0 || busy;
  drop.style.pointerEvents = busy ? "none" : "";
}

function setStatus(msg: string, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

// ---------- API ----------

async function post<T>(url: string, body: BodyInit, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { method: "POST", body, headers });
  const data = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Server returned ${res.status}`), { status: res.status });
  return data as T;
}

async function extract(e: Entry) {
  e.state = "reading";
  e.started = Date.now();
  render();
  try {
    const res = await post<{ proposal: Proposal; file_id: string }>("/api/extract", e.file, {
      "content-type": "application/pdf",
      "x-filename": encodeURIComponent(e.file.name),
    });
    e.result = res.proposal;
    e.fileId = res.file_id;
    e.state = "done";
  } catch (err) {
    e.state = "error";
    e.error = `Server: ${(err as Error).message}`;
  }
  render();
}

async function pool(items: Entry[], n: number, fn: (e: Entry) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

runBtn.addEventListener("click", async () => {
  busy = true;
  results.hidden = true;
  setStatus("Reading proposals. This usually takes 1–3 minutes.");
  const tick = setInterval(render, 1000);
  try {
    // Re-use earlier extractions; retry ones that failed on the server.
    const todo = entries.filter((e) => e.state === "queued" || e.error?.startsWith("Server:"));
    await pool(todo, CONCURRENCY, extract);

    const done = entries.filter((e) => e.state === "done" && e.result);
    if (done.length < 2) throw new Error("Need at least two proposals that were read successfully.");

    setStatus("Comparing scopes…");
    const proposals: Sourced[] = done.map((e) => ({ ...e.result!, source_file: e.file.name, file_id: e.fileId }));
    const projectName = projectEl.value.trim() || null;
    const cmp = await post<Comparison>("/api/compare", JSON.stringify({ projectName, proposals }), {
      "content-type": "application/json",
    });
    current = { id: crypto.randomUUID(), savedAt: Date.now(), proposals, cmp, projectName, messages: [] };
    resetChat();
    showResults(true);
    await persist();
    const failed = entries.length - done.length;
    setStatus(failed ? `Done. ${failed} file(s) skipped.` : "Done.");
  } catch (err) {
    setStatus((err as Error).message, true);
  } finally {
    clearInterval(tick);
    busy = false;
    render();
  }
});

// ---------- Results ----------

const scopeEl = $<HTMLTableElement>("scope");
const diffOnly = $<HTMLInputElement>("diff-only");
diffOnly.addEventListener("change", () => scopeEl.classList.toggle("diff-only", diffOnly.checked));
$("print").addEventListener("click", () => window.print());

// The analysis currently on screen (saved in this browser); chat corrections replace parts of it.
let current: SavedComparison | null = null;

async function persist() {
  if (!current) return;
  current.savedAt = Date.now();
  await saveComparison(current);
  await renderSaved();
}

function showResults(scroll: boolean) {
  if (!current) return;
  const { proposals, cmp, projectName } = current;
  $("briefing").innerHTML = briefingHtml(proposals, cmp);
  results.style.setProperty("--min-table", `${160 + 130 * proposals.length}px`);
  $("fees").innerHTML = feeTable(proposals, cmp);
  scopeEl.innerHTML = scopeTable(proposals, cmp);
  scopeEl.classList.toggle("diff-only", diffOnly.checked);
  $("notes").innerHTML = notesHtml(proposals);
  $("print-meta").textContent = [projectName, new Date().toLocaleDateString()].filter(Boolean).join(" — ");
  results.hidden = false;
  if (scroll) results.scrollIntoView({ behavior: "smooth" });
}

// ---------- Chat ----------

const chatEl = $<HTMLElement>("chat");
const chatLog = $<HTMLDivElement>("chat-log");
const chatForm = $<HTMLFormElement>("chat-form");
const chatInput = $<HTMLTextAreaElement>("chat-input");
const chatSend = $<HTMLButtonElement>("chat-send");
const chatStatus = $<HTMLSpanElement>("chat-status");
const reattachInput = $<HTMLInputElement>("reattach-input");
const chatHint = chatLog.innerHTML;
let chatting = false;

function setChatOpen(open: boolean) {
  chatEl.hidden = !open;
  document.body.classList.toggle("chat-open", open);
  if (open) chatInput.focus();
}
$("chat-open").addEventListener("click", () => setChatOpen(!document.body.classList.contains("chat-open")));
$("chat-close").addEventListener("click", () => setChatOpen(false));

function resetChat() {
  chatLog.innerHTML = chatHint;
  for (const msg of current?.messages ?? []) addMessage(msg.role, msg.text, msg.updated);
}

function addMessage(role: ChatMessage["role"] | "error", text: string, updated = false): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = esc(text).replace(/\n/g, "<br>") + (updated ? `<span class="updated">Analysis updated</span>` : "");
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || chatting || !current) return;
  const c = current;
  chatting = true;
  chatSend.disabled = true;
  chatInput.value = "";
  addMessage("user", text);
  const turns = [...c.messages, { role: "user" as const, text }].map((msg) => ({ role: msg.role, content: msg.text }));
  const started = Date.now();
  const tick = setInterval(() => (chatStatus.textContent = `Thinking… ${Math.round((Date.now() - started) / 1000)}s`), 1000);
  chatStatus.textContent = "Thinking…";
  try {
    const res = await post<ChatResponse>(
      "/api/chat",
      JSON.stringify({ projectName: c.projectName, proposals: c.proposals, comparison: c.cmp, turns }),
      { "content-type": "application/json" },
    );
    for (const u of res.updated_proposals) {
      const prev = c.proposals[u.firm_index];
      if (prev) c.proposals[u.firm_index] = { ...u.proposal, source_file: prev.source_file, file_id: prev.file_id };
    }
    if (res.updated_comparison) c.cmp = res.updated_comparison;
    const updated = res.updated_proposals.length > 0 || !!res.updated_comparison;
    if (updated && current === c) showResults(false);
    c.messages.push({ role: "user", text }, { role: "assistant", text: res.reply, updated });
    if (current === c) addMessage("assistant", res.reply, updated);
    await saveComparison(c);
    await renderSaved();
  } catch (err) {
    // Give the question back for a retry; it isn't added to the saved conversation.
    chatInput.value = text;
    const div = addMessage("error", (err as Error).message);
    if ((err as { status?: number }).status === 410) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Re-attach PDFs";
      btn.addEventListener("click", () => reattachInput.click());
      div.appendChild(btn);
    }
  } finally {
    clearInterval(tick);
    chatStatus.textContent = "";
    chatting = false;
    chatSend.disabled = false;
  }
});

// Re-uploads the original PDFs for a saved comparison whose files expired, matched by file name.
reattachInput.addEventListener("change", async () => {
  const files = Array.from(reattachInput.files ?? []);
  reattachInput.value = "";
  if (!current || !files.length) return;
  const c = current;
  chatStatus.textContent = "Re-attaching…";
  let matched = 0;
  const missing: string[] = [];
  try {
    for (const p of c.proposals) {
      const file = files.find((f) => f.name === p.source_file);
      if (!file) {
        missing.push(p.source_file ?? p.firm);
        continue;
      }
      const res = await post<{ file_id: string }>("/api/upload", file, {
        "content-type": "application/pdf",
        "x-filename": encodeURIComponent(file.name),
      });
      p.file_id = res.file_id;
      matched++;
    }
    await saveComparison(c);
    addMessage(
      "error",
      missing.length
        ? `Re-attached ${matched} of ${c.proposals.length}. Still missing: ${missing.join(", ")}. Pick those files (same names) to continue.`
        : "PDFs re-attached. Send your question again.",
    );
  } catch (err) {
    addMessage("error", (err as Error).message);
  } finally {
    chatStatus.textContent = "";
  }
});

// ---------- Saved comparisons (this browser only) ----------

const savedEl = $<HTMLElement>("saved");
const savedList = $<HTMLOListElement>("saved-list");

async function renderSaved() {
  const all = await listComparisons();
  savedEl.hidden = all.length === 0;
  savedList.innerHTML = all
    .map((s) => {
      const firms = s.proposals.map((p) => p.firm).join(", ");
      const when = new Date(s.savedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return `<li class="${s.id === current?.id ? "active" : ""}">
        <button class="link open" data-open="${s.id}"><b>${esc(s.projectName ?? "Untitled")}</b> <span>${esc(firms)}</span></button>
        <span class="when">${esc(when)}</span>
        <button class="link" data-delete="${s.id}">Delete</button>
      </li>`;
    })
    .join("");
}

savedList.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const openId = target.closest("[data-open]")?.getAttribute("data-open");
  const deleteId = target.closest("[data-delete]")?.getAttribute("data-delete");
  if (openId && !busy && !chatting) {
    const saved = (await listComparisons()).find((s) => s.id === openId);
    if (!saved) return;
    current = saved;
    projectEl.value = saved.projectName ?? "";
    resetChat();
    showResults(true);
    await renderSaved();
  } else if (deleteId && confirm("Delete this saved comparison from this browser?")) {
    await deleteComparison(deleteId);
    if (current?.id === deleteId) {
      current = null;
      results.hidden = true;
      setChatOpen(false);
    }
    await renderSaved();
  }
});

renderSaved();

render();
