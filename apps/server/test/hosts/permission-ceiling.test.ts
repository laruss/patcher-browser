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

  it("keeps every mode available before a machine is chosen", () => {
    const { db } = setup();

    expect(getHostPermissionCeiling({ db }, null)).toBe("full");
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
