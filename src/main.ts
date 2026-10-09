import type { ChatResponse, Comparison, Proposal } from "../lib/claude";
import { estimateChat, estimateCompare, estimateExtract, sumRanges, usd, usdRange, type Usage } from "../lib/cost";
import {
  deleteComparison,
  getReading,
  hashFile,
  listComparisons,
  saveComparison,
  saveReading,
  type ChatMessage,
  type SavedComparison,
} from "./store";
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
  usage?: Usage;
  /** content hash; a saved reading under it is reused instead of paying to read the PDF again */
  hash?: string | null;
  reused?: boolean;
  uploadedAt?: number;
  pdfTokens?: number;
  estTokens?: number;
  estFailed?: boolean;
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
  reuseOrEstimate();
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function reuseOrEstimate() {
  await Promise.all(
    entries
      .filter((e) => e.state === "queued" && e.hash === undefined)
      .map(async (e) => {
        e.hash = await hashFile(e.file);
        const saved = e.hash ? await getReading(e.hash) : undefined;
        if (saved && e.state === "queued") {
          Object.assign(e, {
            state: "done",
            reused: true,
            result: saved.proposal,
            fileId: saved.file_id,
            uploadedAt: saved.uploadedAt,
            pdfTokens: saved.pdf_tokens,
          });
        }
      }),
  );
  render();
  estimateNew();
}

// Measures each new PDF's input tokens (free) so the cost estimate is based on the actual document.
async function estimateNew() {
  const todo = entries.filter((e) => e.state === "queued" && e.hash !== undefined && e.estTokens == null && !e.estFailed);
  await pool(todo, 2, async (e) => {
    try {
      e.estTokens = (await post<{ input_tokens: number }>("/api/estimate", e.file, { "content-type": "application/pdf" })).input_tokens;
    } catch {
      e.estFailed = true;
    }
    render();
  });
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
  if (busy) return;
  const target = e.target as HTMLElement;
  const remove = target.closest("button[data-remove]");
  const reread = target.closest("button[data-reread]");
  if (remove) {
    entries = entries.filter((x) => x.id !== Number(remove.getAttribute("data-remove")));
    render();
  } else if (reread) {
    const entry = entries.find((x) => x.id === Number(reread.getAttribute("data-reread")));
    if (!entry) return;
    Object.assign(entry, { state: "queued", reused: false, result: undefined, fileId: undefined, usage: undefined });
    render();
    estimateNew();
  }
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
  if (e.state === "done" && e.reused) return "Read before · no cost";
  if (e.state === "done") return e.usage?.cost_usd != null ? `Done · ${usd(e.usage.cost_usd)}` : "Done";
  if (e.estTokens != null) return `Ready · ${usdRange(estimateExtract(e.estTokens))}`;
  if (e.hash === undefined) return "Checking…";
  return e.estFailed ? "Ready" : "Ready · estimating…";
}

function render() {
  filesEl.innerHTML = entries
    .map(
      (e) => `<li>
        <span class="name">${esc(e.file.name)} ${e.result ? `<span class="firm">— ${esc(e.result.firm)}</span>` : ""}</span>
        <span class="state ${e.state}">${stateLabel(e)}</span>
        <span>${
          busy
            ? fmtSize(e.file.size)
            : `${e.reused ? `<button data-reread="${e.id}" title="Pay to read this PDF again from scratch">Re-read</button> · ` : ""}<button data-remove="${e.id}" title="Remove">Remove</button>`
        }</span>
      </li>`,
    )
    .join("");
  const usable = entries.filter((e) => e.state !== "error" || e.error?.startsWith("Server:"));
  runBtn.disabled = busy || usable.length < 1;
  runBtn.textContent = busy ? "Working…" : usable.length === 1 ? "Analyze" : "Compare";
  clearBtn.hidden = entries.length === 0 || busy;
  renderRunEstimate(usable);
  drop.style.pointerEvents = busy ? "none" : "";
}

const runEstimateEl = $<HTMLParagraphElement>("run-estimate");

