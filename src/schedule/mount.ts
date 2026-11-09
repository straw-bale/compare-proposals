import { mount, unmount } from "svelte";
import App from "./App.svelte";
import { route, parseScheduleHash } from "./route.js";
import { clearHistory, flushSaves } from "./lib/stores/projects.js";
// The schedule maker's global styles (reset, Barlow, colour tokens, print page). Added only while a schedule screen
// is showing, and removed when leaving, so they can't change the rest of the app.
import appCss from "./lib/app.css?inline";

let app: Record<string, unknown> | null = null;
let root: HTMLElement | null = null;
let style: HTMLStyleElement | null = null;
let editing: string | null = null;
let headerSize: ResizeObserver | null = null;

/** Keeps --site-header-h at the site header's height (it wraps on phones; 0 when hidden), for full-height screens. */
function trackHeader() {
  const header = document.querySelector<HTMLElement>("header.site");
  if (headerSize || !header) return;
  const set = () => document.documentElement.style.setProperty("--site-header-h", `${header.offsetHeight}px`);
  headerSize = new ResizeObserver(set);
  headerSize.observe(header);
  set();
}

// Full-window screens fill the window below the site header (no footer). The print preview has no header either.
// The schedule list and system prompt are ordinary pages, with the site header and footer.
const FULL = new Set(["editor", "share", "print"]);

function loadFonts() {
  if (document.getElementById("schedule-fonts")) return;
  const link = document.createElement("link");
  link.id = "schedule-fonts";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@300;400;500;600;700;800&display=swap";
  document.head.appendChild(link);
}

/** Shows the schedule screen for a hash like "#schedule/<id>". Returns false if the hash isn't a schedule route. */
export function showSchedule(hash: string): boolean {
  const r = parseScheduleHash(hash);
  if (!r) return false;
  loadFonts();
  if (!style) {
    style = document.createElement("style");
    style.id = "schedule-styles";
    // The schedule maker relied on the browser's default text size and line height; this app sets its own.
    style.textContent = `${appCss}\nbody { font-size: 16px; line-height: normal; font-variant-numeric: normal; }\n`;
    document.head.appendChild(style);
  }
  if (!root) {
    root = document.createElement("div");
    root.id = "schedule-root";
    document.querySelector("main")!.before(root);
  }
  const html = document.documentElement;
  html.classList.add("schedule-on");
  html.classList.toggle("schedule-full", FULL.has(r.view));
  html.classList.toggle("schedule-print", r.view === "print");
  trackHeader();
  // Leaving a schedule: send its unsaved edits and forget its undo history.
  const next = r.view === "editor" ? (r.id ?? null) : null;
  if (editing && editing !== next) {
    flushSaves();
    clearHistory(editing);
  }
  editing = next;
  route.set(r);
  if (!app) app = mount(App, { target: root });
  if (!FULL.has(r.view)) scrollTo(0, 0);
  return true;
}

/** Leaves the schedule screens: saves pending edits, removes the editor (and its keyboard shortcuts) and its styles. */
export function hideSchedule() {
  if (!app) return;
  flushSaves();
  if (editing) clearHistory(editing);
  editing = null;
  unmount(app);
  app = null;
  root?.remove();
  root = null;
  style?.remove();
  style = null;
  headerSize?.disconnect();
  headerSize = null;
  document.documentElement.style.removeProperty("--site-header-h");
  document.documentElement.classList.remove("schedule-on", "schedule-full", "schedule-print");
}

// Closing the tab with edits waiting: send them in a way that survives the page going away.
addEventListener("pagehide", () => flushSaves(true));
