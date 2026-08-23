import { matchPath } from "react-router-dom";
import type { IconName } from "@patcher/shared-ui/icon";
import {
  activateBrowserSurfaceTab,
  addBrowserSurfaceTab,
  createAppSurfaceTab,
  getActiveBrowserSurfaceTab,
  isAppSurfaceTab,
  isWebSurfaceTab,
  updateAppSurfaceTab,
  type BrowserSurfaceTab,
  type BrowserSurfaceTabsState,
} from "./browser-surface-tabs";
import {
  APP_ROOT_ROUTE_PATH,
  BROWSER_SURFACE_ROUTE_PATH,
  isToolsRoutePath,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PLUGIN_PANEL_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  TOOLS_SKILLS_ROUTE_PATH,
} from "./route-paths";

/**
 * Where a route paints, now that the browser owns the desktop shell's main area.
 *
 * - `browser` — the surface itself; the active web tab fills the main area.
 * - `agent-panel` — the agent screens (threads, compose). They paint in the side
 *   panel, so the browser keeps the main area and the strip is left alone.
 * - `app-tab` — every remaining destination: Settings, Extensions, a plugin's
 *   panel. These take the main area, so they take a tab.
 *
 * One classifier rather than a condition per call site: "which routes are still
 * allowed to displace the browser" is exactly the question this stage answers,
 * and it must give the same answer to the layout, to the strip and to the tests.
 */
export type SurfaceRouteKind = "agent-panel" | "app-tab" | "browser";

/** Thread detail, both the projectless and the project-scoped spelling. */
const THREAD_ROUTE_PATTERNS = [
  "/threads/:threadId/*",
  "/projects/:projectId/threads/:threadId/*",
];

export function classifySurfaceRoute(pathname: string): SurfaceRouteKind {
  if (matchPath(BROWSER_SURFACE_ROUTE_PATH, pathname) !== null) {
    return "browser";
  }
  if (pathname === APP_ROOT_ROUTE_PATH) {
    return "agent-panel";
  }
  // A project's compose screen is the same New-thread screen scoped to one
  // project, so it belongs where the other agent screens are. Its *settings*
  // route below is a destination and deliberately falls through.
  if (matchPath(LEGACY_PROJECT_COMPOSE_ROUTE_PATH, pathname) !== null) {
    return "agent-panel";
  }
  if (
    THREAD_ROUTE_PATTERNS.some(
      (pattern) => matchPath(pattern, pathname) !== null,
    )
  ) {
    return "agent-panel";
  }
  return "app-tab";
}

/**
 * Identity of the *destination* a path belongs to, so app tabs behave the way
 * Chromium's own chrome:// pages do: asking for Settings a second time comes
 * back to the Settings tab you already have, wherever inside Settings you had
 * got to, instead of stacking near-identical tabs.
 *
 * Navigating within a destination therefore moves its tab, and navigating
 * between destinations switches tabs — both fall out of one lookup.
 */
export function resolveAppTabDestinationKey(pathname: string): string {
  if (
    pathname === SETTINGS_ROUTE_PATH ||
    matchPath(`${SETTINGS_ROUTE_PATH}/*`, pathname) !== null
  ) {
    return "settings";
  }
  if (isToolsRoutePath(pathname)) {
    return "tools";
  }
  const panel = matchPath(PLUGIN_PANEL_ROUTE_PATH, pathname);
  if (panel !== null) {
    // A plugin's panels are separate destinations; the plugin is not one tab.
    return `plugin:${panel.params.pluginId ?? ""}/${panel.params.panelPath ?? ""}`;
  }
  const projectSettings = matchPath(PROJECT_SETTINGS_ROUTE_PATH, pathname);
  if (projectSettings !== null) {
    return `project-settings:${projectSettings.params.projectId ?? ""}`;
  }
  return `path:${pathname}`;
}

/**
 * The mark an app tab wears in the strip. A window frame rather than the globe a
 * web tab gets: the pair is what tells the two kinds apart at a glance, since
 * both are otherwise just an icon and a title.
 */
