import { useQuery, type QueryKey } from "@tanstack/react-query";
import { normalizeBrowserSearchEngineTemplate } from "@patcher/domain/browser-search-engine";
import { normalizePluginSitePattern } from "@patcher/domain/browser-url-pattern";
import {
  normalizePluginMentionTriggers,
  type PluginMentionTrigger,
} from "@/lib/plugin-mention-triggers";

/**
 * Host-rendered plugin contributions (plugin design §4.9), served by
 * GET /api/v1/plugins/contributions. Not in the typed server contract — the
 * plugin routes are server-policy glue — so fetched directly and typed
 * locally. One query covers every contribution kind; later kinds extend
 * {@link PluginContributions}.
 */
/** One mention provider contributed by a plugin (design §4.9). */
export interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
}

/** One omnibox provider contributed by a plugin (`browser.omnibox.providers`). */
export interface PluginOmniboxProviderContribution {
  pluginId: string;
  id: string;
  label: string;
}

/** One context-menu entry contributed by a plugin (`browser.contextMenu.items`). */
export interface PluginBrowserContextMenuItemContribution {
  pluginId: string;
  itemId: string;
  title: string;
  when: { image: boolean; link: boolean; page: boolean; selection: boolean };
}

/** One find-bar button contributed by a plugin (`browser.find.actions`). */
export interface PluginBrowserFindActionContribution {
  pluginId: string;
  itemId: string;
  title: string;
}

/** One tab-menu entry contributed by a plugin (`browser.tab.actions`). */
export interface PluginBrowserTabActionContribution {
  pluginId: string;
  itemId: string;
  title: string;
}

/**
 * One toolbar control contributed by a plugin (`browser.toolbar.items`).
 *
 * `hasState` decides whether the app asks anything as the user browses: a control
 * that looks the same on every page is drawn from this declaration alone.
 */
export interface PluginBrowserToolbarItemContribution {
  pluginId: string;
  itemId: string;
  title: string;
  icon: string | null;
  hasState: boolean;
}

/**
 * That a plugin has a new-tab section at all (`browser.newTab.widgets`).
 *
 * Ids only, deliberately: the section's heading and rows arrive together from the
 * per-tab request, so nothing is duplicated on two wires and nothing can drift
 * between them. What this buys is the question "is anyone there" — with no widget
 * declared, opening a tab asks nothing.
 */
export interface PluginBrowserNewTabWidgetContribution {
  pluginId: string;
  widgetId: string;
}

/**
 * One command a plugin added, with the chord that runs it (`app.commands`).
 *
 * Not in Patcher's keybinding config: Patcher's command ids are a closed enum that the
 * settings UI and the override store key on. These are matched after every one of
 * Patcher's own bindings, so a chord Patcher uses keeps doing what the user expects.
 */
export interface PluginCommandContribution {
  pluginId: string;
  commandId: string;
  title: string;
  shortcut: {
    key: string;
    alt: boolean;
    control: boolean;
    meta: boolean;
    mod: boolean;
    shift: boolean;
  };
}

/** One search engine a plugin offered (`browser.searchEngines`). */
export interface PluginBrowserSearchEngineContribution {
  pluginId: string;
  id: string;
  name: string;
  urlTemplate: string;
}

/**
 * CSS a plugin applies to pages on the sites it declared
 * (`browser.pageStyles`).
 *
 * The css itself, not a handle: this is pushed straight to the desktop shell,
 * which re-applies it on every navigation, so a page load never waits on the
 * server or on the plugin.
 */
export interface PluginBrowserPageStyleContribution {
  pluginId: string;
  styleId: string;
  matches: string[];
  css: string;
}

/**
 * A plugin's own code to run in pages on the sites it declared
 * (`browser.pageScripts`).
 *
 * The source text, like a page style's css: the shell hands it to a document as
 * that document is created, so nothing about running it waits on the server. What
 * *is* asked of the server is whatever the script calls back with — see
 * `useBrowserPageScripts`.
 */
export interface PluginBrowserPageScriptContribution {
  pluginId: string;
  scriptId: string;
  matches: string[];
  code: string;
}

