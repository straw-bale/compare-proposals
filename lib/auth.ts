import { UserFacingError } from "./claude.js";

/**
 * Simple shared access code for the live site. Set ACCESS_CODE in the Vercel project's environment variables
 * (kept out of the repo, which is public). Matching ignores case. When ACCESS_CODE is unset (local dev), no code
 * is required.
 */
export function checkAccess(request: Request): void {
  const expected = process.env.ACCESS_CODE?.trim().toLowerCase();
  if (!expected) return;
  const given = request.headers.get("x-access-code")?.trim().toLowerCase();
  if (given !== expected) throw new UserFacingError("Access code required.", 401);
}
