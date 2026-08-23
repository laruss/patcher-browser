import { describe, expect, it } from "vitest";
import { patcherDesktopInfoSchema } from "../src/info.js";

const baseInfo = {
  lastCheckedAt: null,
  latestVersion: "0.0.32",
  pendingVersion: null,
  platform: "macos",
  updateAvailable: true,
  updateDownloaded: false,
  version: "0.0.31",
} as const;

describe("patcherDesktopInfoSchema", () => {
  it("accepts both explicit download state and legacy shell payloads", () => {
    expect(
      patcherDesktopInfoSchema.safeParse({
        ...baseInfo,
        downloadState: "downloading",
      }).success,
    ).toBe(true);
    expect(patcherDesktopInfoSchema.safeParse(baseInfo).success).toBe(true);
  });

  it("rejects an unknown download state", () => {
    expect(
      patcherDesktopInfoSchema.safeParse({
        ...baseInfo,
        downloadState: "available",
      }).success,
    ).toBe(false);
  });
});
