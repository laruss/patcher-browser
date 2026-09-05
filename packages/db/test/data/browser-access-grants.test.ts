import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBrowserAccessGrant,
  createConnection,
  getBrowserAccessGrant,
  listBrowserAccessGrants,
  migrate,
  pauseBrowserAccessGrant,
  resumeBrowserAccessGrant,
  revokeBrowserAccessGrant,
  touchBrowserAccessGrantUse,
  type DbConnection,
} from "../../src/index.js";

/**
 * These rows *are* the lifetime of a credential, so what is tested here is what
 * the identity check on the server will ask them: does this grant exist, is it
 * stopped — for now or for good — and when did anything last use it.
 */

describe("browser access grants", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  it("issues a grant that starts unused and unrevoked", () => {
    const grant = createBrowserAccessGrant(db, {
      label: "Claude Code",
      level: "read",
    });
    expect(grant.id.startsWith("bag_")).toBe(true);
    // The id rides in the credential and is parsed off it by splitting on ".".
    expect(grant.id).not.toContain(".");
    expect(grant.lastUsedAt).toBeNull();
    expect(grant.revokedAt).toBeNull();
    expect(getBrowserAccessGrant(db, grant.id)).toEqual(grant);
  });

  it("has no answer for an id that was never a grant", () => {
    expect(getBrowserAccessGrant(db, "bag_nothing")).toBeUndefined();
  });

  it("keeps a revoked grant, so a list can say what was taken back", () => {
    const grant = createBrowserAccessGrant(db, {
      label: "Codex",
      level: "full",
    });
    const revoked = revokeBrowserAccessGrant(db, grant.id);
    expect(revoked?.revokedAt).toBeTypeOf("number");
    expect(getBrowserAccessGrant(db, grant.id)?.revokedAt).toBe(
      revoked?.revokedAt,
    );
  });

  it("keeps the first revocation's time on a second revoke", () => {
    // When it stopped working is a fact about the past. A second call is not a
    // new revocation, and moving the date would make a list say otherwise.
    //
    // The clock is injected, because both calls otherwise land in the same
    // millisecond and an implementation that overwrites on every call would
    // pass — the test would be asserting the clock's resolution rather than the
    // behaviour.
    const grant = createBrowserAccessGrant(db, { label: "a", level: "read" });
    expect(revokeBrowserAccessGrant(db, grant.id, 1_000)?.revokedAt).toBe(1_000);
    expect(revokeBrowserAccessGrant(db, grant.id, 9_000)?.revokedAt).toBe(1_000);
  });

  it("reports nothing when there is no such grant to revoke", () => {
    expect(revokeBrowserAccessGrant(db, "bag_missing")).toBeUndefined();
  });

  it("lists newest first, with revoked grants after live ones", () => {
    // Distinct timestamps, because `Date.now()` would give all three the same
    // millisecond here and "newest first" would be asserting the tiebreak.
    const older = createBrowserAccessGrant(db, { label: "a", level: "read" }, 1);
    const newer = createBrowserAccessGrant(db, { label: "b", level: "full" }, 2);
    revokeBrowserAccessGrant(db, newer.id);
    const third = createBrowserAccessGrant(db, { label: "c", level: "read" }, 3);
    expect(listBrowserAccessGrants(db).map((row) => row.id)).toEqual([
      third.id,
      older.id,
      newer.id,
    ]);
  });

  it("records a first use", () => {
    const grant = createBrowserAccessGrant(db, { label: "a", level: "read" });
    touchBrowserAccessGrantUse(db, grant.id, 1_000_000);
    expect(getBrowserAccessGrant(db, grant.id)?.lastUsedAt).toBe(1_000_000);
  });

  it("does not rewrite the row for every request in the same minute", () => {
    // A screenshot loop is dozens of requests a second and none of them is a
    // different answer to "is anything still using this".
    const grant = createBrowserAccessGrant(db, { label: "a", level: "read" });
    touchBrowserAccessGrantUse(db, grant.id, 1_000_000);
    touchBrowserAccessGrantUse(db, grant.id, 1_000_500);
    expect(getBrowserAccessGrant(db, grant.id)?.lastUsedAt).toBe(1_000_000);
    touchBrowserAccessGrantUse(db, grant.id, 1_061_000);
    expect(getBrowserAccessGrant(db, grant.id)?.lastUsedAt).toBe(1_061_000);
  });

  it("orders two grants from the same millisecond deterministically", () => {
    // Not a case a person creates, and a list that reordered itself between two
    // reads of the same data would still be a list nobody can click in.
    const a = createBrowserAccessGrant(db, { label: "a", level: "read" }, 7);
    const b = createBrowserAccessGrant(db, { label: "b", level: "read" }, 7);
    const expected = [a.id, b.id].sort().reverse();
    expect(listBrowserAccessGrants(db).map((row) => row.id)).toEqual(expected);
    expect(listBrowserAccessGrants(db).map((row) => row.id)).toEqual(expected);
  });

  it("pauses and resumes without ending the grant", () => {
    const grant = createBrowserAccessGrant(db, { label: "a", level: "read" });
    expect(pauseBrowserAccessGrant(db, grant.id, 1_000)?.pausedAt).toBe(1_000);
    // Idempotent, and keeping the first pause's timestamp: a second click on
    // "Pause" is not a new decision.
    expect(pauseBrowserAccessGrant(db, grant.id, 9_000)?.pausedAt).toBe(1_000);
    expect(resumeBrowserAccessGrant(db, grant.id)?.pausedAt).toBeNull();
    // Still the same credential — the whole reason pausing exists is that the
    // agent holding it needs no reconfiguring afterwards.
    expect(getBrowserAccessGrant(db, grant.id)?.revokedAt).toBeNull();
  });

  it("will not resume a revoked grant, or pause one", () => {
    // Revoking is the decision that does not have an undo, and a paused
    // timestamp on a revoked row would make "Resume" look available for
    // something that can never work again.
    const grant = createBrowserAccessGrant(db, { label: "a", level: "read" });
    revokeBrowserAccessGrant(db, grant.id, 1_000);

    expect(pauseBrowserAccessGrant(db, grant.id, 2_000)?.pausedAt).toBeNull();
    expect(resumeBrowserAccessGrant(db, grant.id)?.revokedAt).toBe(1_000);
  });

  it("reports nothing when there is no such grant to pause or resume", () => {
    expect(pauseBrowserAccessGrant(db, "bag_missing")).toBeUndefined();
    expect(resumeBrowserAccessGrant(db, "bag_missing")).toBeUndefined();
  });

  it("touching an id that is not a grant changes nothing", () => {
    const grant = createBrowserAccessGrant(db, { label: "a", level: "read" });
    touchBrowserAccessGrantUse(db, "bag_missing", 1_000_000);
    expect(getBrowserAccessGrant(db, grant.id)?.lastUsedAt).toBeNull();
  });
});