function renderRunEstimate(usable: Entry[]) {
  const toRead = usable.filter((e) => e.state !== "done");
  if (busy || usable.length < 1) {
    runEstimateEl.textContent = "";
    return;
  }
  if (toRead.some((e) => e.estTokens == null && !e.estFailed)) {
    runEstimateEl.textContent = "Estimating cost…";
    return;
  }
  // A partial estimate would understate the run, so show none rather than a misleading number.
  if (toRead.some((e) => e.estTokens == null)) {
    runEstimateEl.textContent =
      "Cost estimate unavailable right now. This run uses the Anthropic API and is billed to its account; the actual cost is shown when it finishes.";
    return;
  }
  const total = sumRanges([...toRead.map((e) => estimateExtract(e.estTokens!)), estimateCompare(usable.length)]);
  runEstimateEl.textContent =
    `Estimated cost for this run: ${usdRange(total)}, billed to the Anthropic API account. ` +
    "The actual cost is shown when it finishes.";
}

function setStatus(msg: string, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

// ---------- API ----------

async function post<T>(url: string, body: BodyInit, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { method: "POST", body, headers: { ...headers, "x-access-code": accessCode() } });
  if (res.status === 401) showGate();
  const data = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Server returned ${res.status}`), { status: res.status });
  return data as T;
}

async function extract(e: Entry) {
  e.state = "reading";
  e.started = Date.now();
  render();
  try {
    const res = await post<{ proposal: Proposal; file_id: string; usage: Usage }>("/api/extract", e.file, {
      "content-type": "application/pdf",
      "x-filename": encodeURIComponent(e.file.name),
    });
    e.result = res.proposal;
    e.fileId = res.file_id;
    e.usage = res.usage;
    e.uploadedAt = Date.now();
    e.pdfTokens = res.usage.input_tokens;
    if (e.hash) await saveReading({ hash: e.hash, proposal: res.proposal, file_id: res.file_id, uploadedAt: e.uploadedAt, pdf_tokens: e.pdfTokens });
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

    // Reused readings older than a day have had their PDF deleted from Anthropic; re-upload (free) for the chat.
    const stale = entries.filter((e) => e.state === "done" && e.reused && Date.now() - (e.uploadedAt ?? 0) > DAY_MS - 60 * 60 * 1000);
    await pool(stale, CONCURRENCY, async (e) => {
      try {
        const res = await post<{ file_id: string }>("/api/upload", e.file, {
          "content-type": "application/pdf",
          "x-filename": encodeURIComponent(e.file.name),
        });
        e.fileId = res.file_id;
        e.uploadedAt = Date.now();
        if (e.hash && e.result)
          await saveReading({ hash: e.hash, proposal: e.result, file_id: e.fileId, uploadedAt: e.uploadedAt, pdf_tokens: e.pdfTokens });
      } catch {
        // Not fatal: the comparison still works; the chat will offer to re-attach the PDF.
      }
    });

    const done = entries.filter((e) => e.state === "done" && e.result);
    if (done.length < 1) throw new Error("No proposals could be read.");

    setStatus(done.length === 1 ? "Analyzing…" : "Comparing scopes…");
    const proposals: Sourced[] = done.map((e) => ({
      ...e.result!,
      source_file: e.file.name,
      file_id: e.fileId,
      pdf_tokens: e.pdfTokens,
      source_hash: e.hash ?? undefined,
    }));
    const projectName = projectEl.value.trim() || null;
    const { comparison: cmp, usage } = await post<{ comparison: Comparison; usage: Usage }>(
      "/api/compare",
      JSON.stringify({ projectName, proposals }),
      { "content-type": "application/json" },
    );
    // Reused readings cost nothing this time.
    const costs = [...done.map((e) => (e.reused ? 0 : e.usage?.cost_usd)), usage.cost_usd];
    const costUsd = costs.reduce<number>((a, c) => a + (c ?? 0), 0);
    const partial = costs.some((c) => c == null);
    current = { id: crypto.randomUUID(), savedAt: Date.now(), proposals, cmp, projectName, messages: [], costUsd, costPartial: partial };
    resetChat();
    showResults(true);
    await persist();
    const failed = entries.length - done.length;
    setStatus(`Done${failed ? `, ${failed} file(s) skipped` : ""}. This comparison cost ${usd(costUsd)}${partial ? " (some costs unavailable)" : ""}.`);
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

function renderCost() {
  if (!current) return;
  const c = current;
  $("cost").textContent =
    c.costUsd != null ? `Spent on this comparison: ${usd(c.costUsd)}${c.costPartial ? "+" : ""} (reading, comparing and chat)` : "";
  const tokens = c.proposals.map((p) => p.pdf_tokens);
  const chatCost = $("chat-cost");
  if (tokens.every((t) => t != null)) {
    const est = estimateChat(
      tokens.reduce<number>((a, t) => a + t!, 0),
      c.proposals.length,
    );
    chatCost.textContent =
      `Each question costs about ${usdRange(est.followUp).replace("≈ ", "")} while you keep chatting. ` +
      `The first one, or one after ~5 idle minutes, is ${usdRange(est.first)} because it re-reads the PDFs. ` +
      `Corrections that rewrite the analysis can reach about ${usd(est.correctionMax)}.`;
  } else {
    chatCost.textContent = "Each question has a small API cost; corrections that rewrite the analysis cost more.";
  }
}

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
  // With one proposal there is nothing to differ from, so the filter would hide every row.
  const single = proposals.length < 2;
  (document.querySelector(".toolbar .toggle") as HTMLElement).hidden = single;
  scopeEl.classList.toggle("diff-only", diffOnly.checked && !single);
  $("notes").innerHTML = notesHtml(proposals);
  renderCost();
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
  for (const msg of current?.messages ?? []) addMessage(msg.role, msg.text, msg.updated, msg.cost);
}

function addMessage(role: ChatMessage["role"] | "error", text: string, updated = false, cost?: number | null): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const meta = [updated ? "Analysis updated" : "", cost != null ? usd(cost) : ""].filter(Boolean).join(" · ");
  div.innerHTML = esc(text).replace(/\n/g, "<br>") + (meta ? `<span class="updated">${meta}</span>` : "");
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
    const res = await post<ChatResponse & { usage: Usage }>(
      "/api/chat",
      JSON.stringify({ projectName: c.projectName, proposals: c.proposals, comparison: c.cmp, turns }),
      { "content-type": "application/json" },
    );
    for (const u of res.updated_proposals) {
      const prev = c.proposals[u.firm_index];
      if (!prev) continue;
      c.proposals[u.firm_index] = { ...u.proposal, source_file: prev.source_file, file_id: prev.file_id, pdf_tokens: prev.pdf_tokens, source_hash: prev.source_hash };
      if (prev.source_hash) {
        const saved = await getReading(prev.source_hash);
        if (saved) await saveReading({ ...saved, proposal: u.proposal });
      }
    }
    if (res.updated_comparison) c.cmp = res.updated_comparison;
    const updated = res.updated_proposals.length > 0 || !!res.updated_comparison;
    if (updated && current === c) showResults(false);
    const cost = res.usage.cost_usd;
    c.messages.push({ role: "user", text }, { role: "assistant", text: res.reply, updated, cost });
    c.costUsd = (c.costUsd ?? 0) + (cost ?? 0);
    if (cost == null) c.costPartial = true;
    if (current === c) {
      addMessage("assistant", res.reply, updated, cost);
      renderCost();
    }
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
        <span class="when">${s.costUsd != null ? usd(s.costUsd) + " · " : ""}${esc(when)}</span>
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

// ---------- Access code (live site only; the server decides whether one is required) ----------

const gate = $<HTMLDivElement>("gate");
const gateForm = $<HTMLFormElement>("gate-form");
const gateInput = $<HTMLInputElement>("gate-input");
const gateError = $<HTMLSpanElement>("gate-error");

function accessCode(): string {
  try {
    return localStorage.getItem("access-code") ?? "";
  } catch {
    return gateInput.value;
  }
}

function showGate() {
  gate.hidden = false;
  gateInput.focus();
}

async function codeAccepted(code: string): Promise<boolean> {
  const res = await fetch("/api/auth", { method: "POST", headers: { "x-access-code": code } });
  return res.ok;
}

gateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = gateInput.value.trim();
  gateError.textContent = "";
  if (await codeAccepted(code)) {
    try {
      localStorage.setItem("access-code", code);
    } catch {}
    gate.hidden = true;
  } else {
    gateError.textContent = "That code isn't right.";
    gateInput.select();
  }
});

codeAccepted(accessCode()).then((ok) => {
  if (!ok) showGate();
});

render();
