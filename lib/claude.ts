import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { costOf, type Usage } from "./cost.js";
import { DISCIPLINES } from "./disciplines.js";
import { CHAT_SYSTEM, CHECK_SYSTEM, COMPARE_SYSTEM, EXTRACT_SYSTEM, FEE_DRAFT_SYSTEM, FIT_CHECK_SYSTEM, OWN_PROPOSAL_SYSTEM, RFP_SYSTEM, SUGGEST_SYSTEM } from "./prompts.js";

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

export const RFP_FACTS = {
  location: "Location",
  building_size: "Building size",
  construction_budget: "Construction budget",
  delivery_method: "Delivery method",
  phases: "Phases",
  fee_format: "Fee format",
  contract: "Contract",
  insurance: "Insurance",
  page_limit: "Page limit",
  submission: "Submission format",
  contact: "Contact",
} as const;
export type RfpFactKey = keyof typeof RFP_FACTS;

// An RFP (plus any addenda) read for an architecture firm deciding whether and how to respond.
export const FitSchema = z.object({ verdict: z.enum(["pursue", "consider", "pass"]), reasons: z.array(z.string()) });
export type Fit = z.infer<typeof FitSchema>;

export const RfpSchema = z.object({
  // Whether to pursue it, judged against the firm's world view and past pursuits (missing on older reviews).
  fit: FitSchema,
  project_name: z.string(),
  client: z.string(),
  summary: z.string(),
  // A fixed set so every review reads the same; value "" when the RFP doesn't say.
  facts: z.object(
    Object.fromEntries(
      ["location", "building_size", "construction_budget", "delivery_method", "phases", "fee_format", "contract", "insurance", "page_limit", "submission", "contact"].map(
        (k) => [k, z.object({ value: z.string(), page: z.number() })],
      ),
    ) as Record<RfpFactKey, z.ZodObject<{ value: z.ZodString; page: z.ZodNumber }>>,
  ),
  // Every discipline on the governing list, each marked requested or not, so the team can see which consultants it needs.
  services: z.array(z.object({ discipline: z.enum(DISCIPLINES), requested: z.enum(["yes", "no", "unclear"]), detail: z.string(), page: z.number() })),
  dates: z.array(
    z.object({
      label: z.string(),
      date: z.string(), // YYYY-MM-DD, or "" if not a specific day
      when: z.string(), // as written, e.g. "Dec 8, 2:00 PM" or "Spring 2028"
      mandatory: z.boolean(),
      page: z.number(),
    }),
  ),
  watch_outs: z.array(z.object({ critical: z.boolean(), title: z.string(), detail: z.string(), page: z.number() })),
  questions: z.array(z.string()),
  scoring: z.array(z.object({ criterion: z.string(), weight: z.string() })),
});
export type Rfp = z.infer<typeof RfpSchema>;

// A project's consultant proposals checked against its RFP review: who covers each requested service, and what's missing or wrong.
export const ProjectCheckSchema = z.object({
  summary: z.string(),
  coverage: z.array(
    z.object({
      discipline: z.string(),
      status: z.enum(["covered", "partial", "missing", "in_house"]),
      firm_indexes: z.array(z.number()),
      note: z.string(),
    }),
  ),
  issues: z.array(
    z.object({
      level: z.enum(["high", "medium", "low"]),
      title: z.string(),
      detail: z.string(),
      firm_indexes: z.array(z.number()),
    }),
  ),
});
export type ProjectCheck = z.infer<typeof ProjectCheckSchema>;

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






// ---------- Calls ----------