export interface PluginContributions {
  browserContextMenuItems: PluginBrowserContextMenuItemContribution[];
  browserFindActions: PluginBrowserFindActionContribution[];
  browserPageScripts: PluginBrowserPageScriptContribution[];
  browserPageStyles: PluginBrowserPageStyleContribution[];
  browserSearchEngines: PluginBrowserSearchEngineContribution[];
  browserTabActions: PluginBrowserTabActionContribution[];
  browserToolbarItems: PluginBrowserToolbarItemContribution[];
  browserNewTabWidgets: PluginBrowserNewTabWidgetContribution[];
  commands: PluginCommandContribution[];
  mentionProviders: PluginMentionProviderContribution[];
  omniboxProviders: PluginOmniboxProviderContribution[];
}

const EMPTY_CONTRIBUTIONS: PluginContributions = {
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
};

function toContextMenuItemContribution(
  value: unknown,
): PluginBrowserContextMenuItemContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const when = item.when as Record<string, unknown> | undefined;
  if (
    typeof item.pluginId !== "string" ||
    typeof item.itemId !== "string" ||
    typeof item.title !== "string" ||
    typeof when !== "object" ||
    when === null
  ) {
    return null;
  }
  return {
    pluginId: item.pluginId,
    itemId: item.itemId,
    title: item.title,
    when: {
      image: when.image === true,
      link: when.link === true,
      page: when.page === true,
      selection: when.selection === true,
    },
  };
}

function toFindActionContribution(
  value: unknown,
): PluginBrowserFindActionContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const action = value as Record<string, unknown>;
  if (
    typeof action.pluginId !== "string" ||
    typeof action.itemId !== "string" ||
    typeof action.title !== "string"
  ) {
    return null;
  }
  return {
    pluginId: action.pluginId,
    itemId: action.itemId,
    title: action.title,
  };
}

/**
 * An engine whose template the app cannot use is dropped here rather than
 * offered: the server validated it at registration, so a bad one means a build
 * mismatch, and a row that searches nowhere is worse than no row.
 */
function toSearchEngineContribution(
  value: unknown,
): PluginBrowserSearchEngineContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const engine = value as Record<string, unknown>;
  if (
    typeof engine.pluginId !== "string" ||
    typeof engine.id !== "string" ||
    typeof engine.name !== "string" ||
    typeof engine.urlTemplate !== "string" ||
    normalizeBrowserSearchEngineTemplate(engine.urlTemplate) === null
  ) {
    return null;
  }
  return {
    pluginId: engine.pluginId,
    id: engine.id,
    name: engine.name,
    urlTemplate: engine.urlTemplate,
  };
}

function toPageStyleContribution(
  value: unknown,
): PluginBrowserPageStyleContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const style = value as Record<string, unknown>;
  if (
    typeof style.pluginId !== "string" ||
    typeof style.styleId !== "string" ||
    typeof style.css !== "string" ||
    style.css.length === 0 ||
    !Array.isArray(style.matches) ||
    style.matches.length === 0
  ) {
    return null;
  }
  // Re-checked here rather than trusted from the server: the shell applies these
  // to whatever page matches, so a pattern this build would not have accepted
  // must not become one it honours.
  const matches = style.matches.filter(
    (pattern): pattern is string =>
      typeof pattern === "string" &&
      normalizePluginSitePattern(pattern) !== null,
  );
  if (matches.length !== style.matches.length) return null;
  return {
    pluginId: style.pluginId,
    styleId: style.styleId,
    matches,
    css: style.css,
  };
}

function toPageScriptContribution(
  value: unknown,
): PluginBrowserPageScriptContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const script = value as Record<string, unknown>;
  if (
    typeof script.pluginId !== "string" ||
    typeof script.scriptId !== "string" ||
    typeof script.code !== "string" ||
    script.code.length === 0 ||
    !Array.isArray(script.matches) ||
    script.matches.length === 0
  ) {
    return null;
  }
  // Re-checked here for the reason a page style's patterns are, with more at
  // stake: this decides which sites get to run a plugin's program, so a pattern
  // this build would not have accepted must not become one it honours. A row with
  // any bad pattern is dropped whole rather than narrowed.
  const matches = script.matches.filter(
    (pattern): pattern is string =>
      typeof pattern === "string" &&
      normalizePluginSitePattern(pattern) !== null,
  );
  if (matches.length !== script.matches.length) return null;
  return {
    pluginId: script.pluginId,
    scriptId: script.scriptId,
    matches,
    code: script.code,
  };
}

