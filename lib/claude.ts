import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { costOf, type Usage } from "./cost.js";

export const MODEL = "claude-opus-5-5";

// ---------- Schemas ----------

const PhaseKey = z.enum(["PRE", "SD", "DD", "CD", "BID", "CA", "CLOSEOUT", "MULTI", "OTHER"]);
const ScopeStatus = z.enum(["included", "excluded", "optional"]);

export const ProposalSchema = z.object({
  firm: z.string(),
  contact: z.string().nullable(),
  proposal_date: z.string().nullable(),
  project_name: z.string().nullable(),
  disciplines: z.array(z.string()),
  fee_structure: z.string().nullable(),
  // Every fee line exactly as stated, including the proposal's own subtotals/totals. Never computed.
  fee_items: z.array(
    z.object({
      id: z.number(),
      scenario: z.string().nullable(),
      phase: PhaseKey,
      label: z.string(),
      kind: z.enum(["fee", "expense", "subtotal", "total"]),
      basis: z.enum(["fixed", "percent_of_construction", "hourly", "not_to_exceed", "allowance", "other"]),
      amount: z.number().nullable(),
      percent: z.number().nullable(),
      page: z.number(), // 0 = unknown (keeps the schema under the API's union-field limit)
    }),
  ),
  additional_services: z.array(
    z.object({
      description: z.string(),
      amount: z.number().nullable(),
      basis: z.string().nullable(),
    }),
  ),
  reimbursables: z.string().nullable(),
  hourly_rates: z.array(z.object({ role: z.string(), rate: z.number().nullable() })),
  ca_site_visits: z.string().nullable(),
  schedule: z.string().nullable(),
  payment_terms: z.string().nullable(),
  scope_items: z.array(
    z.object({
      category: z.string(),
      description: z.string(),
      phase: z.string().nullable(),
      status: ScopeStatus,
      page: z.number(), // 0 = unknown (keeps the schema under the API's union-field limit)
    }),
  ),
  exclusions: z.array(z.string()),
  assumptions: z.array(z.string()),
  deliverables: z.array(z.string()),
  clarifications: z.array(z.string()),
  extraction_notes: z.array(z.string()),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const ComparisonSchema = z.object({
  briefing: z.object({
    headline: z.string(),
    overview: z.string(),
    flags: z.array(
      z.object({
        level: z.enum(["high", "medium", "low"]),
        title: z.string(),
        detail: z.string(),
        firm_indexes: z.array(z.number()),
      }),
    ),
    questions: z.array(z.object({ firm_index: z.number(), items: z.array(z.string()) })),
  }),
  // Common names for pricing scenarios (e.g. construction-budget ranges), mapped from each firm's own wording.
  scenarios: z.array(
    z.object({
      name: z.string(),
      firm_labels: z.array(z.object({ firm_index: z.number(), scenario: z.string() })),
    }),
  ),
  fee_rows: z.array(
    z.object({
      section: z.string(),
      label: z.string(),
      cells: z.array(z.object({ firm_index: z.number(), item_ids: z.array(z.number()), note: z.string().nullable() })),
    }),
  ),
  categories: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          item: z.string(),
          statuses: z.array(
            z.object({
              firm_index: z.number(),
              status: z.enum(["included", "excluded", "optional", "not_mentioned"]),
              note: z.string().nullable(),
              page: z.number(), // 0 = unknown
            }),
          ),
        }),
      ),
    }),
  ),
});
export type Comparison = z.infer<typeof ComparisonSchema>;

// What the chat model returns. Corrections come back as JSON text (validated below against the full schemas),
// because nesting whole proposals/analyses here would exceed the structured-output union-field limit.
const ChatWireSchema = z.object({
  reply: z.string(),
  updated_comparison_json: z.string(),
  updated_proposals: z.array(z.object({ firm_index: z.number(), proposal_json: z.string() })),
});

// A chat turn either just answers, or answers and replaces parts of the analysis.
export type ChatResponse = {
  reply: string;
  updated_comparison: Comparison | null;
  updated_proposals: { firm_index: number; proposal: Proposal }[];
};

// ---------- Prompts ----------

