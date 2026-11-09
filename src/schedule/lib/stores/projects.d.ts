// Types for the parts of the schedule store that TypeScript code uses (the store itself stays JavaScript).
export function flushSaves(keepalive?: boolean): Promise<unknown>;
export function clearHistory(projectId: string): void;
export const projectStore: { init(force?: boolean): Promise<void>; [k: string]: unknown };
