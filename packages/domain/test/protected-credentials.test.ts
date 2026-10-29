import { describe, expect, it } from "vitest";
import { credentialRequestArgsSchema } from "../src/protected-credentials.js";
import { pluginPatcherManifestSchema } from "../src/plugin-manifest.js";
describe("credential API authority", () => {
  it("accepts only an inert bounded proposal", () => {
    const request = { operation: "save", tabId: "tab", accountId: "primary" };
    expect(credentialRequestArgsSchema.safeParse(request).success).toBe(true);
    for (const field of [
      "password",
      "approved",
      "owner",
      "selector",
      "originOverride",
    ])
      expect(
        credentialRequestArgsSchema.safeParse({ ...request, [field]: true })
          .success,
      ).toBe(false);
    expect(
      credentialRequestArgsSchema.safeParse({ ...request, accountId: "" })
        .success,
    ).toBe(false);
  });
  it("requires a separate runtime permission declaration", () => {
    const manifest = {
      name: "Fixture",
      description: "Fixture",
      branding: { icon: "key" },
      server: "server.ts",
      permissions: ["credentials.manage"],
    };
    expect(pluginPatcherManifestSchema.safeParse(manifest).success).toBe(false);
    expect(
      pluginPatcherManifestSchema.safeParse({
        ...manifest,
        siteAccess: "runtime",
      }).success,
    ).toBe(true);
  });
});