const EXTRACT_SYSTEM = `You are a senior architect and owner's representative at an architecture/design-build firm, experienced in reviewing consultant fee proposals across all architecture and engineering disciplines: MEP, structural, civil, landscape, AV/IT/security, acoustics, lighting, lab planning, code, envelope, sustainability, cost estimating, and others. Your job is to extract the proposal's scope and fees accurately so it can be reviewed on its own or compared side by side with competing proposals.

Rules:
- fee_items: record every fee line exactly as the proposal states it, one item per line, with sequential ids starting at 0. Include the proposal's own subtotals and totals as separate items (kind "subtotal"/"total"), and reimbursable/expense lines as kind "expense". Never compute, add, convert, or estimate a value: amount is the stated dollar figure (number only) or null; percent is the stated percentage (e.g. 2.8) or null. If a value isn't stated, don't create it.
- Many RFPs ask for fees under multiple scenarios (construction-budget ranges, options, alternates, base vs. add). Set scenario on each line to a short, consistent name using the proposal's wording (e.g. "$5M–$8M construction", "$9M–$12M construction", "Option B"). Lines that apply regardless of scenario get scenario null.
- phase: PRE (programming/pre-design), SD, DD, CD, BID (bidding/permitting/negotiation), CA, CLOSEOUT (closeout/commissioning/record drawings), MULTI (one line covering several phases, e.g. "CD through CA" or "Programming/SD"; pick SD for combined Programming/SD), or OTHER. Keep the proposal's own wording in label.
- proposal_date: the date on the proposal as YYYY-MM-DD, or null if none is given.
- fee_structure: one plain sentence describing how the fee is structured (e.g. "Fixed fee for Programming/SD; DD through Closeout as % of construction, by budget range").
- Note in extraction_notes any internal inconsistencies you can see directly in the document (e.g. a line labeled with the wrong scenario, a subtotal that visibly doesn't match its lines), quoting the figures as written.
- disciplines: the services this proposal covers, in plain words (e.g. "Audio-visual design", "Architectural acoustics", "Mechanical").
- scope_items should be granular and comparable: one item per distinct service or task in the proposal's own discipline terms (e.g. for MEP "Load calculations"; for AV "AV system design narrative", "Equipment specifications"; for acoustics "Background noise survey", "Sound isolation recommendations"; across disciplines "Site visits during construction (4)", "Record drawings"). Use short category names that fit the discipline, plus common ones such as Survey & Existing Conditions, Design, Documentation & Specifications, Coordination & Meetings, Bidding, Construction Administration, Testing & Commissioning, Deliverables, General.
- Mark items the proposal explicitly excludes as "excluded" and items offered as add-ons or alternates as "optional". Include the page number where each item appears; use 0 when you can't tell. Use 0 for fee_items.page the same way.
- Capture exclusions, assumptions, deliverables, and any clarifications, risks, or unusual terms (caps, limits, NTE, number of revisions or meetings, insurance, schedule dependencies).`;

