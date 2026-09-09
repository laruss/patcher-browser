/**
 * The fake host's `patcher.browser.control` — the double for direct control.
 *
 * Moved out of `fake-plugin-host.ts` whole (#80), mirroring the split of
 * `plugin-api.ts` it doubles for: that file is pinned at its size and #115 had
 * to add a method to the namespace next door. This half was the one that could
 * leave, because it reads and writes the page store through functions and never
 * touches the fake's own mutable counters the way `page` and `recording` do.
 *
 * The deps are the slice of the fake's closure these eight methods use, named
 * as narrowly as they are used: the page store is described here by the three
 * fields the control calls read and write, not by the fake's whole page
 * content, so this module does not have to see the rest of it.
 */
import type {
  PluginBrowser,
  PluginBrowserRouteState,
  PluginBrowserTab,
} from "@patcher/plugin-sdk";
import type { PluginPermission } from "@patcher/domain";

/** What the control namespace reads out of, and writes into, the page store. */
interface FakeBrowserControlPageContent {
  evaluated: string;
  routes: readonly PluginBrowserRouteState[];
  offline: boolean;
}

export interface FakeBrowserControlDeps {
  beginBrowserCall: (
    type: string,
    permission: PluginPermission,
    args?: Record<string, unknown>,
  ) => void;
  requireLiveBrowserTab: (tabId: string | undefined) => PluginBrowserTab;
  readBrowserPageContent: (tabId: string) => FakeBrowserControlPageContent;
  writeBrowserPageContent: (
    tabId: string,
    patch: Partial<FakeBrowserControlPageContent>,
  ) => void;
  browserPageStateOf: (tabId: string | undefined) => {
    tabId: string;
    url: string;
    title: string | null;
  };
  browserRoutesOf: (tab: PluginBrowserTab) => {
    tabId: string;
    url: string;
    title: string | null;
    routes: PluginBrowserRouteState[];
    offline: boolean;
  };
}

export function createFakeBrowserControl({
  beginBrowserCall,
  requireLiveBrowserTab,
  readBrowserPageContent,
  writeBrowserPageContent,
  browserPageStateOf,
  browserRoutesOf,
}: FakeBrowserControlDeps): PluginBrowser["control"] {
  return {
    evaluate(args) {
      beginBrowserCall("control.evaluate", "page.inject", { ...args });
      const tab = requireLiveBrowserTab(args?.tabId);
      return Promise.resolve({
        tabId: tab.tabId,
        url: tab.url,
        title: tab.title,
        value: readBrowserPageContent(tab.tabId).evaluated,
        truncated: false,
      });
    },
    mouseMove(args) {
      beginBrowserCall("control.mouseMove", "page.interact", { ...args });
      return Promise.resolve(browserPageStateOf(args?.tabId));
    },
    mouseButton(args) {
      beginBrowserCall("control.mouseButton", "page.interact", { ...args });
      return Promise.resolve(browserPageStateOf(args?.tabId));
    },
    mouseWheel(args) {
      beginBrowserCall("control.mouseWheel", "page.interact", { ...args });
      return Promise.resolve(browserPageStateOf(args?.tabId));
    },
    route(args) {
      beginBrowserCall("control.route", "network.intercept", { ...args });
      const tab = requireLiveBrowserTab(args?.tabId);
      const body = args?.body ?? "";
      // Newest first and one route per pattern, as the shell keeps them, so a
      // test can tell which of two overlapping mocks would answer.
      writeBrowserPageContent(tab.tabId, {
        routes: [
          {
            pattern: args.pattern,
            status: args.status ?? 200,
            contentType:
              args.contentType ??
              (/^\s*[[{]/u.test(body) ? "application/json" : "text/plain"),
            body,
            headers: args.headers ?? [],
            matched: 0,
          },
          ...readBrowserPageContent(tab.tabId).routes.filter(
            (route) => route.pattern !== args.pattern,
          ),
        ],
      });
      return Promise.resolve(browserRoutesOf(tab));
    },
    routes(args) {
      beginBrowserCall("control.routes", "network.intercept", { ...args });
      return Promise.resolve(
        browserRoutesOf(requireLiveBrowserTab(args?.tabId)),
      );
    },
    unroute(args) {
      beginBrowserCall("control.unroute", "network.intercept", { ...args });
      const tab = requireLiveBrowserTab(args?.tabId);
      const pattern = args?.pattern;
      writeBrowserPageContent(tab.tabId, {
        routes:
          pattern === undefined
            ? []
            : readBrowserPageContent(tab.tabId).routes.filter(
                (route) => route.pattern !== pattern,
              ),
      });
      return Promise.resolve(browserRoutesOf(tab));
    },
    setOffline(args) {
      beginBrowserCall("control.setOffline", "network.intercept", {
        ...args,
      });
      const tab = requireLiveBrowserTab(args?.tabId);
      writeBrowserPageContent(tab.tabId, { offline: args.offline });
      return Promise.resolve(browserPageStateOf(tab.tabId));
    },
  };
}
