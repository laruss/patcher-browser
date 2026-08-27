import { describe, expect, it } from "vitest";
import { resolvePermissionMode } from "./provider-permissions.js";
import type { PermissionMode } from "./rpc-types.js";

/**
 * An automation runs on a schedule with nobody watching, so the mode it gets
 * when nobody stated one is the longest-lived permission decision in the
 * product. It must resolve toward the sandbox.
 */

interface FakeProvider {
  id: string;
  available?: boolean;
  supportedPermissionModes: PermissionMode[];
}

function fakeApi(providers: FakeProvider[]) {
  return {
    sdk: {
      providers: {
        list: async () =>
          providers.map((provider) => ({
            id: provider.id,
            available: provider.available ?? true,
            capabilities: {
              supportedPermissionModes: provider.supportedPermissionModes,
            },
          })),
      },
    },
  } as unknown as Parameters<typeof resolvePermissionMode>[0];
}

describe("resolvePermissionMode", () => {
  it("prefers the automatic reviewer when the provider has one", async () => {
    const api = fakeApi([
      {
        id: "codex",
        supportedPermissionModes: ["accept-edits", "auto", "full"],
      },
    ]);

    expect(await resolvePermissionMode(api, "codex")).toBe("auto");
  });

  it("keeps the sandbox for a provider with no automatic reviewer", async () => {
    // Cursor advertises accept-edits/full. Preferring "full" here handed every
    // unattended run of it the whole machine.
    const api = fakeApi([
      { id: "acp-cursor", supportedPermissionModes: ["accept-edits", "full"] },
    ]);

    expect(await resolvePermissionMode(api, "acp-cursor")).toBe("accept-edits");
  });

  it("uses Full Access only for a provider that offers nothing else", async () => {
    const api = fakeApi([{ id: "pi", supportedPermissionModes: ["full"] }]);

    expect(await resolvePermissionMode(api, "pi")).toBe("full");
  });

  it("honours a mode the caller stated", async () => {
    const api = fakeApi([
      {
        id: "codex",
        supportedPermissionModes: ["accept-edits", "auto", "full"],
      },
    ]);

    expect(await resolvePermissionMode(api, "codex", "accept-edits")).toBe(
      "accept-edits",
    );
  });

  it("refuses a stated mode the provider does not support", async () => {
    const api = fakeApi([{ id: "pi", supportedPermissionModes: ["full"] }]);

    await expect(resolvePermissionMode(api, "pi", "auto")).rejects.toThrow(
      /not supported by provider pi/,
    );
  });

  it("refuses a provider that is not available", async () => {
    const api = fakeApi([
      { id: "codex", available: false, supportedPermissionModes: ["auto"] },
    ]);

    await expect(resolvePermissionMode(api, "codex")).rejects.toThrow(
      /is not available/,
    );
  });
});
