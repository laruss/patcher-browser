import { describe, expect, it } from "vitest";
import {
  parseStoredPermissionMode,
  serializeStoredPermissionMode,
} from "./persisted-selection-fields";

/**
 * The composer's permission mode is a *stored* preference, so whatever it keeps
 * becomes the starting mode of every later new thread. That makes it the one
 * place where the Full Access confirmation can be told a lie: the picker stops
 * only on the transition to Full Access, so a composer that opened already at
 * "full" would never ask again — and the dialog's own copy promises the
 * opposite ("This applies to this thread… the next one starts from it again").
 */
describe("the composer's stored permission mode", () => {
  it("does not carry Full Access into the next thread", () => {
    expect(parseStoredPermissionMode("full", "")).toBe("");
    expect(serializeStoredPermissionMode("full")).toBe("");
  });

  it("keeps the sandboxed preferences it is for", () => {
    expect(parseStoredPermissionMode("auto", "")).toBe("auto");
    expect(parseStoredPermissionMode("accept-edits", "")).toBe("accept-edits");
    expect(serializeStoredPermissionMode("auto")).toBe("auto");
  });

  it("still migrates the legacy workspace-write preference", () => {
    expect(parseStoredPermissionMode("workspace-write", "")).toBe(
      "accept-edits",
    );
  });

  it("drops a legacy readonly preference rather than widening it", () => {
    expect(parseStoredPermissionMode("readonly", "")).toBe("");
    expect(parseStoredPermissionMode("nonsense", "")).toBe("");
    expect(parseStoredPermissionMode(null, "")).toBe("");
  });
});
