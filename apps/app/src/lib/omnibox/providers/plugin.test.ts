import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginOmniboxSuggestGroup } from "@/hooks/queries/plugin-contribution-queries";
import { rankOmniboxSuggestions } from "../rank";
import type { OmniboxProvider, OmniboxSuggestion } from "../types";
import {
  createOmniboxPluginProvider,
  createOmniboxPluginProviders,
  createPluginOmniboxSuggestionSource,
  omniboxPluginProviderId,
  type PluginOmniboxSuggestionSource,
} from "./plugin";

const CONTRIBUTION = { id: "agent", label: "Agent", pluginId: "omnibox-agent" };

function group(
  overrides: Partial<PluginOmniboxSuggestGroup> = {},
): PluginOmniboxSuggestGroup {
  return {
    items: [
      {
        action: { type: "run" },
        itemId: "agent:ask",
        score: 0.8,
        subtitle: "spawns a Patcher thread",
        title: "Ask an agent",
      },
      {
        action: { type: "navigate", url: "https://docs.test/" },
        itemId: "agent:docs",
        score: 0.5,
        subtitle: null,
        title: "Docs",
      },
    ],
    label: "Agent",
    pluginId: "omnibox-agent",
    providerId: "agent",
    ...overrides,
  };
}

function sourceReturning(
  result: PluginOmniboxSuggestGroup | null,
): PluginOmniboxSuggestionSource {
  return { suggest: async () => result };
}

async function suggest(
  provider: OmniboxProvider,
  query: string,
): Promise<readonly OmniboxSuggestion[]> {
  const suggestions = await provider.suggest(query, {
    signal: new AbortController().signal,
  });
  return suggestions.map((suggestion) => ({
    ...suggestion,
    providerId: provider.id,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("omnibox plugin provider", () => {
  it("namespaces the provider id by plugin", () => {
    expect(omniboxPluginProviderId(CONTRIBUTION)).toBe(
      "plugin:omnibox-agent:agent",
    );
  });

  it("maps a navigate row to a plain navigation", async () => {
    const provider = createOmniboxPluginProvider({
      contribution: CONTRIBUTION,
      source: sourceReturning(group()),
    });

    const rows = await suggest(provider, "flake");

    expect(rows[1]).toMatchObject({
      action: { type: "navigate", url: "https://docs.test/" },
      kind: "plugin",
      // The plugin's own label, so the row's source is visible.
      sourceLabel: "Agent",
      title: "Docs",
    });
  });

  // The plugin's action needs the query it was offered for, and `run` receives
  // only an item id — so the query rides the action.
  it("stamps the query into a run action", async () => {
    const provider = createOmniboxPluginProvider({
      contribution: CONTRIBUTION,
      source: sourceReturning(group()),
    });

    const rows = await suggest(provider, "flake");

    expect(rows[0]?.action).toEqual({
      type: "plugin-run",
      itemId: "agent:ask",
      pluginId: "omnibox-agent",
      providerId: "agent",
      query: "flake",
    });
  });

  it("contributes nothing when its group is absent", async () => {
    const provider = createOmniboxPluginProvider({
      contribution: CONTRIBUTION,
      source: sourceReturning(null),
    });

    expect(await suggest(provider, "flake")).toEqual([]);
  });

  // Two plugins offering the same item id must stay two distinct rows.
  it("keeps identical rows from different plugins apart", async () => {
    const first = createOmniboxPluginProvider({
      contribution: CONTRIBUTION,
      source: sourceReturning(group({ items: [group().items[0]!] })),
    });
    const second = createOmniboxPluginProvider({
      contribution: { ...CONTRIBUTION, pluginId: "other-plugin" },
      source: sourceReturning(
        group({ items: [group().items[0]!], pluginId: "other-plugin" }),
      ),
    });

    const ranked = rankOmniboxSuggestions({
      maxPerProvider: 4,
      maxSuggestions: 8,
      suggestions: [
        ...(await suggest(first, "flake")),
        ...(await suggest(second, "flake")),
      ],
    });

    expect(ranked).toHaveLength(2);
  });
});

describe("shared plugin suggestion source", () => {
  function stubFetch(groups: PluginOmniboxSuggestGroup[]) {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ groups, ok: true }),
      ok: true,
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  // The server answers for every plugin at once; one request per query keeps a
  // second plugin from costing a second round trip per keystroke.
  it("issues one request per query for all providers", async () => {
    const fetchMock = stubFetch([
      group(),
      group({ label: "Other", pluginId: "other-plugin", providerId: "other" }),
    ]);
    const providers = createOmniboxPluginProviders({
      contributions: [
        CONTRIBUTION,
        { id: "other", label: "Other", pluginId: "other-plugin" },
      ],
      source: createPluginOmniboxSuggestionSource(),
    });

    const rows = (
      await Promise.all(providers.map((provider) => suggest(provider, "flake")))
    ).flat();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows.map((row) => row.providerId)).toEqual([
      "plugin:omnibox-agent:agent",
      "plugin:omnibox-agent:agent",
      "plugin:other-plugin:other",
      "plugin:other-plugin:other",
    ]);
  });

  it("each provider takes only its own group", async () => {
    stubFetch([group({ label: "Other", providerId: "other" })]);
    const [provider] = createOmniboxPluginProviders({
      contributions: [CONTRIBUTION],
      source: createPluginOmniboxSuggestionSource(),
    });

    expect(await suggest(provider!, "flake")).toEqual([]);
  });

  it("requests again for the next query", async () => {
    const fetchMock = stubFetch([group()]);
    const source = createPluginOmniboxSuggestionSource();
    const provider = createOmniboxPluginProvider({
      contribution: CONTRIBUTION,
      source,
    });

    await suggest(provider, "flake");
    await suggest(provider, "flaky");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
