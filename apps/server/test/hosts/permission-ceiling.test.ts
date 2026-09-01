import { describe, expect, it } from "vitest";
import {
  createConnection,
  migrate,
  noopNotifier,
  updateHost,
  upsertHost,
  type DbConnection,
} from "@patcher/db";
import { DEFAULT_HOST_MAX_PERMISSION_MODE } from "@patcher/domain";
import {
  clampPermissionModeToHost,
  getHostPermissionCeiling,
  isHostPermissionCeilingConflictError,
  PERMISSION_CEILING_WITH_NO_MACHINE,
} from "../../src/services/hosts/permission-ceiling.js";

function setup(): { db: DbConnection; hostId: string } {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    id: "host_permission_ceiling",
    name: "Permission Ceiling Host",
    type: "persistent",
  });
  return { db, hostId: host.id };
}

describe("getHostPermissionCeiling", () => {
  it("reports the sandbox ceiling a newly enrolled machine carries", () => {
    const { db, hostId } = setup();

    expect(getHostPermissionCeiling({ db }, hostId)).toBe(
      DEFAULT_HOST_MAX_PERMISSION_MODE,
    );
  });

  it("reports the ceiling an owner raised", () => {
    const { db, hostId } = setup();
    updateHost(db, noopNotifier, hostId, { maxPermissionMode: "full" });

    expect(getHostPermissionCeiling({ db }, hostId)).toBe("full");
  });

  it("falls back to the sandbox ceiling for a machine with no row", () => {
    const { db } = setup();

    expect(getHostPermissionCeiling({ db }, "host_missing")).toBe(
      DEFAULT_HOST_MAX_PERMISSION_MODE,
    );
  });

  it("has a named answer for no machine instead of answering for one", () => {
    // The lookup used to take a null host id and answer "full": the right answer
    // to a different question, in the wrong shape — a security-relevant lookup
    // that grants everything when its subject is missing. It now takes a
    // machine (the type says so), and the answer for "no machine chosen" is a
    // constant the two callers that mean it name.
    expect(PERMISSION_CEILING_WITH_NO_MACHINE).toBe("full");
  });
});

describe("clampPermissionModeToHost", () => {
  it("lowers a full-access request to the machine's sandbox ceiling", () => {
    const { db, hostId } = setup();

    expect(
      clampPermissionModeToHost(
        { db },
        { hostId, permissionMode: "full", providerId: "codex" },
      ),
    ).toBe("auto");
  });

  it("refuses a provider that cannot run sandboxed at all", () => {
    const { db, hostId } = setup();

    let error: unknown;
    try {
      clampPermissionModeToHost(
        { db },
        { hostId, permissionMode: "full", providerId: "pi" },
      );
    } catch (caught) {
      error = caught;
    }

    expect(isHostPermissionCeilingConflictError(error)).toBe(true);
  });

  it("leaves a mode alone with no machine, which is why work clamps again with one", () => {
    // A thread whose environment was destroyed has no machine — ordinary, not
    // exceptional — and is still asked what mode it runs at. No machine means no
    // machine's limit, so this answer is never the last word: the same machine,
    // named, lowers it, and every set of options the daemon is handed goes
    // through that clamp with a host id that is a string.
    const { db, hostId } = setup();

    expect(
      clampPermissionModeToHost(
        { db },
        { hostId: null, permissionMode: "full", providerId: "codex" },
      ),
    ).toBe("full");
    expect(
      clampPermissionModeToHost(
        { db },
        { hostId, permissionMode: "full", providerId: "codex" },
      ),
    ).toBe("auto");
  });

  it("runs that provider once the owner raises the ceiling", () => {
    const { db, hostId } = setup();
    updateHost(db, noopNotifier, hostId, { maxPermissionMode: "full" });

    expect(
      clampPermissionModeToHost(
        { db },
        { hostId, permissionMode: "full", providerId: "pi" },
      ),
    ).toBe("full");
  });
});
