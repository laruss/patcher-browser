// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PatcherDesktopBrowserApi,
  PatcherDesktopBrowserFindRequest,
  PatcherDesktopBrowserFindResult,
  PatcherDesktopBrowserFindResultHandler,
} from "@patcher/desktop-contract";
import {
  createPatcherDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/patcher-desktop-test-utils";
import { describeBrowserFindMatches, useBrowserFind } from "./browser-find";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

interface FindHarness {
  /** Every command the bar sent, in order. */
  commands: PatcherDesktopBrowserFindRequest[];
  /** Push a count the way the shell does. */
  pushResult: (result: PatcherDesktopBrowserFindResult) => void;
}

function installDesktopBrowser(
  overrides: Partial<PatcherDesktopBrowserApi> = {},
): FindHarness {
  const commands: PatcherDesktopBrowserFindRequest[] = [];
  const listeners = new Set<PatcherDesktopBrowserFindResultHandler>();
  const browser: PatcherDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    find(request) {
      commands.push(request);
    },
    onFindResult(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ...overrides,
  };
  window.patcherDesktop = createPatcherDesktopApi(desktopInfo, browser);
  return {
    commands,
    pushResult(result) {
      act(() => {
        for (const listener of listeners) {
          listener(result);
        }
      });
    },
  };
}

function renderFind(
  tabId: string | null = "browser:a",
  url = "https://a.test/",
) {
  return renderHook(
    ({ tab, page }: { tab: string | null; page: string }) =>
      useBrowserFind({ tabId: tab, url: page }),
    { initialProps: { tab: tabId, page: url } },
  );
}

afterEach(() => {
  cleanup();
  delete window.patcherDesktop;
});

describe("describeBrowserFindMatches", () => {
  it("says nothing until something has been counted", () => {
    expect(describeBrowserFindMatches(null)).toBe("");
  });

  it("reads as a position out of a total, or as no results", () => {
    expect(
      describeBrowserFindMatches({ activeMatchOrdinal: 3, matches: 12 }),
    ).toBe("3/12");
    expect(
      describeBrowserFindMatches({ activeMatchOrdinal: 0, matches: 0 }),
    ).toBe("No results");
  });
});

describe("useBrowserFind", () => {
  it("searches as the user types", () => {
    const harness = installDesktopBrowser();
    const view = renderFind();

    act(() => {
      view.result.current.open();
    });
    act(() => {
      view.result.current.search("nee");
    });
    act(() => {
      view.result.current.search("needle");
    });

    expect(view.result.current.isOpen).toBe(true);
    expect(harness.commands).toEqual([
      { tabId: "browser:a", action: "start", query: "nee" },
      { tabId: "browser:a", action: "start", query: "needle" },
    ]);
  });

  it("shows the count the shell pushes for this tab, and no other", () => {
    const harness = installDesktopBrowser();
    const view = renderFind();
    act(() => {
      view.result.current.search("needle");
    });

    harness.pushResult({
      tabId: "browser:other",
      activeMatchOrdinal: 9,
      matches: 9,
      finalUpdate: true,
    });
    expect(view.result.current.matches).toBeNull();

    harness.pushResult({
      tabId: "browser:a",
      activeMatchOrdinal: 1,
      matches: 4,
      finalUpdate: true,
    });

    expect(view.result.current.matches).toEqual({
      activeMatchOrdinal: 1,
      matches: 4,
    });
  });

  it("steps forward and back through the running query", () => {
    const harness = installDesktopBrowser();
    const view = renderFind();
    act(() => {
      view.result.current.search("needle");
    });

    act(() => {
      view.result.current.step(1);
    });
    act(() => {
      view.result.current.step(-1);
    });

    expect(harness.commands.slice(1)).toEqual([
      { tabId: "browser:a", action: "next", query: "needle" },
      { tabId: "browser:a", action: "previous", query: "needle" },
    ]);
  });

  it("does not step with an empty bar", () => {
    const harness = installDesktopBrowser();
    const view = renderFind();

    act(() => {
      view.result.current.step(1);
    });

    expect(harness.commands).toEqual([]);
  });

  // Closing has to reach the shell: the highlights are Chromium's, and nothing
  // in the DOM can clear them.
  it("ends the session on close and drops the count", () => {
    const harness = installDesktopBrowser();
    const view = renderFind();
    act(() => {
      view.result.current.open();
    });
    act(() => {
      view.result.current.search("needle");
    });
    harness.pushResult({
      tabId: "browser:a",
      activeMatchOrdinal: 1,
      matches: 4,
      finalUpdate: true,
    });

    act(() => {
      view.result.current.close();
    });

    expect(view.result.current.isOpen).toBe(false);
    expect(view.result.current.matches).toBeNull();
    expect(harness.commands.at(-1)).toEqual({
      tabId: "browser:a",
      action: "stop",
      query: "",
    });
  });

  // Reopening keeps the query — that is what makes the shortcut a "search
  // again" — so the count has to be right before anything is typed.
  it("re-runs the last query when it opens again", () => {
    const harness = installDesktopBrowser();
    const view = renderFind();
    act(() => {
      view.result.current.open();
    });
    act(() => {
      view.result.current.search("needle");
    });
    act(() => {
      view.result.current.close();
    });

    act(() => {
      view.result.current.open();
    });

    expect(view.result.current.query).toBe("needle");
    expect(harness.commands.at(-1)).toEqual({
      tabId: "browser:a",
      action: "start",
      query: "needle",
    });
  });

  it("bumps the focus token on every open", () => {
    installDesktopBrowser();
    const view = renderFind();

    act(() => {
      view.result.current.open();
    });
    const first = view.result.current.focusToken;
    act(() => {
      view.result.current.open();
    });

    expect(view.result.current.focusToken).toBe(first + 1);
  });

  // The bar belongs to the tab it was opened over.
  it("closes and stops the old tab's session when the tab changes", () => {
    const harness = installDesktopBrowser();
    const view = renderFind();
    act(() => {
      view.result.current.open();
    });
    act(() => {
      view.result.current.search("needle");
    });

    view.rerender({ tab: "browser:b", page: "https://b.test/" });

    expect(view.result.current.isOpen).toBe(false);
    expect(harness.commands.at(-1)).toEqual({
      tabId: "browser:a",
      action: "stop",
      query: "",
    });
  });

  // A count belongs to the page it was taken on.
  it("drops the count when the page navigates", () => {
    const harness = installDesktopBrowser();
    const view = renderFind();
    act(() => {
      view.result.current.search("needle");
    });
    harness.pushResult({
      tabId: "browser:a",
      activeMatchOrdinal: 1,
      matches: 4,
      finalUpdate: true,
    });

    view.rerender({ tab: "browser:a", page: "https://a.test/next" });

    expect(view.result.current.matches).toBeNull();
  });

  // An older shell has no find channel, so the shortcut has to fall through
  // rather than open a bar that could never search anything.
  it("refuses to open against a shell that cannot find", () => {
    installDesktopBrowser({ find: undefined, onFindResult: undefined });
    const view = renderFind();

    let opened = true;
    act(() => {
      opened = view.result.current.open();
    });

    expect(opened).toBe(false);
    expect(view.result.current.isOpen).toBe(false);
  });
});