function toToolbarItemContribution(
  value: unknown,
): PluginBrowserToolbarItemContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.pluginId !== "string" ||
    typeof item.itemId !== "string" ||
    typeof item.title !== "string"
  ) {
    return null;
  }
  return {
    pluginId: item.pluginId,
    itemId: item.itemId,
    title: item.title,
    icon: typeof item.icon === "string" ? item.icon : null,
    // Absent means "asks nothing", which is the safe reading: the alternative is
    // a request per navigation to a server that never wanted one.
    hasState: item.hasState === true,
  };
}

function toNewTabWidgetContribution(
  value: unknown,
): PluginBrowserNewTabWidgetContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const widget = value as Record<string, unknown>;
  if (
    typeof widget.pluginId !== "string" ||
    typeof widget.widgetId !== "string"
  ) {
    return null;
  }
  return { pluginId: widget.pluginId, widgetId: widget.widgetId };
}

/**
 * A command whose chord the app could not match is dropped rather than listed: a
 * shortcut row that never fires is worse than no row, and the server normalised
 * every modifier before sending it, so a missing one means a build mismatch.
 */
function toCommandContribution(
  value: unknown,
): PluginCommandContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const command = value as Record<string, unknown>;
  const shortcut = command.shortcut as Record<string, unknown> | undefined;
  if (
    typeof command.pluginId !== "string" ||
    typeof command.commandId !== "string" ||
    typeof command.title !== "string" ||
    typeof shortcut !== "object" ||
    shortcut === null ||
    typeof shortcut.key !== "string" ||
    shortcut.key.length === 0
  ) {
    return null;
  }
  return {
    pluginId: command.pluginId,
    commandId: command.commandId,
    title: command.title,
    shortcut: {
      key: shortcut.key,
      alt: shortcut.alt === true,
      control: shortcut.control === true,
      meta: shortcut.meta === true,
      mod: shortcut.mod === true,
      shift: shortcut.shift === true,
    },
  };
}

function toOmniboxProviderContribution(
  value: unknown,
): PluginOmniboxProviderContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const provider = value as Record<string, unknown>;
  if (
    typeof provider.pluginId !== "string" ||
    typeof provider.id !== "string" ||
    typeof provider.label !== "string"
  ) {
    return null;
  }
  return {
    pluginId: provider.pluginId,
    id: provider.id,
    label: provider.label,
  };
}

function toMentionProviderContribution(
  value: unknown,
): PluginMentionProviderContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const provider = value as Record<string, unknown>;
  const triggers = normalizePluginMentionTriggers(provider.triggers);
  if (triggers === null) return null;
  if (
    typeof provider.pluginId !== "string" ||
    typeof provider.id !== "string" ||
    typeof provider.label !== "string"
  ) {
    return null;
  }
  return {
    pluginId: provider.pluginId,
    id: provider.id,
    label: provider.label,
    triggers,
  };
}

