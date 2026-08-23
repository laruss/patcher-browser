import { readFile } from "node:fs/promises";
import { PLUGIN_SDK_VERSION } from "@patcher/domain";
import { describe, expect, it } from "vitest";

describe("plugin SDK compatibility version", () => {
  it("keeps the package version aligned with the canonical compatibility version", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(packageJson.version).toBe(PLUGIN_SDK_VERSION);
    // Past 0.x on purpose. The artifact gate compares majors and was vacuous
    // while the major was 0; see plugin-sdk-version.ts.
    expect(PLUGIN_SDK_VERSION).toMatch(/^[1-9]\d*\.\d+\.\d+$/u);
  });
});
