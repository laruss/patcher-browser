import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspaceSandboxAvailability } from "../session-options.js";

/**
 * Whether a machine can build the sandbox the workspace modes promise.
 *
 * The Linux answer used to come from PATH alone, and the PATH a daemon resolves
 * from a login shell can be almost empty — a systemd unit with nothing inherited
 * gets little more than Patcher's own bin directory. That reported "no
 * bubblewrap" on hosts that had it, and refused every sandboxed turn.
 */

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createHelper(name = "bwrap"): string {
  const dir = mkdtempSync(join(tmpdir(), "patcher-sandbox-helper-"));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
}

describe("resolveWorkspaceSandboxAvailability", () => {
  it("composes a sandbox on macOS with nothing to find", () => {
    expect(
      resolveWorkspaceSandboxAvailability({ env: {}, platform: "darwin" }),
    ).toEqual({ available: true });
  });

  it("finds the Linux helper on PATH", () => {
    const helper = createHelper();

    expect(
      resolveWorkspaceSandboxAvailability({
        env: { PATH: helper.slice(0, helper.lastIndexOf("/")) },
        platform: "linux",
      }),
    ).toEqual({ available: true });
  });

  it("finds the Linux helper at a distribution path when PATH does not say", () => {
    // The case the PATH-only probe got wrong.
    const helper = createHelper();

    expect(
      resolveWorkspaceSandboxAvailability({
        env: { PATH: "/nonexistent-patcher-probe" },
        platform: "linux",
        wellKnownHelperPaths: [helper],
      }),
    ).toEqual({ available: true });
  });

  it("refuses when the helper is nowhere", () => {
    const result = resolveWorkspaceSandboxAvailability({
      env: { PATH: "/nonexistent-patcher-probe" },
      platform: "linux",
      wellKnownHelperPaths: ["/nonexistent-patcher-probe/bwrap"],
    });

    expect(result.available).toBe(false);
    if (result.available) throw new Error("expected a refusal");
    expect(result.reason).toContain("bubblewrap");
    expect(result.remedy).toContain("install bubblewrap");
  });

  it("refuses a platform with no sandbox backend", () => {
    const result = resolveWorkspaceSandboxAvailability({
      env: {},
      platform: "win32",
    });

    expect(result.available).toBe(false);
    if (result.available) throw new Error("expected a refusal");
    expect(result.reason).toContain("win32");
  });

  it("does not accept a directory as the helper", () => {
    // X_OK alone passes for a searchable directory, which is why the lookup
    // requires a regular file.
    const dir = mkdtempSync(join(tmpdir(), "patcher-sandbox-helper-dir-"));
    tempDirs.push(dir);

    const result = resolveWorkspaceSandboxAvailability({
      env: { PATH: "/nonexistent-patcher-probe" },
      platform: "linux",
      wellKnownHelperPaths: [dir],
    });

    expect(result.available).toBe(false);
  });
});