let client: Anthropic | null = null;
export function getClient(): Anthropic {
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
export function usageOf(msg: {
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
  firm = "",
): Promise<{ comparison: Comparison; usage: Usage }> {
  const payload = proposals.map((p, firm_index) => {
    const { hourly_rates, ...rest } = p;
    return { firm_index, ...rest };
  });
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: withContext(COMPARE_SYSTEM, firm),
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

/** Reads an RFP and its addenda (already uploaded via /api/upload) in one call. */
/** The built-in instructions, then the firm's world view and past pursuits (see lib/worldview.ts) when there are any. */
const withContext = (system: string, context: string) => (context.trim() ? `${system}\n\n${context.trim()}` : system);

export async function reviewRfp(files: { file_id: string; filename: string }[], context = ""): Promise<{ rfp: Rfp; usage: Usage }> {
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: withContext(RFP_SYSTEM, context),
    output_config: { effort: "high", format: betaZodOutputFormat(RfpSchema) },
    messages: [
      {
        role: "user",
        content: [
          ...files.map((f) => ({ type: "document" as const, title: f.filename, source: { type: "file" as const, file_id: f.file_id } })),
          { type: "text", text: files.length > 1 ? "Review this RFP and its addenda (in the order given)." : "Review this RFP." },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's RFP review.", 502);
  return { rfp: msg.parsed_output, usage: usageOf(msg) };
}

/** The pursue / consider / pass verdict for a saved RFP review, from its JSON alone (no PDFs). */
export async function fitCheck(rfp: unknown, context: string): Promise<{ fit: Fit; usage: Usage }> {
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: withContext(FIT_CHECK_SYSTEM, context),
    output_config: { effort: "medium", format: betaZodOutputFormat(FitSchema) },
    messages: [{ role: "user", content: `RFP review (JSON):\n${JSON.stringify(rfp)}` }],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's verdict.", 502);
  return { fit: msg.parsed_output, usage: usageOf(msg) };
}

/** Suggested edits to the world view, from how its verdicts compared with real outcomes. Plain text. */
export async function suggestWorldView(worldView: string, results: unknown[]): Promise<{ text: string; usage: Usage }> {
  const msg = await getClient().beta.messages
    .stream({
      ...BASE,
      max_tokens: 4000,
      system: SUGGEST_SYSTEM,
      output_config: { effort: "high" },
      messages: [
        {
          role: "user",
          content: `Current world view:\n${worldView.trim() || "(empty)"}\n\nVerdicts against outcomes (JSON):\n${JSON.stringify(results, null, 1)}`,
        },
      ],
    })
    .finalMessage();
  checkStop(msg);
  return { text: textOf(msg), usage: usageOf(msg) };
}

/** About 150 words on what a proposal the firm submitted emphasised. */
export async function summarizeOwnProposal(fileId: string, filename: string): Promise<{ summary: string; usage: Usage }> {
  const msg = await getClient().beta.messages
    .stream({
      ...BASE,
      max_tokens: 2000,
      system: OWN_PROPOSAL_SYSTEM,
      output_config: { effort: "medium" },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", title: filename, source: { type: "file", file_id: fileId } },
            { type: "text", text: "Summarise this proposal." },
          ],
        },
      ],
    })
    .finalMessage();
  checkStop(msg);
  return { summary: textOf(msg).trim(), usage: usageOf(msg) };
}

const textOf = (msg: { content: { type: string }[] }) =>
  msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as unknown as { text: string }).text)
    .join("");

/** Checks a project's consultant proposals against its RFP review. Text only (no PDFs), so it's quick and cheap. */
export async function checkProject(rfp: Rfp, proposals: Proposal[], firm = ""): Promise<{ check: ProjectCheck; usage: Usage }> {
  const payload = proposals.map((p, firm_index) => {
    const { hourly_rates, fee_items, ...rest } = p;
    return { firm_index, ...rest };
  });
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: withContext(CHECK_SYSTEM, firm),
    output_config: { effort: "high", format: betaZodOutputFormat(ProjectCheckSchema) },
    messages: [
      {
        role: "user",
        content: `RFP review (JSON):\n${JSON.stringify(rfp)}\n\nConsultant proposal extractions (JSON):\n${JSON.stringify(payload, null, 1)}`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's project check.", 502);
  return { check: msg.parsed_output, usage: usageOf(msg) };
}

// A starting fee drafted from the RFP review: budget, and the firm's own architecture and interior design work
// (FF&E included when the RFP asks for it) by phase, task and role. Consultants are left to their own proposals.
export const FeeDraftSchema = z.object({
  budget: z.object({
    by: z.enum(["amount", "area"]),
    amount: z.number().nullable(),
    area: z.number().nullable(),
    cost_per_sf: z.number().nullable(),
    basis: z.string(),
  }),
  target_percent: z.number(),
  phases: z.array(
    z.object({
      name: z.string(),
      target_share: z.number(),
      tasks: z.array(z.object({ name: z.string(), hours: z.array(z.object({ role_id: z.string(), hours: z.number() })) })),
    }),
  ),
  expenses: z.number().nullable(),
  assumptions: z.array(z.string()),
});
export type FeeDraft = z.infer<typeof FeeDraftSchema>;


/** Drafts a starting fee from an RFP review. Text only (no PDFs), so it's quick and cheap. */
export async function draftFee(
  rfp: Rfp,
  roles: { id: string; name: string; rate: number | null }[],
  context = "",
): Promise<{ draft: FeeDraft; usage: Usage }> {
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: withContext(FEE_DRAFT_SYSTEM, context),
    output_config: { effort: "high", format: betaZodOutputFormat(FeeDraftSchema) },
    messages: [
      {
        role: "user",
        content: `RFP review (JSON):\n${JSON.stringify(rfp)}\n\nStaff roles and hourly rates (JSON):\n${JSON.stringify(roles)}`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's fee draft.", 502);
  return { draft: msg.parsed_output, usage: usageOf(msg) };
}

export type ChatTurn ={ role: "user" | "assistant"; content: string };

export async function chat(
  proposals: (Proposal & { file_id: string; source_file: string })[],
  comparison: Comparison,
  projectName: string | null,
  turns: ChatTurn[],
  firm = "",
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
    system: withContext(CHAT_SYSTEM, firm),
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