async function fetchPluginContributions(
  signal: AbortSignal,
): Promise<PluginContributions> {
  const response = await fetch("/api/v1/plugins/contributions", { signal });
  // Nothing to surface rather than an error: an older server (no plugin
  // routes) or a disabled experiment both mean "no contributions".
  if (!response.ok) return EMPTY_CONTRIBUTIONS;
  const body = (await response.json()) as {
    browserContextMenuItems?: unknown;
    browserFindActions?: unknown;
    browserPageScripts?: unknown;
    browserPageStyles?: unknown;
    browserSearchEngines?: unknown;
    browserTabActions?: unknown;
    browserToolbarItems?: unknown;
    browserNewTabWidgets?: unknown;
    commands?: unknown;
    mentionProviders?: unknown;
    omniboxProviders?: unknown;
  };
  return {
    browserContextMenuItems: Array.isArray(body.browserContextMenuItems)
      ? body.browserContextMenuItems
          .map(toContextMenuItemContribution)
          .filter(
            (item): item is PluginBrowserContextMenuItemContribution =>
              item !== null,
          )
      : [],
    browserFindActions: Array.isArray(body.browserFindActions)
      ? body.browserFindActions
          .map(toFindActionContribution)
          .filter(
            (action): action is PluginBrowserFindActionContribution =>
              action !== null,
          )
      : [],
    browserPageScripts: Array.isArray(body.browserPageScripts)
      ? body.browserPageScripts
          .map(toPageScriptContribution)
          .filter(
            (script): script is PluginBrowserPageScriptContribution =>
              script !== null,
          )
      : [],
    browserPageStyles: Array.isArray(body.browserPageStyles)
      ? body.browserPageStyles
          .map(toPageStyleContribution)
          .filter(
            (style): style is PluginBrowserPageStyleContribution =>
              style !== null,
          )
      : [],
    browserSearchEngines: Array.isArray(body.browserSearchEngines)
      ? body.browserSearchEngines
          .map(toSearchEngineContribution)
          .filter(
            (engine): engine is PluginBrowserSearchEngineContribution =>
              engine !== null,
          )
      : [],
    browserTabActions: Array.isArray(body.browserTabActions)
      ? // The same three fields a find-bar button has, so the same normaliser.
        body.browserTabActions
          .map(toFindActionContribution)
          .filter(
            (action): action is PluginBrowserTabActionContribution =>
              action !== null,
          )
      : [],
    browserToolbarItems: Array.isArray(body.browserToolbarItems)
      ? body.browserToolbarItems
          .map(toToolbarItemContribution)
          .filter(
            (item): item is PluginBrowserToolbarItemContribution =>
              item !== null,
          )
      : [],
    browserNewTabWidgets: Array.isArray(body.browserNewTabWidgets)
      ? body.browserNewTabWidgets
          .map(toNewTabWidgetContribution)
          .filter(
            (widget): widget is PluginBrowserNewTabWidgetContribution =>
              widget !== null,
          )
      : [],
    commands: Array.isArray(body.commands)
      ? body.commands
          .map(toCommandContribution)
          .filter(
            (command): command is PluginCommandContribution => command !== null,
          )
      : [],
    mentionProviders: Array.isArray(body.mentionProviders)
      ? body.mentionProviders
          .map(toMentionProviderContribution)
          .filter(
            (provider): provider is PluginMentionProviderContribution =>
              provider !== null,
          )
      : [],
    omniboxProviders: Array.isArray(body.omniboxProviders)
      ? body.omniboxProviders
          .map(toOmniboxProviderContribution)
          .filter(
            (provider): provider is PluginOmniboxProviderContribution =>
              provider !== null,
          )
      : [],
  };
}

export function pluginContributionsQueryKey(): QueryKey {
  return ["plugin-contributions"];
}

/**
 * Prefix covering every contributions cache entry. The realtime
 * `plugins-changed` broadcast invalidates it so `patcher plugin
 * reload/enable/disable` reaches open pages without waiting out the stale
 * time.
 */
export function allPluginContributionsQueryKeyPrefix(): QueryKey {
  return ["plugin-contributions"];
}

/**
 * All host-rendered plugin contributions. Consumers read their kind from the
 * shared result so the app makes one contributions request total.
 */
export function usePluginContributions() {
  return useQuery({
    queryKey: pluginContributionsQueryKey(),
    queryFn: ({ signal }) => fetchPluginContributions(signal),
    staleTime: 30_000,
  });
}
export interface PluginMentionSearchItem {
  /** Opaque server-composed item reference; rides the mention resource. */
  itemId: string;
  title: string;
  subtitle: string | null;
  icon: string | null;
}

/** One provider's mention search results, grouped under its label. */
export interface PluginMentionSearchGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginMentionSearchItem[];
}

function isMentionSearchItem(value: unknown): value is PluginMentionSearchItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.itemId === "string" &&
    typeof item.title === "string" &&
    (item.subtitle === null || typeof item.subtitle === "string") &&
    (item.icon === null || typeof item.icon === "string")
  );
}

function isMentionSearchGroup(
  value: unknown,
): value is PluginMentionSearchGroup {
  if (typeof value !== "object" || value === null) return false;
  const group = value as Record<string, unknown>;
  return (
    typeof group.pluginId === "string" &&
    typeof group.providerId === "string" &&
    typeof group.label === "string" &&
    Array.isArray(group.items) &&
    group.items.every(isMentionSearchItem)
  );
}

export interface PluginMentionSearchArgs {
  trigger: PluginMentionTrigger;
  query: string;
  projectId: string | null;
  threadId: string | null;
}