const COMPARE_SYSTEM = `You are a senior architect reviewing consultant proposals for a project-architect colleague. Proposals can be from any architecture or engineering discipline. You receive structured extractions of one or more proposals, identified by firm_index.

If there is one proposal, review it on its own: the scope checklist lists what it covers, plus the services a reviewer would normally expect for this discipline and project that it is silent on (not_mentioned) or excludes. The fee rows lay out its stated fees, and the briefing gives the key facts and concerns. If there are several, compare them. If they cover different disciplines or services (e.g. one AV and one acoustics proposal), say so plainly in the headline and don't rank them against each other on fee; compare only scope, terms and approach where they overlap.

Build a normalized master scope checklist so the proposals can be compared line by line:
- Merge equivalent items across firms into a single row with clear, neutral wording. Group rows into categories that fit the discipline(s) (e.g. for MEP: Mechanical, Electrical, Plumbing; for AV: Systems Design, Infrastructure, Programming & Commissioning; plus common ones like Survey & Existing Conditions, Coordination & Meetings, Construction Administration, Deliverables, General). Order categories and items logically.
- For every row, give exactly one status per firm (every firm_index): included, excluded (explicitly excluded), optional (add-on/alternate), or not_mentioned (silent). Distinguish excluded from not_mentioned carefully. Use note for meaningful qualifiers (e.g. "4 visits", "basic only") and page when known (0 if unknown).
- Prefer rows where firms differ or that matter for an apples-to-apples comparison; don't pad with trivial items.

Define scenarios first. If any proposal prices multiple scenarios (construction-budget ranges, options, alternates), list each distinct scenario once with a clear common name (e.g. "$5M–$8M construction budget"). In firm_labels, map every non-null fee_items.scenario string from every firm to its scenario, using that firm's exact string. Leave scenarios empty if no proposal has them. Lines with scenario null apply to all scenarios.

Build fee_rows to line up the firms' fee_items side by side:
- section names the fee portion without the scenario (e.g. "Programming / SD", "DD through Closeout", "Additional services"); the app groups rows under scenario headings itself. Within a section, add a row per comparable phase line, then the expense line, then the stated subtotal/total if firms state one.
- Each cell references item_ids from that firm's fee_items only. Never put lines from different scenarios in the same row; make one row per scenario instead (the app splits mixed rows anyway). Put items in the same row only when they cover the same scope portion and scenario. A firm whose price covers several phases in one line (e.g. a single percentage for CD–CA) should have that line in one row labeled for the span, with the other firms' matching items listed in that row too, rather than repeating it in each phase row.
- Use an empty item_ids list when a firm has nothing for that row. note is an optional short qualifier in words only (e.g. "NTE", "label says $5M–$8M"); never put numbers, dollar amounts, or percentages in note.
- Never invent rows for totals no firm stated.
Then write a briefing as if you were walking a project-architect colleague through your review: plain, direct, and short. They'll read it in under a minute before deciding what to do next.
- headline: one sentence with the bottom line. For several proposals, say which looks stronger on paper, if any, and the single biggest caveat. For one proposal, give your overall read of it and the single biggest caveat.
- overview: 2-4 sentences. For several proposals, how the fees and scope compare and what it would take to compare them on equal terms. For one proposal, the key facts: what it covers, how it's priced, and what's notably missing.
- Fee accuracy is critical. Quote only figures exactly as stated in the extractions, and say which scenario/portion each one belongs to. Never add, subtract, convert (e.g. percentage to dollars), extrapolate, or combine figures into a total or difference, and never present anything as a "comparable" or "normalized" total. If firms price on different bases (fixed dollars vs. % of construction) or different scenarios, say so plainly and compare only like-for-like stated figures; otherwise turn it into a question for the firm. Never write something that then has to be qualified as unusable. Leave it out instead.
- flags: the 3-8 things your colleague must know, most important first. Look specifically for inconsistencies and red flags: mislabeled or internally inconsistent fee lines noted in extraction_notes, fees stated only as percentages where others gave dollars, ambiguous fee wording, scope listed as included but contradicted by an exclusion, missing basics a firm is silent on (judged for its discipline), uncapped or vague reimbursables, thin construction-phase involvement (few site visits), delegated design, mismatched project names or dates, and anything unusual in terms. level: high = could change the decision or cost real money; medium = needs clarification; low = worth noting. Keep detail to one or two sentences. Don't repeat the same point as both a flag and the overview.
- questions: for each firm with open issues, the specific clarification questions you'd send them (max 4 each, phrased ready to paste into an email).
- In all prose, refer to firms by their firm name, never by firm_index.`;

const CHAT_SYSTEM = `You are the senior architect who prepared this proposal review, now answering a project-architect colleague's follow-up questions. You have the original proposal PDFs, the data extracted from each one (identified by firm_index), and the current analysis (briefing, fee_rows, scope categories).

Answering:
- Be brief and direct, like a colleague in chat. Check the PDFs when a question touches specifics, and cite page numbers (e.g. "Firm name p.3").
- Fee accuracy is critical. Quote figures exactly as stated. Never add, subtract, convert, or extrapolate fees, and never offer a computed total. If asked for one, explain what is stated instead and what's needed to compare.

Corrections:
- When the colleague asks you to change something, or you find the analysis contradicts the PDFs, fix it. Return updated_proposals (proposal_json: the complete corrected extraction for that firm as JSON text, in exactly the same structure as the extracted data you were given but without firm_index, keeping fee_items ids stable unless the fix requires otherwise) and/or updated_comparison_json (the complete corrected analysis as JSON text, same structure as the current analysis). Keep everything else unchanged.
- If a requested correction contradicts the PDF, don't apply it; say what the document says, with the page, and ask them to confirm. If they confirm or give information from outside the documents (e.g. a phone call with the firm), apply it and mention the source in the relevant note or extraction_notes.
- All analysis rules still apply: fee_rows reference fee_items by id, notes contain no figures, and the briefing follows the same accuracy rules.
- In reply, say plainly what you changed. Leave updated_comparison_json as an empty string and updated_proposals empty when nothing changes.
- Refer to firms by name, never by firm_index.`;

