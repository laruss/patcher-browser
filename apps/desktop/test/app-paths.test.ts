import { describe, expect, it } from "vitest";
import {
  resolveDesktopBridgePath,
  resolveDesktopIconPath,
  type DesktopPathContext,
} from "../src/app-paths.js";

describe("desktop app paths", () => {
  it("resolves the packaged patcher-app bridge beside the active asar", () => {
    const paths: DesktopPathContext = {
      appPath: "/Applications/Patcher.app/Contents/Resources/app.asar",
      isPackaged: true,
      resourcesPath: "/Applications/Patcher.app/Contents/Resources",
    };

    expect(resolveDesktopBridgePath({ paths })).toBe(
      "/Applications/Patcher.app/Contents/Resources/app.asar.unpacked/dist/patcher-app-bridge.mjs",
    );
  });

  it("resolves the universal packaged patcher-app bridge beside the selected arch asar", () => {
    const paths: DesktopPathContext = {
      appPath: "/Applications/Patcher.app/Contents/Resources/app-arm64.asar",
      isPackaged: true,
      resourcesPath: "/Applications/Patcher.app/Contents/Resources",
    };

    expect(resolveDesktopBridgePath({ paths })).toBe(
      "/Applications/Patcher.app/Contents/Resources/app-arm64.asar.unpacked/dist/patcher-app-bridge.mjs",
    );
  });

  it("uses the release-specific icon inside packaged apps", () => {
    const paths: DesktopPathContext = {
      appPath: "/Applications/Patcher Nightly.app/Contents/Resources/app.asar",
      isPackaged: true,
      resourcesPath: "/Applications/Patcher Nightly.app/Contents/Resources",
    };

    expect(
      resolveDesktopIconPath({
        packagedIconFileName: "icon-nightly.png",
        paths,
      }),
    ).toBe(
      "/Applications/Patcher Nightly.app/Contents/Resources/app.asar/assets/icon-nightly.png",
    );
  });

  it("keeps the development icon independent of the release channel", () => {
    const paths: DesktopPathContext = {
      appPath: "/checkout/apps/desktop",
      isPackaged: false,
      resourcesPath: "/checkout/apps/desktop",
    };

    expect(
      resolveDesktopIconPath({
        packagedIconFileName: "icon-nightly.png",
        paths,
      }),
    ).toBe("/checkout/apps/desktop/assets/icon-dev.png");
  });
});
