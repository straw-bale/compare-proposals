import { getClient, usageOf } from "./claude.js";
import { SCHEDULE_PROMPT } from "./schedule-prompt.js";
import type { Usage } from "./cost.js";

// The Schedule Assistant, moved from the schedule maker. Same model and limits as before so its answers don't change.
export const SCHEDULE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;

/** Sends the conversation plus the current schedule; returns the assistant's raw text (the editor parses it). */
export async function askScheduleAssistant(project: unknown, messages: { role: "user" | "assistant"; content: unknown }[]): Promise<{ text: string; usage: Usage }> {
  const system = `${SCHEDULE_PROMPT}

## Current Project
${JSON.stringify(project ?? null, null, 2)}`;
  const msg = await getClient().messages.create({
    model: SCHEDULE_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    // Content is passed through as the editor built it (text, or a file block plus text).
    messages: messages.map(({ role, content }) => ({ role, content })) as never,
  });
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  return { text, usage: usageOf(msg) };
}
