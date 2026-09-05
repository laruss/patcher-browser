import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBrowserAccessGrant,
  createConnection,
  getBrowserAccessGrant,
  listBrowserAccessGrants,
  migrate,
  revokeBrowserAccessGrant,
  touchBrowserAccessGrantUse,
  type DbConnection,
} from "../../src/index.js";

/**
 * These rows *are* the lifetime of a credential, so what is tested here is what
 * the identity check on the server will ask them: does this grant exist, was it
 * taken back, and when did anything last use it.
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
    const grant = createBrowserAccessGrant(db, { label: "a", level: "read" });
    const first = revokeBrowserAccessGrant(db, grant.id)?.revokedAt;
    expect(revokeBrowserAccessGrant(db, grant.id)?.revokedAt).toBe(first);
  });

  it("reports nothing when there is no such grant to revoke", () => {
    expect(revokeBrowserAccessGrant(db, "bag_missing")).toBeUndefined();
  });

  it("lists newest first, with revoked grants after live ones", () => {
    const older = createBrowserAccessGrant(db, { label: "a", level: "read" });
    const newer = createBrowserAccessGrant(db, { label: "b", level: "full" });
    revokeBrowserAccessGrant(db, newer.id);
    const third = createBrowserAccessGrant(db, { label: "c", level: "read" });
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

  it("touching an id that is not a grant changes nothing", () => {
    const grant = createBrowserAccessGrant(db, { label: "a", level: "read" });
    touchBrowserAccessGrantUse(db, "bag_missing", 1_000_000);
    expect(getBrowserAccessGrant(db, grant.id)?.lastUsedAt).toBeNull();
  });
});