export function resolveAppTabIconName(path: string): IconName {
  const key = destinationKeyOfTabPath(path);
  if (key === "settings" || key.startsWith("project-settings:")) {
    return "Settings";
  }
  if (key === "tools") {
    return "Puzzle";
  }
  return "AppWindow";
}

/**
 * Patcher's own destinations, as the omnibox offers them. Kept here beside the route
 * rules rather than in the provider, so "what counts as a destination" has one
 * answer: the same list the strip turns into tabs.
 *
 * Plugin panels are appended by the caller from the slot registry — a plugin
 * registering a panel gets an omnibox entry without touching this list.
 */
export const PATCHER_APP_TAB_DESTINATIONS: readonly {
  id: string;
  keywords: readonly string[];
  path: string;
  subtitle: string;
  title: string;
}[] = [
  {
    id: "settings",
    keywords: ["settings", "preferences", "options"],
    path: SETTINGS_ROUTE_PATH,
    subtitle: "Patcher settings",
    title: "Settings",
  },
  {
    id: "extensions",
    keywords: ["extensions", "plugins", "add-ons"],
    path: TOOLS_PLUGINS_ROUTE_PATH,
    subtitle: "Installed plugins",
    title: "Extensions",
  },
  {
    id: "skills",
    keywords: ["skills"],
    path: TOOLS_SKILLS_ROUTE_PATH,
    subtitle: "Skill library",
    title: "Skills",
  },
];

export interface SurfaceRouteTarget {
  /** Pathname plus search — what navigating back to this tab replays. */
  path: string;
  /** The screen's document title, or null before it has one. */
  title: string | null;
}

function destinationKeyOfTabPath(path: string): string {
  // The record keeps the search string, the key must not: `?section=x` is a
  // place inside a destination, not a destination of its own.
  return resolveAppTabDestinationKey(path.split("?")[0] ?? path);
}

/**
 * Makes the strip agree with the window.
 *
 * The window URL wins, always — which is what lets one router serve a strip of
 * many tabs. Restoring a session runs this exactly like any later navigation
 * does, so there is no separate boot path to keep correct: whatever the app
 * opens on is what the strip is corrected to.
 *
 * `target` is null on the routes that leave the main area to the browser (the
 * surface itself and the agent screens); there the strip hands the main area
 * back to a web tab.
 */
export function reconcileBrowserSurfaceTabsWithRoute(
  state: BrowserSurfaceTabsState,
  target: SurfaceRouteTarget | null,
): BrowserSurfaceTabsState {
  if (target === null) {
    const active = getActiveBrowserSurfaceTab(state);
    if (active === null || isWebSurfaceTab(active)) {
      return state;
    }
    // The most recent web tab, not the first: it is the page the user was on
    // before the app screen took over.
    const lastWebTab = state.tabs.filter(isWebSurfaceTab).at(-1);
    return lastWebTab === undefined
      ? state
      : activateBrowserSurfaceTab(state, lastWebTab.id);
  }
  const key = destinationKeyOfTabPath(target.path);
  const existing = state.tabs
    .filter(isAppSurfaceTab)
    .find((tab) => destinationKeyOfTabPath(tab.path) === key);
  if (existing === undefined) {
    return addBrowserSurfaceTab(
      state,
      createAppSurfaceTab({ path: target.path, title: target.title }),
    );
  }
  return updateAppSurfaceTab(activateBrowserSurfaceTab(state, existing.id), {
    path: target.path,
    tabId: existing.id,
    title: target.title,
  });
}

/**
 * Where the window has to go for a tab to become the visible one, or null when
 * it is already there.
 *
 * Activating a web tab navigates only when an app screen currently holds the
 * main area. On the browser route there is nothing to leave, and on an agent
 * route leaving would close the thread the user is reading in the panel beside
 * it — the panel and the main area share one URL, so a needless navigation here
 * is a lost conversation.
 */
export function resolveSurfaceTabRoute({
  isOnAppTabRoute,
  tab,
}: {
  isOnAppTabRoute: boolean;
  tab: BrowserSurfaceTab | null;
}): string | null {
  if (tab !== null && isAppSurfaceTab(tab)) {
    return tab.path;
  }
  return isOnAppTabRoute ? BROWSER_SURFACE_ROUTE_PATH : null;
}