async function fetchPluginMentionSearch(
  args: PluginMentionSearchArgs,
  signal: AbortSignal,
): Promise<PluginMentionSearchGroup[]> {
  const params = new URLSearchParams({
    q: args.query,
    trigger: args.trigger,
  });
  if (args.projectId !== null) params.set("projectId", args.projectId);
  if (args.threadId !== null) params.set("threadId", args.threadId);
  const response = await fetch(
    `/api/v1/plugins/mentions/search?${params.toString()}`,
    { signal },
  );
  // Nothing to surface rather than an error: a disabled experiment or an
  // older server both mean "no plugin mention results".
  if (!response.ok) return [];
  const body = (await response.json()) as { groups?: unknown };
  return Array.isArray(body.groups)
    ? body.groups.filter(isMentionSearchGroup)
    : [];
}

/**
 * Plugin mention-provider search for the composer's `@` menu (design §4.9).
 * Callers gate `enabled` on a non-empty (debounced) query plus at least one
 * registered mention provider so idle composers never poll the server.
 */
export function usePluginMentionSearch(
  args: PluginMentionSearchArgs,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: [
      "plugin-mention-search",
      args.trigger,
      args.query,
      args.projectId,
      args.threadId,
    ],
    queryFn: ({ signal }) => fetchPluginMentionSearch(args, signal),
    enabled: options.enabled,
    staleTime: 15_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === args.trigger ? previous : undefined,
  });
}

/** What picking a plugin omnibox row does; `run` calls the plugin back. */
export type PluginOmniboxSuggestAction =
  | { type: "navigate"; url: string }
  | { type: "run" };

export interface PluginOmniboxSuggestItem {
  /** Opaque server-composed item reference; posted back for a `run` action. */
  itemId: string;
  title: string;
  subtitle: string | null;
  /** Already clamped to [0, 1] by the server. */
  score: number;
  action: PluginOmniboxSuggestAction;
}

/** One provider's omnibox suggestions, labelled with its source. */
export interface PluginOmniboxSuggestGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginOmniboxSuggestItem[];
}

function isOmniboxSuggestAction(
  value: unknown,
): value is PluginOmniboxSuggestAction {
  if (typeof value !== "object" || value === null) return false;
  const action = value as Record<string, unknown>;
  if (action.type === "run") return true;
  return action.type === "navigate" && typeof action.url === "string";
}

function isOmniboxSuggestItem(
  value: unknown,
): value is PluginOmniboxSuggestItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.itemId === "string" &&
    typeof item.title === "string" &&
    (item.subtitle === null || typeof item.subtitle === "string") &&
    typeof item.score === "number" &&
    isOmniboxSuggestAction(item.action)
  );
}

function isOmniboxSuggestGroup(
  value: unknown,
): value is PluginOmniboxSuggestGroup {
  if (typeof value !== "object" || value === null) return false;
  const group = value as Record<string, unknown>;
  return (
    typeof group.pluginId === "string" &&
    typeof group.providerId === "string" &&
    typeof group.label === "string" &&
    Array.isArray(group.items) &&
    group.items.every(isOmniboxSuggestItem)
  );
}

/**
 * Plugin omnibox suggestions for one query (`browser.omnibox.providers`).
 *
 * Not a react-query hook: the omnibox controller drives providers itself, with
 * its own debounce and cancellation, and calls this from a provider adapter
 * rather than from a component.
 */
export async function fetchPluginOmniboxSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<PluginOmniboxSuggestGroup[]> {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(
    `/api/v1/plugins/omnibox/suggest?${params.toString()}`,
    { signal },
  );
  // Nothing to surface rather than an error: a disabled experiment or an
  // older server both mean "no plugin suggestions".
  if (!response.ok) return [];
  const body = (await response.json()) as { groups?: unknown };
  return Array.isArray(body.groups)
    ? body.groups.filter(isOmniboxSuggestGroup)
    : [];
}

export interface RunPluginOmniboxActionArgs {
  itemId: string;
  pluginId: string;
  /** The query the picked suggestion was produced for. */
  query: string;
}

/**
 * Perform a picked `run` suggestion. Returns the URL the plugin asks the
 * browser to open, or null when it asks for nothing (or the call failed —
 * a failed action must not navigate the tab somewhere arbitrary).
 */
export async function runPluginOmniboxAction(
  args: RunPluginOmniboxActionArgs,
): Promise<string | null> {
  const response = await fetch("/api/v1/plugins/omnibox/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      itemId: args.itemId,
      pluginId: args.pluginId,
      query: args.query,
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    navigate?: unknown;
    ok?: unknown;
  };
  if (body.ok !== true) return null;
  return typeof body.navigate === "string" && body.navigate.length > 0
    ? body.navigate
    : null;
}

