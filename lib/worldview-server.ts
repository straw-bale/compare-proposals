import { dbConfigured, get } from "./db.js";
import { emptyWorldView, firmContext, worldViewText, type WorldView } from "./worldview.js";

/**
 * The firm's saved world view, as context to add after a tool's built-in instructions. Read on the server for the
 * tools that don't send it themselves, so every advice-giving tool sees it. "" when there's none or it can't be read
 * (the tool still answers, just without it).
 */
export async function worldViewContext(): Promise<string> {
  if (!dbConfigured()) return "";
  try {
    const saved = (await get("settings", "worldview")) as Partial<WorldView> | null;
    return saved ? firmContext(worldViewText({ ...emptyWorldView(), ...saved }), []) : "";
  } catch (err) {
    console.error("[worldview] couldn't read:", (err as Error).message);
    return "";
  }
}