// ---------- Calls ----------

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new UserFacingError("ANTHROPIC_API_KEY is not set on the server. Add it to .env.local (local) or the Vercel project settings.", 500);
  }
  client ??= new Anthropic();
  return client;
}

export class UserFacingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// Shared request settings: Opus 5.5 at high effort (default is medium), with the
// server-side refusal fallback so a classifier decline is retried on another model.
const BASE = {
  model: MODEL,
  max_tokens: 64000,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

function checkStop(msg: { stop_reason: string | null }) {
  if (msg.stop_reason === "refusal") {
    throw new UserFacingError("Claude declined to process this document.", 422);
  }
  if (msg.stop_reason === "max_tokens") {
    throw new UserFacingError("The response was too long and got cut off. Try splitting the document.", 422);
  }
}

// Uploaded PDFs are tagged with this prefix so cleanup only ever touches this app's files.
const FILE_PREFIX = "proposal-comparison__";
const FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Deletes this app's uploaded PDFs older than a day. Runs once per comparison; failures are logged, not fatal. */
/** Token usage and dollar cost of one response, from the API's own usage report. */
function usageOf(msg: {
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number | null; cache_read_input_tokens: number | null };
}): Usage {
  const u = {
    model: msg.model,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_write_tokens: msg.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: msg.usage.cache_read_input_tokens ?? 0,
  };
  console.log(`[usage] ${u.model} in=${u.input_tokens} out=${u.output_tokens} cache_w=${u.cache_write_tokens} cache_r=${u.cache_read_tokens}`);
  return { ...u, cost_usd: costOf(u) };
}

/** Exact input-token count for reading a PDF (free endpoint; nothing is generated or stored). */
export async function countPdfTokens(pdf: Buffer): Promise<number> {
  const res = await getClient().messages.countTokens({
    model: MODEL,
    system: EXTRACT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text: "Extract the scope and fees from this consultant proposal." },
        ],
      },
    ],
  });
  return res.input_tokens;
}

export async function cleanupOldFiles(): Promise<void> {
  try {
    const cutoff = Date.now() - FILE_MAX_AGE_MS;
    const stale: string[] = [];
    for await (const f of getClient().files.list({ limit: 1000 })) {
      if (f.filename.startsWith(FILE_PREFIX) && Date.parse(f.created_at) < cutoff) stale.push(f.id);
    }
    await Promise.allSettled(stale.map((id) => getClient().files.delete(id)));
    if (stale.length) console.log(`[cleanup] deleted ${stale.length} file(s) older than a day`);
  } catch (err) {
    console.error("[cleanup] failed:", (err as Error).message);
  }
}

/** Stores a PDF on Anthropic so the chat can re-read it without re-uploading; deleted after a day by cleanupOldFiles. */
export async function uploadPdf(pdf: Buffer, filename: string): Promise<string> {
  const file = await getClient().files.upload({
    file: await toFile(pdf, FILE_PREFIX + filename, { type: "application/pdf" }),
  });
  return file.id;
}

export async function extractProposal(pdf: Buffer, filename: string): Promise<{ proposal: Proposal; file_id: string; usage: Usage }> {
  const file = { id: await uploadPdf(pdf, filename) };
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: EXTRACT_SYSTEM,
    output_config: { effort: "high", format: betaZodOutputFormat(ProposalSchema) },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            title: filename,
            source: { type: "file", file_id: file.id },
          },
          { type: "text", text: `Extract the scope and fees from this consultant proposal (file: ${filename}).` },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's response for this proposal.", 502);
  return { proposal: msg.parsed_output, file_id: file.id, usage: usageOf(msg) };
}

