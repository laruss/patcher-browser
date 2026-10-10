import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: {}, systemPreferences: {} }));
import { readEffectiveWebAuthnEntitlements } from "../src/native-webauthn.js";

it.runIf(process.platform === "darwin")(
  "parses real codesign entitlements as XML rather than its abstract display format",
  async () => {
    const root = await mkdtemp(
      join(tmpdir(), "patcher-webauthn-entitlements-"),
    );
    try {
      // A copied, ad-hoc test binary checks extraction only, never Keychain access.
      const binary = join(root, "fixture");
      const plist = join(root, "entitlements.plist");
      const group = "TEAMID1234.app.patcher.desktop.webauthn";
      await copyFile("/usr/bin/true", binary);
      await writeFile(
        plist,
        `<?xml version="1.0"?><plist version="1.0"><dict><key>keychain-access-groups</key><array><string>${group}</string></array></dict></plist>`,
      );
      execFileSync(
        "/usr/bin/codesign",
        ["--force", "--sign", "-", "--entitlements", plist, binary],
        { stdio: "ignore", timeout: 5_000 },
      );
      expect(await readEffectiveWebAuthnEntitlements(binary)).toEqual({
        "keychain-access-groups": [group],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
