// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PatcherDesktopBrowserApi } from "@patcher/desktop-contract";
import {
  createPatcherDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/patcher-desktop-test-utils";
import {
  createOmniboxHistoryProvider,
  createOmniboxNavigationProvider,
  createOmniboxOpenTabsProvider,
  createOmniboxSearchProvider,
  OMNIBOX_DEBOUNCE_MS,
  type OmniboxProvider,
} from "@/lib/omnibox";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER } from "@patcher/domain/browser-search-engine";
import { BrowserSurfaceChrome } from "./BrowserSurfaceChrome";

/** Named rather than assumed: the provider has no default engine any more. */
const GOOGLE_TEMPLATE = `https://www.google.com/search?q=${BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER}`;

const ACTIVE_TAB_ID = "tab-active";
const CURRENT_URL = "https://current.test/page";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

/**
 * The real built-in providers, so these tests cover the wiring the surface
 * actually uses rather than a stand-in provider.
 */
function builtInProviders(): readonly OmniboxProvider[] {
  return [
    createOmniboxNavigationProvider(),
    createOmniboxSearchProvider({ searchUrlTemplate: GOOGLE_TEMPLATE }),
    createOmniboxOpenTabsProvider({
      activeTabId: ACTIVE_TAB_ID,
      tabs: [
        { id: "tab-docs", title: "Docs — Example", url: "https://docs.test/" },
      ],
    }),
    createOmniboxHistoryProvider({
      search: async () => [
        {
          id: "bhist_docs",
          scopeId: "browser-surface",
          title: "Docs archive",
          url: "https://archive.test/docs",
          visitCount: 1,
          lastVisitedAt: 0,
        },
      ],
    }),
  ];
}

interface RenderChromeResult {
  browser: PatcherDesktopBrowserApi;
  input: HTMLInputElement;
  navigate: ReturnType<typeof vi.fn>;
  onActivateTab: ReturnType<typeof vi.fn>;
  onPageOverlayChange: ReturnType<typeof vi.fn>;
}

function renderChrome(
  url = CURRENT_URL,
  {
    certificateTrustedByUser = false,
  }: { certificateTrustedByUser?: boolean } = {},
): RenderChromeResult {
  const navigate = vi.fn();
  const onActivateTab = vi.fn();
  const onPageOverlayChange = vi.fn();
  const browser = { ...createNoopDesktopBrowserApi(), navigate };
  window.patcherDesktop = createPatcherDesktopApi(desktopInfo, browser);

  // A query client because the site-info panel fetches what plugins know about
  // the site when it opens; the rest of the chrome needs none.
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  render(
    <Wrapper>
      <BrowserSurfaceChrome
        certificateTrustedByUser={certificateTrustedByUser}
        onActivateTab={onActivateTab}
        onOpenAppRoute={() => {}}
        onPageOverlayChange={onPageOverlayChange}
        providers={builtInProviders()}
        tabId={ACTIVE_TAB_ID}
        url={url}
      />
    </Wrapper>,
  );

  return {
    browser,
    input: screen.getByRole("combobox") as HTMLInputElement,
    navigate,
    onActivateTab,
    onPageOverlayChange,
  };
}

/** Type into the omnibox and let the debounce elapse. */
async function typeQuery(input: HTMLInputElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(OMNIBOX_DEBOUNCE_MS);
  });
}