export interface RunPluginContextMenuItemArgs {
  imageUrl: string | null;
  itemId: string;
  linkUrl: string | null;
  pageUrl: string;
  pluginId: string;
  selectionText: string | null;
  tabId: string;
}

/**
 * Perform a context-menu entry the user picked. Fire-and-forget: the menu has
 * already closed, so there is nothing to report back to.
 */
export async function runPluginContextMenuItem(
  args: RunPluginContextMenuItemArgs,
): Promise<void> {
  await fetch("/api/v1/plugins/browser/context-menu", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  }).catch(() => undefined);
}

export interface RunPluginFindActionArgs {
  itemId: string;
  pageUrl: string;
  pluginId: string;
  /** What the find bar had in it when the button was pressed. */
  query: string;
  tabId: string;
}

/**
 * Press a plugin's find-bar button. Fire-and-forget, like a context-menu entry:
 * the plugin reports through its own surfaces, and the bar keeps the user's
 * query where it was.
 */
export async function runPluginFindAction(
  args: RunPluginFindActionArgs,
): Promise<void> {
  await fetch("/api/v1/plugins/browser/find-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  }).catch(() => undefined);
}

/** One plugin's section of the site-info popover (`browser.siteInfo.sections`). */
export interface PluginSiteInfoSection {
  pluginId: string;
  providerId: string;
  label: string;
  rows: { label: string; value: string }[];
}

function isSiteInfoSection(value: unknown): value is PluginSiteInfoSection {
  if (typeof value !== "object" || value === null) return false;
  const section = value as Record<string, unknown>;
  return (
    typeof section.pluginId === "string" &&
    typeof section.providerId === "string" &&
    typeof section.label === "string" &&
    Array.isArray(section.rows) &&
    section.rows.every((row) => {
      if (typeof row !== "object" || row === null) return false;
      const typed = row as Record<string, unknown>;
      return typeof typed.label === "string" && typeof typed.value === "string";
    })
  );
}

async function fetchPluginSiteInfo(
  args: { tabId: string; url: string },
  signal: AbortSignal,
): Promise<PluginSiteInfoSection[]> {
  const params = new URLSearchParams({ tabId: args.tabId, url: args.url });
  const response = await fetch(
    `/api/v1/plugins/browser/site-info?${params.toString()}`,
    { signal },
  );
  // Nothing to add rather than an error: an older server or a disabled
  // experiment both mean "no plugin has anything to say about this site".
  if (!response.ok) return [];
  const body = (await response.json()) as { sections?: unknown };
  return Array.isArray(body.sections)
    ? body.sections.filter(isSiteInfoSection)
    : [];
}

/**
 * What plugins know about the page in this tab, for the site-info popover.
 *
 * Asked when the popover opens rather than on every navigation — `enabled` is the
 * popover's own open state — because a provider may do real work to answer, and
 * nobody is reading it while it is closed.
 */
export function usePluginSiteInfo(
  args: { tabId: string; url: string },
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: ["plugin-site-info", args.tabId, args.url],
    queryFn: ({ signal }) => fetchPluginSiteInfo(args, signal),
    enabled: options.enabled,
    staleTime: 5_000,
  });
}

/** What one plugin's toolbar control looks like for the page it was asked about. */
export interface PluginToolbarItemState {
  pluginId: string;
  itemId: string;
  active: boolean;
  /** Replaces the declared title, or null to keep it. */
  title: string | null;
}

function isToolbarItemState(value: unknown): value is PluginToolbarItemState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.pluginId === "string" &&
    typeof state.itemId === "string" &&
    typeof state.active === "boolean" &&
    (state.title === null || typeof state.title === "string")
  );
}

async function fetchPluginToolbarStates(
  args: { tabId: string; url: string; title: string | null },
  signal: AbortSignal,
): Promise<PluginToolbarItemState[]> {
  const params = new URLSearchParams({ tabId: args.tabId, url: args.url });
  if (args.title !== null) params.set("title", args.title);
  const response = await fetch(
    `/api/v1/plugins/browser/toolbar-state?${params.toString()}`,
    { signal },
  );
  // The declared look rather than an error: an older server or a disabled
  // experiment both mean "nobody has anything to say about this page".
  if (!response.ok) return [];
  const body = (await response.json()) as { states?: unknown };
  return Array.isArray(body.states)
    ? body.states.filter(isToolbarItemState)
    : [];
}

