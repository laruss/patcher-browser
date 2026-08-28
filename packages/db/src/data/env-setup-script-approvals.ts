import { and, eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { envSetupScriptApprovals } from "../schema.js";

/**
 * Whether this project's owner has already allowed a setup script with exactly
 * this content.
 *
 * Content, not path: a script that changed is a script nobody has seen.
 */
export function hasEnvSetupScriptApproval(
  db: DbConnection,
  args: { projectId: string; scriptSha256: string },
): boolean {
  const row = db
    .select({ approvedAt: envSetupScriptApprovals.approvedAt })
    .from(envSetupScriptApprovals)
    .where(
      and(
        eq(envSetupScriptApprovals.projectId, args.projectId),
        eq(envSetupScriptApprovals.scriptSha256, args.scriptSha256),
      ),
    )
    .get();
  return row !== undefined;
}

/** Remember an allow, so the next worktree from this repository asks nothing. */
export function recordEnvSetupScriptApproval(
  db: DbConnection,
  args: { projectId: string; scriptSha256: string },
): void {
  db.insert(envSetupScriptApprovals)
    .values({
      projectId: args.projectId,
      scriptSha256: args.scriptSha256,
      approvedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
}
