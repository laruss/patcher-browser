import { describe, expect, it } from "vitest";
import {
  patcherDesktopInfoSchema,
  patcherDesktopThemeSchema,
  patcherDesktopVersionFeedSchema,
  patcherDesktopWindowStateSchema,
} from "../src/index.js";

const checkedAt = "2026-05-21T00:00:00.000Z";

describe("desktop info schema", () => {
  it("accepts the desktop update info payload", () => {
    expect(
      patcherDesktopInfoSchema.safeParse({
        lastCheckedAt: checkedAt,
        latestVersion: "0.0.2",
        pendingVersion: null,
        platform: "macos",
        updateAvailable: true,
        updateDownloaded: false,
        version: "0.0.1",
      }).success,
    ).toBe(true);
  });

  it("accepts the desktop theme values", () => {
    expect(patcherDesktopThemeSchema.safeParse("dark").success).toBe(true);
    expect(patcherDesktopThemeSchema.safeParse("light").success).toBe(true);
    expect(patcherDesktopThemeSchema.safeParse("system").success).toBe(true);
    expect(
      patcherDesktopThemeSchema.safeParse({
        canvasColor: "oklch(0.195 0 0)",
        inkColor: "oklch(0.81 0 0)",
        mode: "dark",
      }).success,
    ).toBe(false);
  });

  it("accepts strict desktop window state payloads", () => {
    expect(
      patcherDesktopWindowStateSchema.safeParse({ isFullScreen: true }).success,
    ).toBe(true);
    expect(
      patcherDesktopWindowStateSchema.safeParse({
        isFullScreen: true,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("desktop version feed schema", () => {
  it("accepts a valid desktop-version.json payload", () => {
    expect(
      patcherDesktopVersionFeedSchema.safeParse({
        channel: "latest",
        files: [
          {
            sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
            size: 123456789,
            url: "Patcher-0.0.2-universal.zip",
          },
        ],
        minimumSystemVersion: null,
        path: "Patcher-0.0.2-universal.zip",
        platform: "macos",
        releaseDate: checkedAt,
        releaseName: "Patcher desktop 0.0.2",
        releaseNotes: null,
        schemaVersion: 1,
        sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
        stagingPercentage: null,
        version: "0.0.2",
      }).success,
    ).toBe(true);
  });

  it("accepts the isolated nightly desktop channel", () => {
    expect(
      patcherDesktopVersionFeedSchema.safeParse({
        channel: "nightly",
        files: [
          {
            sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
            size: 123456789,
            url: "Patcher-Nightly-0.0.2-nightly.1.1-arm64.zip",
          },
        ],
        minimumSystemVersion: null,
        path: "Patcher-Nightly-0.0.2-nightly.1.1-arm64.zip",
        platform: "macos",
        releaseDate: checkedAt,
        releaseName: "Patcher Nightly desktop 0.0.2-nightly.1.1",
        releaseNotes: null,
        schemaVersion: 1,
        sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
        stagingPercentage: null,
        version: "0.0.2-nightly.1.1",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed version feed payloads", () => {
    expect(
      patcherDesktopVersionFeedSchema.safeParse({
        channel: "latest",
        files: [],
        minimumSystemVersion: null,
        path: "Patcher-0.0.2-universal.zip",
        platform: "macos",
        releaseDate: checkedAt,
        releaseName: "Patcher desktop 0.0.2",
        releaseNotes: null,
        schemaVersion: 1,
        sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
        stagingPercentage: null,
        version: "0.0.2",
      }).success,
    ).toBe(false);
  });
});