export function pluginToolbarStatesQueryKeyPrefix(): QueryKey {
  return ["plugin-toolbar-states"];
}

/**
 * What each plugin's toolbar control looks like for the page in this tab.
 *
 * Keyed by tab and address, not by title: a title arrives after the page does and
 * changes nothing about *which* page this is, so re-asking on it would double
 * every navigation's cost for an answer nobody's control depends on.
 *
 * `enabled` is the caller's own "does any control even offer a state" — with none,
 * this asks nothing at all as the user browses.
 */
export function usePluginToolbarStates(
  args: { tabId: string; url: string; title: string | null },
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: ["plugin-toolbar-states", args.tabId, args.url],
    queryFn: ({ signal }) => fetchPluginToolbarStates(args, signal),
    enabled: options.enabled,
    staleTime: 5_000,
  });
}

/** One plugin's section of the new-tab screen (`browser.newTab.widgets`). */
export interface PluginNewTabSection {
  pluginId: string;
  widgetId: string;
  label: string;
  rows: { title: string; subtitle: string | null; url: string }[];
}

function isNewTabSection(value: unknown): value is PluginNewTabSection {
  if (typeof value !== "object" || value === null) return false;
  const section = value as Record<string, unknown>;
  return (
    typeof section.pluginId === "string" &&
    typeof section.widgetId === "string" &&
    typeof section.label === "string" &&
    Array.isArray(section.rows) &&
    section.rows.every((row) => {
      if (typeof row !== "object" || row === null) return false;
      const typed = row as Record<string, unknown>;
      return (
        typeof typed.title === "string" &&
        typeof typed.url === "string" &&
        (typed.subtitle === null || typeof typed.subtitle === "string")
      );
    })
  );
}

async function fetchPluginNewTabSections(
  args: { tabId: string },
  signal: AbortSignal,
): Promise<PluginNewTabSection[]> {
  const params = new URLSearchParams({ tabId: args.tabId });
  const response = await fetch(
    `/api/v1/plugins/browser/new-tab?${params.toString()}`,
    { signal },
  );
  // Nothing to add rather than an error: an older server or a disabled
  // experiment both mean "no plugin has anything for a new tab".
  if (!response.ok) return [];
  const body = (await response.json()) as { sections?: unknown };
  return Array.isArray(body.sections)
    ? body.sections.filter(isNewTabSection)
    : [];
}

/**
 * What plugins want to show on this tab's new-tab screen.
 *
 * `enabled` is the caller's "has anyone declared a widget", so an install with no
 * such plugin never asks. Asked per tab because the screen is per tab, and kept
 * briefly stale so returning to an empty tab does not re-ask on every render.
 */
export function usePluginNewTabSections(
  args: { tabId: string },
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: ["plugin-new-tab-sections", args.tabId],
    queryFn: ({ signal }) => fetchPluginNewTabSections(args, signal),
    enabled: options.enabled,
    staleTime: 5_000,
  });
}

/**
 * Run a plugin command whose chord fired. Fire-and-forget: a keypress has already
 * happened, and the plugin reports through its own surfaces.
 */
export async function runPluginCommand(args: {
  pluginId: string;
  commandId: string;
}): Promise<void> {
  await fetch("/api/v1/plugins/commands/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  }).catch(() => undefined);
}

export interface RunPluginToolbarItemArgs {
  itemId: string;
  pluginId: string;
  tabId: string;
  url: string;
  title: string | null;
}

/**
 * Press a plugin's toolbar control, and resolve once the plugin is done.
 *
 * Awaited, unlike a menu entry: the caller asks for states again afterwards, and
 * a control that toggled something has to stop looking like it did before.
 */
export async function runPluginToolbarItem(
  args: RunPluginToolbarItemArgs,
): Promise<void> {
  await fetch("/api/v1/plugins/browser/toolbar-item", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  }).catch(() => undefined);
}

export interface RunPluginTabActionArgs {
  itemId: string;
  pluginId: string;
  tabId: string;
  /** Null for a Patcher screen, which is a tab with no page. */
  url: string | null;
  title: string | null;
  pinned: boolean;
  muted: boolean;
  active: boolean;
}