/** jsdom does not implicitly submit a form on Enter, so submit it directly. */
function pressEnter(input: HTMLInputElement) {
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

function optionLabels(): string[] {
  return screen
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

beforeEach(() => {
  vi.useFakeTimers();
  // The site-info panel asks the server what plugins know about the site as soon
  // as it opens. Nothing here asserts on that, but an unstubbed fetch rejects
  // into an unhandled promise.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, sections: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BrowserSurfaceChrome", () => {
  it("shows the current URL and no suggestions at rest", () => {
    const { input } = renderChrome();

    expect(input.value).toBe(CURRENT_URL);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  // The mixed list is the milestone's point: several sources, one ranked list.
  it("mixes search, open-tab and history rows for a query", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs");

    const labels = optionLabels();
    expect(labels).toHaveLength(3);
    expect(labels[0]).toContain("Search");
    expect(labels[0]).toContain("docs");
    expect(labels[1]).toContain("Tab");
    expect(labels[1]).toContain("Docs — Example");
    expect(labels[2]).toContain("History");
    expect(labels[2]).toContain("Docs archive");
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("offers the address itself first for address-like input", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs.test");

    expect(optionLabels()[0]).toContain("https://docs.test");
  });

  it("waits for the debounce before running providers", async () => {
    const { input } = renderChrome();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "docs" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OMNIBOX_DEBOUNCE_MS - 1);
    });

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  // Enter must not depend on whether suggestions have arrived yet — that is why
  // the default action is resolved from the text, not from the list.
  it("searches the typed text on Enter before any suggestion arrives", () => {
    const { input, navigate } = renderChrome();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "best headphones" } });
    pressEnter(input);

    expect(navigate).toHaveBeenCalledWith({
      tabId: ACTIVE_TAB_ID,
      url: "https://www.google.com/search?q=best%20headphones",
    });
  });

  it("navigates to a typed address on Enter", () => {
    const { input, navigate } = renderChrome();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "example.com/x" } });
    pressEnter(input);

    expect(navigate).toHaveBeenCalledWith({
      tabId: ACTIVE_TAB_ID,
      url: "https://example.com/x",
    });
  });

  it("runs the highlighted row instead of the default action", async () => {
    const { input, navigate, onActivateTab } = renderChrome();

    await typeQuery(input, "docs");
    // Row 0 is the search default; row 1 is the open tab.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      "browser-omnibox-option-1",
    );

    pressEnter(input);

    expect(onActivateTab).toHaveBeenCalledWith("tab-docs");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates to a clicked history row", async () => {
    const { input, navigate } = renderChrome();

    await typeQuery(input, "docs");
    fireEvent.click(screen.getAllByRole("option")[2]);

    expect(navigate).toHaveBeenCalledWith({
      tabId: ACTIVE_TAB_ID,
      url: "https://archive.test/docs",
    });
  });

  // A tab with no page has nothing to read and one thing to do. Chrome focuses
  // its omnibox on the new-tab page too, and for the same reason.
  it("takes focus on a tab with no page, and leaves a loaded one alone", () => {
    const empty = renderChrome("");
    expect(document.activeElement).toBe(empty.input);

    cleanup();

    const loaded = renderChrome();
    expect(document.activeElement).not.toBe(loaded.input);
  });

  // The list belongs to the address bar, not to the window: it shares the input's
  // column so it cannot be wider than the control being typed into.
  it("puts the suggestion list in the address bar's own column", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs");

    const listbox = screen.getByRole("listbox");
    const column = input.closest("form")?.parentElement;
    expect(column).not.toBeNull();
    expect(column?.contains(listbox)).toBe(true);
    // And the column is not the whole chrome: the toolbar's buttons sit outside
    // it, which is what keeps the list narrower than the window.
    expect(
      column?.contains(screen.getByRole("button", { name: "Go back" })),
    ).toBe(false);
  });

  it("closes the list and restores the URL on Escape", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs");
    expect(screen.queryByRole("listbox")).not.toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.value).toBe(CURRENT_URL);
  });

  it("closes the list on blur", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs");
    fireEvent.blur(input);

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("empties the list when the query is cleared", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs");
    await typeQuery(input, "");

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  // The padlock's name is the claim it makes, and it used to make one the
  // browser could not back: `https` in the address bar said "secure" even for a
  // certificate Chromium had refused.
  it("names the connection on the padlock rather than promising security", () => {
    renderChrome();

    expect(screen.getByLabelText("Connection is encrypted")).not.toBeNull();

    cleanup();
    renderChrome("https://dev.box.test/", { certificateTrustedByUser: true });

    expect(screen.getByLabelText("Certificate is not trusted")).not.toBeNull();
    expect(screen.queryByLabelText("Connection is encrypted")).toBeNull();
  });

  // A page served from this machine has no network to be insecure on, and the
  // old glyph warned about Patcher's own pages.
  it("does not warn about a loopback page", () => {
    renderChrome("http://localhost:5173/");

    expect(screen.getByLabelText("Page from this machine")).not.toBeNull();
  });

  // The panel hangs over the page area, which is a native view compositing above
  // the DOM — so opening it has to freeze the page or it draws behind it. Asked
  // for rather than done here: the surface owns the one call that freezes.
  it("asks for the page to be frozen while the site panel is open", () => {
    const { onPageOverlayChange } = renderChrome();
    onPageOverlayChange.mockClear();

    fireEvent.click(screen.getByLabelText("Connection is encrypted"));

    expect(onPageOverlayChange).toHaveBeenLastCalledWith(true);
  });

  it("enables back and forward from the native view's own state", () => {
    const listeners: ((state: unknown) => void)[] = [];
    const browser: PatcherDesktopBrowserApi = {
      ...createNoopDesktopBrowserApi(),
      onState(listener) {
        listeners.push(listener as (state: unknown) => void);
        return () => {};
      },
    };
    window.patcherDesktop = createPatcherDesktopApi(desktopInfo, browser);
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    render(
      <Wrapper>
        <BrowserSurfaceChrome
          onActivateTab={() => {}}
          onOpenAppRoute={() => {}}
          onPageOverlayChange={() => {}}
          providers={builtInProviders()}
          tabId={ACTIVE_TAB_ID}
          url={CURRENT_URL}
        />
      </Wrapper>,
    );

    expect(
      screen.getByRole("button", { name: "Go back" }).hasAttribute("disabled"),
    ).toBe(true);

    act(() => {
      for (const listener of listeners) {
        listener({
          canGoBack: true,
          canGoForward: false,
          errorText: null,
          isLoading: true,
          tabId: ACTIVE_TAB_ID,
          title: null,
          url: CURRENT_URL,
        });
      }
    });

    expect(
      screen.getByRole("button", { name: "Go back" }).hasAttribute("disabled"),
    ).toBe(false);
    // Loading turns the reload control into a stop control.
    expect(screen.getByRole("button", { name: "Stop loading" })).toBeTruthy();
  });

  it("ignores state pushed for another tab", () => {
    const listeners: ((state: unknown) => void)[] = [];
    window.patcherDesktop = createPatcherDesktopApi(desktopInfo, {
      ...createNoopDesktopBrowserApi(),
      onState(listener) {
        listeners.push(listener as (state: unknown) => void);
        return () => {};
      },
    });
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    render(
      <Wrapper>
        <BrowserSurfaceChrome
          onActivateTab={() => {}}
          onOpenAppRoute={() => {}}
          onPageOverlayChange={() => {}}
          providers={builtInProviders()}
          tabId={ACTIVE_TAB_ID}
          url={CURRENT_URL}
        />
      </Wrapper>,
    );

    act(() => {
      for (const listener of listeners) {
        listener({
          canGoBack: true,
          canGoForward: true,
          errorText: null,
          isLoading: false,
          tabId: "some-other-tab",
          title: null,
          url: "https://other.test/",
        });
      }
    });

    expect(
      screen.getByRole("button", { name: "Go back" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
