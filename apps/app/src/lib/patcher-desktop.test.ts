import { describe, expect, it } from "vitest";
import type { PatcherDesktopInfo } from "@patcher/desktop-contract";
import { createPatcherDesktopApi } from "@/test/patcher-desktop-test-utils";
import {
  MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
  SIDEBAR_TRIGGER_TRAILING_INSET_CLASS,
  SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS,
  shouldReserveMacosTrafficLights,
} from "./patcher-desktop";

const desktopInfo: PatcherDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

/** The pixel count out of an arbitrary-value Tailwind class. */
function px(className: string): number {
  const match = /\[(\d+)px\]/.exec(className);
  if (match === null) {
    throw new Error(`no px token in "${className}"`);
  }
  return Number(match[1]);
}

describe("desktop chrome geometry", () => {
  it("reserves macOS traffic-light space only when lights are visible", () => {
    const desktopApi = createPatcherDesktopApi(desktopInfo);

    expect(
      shouldReserveMacosTrafficLights({
        desktopInfo: desktopApi,
        windowState: { isFullScreen: false },
      }),
    ).toBe(true);
    expect(
      shouldReserveMacosTrafficLights({
        desktopInfo: desktopApi,
        windowState: { isFullScreen: true },
      }),
    ).toBe(false);
    expect(
      shouldReserveMacosTrafficLights({
        desktopInfo: null,
        windowState: { isFullScreen: false },
      }),
    ).toBe(false);
  });

  // Both reserves are px geometry, not typography, and a silent drift in either
  // reintroduces BB-46's overlap — content sitting under pinned window chrome.
  // So lock both targets.
  //
  // Each is the WHOLE distance from the window edge, never a surface's inset
  // plus a remainder: a reserve replaces one side of the `px-*` on the element
  // it rides. Asserting a sum here is what let both tokens ship 16px short —
  // tabs under the traffic lights at one end, the new-tab button under the
  // sidebar trigger at the other.
  it("lands the leading reserve just past the traffic lights", () => {
    // Where the traffic-light strip ends: leading content must clear it. The
    // pinned trigger is no longer here — it moved to the trailing edge — so the
    // target is the lights alone.
    const TARGET = px(MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS); // 84

    expect(px(MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS)).toBe(TARGET);
  });

  it("lands the trailing reserve just past the pinned sidebar trigger", () => {
    const TRIGGER_INSET = px(SIDEBAR_TRIGGER_TRAILING_INSET_CLASS); // 12
    const TRIGGER_BUTTON = 28;
    const TRIGGER_GAP = 8;
    const TARGET = TRIGGER_INSET + TRIGGER_BUTTON + TRIGGER_GAP; // 48

    expect(px(SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS)).toBe(TARGET);
  });
});
