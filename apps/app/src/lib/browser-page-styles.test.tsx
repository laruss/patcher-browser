// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PATCHER_DESKTOP_BROWSER_MAX_PAGE_STYLES,
  type PatcherDesktopBrowserApi,
  type PatcherDesktopBrowserPageStyles,
} from "@patcher/desktop-contract";
import {
  createPatcherDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/patcher-desktop-test-utils";
import type { PluginBrowserPageStyleContribution } from "@/hooks/queries/plugin-contribution-queries";
import { useBrowserPageStyles } from "./browser-page-styles";

const contributions = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("@/hooks/queries/plugin-contribution-queries", () => ({
  usePluginContributions: () => ({ data: contributions.value }),
}));

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

const STYLE: PluginBrowserPageStyleContribution = {
  pluginId: "declutter",
  styleId: "feed",
  matches: ["https://github.com/**"],
  css: ".feed { display: none }",
};

function installShell(
  overrides: Partial<PatcherDesktopBrowserApi> = {},
): PatcherDesktopBrowserPageStyles[] {
  const pushes: PatcherDesktopBrowserPageStyles[] = [];
  window.patcherDesktop = createPatcherDesktopApi(desktopInfo, {
    ...createNoopDesktopBrowserApi(),
    setPageStyles(request) {
      pushes.push(request);
    },
    ...overrides,
  });
  return pushes;
}

afterEach(() => {
  cleanup();
  contributions.value = undefined;
  delete window.patcherDesktop;
});

describe("useBrowserPageStyles", () => {
  it("hands the declared styles to the shell", async () => {
    contributions.value = { browserPageStyles: [STYLE] };
    const pushes = installShell();

    renderHook(() => useBrowserPageStyles());

    await waitFor(() => {
      expect(pushes).toEqual([{ styles: [STYLE] }]);
    });
  });

  // The shell replaces what it holds, so "nothing declared" has to be sent as an
  // empty list: leaving it unsaid would leave a removed plugin's css on the page.
  it("pushes an empty list when nothing is declared", async () => {
    contributions.value = { browserPageStyles: [] };
    const pushes = installShell();

    renderHook(() => useBrowserPageStyles());

    await waitFor(() => {
      expect(pushes).toEqual([{ styles: [] }]);
    });
  });

  // "Not answered yet" is not "nothing declared": pushing an empty list while the
  // query loads would strip the stylesheets off the pages the user has open and
  // put them back a moment later — a flash on every window reload.
  it("says nothing while the contributions are still loading", () => {
    contributions.value = undefined;
    const pushes = installShell();

    renderHook(() => useBrowserPageStyles());

    expect(pushes).toEqual([]);
  });

  // Over the shell's cap the whole push is dropped by its parser and the list it
  // already holds stays, so one plugin declaring too many would leave every
  // plugin's styles stale.
  it("pushes no more styles than the shell will accept", async () => {
    contributions.value = {
      browserPageStyles: Array.from(
        { length: PATCHER_DESKTOP_BROWSER_MAX_PAGE_STYLES + 5 },
        (_unused, index) => ({ ...STYLE, styleId: `feed-${index}` }),
      ),
    };
    const pushes = installShell();

    renderHook(() => useBrowserPageStyles());

    await waitFor(() => {
      expect(pushes[0]?.styles).toHaveLength(
        PATCHER_DESKTOP_BROWSER_MAX_PAGE_STYLES,
      );
    });
  });

  it("says nothing to a shell that has no such channel", () => {
    contributions.value = { browserPageStyles: [STYLE] };
    // No `setPageStyles`: an older shell, whose strict parser would drop the
    // payload anyway.
    window.patcherDesktop = createPatcherDesktopApi(
      desktopInfo,
      createNoopDesktopBrowserApi(),
    );

    expect(() => renderHook(() => useBrowserPageStyles())).not.toThrow();
  });

  it("says nothing on the web build, where there is no shell", () => {
    contributions.value = { browserPageStyles: [STYLE] };

    expect(() => renderHook(() => useBrowserPageStyles())).not.toThrow();
  });
});
