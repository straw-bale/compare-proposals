// Shared by server and browser: Claude API pricing and cost math. No SDK imports.

/** US$ per million tokens, Anthropic list prices (Oct 2026). Update here if pricing changes. */
const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  // Possible server-side fallback model if a request is declined.
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

export type Usage = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  /** null when the serving model isn't in the price table */
  cost_usd: number | null;
};

const priceFor = (model: string) => PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? ""];

export function costOf(u: Omit<Usage, "cost_usd">): number | null {
  const p = priceFor(u.model);
  if (!p) return null;
  return (
    (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_write_tokens * p.cacheWrite + u.cache_read_tokens * p.cacheRead) /
    1e6
  );
}

// ---------- Estimates (shown before spending) ----------
// Input tokens are measured exactly; output (Claude's reasoning + written result) can only be estimated,
// so every estimate is a range. Actual costs are shown after each step.

const MAIN = PRICES["claude-opus-5-5"];
type Range = [number, number];
const range = (inTokens: Range, outTokens: Range, inPrice = MAIN.input): Range => [
  (inTokens[0] * inPrice + outTokens[0] * MAIN.output) / 1e6,
  (inTokens[1] * inPrice + outTokens[1] * MAIN.output) / 1e6,
];

/** Reading one PDF, given its measured input tokens. */
export const estimateExtract = (inputTokens: number): Range => range([inputTokens, inputTokens], [5_000, 20_000]);

/** The comparison step, which reads the extracted data (not the PDFs) for n proposals. */
export const estimateCompare = (n: number): Range => range([2_000 + n * 3_000, 2_000 + n * 8_000], [8_000, 25_000]);

/**
 * A chat question. The PDFs, extracted data and analysis are cached together: the first question (or one after
 * ~5 idle minutes, or right after a correction changes the analysis) writes the cache; follow-ups read it.
 */
export function estimateChat(pdfTokens: number, n: number) {
  const context: Range = [pdfTokens + 2_000 + n * 5_000, pdfTokens + 2_000 + n * 10_000];
  const answer: Range = [1_000, 8_000];
  const correction: Range = [10_000, 30_000]; // corrections rewrite the analysis
  return {
    followUp: range(context, answer, MAIN.cacheRead),
    first: range(context, answer, MAIN.cacheWrite),
    correctionMax: range(context, correction, MAIN.cacheWrite)[1],
  };
}

export const sumRanges = (rs: Range[]): Range => rs.reduce<Range>((a, r) => [a[0] + r[0], a[1] + r[1]], [0, 0]);

export function usd(n: number): string {
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
export const usdRange = ([lo, hi]: Range) => (usd(lo) === usd(hi) ? `≈ ${usd(lo)}` : `≈ ${usd(lo)}–${usd(hi)}`);