export async function compareProposals(
  proposals: Proposal[],
  projectName: string | null,
): Promise<{ comparison: Comparison; usage: Usage }> {
  const payload = proposals.map((p, firm_index) => {
    const { hourly_rates, ...rest } = p;
    return { firm_index, ...rest };
  });
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: COMPARE_SYSTEM,
    output_config: { effort: "high", format: betaZodOutputFormat(ComparisonSchema) },
    messages: [
      {
        role: "user",
        content: `${projectName ? `Project: ${projectName}\n\n` : ""}Proposal extractions (JSON):\n${JSON.stringify(payload, null, 1)}`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's comparison.", 502);
  return { comparison: msg.parsed_output, usage: usageOf(msg) };
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function chat(
  proposals: (Proposal & { file_id: string; source_file: string })[],
  comparison: Comparison,
  projectName: string | null,
  turns: ChatTurn[],
): Promise<ChatResponse & { usage: Usage }> {
  const docs = proposals.map((p, i) => ({
    type: "document" as const,
    title: `firm_index ${i}: ${p.firm} (${p.source_file})`,
    source: { type: "file" as const, file_id: p.file_id },
  }));
  const extractions = proposals.map(({ file_id, source_file, ...p }, firm_index) => ({ firm_index, ...p }));
  const context = `${projectName ? `Project: ${projectName}\n\n` : ""}Extracted data (JSON):\n${JSON.stringify(extractions)}\n\nCurrent analysis (JSON):\n${JSON.stringify(comparison)}`;

  const [first, ...rest] = turns;
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: CHAT_SYSTEM,
    // Most chat turns are lookups; medium effort keeps them cheaper and faster than the high used for reading.
    output_config: { effort: "medium", format: betaZodOutputFormat(ChatWireSchema) },
    messages: [
      { role: "user", content: [...docs, // PDFs + data + analysis are identical across turns (until a correction), so they're cached:
        // follow-up questions read them at the cache rate.
        { type: "text", text: context, cache_control: { type: "ephemeral" } },
        { type: "text", text: first.content },] },
      ...rest.map((t) => ({ role: t.role, content: t.content })),
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's reply.", 502);
  return { ...applyChatUpdates(msg.parsed_output, proposals.length), usage: usageOf(msg) };
}

/** Parses and validates the chat's JSON-text corrections. Anything malformed is dropped and the reply says so. */
function applyChatUpdates(wire: z.infer<typeof ChatWireSchema>, firmCount: number): ChatResponse {
  const parse = <T>(schema: z.ZodType<T>, text: string): T | null => {
    try {
      const r = schema.safeParse(JSON.parse(text));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  };
  let failed = false;
  let updated_comparison: Comparison | null = null;
  if (wire.updated_comparison_json.trim()) {
    updated_comparison = parse(ComparisonSchema, wire.updated_comparison_json);
    if (!updated_comparison) failed = true;
  }
  const updated_proposals: ChatResponse["updated_proposals"] = [];
  for (const u of wire.updated_proposals) {
    const proposal = u.firm_index >= 0 && u.firm_index < firmCount ? parse(ProposalSchema, u.proposal_json) : null;
    if (proposal) updated_proposals.push({ firm_index: u.firm_index, proposal });
    else failed = true;
  }
  const reply = failed
    ? `${wire.reply}\n\n(Note: part of this correction came back malformed, so it was not applied. The tables may not reflect it yet; ask again to retry.)`
    : wire.reply;
  return { reply, updated_comparison, updated_proposals };
}

// Converts any thrown error into a JSON Response with a readable message.
export function errorResponse(err: unknown): Response {
  let status = 500;
  let message = "Unexpected server error.";
  if (err instanceof UserFacingError) {
    status = err.status;
    message = err.message;
  } else if (err instanceof Anthropic.AuthenticationError) {
    message = "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  } else if (err instanceof Anthropic.RateLimitError) {
    status = 429;
    message = "Rate limited by the Anthropic API. Wait a minute and retry.";
  } else if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
    status = 402;
    message = "The Anthropic account is out of API credits. Add credits under Plans & Billing in the Claude Console, then retry.";
  } else if (
    err instanceof Anthropic.NotFoundError ||
    (err instanceof Anthropic.BadRequestError && /file/i.test(err.message) && /not found|does not exist/i.test(err.message))
  ) {
    status = 410;
    message = "The source PDFs have expired (they're deleted after a day). Run the comparison again to keep chatting.";
  } else if (err instanceof Anthropic.BadRequestError) {
    status = 400;
    message = `Anthropic API rejected the request: ${err.message}`;
  } else if (err instanceof Anthropic.APIError) {
    status = 502;
    message = `Anthropic API error (${err.status ?? "network"}). Try again.`;
  }
  // Log status only — never document content.
  console.error(`[api] ${status}: ${message}`);
  return Response.json({ error: message }, { status });
}
