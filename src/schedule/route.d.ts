import type { Writable } from "svelte/store";
export type ScheduleRoute = { view: "list" | "editor" | "share" | "print" | "prompt"; id?: string | null; params?: Record<string, unknown> | null };
export const route: Writable<ScheduleRoute>;
export function parseScheduleHash(hash: string): ScheduleRoute | null;
