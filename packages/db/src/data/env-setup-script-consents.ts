import { and, eq, ne } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { envSetupScriptConsents } from "../schema.js";
import { createEnvSetupScriptConsentId } from "../ids.js";

export type EnvSetupScriptConsentRow =
  typeof envSetupScriptConsents.$inferSelect;

/**
 * Which script, on which machine, in which checkout.
 *
 * All four together, because a setup script's effect is not in its bytes: the
 * same `npm ci` runs whatever the repository around it says, so an allow given
 * for one checkout on one machine is not an answer about another. The path is
 * the repository the worktrees come from, not a worktree — worktrees are new
 * paths, and asking once per worktree is what a remembered answer avoids.
 */
export interface EnvSetupScriptConsentScope {
  projectId: string;
  hostId: string;
  sourcePath: string;
  scriptSha256: string;
}

export interface EnvSetupScriptSighting extends EnvSetupScriptConsentScope {
  scriptPath: string;
  scriptByteLength: number;
}

function matchesScope(scope: EnvSetupScriptConsentScope) {
  return and(
    eq(envSetupScriptConsents.projectId, scope.projectId),
    eq(envSetupScriptConsents.hostId, scope.hostId),
    eq(envSetupScriptConsents.sourcePath, scope.sourcePath),
    eq(envSetupScriptConsents.scriptSha256, scope.scriptSha256),
  );
}

/** Whether a person has already allowed exactly this script, here. */
export function hasEnvSetupScriptAllowance(
  db: DbConnection,
  scope: EnvSetupScriptConsentScope,
): boolean {
  const row = db
    .select({ status: envSetupScriptConsents.status })
    .from(envSetupScriptConsents)
    .where(matchesScope(scope))
    .get();
  return row?.status === "allowed";
}

/** Remember an allow, so the next worktree from this repository asks nobody. */
export function recordEnvSetupScriptAllowance(
  db: DbConnection,
  notifier: DbNotifier,
  sighting: EnvSetupScriptSighting,
): void {
  const now = Date.now();
  db.insert(envSetupScriptConsents)
    .values({
      id: createEnvSetupScriptConsentId(),
      ...sighting,
      status: "allowed",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        envSetupScriptConsents.projectId,
        envSetupScriptConsents.hostId,
        envSetupScriptConsents.sourcePath,
        envSetupScriptConsents.scriptSha256,
      ],
      set: {
        status: "allowed",
        scriptPath: sighting.scriptPath,
        scriptByteLength: sighting.scriptByteLength,
        updatedAt: now,
      },
    })
    .run();
  notifier.notifyProject(sighting.projectId, ["setup-script-consents-changed"]);
}

/**
 * Keep a question nobody answered, so it can be answered later.
 *
 * A schedule or a delegated thread provisions in a thread nobody is watching:
 * the prompt stands its four minutes and times out, and without this the run
 * after it starts from the same nothing. One unanswered question per repository
 * per machine — the newest — because the question is "this repository's script
 * wants to run", and the bytes it wants to run are whatever the checkout holds
 * now.
 *
 * An existing allow is never touched here: this is only reached when there was
 * none.
 */
export function recordEnvSetupScriptQuestion(
  db: DbConnection,
  notifier: DbNotifier,
  sighting: EnvSetupScriptSighting,
): void {
  const now = Date.now();
  db.transaction((tx) => {
    tx.insert(envSetupScriptConsents)
      .values({
        id: createEnvSetupScriptConsentId(),
        ...sighting,
        status: "asked",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          envSetupScriptConsents.projectId,
          envSetupScriptConsents.hostId,
          envSetupScriptConsents.sourcePath,
          envSetupScriptConsents.scriptSha256,
        ],
        set: {
          scriptPath: sighting.scriptPath,
          scriptByteLength: sighting.scriptByteLength,
          updatedAt: now,
        },
      })
      .run();
    tx.delete(envSetupScriptConsents)
      .where(
        and(
          eq(envSetupScriptConsents.projectId, sighting.projectId),
          eq(envSetupScriptConsents.hostId, sighting.hostId),
          eq(envSetupScriptConsents.sourcePath, sighting.sourcePath),
          eq(envSetupScriptConsents.status, "asked"),
          ne(envSetupScriptConsents.scriptSha256, sighting.scriptSha256),
        ),
      )
      .run();
  });
  notifier.notifyProject(sighting.projectId, ["setup-script-consents-changed"]);
}

/**
 * Drop a standing question, because it has just been answered face to face.
 *
 * Only an unanswered one: an allow is not something a later decline in another
 * thread takes away, and the row that records it is not this row.
 */
export function forgetEnvSetupScriptQuestion(
  db: DbConnection,
  notifier: DbNotifier,
  scope: EnvSetupScriptConsentScope,
): void {
  const row =
    db
      .delete(envSetupScriptConsents)
      .where(and(matchesScope(scope), eq(envSetupScriptConsents.status, "asked")))
      .returning({ id: envSetupScriptConsents.id })
      .get() ?? null;
  if (row) {
    notifier.notifyProject(scope.projectId, ["setup-script-consents-changed"]);
  }
}

/** Everything this project remembers, newest first. */
export function listEnvSetupScriptConsents(
  db: DbConnection,
  projectId: string,
): EnvSetupScriptConsentRow[] {
  return db
    .select()
    .from(envSetupScriptConsents)
    .where(eq(envSetupScriptConsents.projectId, projectId))
    .all()
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * Answer a standing question, out of band.
 *
 * Scoped by project as well as by id so a caller that names somebody else's row
 * gets nothing rather than a foreign allow.
 */
export function allowEnvSetupScriptConsent(
  db: DbConnection,
  notifier: DbNotifier,
  args: { projectId: string; consentId: string },
): EnvSetupScriptConsentRow | null {
  const row =
    db
      .update(envSetupScriptConsents)
      .set({ status: "allowed", updatedAt: Date.now() })
      .where(
        and(
          eq(envSetupScriptConsents.id, args.consentId),
          eq(envSetupScriptConsents.projectId, args.projectId),
        ),
      )
      .returning()
      .get() ?? null;
  if (row) {
    notifier.notifyProject(args.projectId, ["setup-script-consents-changed"]);
  }
  return row;
}

/** Forget one row: revoking an allow, or dismissing a question. */
export function deleteEnvSetupScriptConsent(
  db: DbConnection,
  notifier: DbNotifier,
  args: { projectId: string; consentId: string },
): boolean {
  const row =
    db
      .delete(envSetupScriptConsents)
      .where(
        and(
          eq(envSetupScriptConsents.id, args.consentId),
          eq(envSetupScriptConsents.projectId, args.projectId),
        ),
      )
      .returning({ id: envSetupScriptConsents.id })
      .get() ?? null;
  if (row) {
    notifier.notifyProject(args.projectId, ["setup-script-consents-changed"]);
  }
  return row !== null;
}