/**
 * Pick a plugin's tab-menu entry. Fire-and-forget, like a context-menu entry:
 * the menu has closed, and the plugin reports through its own surfaces.
 */
export async function runPluginTabAction(
  args: RunPluginTabActionArgs,
): Promise<void> {
  await fetch("/api/v1/plugins/browser/tab-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  }).catch(() => undefined);
}

export interface ResolvePluginBrowserAuthArgs {
  /** `example.com`, or `example.com:8443` — who challenged. */
  host: string;
  insecure: boolean;
  tabId: string;
}

export interface PluginBrowserAuthCredentials {
  password: string;
  username: string;
}

/**
 * Ask plugins for the credentials a page was challenged for
 * (`browser.auth.providers`), before the user is asked.
 *
 * Null means nobody answered — which is also what a failed call means, because
 * the fallback for both is the same and it is the safe one: show the prompt.
 */
export async function resolvePluginBrowserAuth(
  args: ResolvePluginBrowserAuthArgs,
): Promise<PluginBrowserAuthCredentials | null> {
  const response = await fetch("/api/v1/plugins/browser/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  }).catch(() => null);
  if (response === null || !response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    credentials?: unknown;
    ok?: unknown;
  } | null;
  const credentials = body?.credentials as
    | Partial<PluginBrowserAuthCredentials>
    | null
    | undefined;
  if (
    body?.ok !== true ||
    typeof credentials?.username !== "string" ||
    typeof credentials.password !== "string"
  ) {
    return null;
  }
  return {
    password: credentials.password,
    username: credentials.username,
  };
}

export interface PluginExternalLinkDecision {
  handled: boolean;
  url: string | null;
}

/**
 * Ask plugins where a link the system handed Patcher should go
 * (`browser.externalLink.handlers`), before it becomes a tab.
 *
 * Null means nobody decided — which is also what a server that is not listening
 * means, and what a slow handler becomes. Every one of those opens the link in a
 * tab, which is what Patcher does with no plugins at all.
 */
export async function resolvePluginExternalLink(
  url: string,
): Promise<PluginExternalLinkDecision | null> {
  const response = await fetch("/api/v1/plugins/browser/external-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  }).catch(() => null);
  if (response === null || !response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    decision?: unknown;
    ok?: unknown;
  } | null;
  if (body?.ok !== true) return null;
  const decision = body.decision as
    | { handled?: unknown; url?: unknown }
    | null
    | undefined;
  if (decision === null || decision === undefined) return null;
  return {
    handled: decision.handled === true,
    url: typeof decision.url === "string" ? decision.url : null,
  };
}

export interface ResolvePluginBrowserPdfTextArgs {
  pageUrl: string;
  tabId: string;
  title: string | null;
}

/**
 * Ask plugins to read a PDF the browser could not (`browser.pdf.textProviders`).
 *
 * Only ever called for a document the browser has already parsed and found no
 * text in, so a failure here costs an answer nobody had anyway: null means
 * nobody answered, which is also what a server that is not listening means.
 */
export async function resolvePluginBrowserPdfText(
  args: ResolvePluginBrowserPdfTextArgs,
): Promise<string | null> {
  const response = await fetch("/api/v1/plugins/browser/pdf-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  }).catch(() => null);
  if (response === null || !response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    ok?: unknown;
    text?: unknown;
  } | null;
  if (body?.ok !== true || typeof body.text !== "string") return null;
  return body.text.length === 0 ? null : body.text;
}

export interface ReportPluginBrowserDownloadArgs {
  filename: string;
  id: string;
  mimeType: string;
  savePath: string | null;
  state: "completed" | "cancelled" | "interrupted" | "refused";
  tabId: string;
  url: string;
}

/**
 * Hand a finished download to whatever plugins registered a handler
 * (`browser.downloads.handlers`).
 *
 * Fire-and-forget by design: the file is already written and the user has
 * already been told, so this cannot fail in a way worth interrupting them
 * about. It resolves to how many handlers ran, which is what the tests assert
 * on and what a caller can log.
 */
export async function reportPluginBrowserDownload(
  args: ReportPluginBrowserDownloadArgs,
): Promise<number> {
  const response = await fetch("/api/v1/plugins/browser/downloads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) return 0;
  const body = (await response.json()) as {
    handlerCount?: unknown;
    ok?: unknown;
  };
  if (body.ok !== true || typeof body.handlerCount !== "number") return 0;
  return body.handlerCount;
}
