// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPatcherDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/patcher-desktop-test-utils";
import type { PluginOmniboxSuggestGroup } from "@/hooks/queries/plugin-contribution-queries";
import {
  createOmniboxNavigationProvider,
  createOmniboxPluginProviders,
  createOmniboxSearchProvider,
  createPluginOmniboxSuggestionSource,
  OMNIBOX_DEBOUNCE_MS,
} from "@/lib/omnibox";
import { BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER } from "@patcher/domain/browser-search-engine";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowserSurfaceChrome } from "./BrowserSurfaceChrome";

/** Named rather than assumed: the provider has no default engine any more. */
const GOOGLE_TEMPLATE = `https://www.google.com/search?q=${BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER}`;

// The end of the Milestone C chain: a plugin's rows reach the same ranked list
// as the browser's own, and picking one calls the plugin back.

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

const PLUGIN_GROUP: PluginOmniboxSuggestGroup = {
  items: [
    {
      action: { type: "run" },
      itemId: "agent:ask",
      score: 0.8,
      subtitle: "spawns a Patcher thread",
      title: "Ask an agent",
    },
  ],
  label: "Agent",
  pluginId: "omnibox-agent",
  providerId: "agent",
};

interface FetchCall {
  body: unknown;
  url: string;
}

/** Serves the plugin suggest endpoint, and records the run POST. */
function stubPluginEndpoints(): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({
        body: init?.body === undefined ? null : JSON.parse(init.body),
        url,
      });
      if (url.startsWith("/api/v1/plugins/omnibox/run")) {
        return {
          json: async () => ({ navigate: "https://ran.test/", ok: true }),
          ok: true,
        };
      }
      return {
        json: async () => ({ groups: [PLUGIN_GROUP], ok: true }),
        ok: true,
      };
    }),
  );
  return calls;
}

function renderChrome() {
  const navigate = vi.fn();
  window.patcherDesktop = createPatcherDesktopApi(desktopInfo, {
    ...createNoopDesktopBrowserApi(),
    navigate,
  });
  // The chrome reads the chosen search engine from the query cache, so it needs a
  // client — the app has one at the root.
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  render(
    <Wrapper>
      <BrowserSurfaceChrome
        onActivateTab={() => {}}
        onOpenAppRoute={() => {}}
        onPageOverlayChange={() => {}}
        providers={[
          createOmniboxNavigationProvider(),
          createOmniboxSearchProvider({ searchUrlTemplate: GOOGLE_TEMPLATE }),
          // Plugins come last, so they lose score ties to the built-ins.
          ...createOmniboxPluginProviders({
            contributions: [
              { id: "agent", label: "Agent", pluginId: "omnibox-agent" },
            ],
            source: createPluginOmniboxSuggestionSource(),
          }),
        ]}
        tabId={ACTIVE_TAB_ID}
        url={CURRENT_URL}
      />
    </Wrapper>,
  );
  return { input: screen.getByRole("combobox") as HTMLInputElement, navigate };
}

async function typeQuery(input: HTMLInputElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(OMNIBOX_DEBOUNCE_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("BrowserSurfaceChrome with a plugin provider", () => {
  it("shows plugin rows under the browser's own, labelled with their source", async () => {
    stubPluginEndpoints();
    const { input } = renderChrome();

    await typeQuery(input, "flaky tests");

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    // The default action keeps the top row; the plugin row sits under it.
    expect(options[0]?.textContent).toContain("Search");
    expect(options[1]?.textContent).toContain("Agent");
    expect(options[1]?.textContent).toContain("Ask an agent");
  });

  it("calls the plugin back with the query and opens the url it returns", async () => {
    const calls = stubPluginEndpoints();
    const { input, navigate } = renderChrome();

    await typeQuery(input, "flaky tests");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[1]!);
    });

    expect(calls.at(-1)).toEqual({
      body: {
        itemId: "agent:ask",
        pluginId: "omnibox-agent",
        query: "flaky tests",
      },
      url: "/api/v1/plugins/omnibox/run",
    });
    expect(navigate).toHaveBeenCalledWith({
      tabId: ACTIVE_TAB_ID,
      url: "https://ran.test/",
    });
  });

  // A plugin that cannot answer must not take the omnibox down with it.
  it("keeps the browser's own rows when the plugin endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({}), ok: false })),
    );
    const { input } = renderChrome();

    await typeQuery(input, "flaky tests");

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("Search");
  });
});
