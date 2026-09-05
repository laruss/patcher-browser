import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { BrowserAccessGrantLevel } from "@patcher/domain";
import type { DbConnection } from "../connection.js";
import { createBrowserAccessGrantId } from "../ids.js";
import { browserAccessGrants } from "../schema.js";

export type BrowserAccessGrantRow = typeof browserAccessGrants.$inferSelect;

/**
 * The grants an agent outside Patcher can be holding, and the four questions
 * asked of them.
 *
 * Reads happen on every request such an agent makes, so `getBrowserAccessGrant`
 * is a primary-key lookup and nothing more: it is the whole of what decides
 * whether a credential is still accepted, and it must not become a join.
 */

export interface CreateBrowserAccessGrantArgs {
  label: string;
  level: BrowserAccessGrantLevel;
}

/** Issue a grant. The caller derives the credential from the id it returns. */
export function createBrowserAccessGrant(
  db: DbConnection,
  args: CreateBrowserAccessGrantArgs,
  now: number = Date.now(),
): BrowserAccessGrantRow {
  const row: BrowserAccessGrantRow = {
    id: createBrowserAccessGrantId(),
    label: args.label,
    level: args.level,
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
  };
  db.insert(browserAccessGrants).values(row).run();
  return row;
}

/**
 * One grant by id, revoked ones included.
 *
 * Revoked rows come back rather than being filtered out here, because the two
 * callers want different things from them: the identity check has to tell "this
 * grant was revoked" from "this id was never a grant" so the refusal can say
 * which, and a list has to show what was taken back.
 */
export function getBrowserAccessGrant(
  db: DbConnection,
  id: string,
): BrowserAccessGrantRow | undefined {
  return db
    .select()
    .from(browserAccessGrants)
    .where(eq(browserAccessGrants.id, id))
    .get();
}

/**
 * Every grant, newest first, revoked ones last.
 *
 * The id breaks a tie on `createdAt`, which is a millisecond and so not a total
 * order — two grants issued by a script in the same tick would otherwise come
 * back in whatever order SQLite felt like, and a list that reorders itself
 * between two reads of the same data is a list nobody can click in.
 */
export function listBrowserAccessGrants(
  db: DbConnection,
): BrowserAccessGrantRow[] {
  return db
    .select()
    .from(browserAccessGrants)
    .orderBy(desc(browserAccessGrants.createdAt), desc(browserAccessGrants.id))
    .all()
    .sort((a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null));
}

/**
 * Take a grant back. Idempotent, and it keeps the first revocation's timestamp:
 * when it stopped working is a fact, and a second call is not a new one.
 *
 * Returns the row as it now stands, or undefined when there is no such grant —
 * so a route can answer 404 rather than reporting a revocation that revoked
 * nothing.
 */
export function revokeBrowserAccessGrant(
  db: DbConnection,
  id: string,
): BrowserAccessGrantRow | undefined {
  db.update(browserAccessGrants)
    .set({ revokedAt: Date.now() })
    .where(
      and(eq(browserAccessGrants.id, id), isNull(browserAccessGrants.revokedAt)),
    )
    .run();
  return getBrowserAccessGrant(db, id);
}

/**
 * How stale `lastUsedAt` is allowed to get.
 *
 * This is written on the way through the request gate, and a grant driving the
 * browser makes a lot of requests — a screenshot loop is dozens a second, and
 * none of them is a different answer to "is anything still using this". A
 * minute is far below the resolution anybody reads the field at.
 */
const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * Note that a grant was used, at most once a minute.
 *
 * Written by the identity check rather than by the browser route, because the
 * question it answers is "is this credential still in use", and a refused
 * command is still a use. Best effort by construction: the `where` does the
 * throttling, so two concurrent requests race to a write that would have been
 * the same either way.
 */
export function touchBrowserAccessGrantUse(
  db: DbConnection,
  id: string,
  now: number = Date.now(),
): void {
  db.update(browserAccessGrants)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(browserAccessGrants.id, id),
        or(
          isNull(browserAccessGrants.lastUsedAt),
          lt(browserAccessGrants.lastUsedAt, now - LAST_USED_RESOLUTION_MS),
        ),
      ),
    )
    .run();
}
