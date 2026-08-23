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
  useBrowserSearchEngine,
  useBrowserSearchEngineOptions,
} from "./browser-search-engine";

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { config: vi.fn() } },
}));

const KAGI = {
  pluginId: "search-engines",
  id: "kagi",
  name: "Kagi",
  urlTemplate: "https://kagi.com/search?q=%s",
};

/**
 * A known-good engine every test with contributions also sends, so a `waitFor`
 * can key on *its* arrival.
 *
 * Waiting on "there are options" would prove nothing: Patcher's own are there before
 * any request is made, so every assertion about what a contribution did — or was
 * refused — would run before the fetch landed and pass for the wrong reason.
 */
const BEACON = {
  pluginId: "search-engines",
  id: "beacon",
  name: "Beacon",
  urlTemplate: "https://beacon.test/?q=%s",
};

function systemConfig(browserSearchEngineId: string): SystemConfigResponse {
  return {
    generalSettings: { ...defaultAppSettings, browserSearchEngineId },
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

function mount(args: { engineId: string; engines: unknown[] }) {
  vi.mocked(sdk.system.config).mockResolvedValue(systemConfig(args.engineId));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ browserSearchEngines: args.engines }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  const { wrapper } = createQueryClientTestHarness();
  return renderHook(
    () => ({
      engine: useBrowserSearchEngine(),
      options: useBrowserSearchEngineOptions(),
    }),
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the chosen browser search engine", () => {
  it("searches with Patcher's own by default", async () => {
    const { result } = mount({ engineId: "google", engines: [] });

    await waitFor(() => {
      expect(result.current.engine.id).toBe("google");
    });
    expect(result.current.options.every((o) => o.pluginId === null)).toBe(true);
  });

  it("searches with a plugin's engine once the setting names it", async () => {
    const { result } = mount({ engineId: "kagi", engines: [KAGI] });

    await waitFor(() => {
      expect(result.current.engine.id).toBe("kagi");
    });
    expect(result.current.engine.urlTemplate).toBe(KAGI.urlTemplate);
    // The list says where a row came from: the user is choosing who receives
    // everything they type.
    expect(
      result.current.options.find((option) => option.id === "kagi")?.pluginId,
    ).toBe("search-engines");
  });

  // The setting outlives the plugin that put the engine in it.
  it("falls back to Patcher's own when the setting names an engine nobody offers", async () => {
    const { result } = mount({ engineId: "kagi", engines: [BEACON] });

    await waitFor(() => {
      expect(result.current.options.some((o) => o.id === "beacon")).toBe(true);
    });
    expect(result.current.engine.id).toBe("google");
  });

  // A plugin must not quietly become the engine the setting already names.
  it("keeps Patcher's own engine when a plugin claims its id", async () => {
    const { result } = mount({
      engineId: "google",
      engines: [{ ...KAGI, id: "google", name: "Not Google" }, BEACON],
    });

    await waitFor(() => {
      expect(result.current.options.some((o) => o.id === "beacon")).toBe(true);
    });
    expect(result.current.engine.name).toBe("Google");
    expect(
      result.current.options.filter((option) => option.id === "google"),
    ).toHaveLength(1);
  });

  // The server validates a template at registration; a build that answers with a
  // bad one gets it dropped rather than offered.
  it("drops an engine whose template it cannot use", async () => {
    const { result } = mount({
      engineId: "google",
      engines: [{ ...KAGI, urlTemplate: "http://evil.test/?q=%s" }, BEACON],
    });

    await waitFor(() => {
      expect(result.current.options.some((o) => o.id === "beacon")).toBe(true);
    });
    expect(result.current.options.some((o) => o.id === "kagi")).toBe(false);
  });
});
