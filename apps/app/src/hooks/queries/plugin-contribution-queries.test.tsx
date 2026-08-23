// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SystemConfigResponse } from "@patcher/server-contract";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
} from "@patcher/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  usePluginContributions,
  usePluginMentionSearch,
} from "./plugin-contribution-queries";

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { config: vi.fn() } },
}));

function systemConfig(): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: defaultExperiments,
    appearance: defaultAppTheme,
    customThemes: [],
    pluginThemes: [],
    featureFlags: { placeholder: false, timelineWindowEventBudget: 1_500 },
    hostDaemonPort: null,
    serverUrl: "http://localhost:38986",
    primaryHostId: null,
    primaryHostPlatform: null,
    voiceTranscriptionEnabled: false,
    dataDir: "/tmp/patcher-test",
  };
}

function mockFetchJsonOnce(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("usePluginContributions", () => {
  it("fetches contributions and drops malformed entries", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    const fetchMock = mockFetchJsonOnce({
      cliCommands: [],
      mentionProviders: [
        { pluginId: "linear", id: "issues", label: "Linear issues" },
        {
          pluginId: "github",
          id: "pulls",
          label: "GitHub pull requests",
          triggers: ["@", "#"],
        },
        {
          pluginId: "bad-trigger",
          id: "issues",
          label: "Bad trigger",
          triggers: ["?"],
        },
        {
          pluginId: "duplicate-trigger",
          id: "issues",
          label: "Duplicate trigger",
          triggers: ["#", "#"],
        },
        {
          pluginId: "empty-trigger",
          id: "issues",
          label: "Empty trigger",
          triggers: [],
        },
        { pluginId: "broken" }, // malformed: dropped at the boundary
      ],
      browserFindActions: [
        { pluginId: "notes", itemId: "save-search", title: "Save this search" },
        { pluginId: "broken", itemId: "no-title" }, // dropped at the boundary
      ],
      browserTabActions: [
        { pluginId: "notes", itemId: "file-tab", title: "File this tab" },
        { pluginId: "broken", itemId: "no-title" }, // dropped at the boundary
      ],
      browserToolbarItems: [
        {
          pluginId: "notes",
          itemId: "star",
          title: "Save this page",
          icon: "Star",
          hasState: true,
        },
        // Dropped at the boundary: there would be nothing to label the control
        // with, and an unlabelled button in the chrome is unusable.
        { pluginId: "broken", itemId: "star", hasState: true },
      ],
      browserNewTabWidgets: [
        { pluginId: "notes", widgetId: "saved" },
        { pluginId: "broken" }, // dropped at the boundary
      ],
      browserPageStyles: [
        {
          pluginId: "notes",
          styleId: "declutter",
          matches: ["https://github.com/**"],
          css: ".ad { display: none }",
        },
        // Dropped whole rather than trimmed to its good pattern: what the shell
        // applies has to be what a manifest could have declared, and plain http
        // to another machine could not.
        {
          pluginId: "evil",
          styleId: "wide",
          matches: ["https://github.com/**", "http://intranet.example/**"],
          css: "* { display: none }",
        },
      ],
      browserPageScripts: [
        {
          pluginId: "notes",
          scriptId: "toolbar",
          matches: ["https://github.com/**"],
          code: "patcher.ready(function(){})",
        },
        // Dropped for the same reason a style is, with more at stake: this one
        // decides which sites get to run a plugin's program.
        {
          pluginId: "evil",
          scriptId: "everywhere",
          matches: ["http://intranet.example/**"],
          code: "fetch('/secrets')",
        },
      ],
      commands: [
        {
          pluginId: "notes",
          commandId: "save-page",
          title: "Save this page",
          shortcut: { key: "d", mod: true },
        },
        // Dropped at the boundary: a command with no key could match no
        // chord, and a shortcut row that never fires is worse than no row.
        {
          pluginId: "broken",
          commandId: "nokey",
          title: "Nowhere",
          shortcut: { mod: true },
        },
      ],
      browserSearchEngines: [
        {
          pluginId: "notes",
          id: "kagi",
          name: "Kagi",
          urlTemplate: "https://kagi.com/search?q=%s",
        },
        // Dropped at the boundary: plain http to another machine is refused, so
        // an engine the server would never have registered cannot slip in here.
        {
          pluginId: "broken",
          id: "evil",
          name: "Evil",
          urlTemplate: "http://evil.test/?q=%s",
        },
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => usePluginContributions(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        browserContextMenuItems: [],
        browserFindActions: [
          {
            pluginId: "notes",
            itemId: "save-search",
            title: "Save this search",
          },
        ],
        browserTabActions: [
          { pluginId: "notes", itemId: "file-tab", title: "File this tab" },
        ],
        browserToolbarItems: [
          {
            pluginId: "notes",
            itemId: "star",
            title: "Save this page",
            icon: "Star",
            hasState: true,
          },
        ],
        browserNewTabWidgets: [{ pluginId: "notes", widgetId: "saved" }],
        browserPageStyles: [
          {
            pluginId: "notes",
            styleId: "declutter",
            matches: ["https://github.com/**"],
            css: ".ad { display: none }",
          },
        ],
        browserPageScripts: [
          {
            pluginId: "notes",
            scriptId: "toolbar",
            matches: ["https://github.com/**"],
            code: "patcher.ready(function(){})",
          },
        ],
        commands: [
          {
            pluginId: "notes",
            commandId: "save-page",
            title: "Save this page",
            shortcut: {
              key: "d",
              alt: false,
              control: false,
              meta: false,
              mod: true,
              shift: false,
            },
          },
        ],
        browserSearchEngines: [
          {
            pluginId: "notes",
            id: "kagi",
            name: "Kagi",
            urlTemplate: "https://kagi.com/search?q=%s",
          },
        ],
        mentionProviders: [
          {
            pluginId: "linear",
            id: "issues",
            label: "Linear issues",
            triggers: ["@"],
          },
          {
            pluginId: "github",
            id: "pulls",
            label: "GitHub pull requests",
            triggers: ["@", "#"],
          },
        ],
        omniboxProviders: [],
      });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/contributions",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shapes a failed contributions request as empty rather than an error", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig());
    mockFetchJsonOnce({ ok: false }, { status: 503 });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => usePluginContributions(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        browserContextMenuItems: [],
        browserFindActions: [],
        browserPageScripts: [],
        browserPageStyles: [],
        browserSearchEngines: [],
        browserTabActions: [],
        browserToolbarItems: [],
        browserNewTabWidgets: [],
        commands: [],
        mentionProviders: [],
        omniboxProviders: [],
      });
    });
  });
});

describe("usePluginMentionSearch", () => {
  it("includes the active trigger in the search request", async () => {
    const fetchMock = mockFetchJsonOnce({
      ok: true,
      groups: [
        {
          pluginId: "github",
          providerId: "issue",
          label: "GitHub issues",
          items: [
            {
              itemId: "issue:owner/repo#42",
              title: "#42 Fix login bug",
              subtitle: "owner/repo",
              icon: null,
            },
          ],
        },
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        usePluginMentionSearch(
          {
            trigger: "#",
            query: "42",
            projectId: "proj_1",
            threadId: null,
          },
          { enabled: true },
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([
        {
          pluginId: "github",
          providerId: "issue",
          label: "GitHub issues",
          items: [
            {
              itemId: "issue:owner/repo#42",
              title: "#42 Fix login bug",
              subtitle: "owner/repo",
              icon: null,
            },
          ],
        },
      ]);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/mentions/search?q=42&trigger=%23&projectId=proj_1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
