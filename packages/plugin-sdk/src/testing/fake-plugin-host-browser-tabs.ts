/**
 * The fake host's `patcher.browser.tabs` — the double for the strip.
 *
 * Moved out of `fake-plugin-host.ts` whole (#80), mirroring both its sibling
 * `fake-plugin-host-browser-control.ts` and the split of the `plugin-api.ts`
 * namespace it doubles for: that file is pinned at its size and #117 had to add
 * `release` to this namespace. A pinned file is the debt rather than an
 * exemption, so the code goes into a module instead of pushing the pin up.
 *
 * The one piece of the fake's closure these methods *mutate* is the tab list,
 * so it travels as a read and a write rather than as a value — the same shape
 * the control namespace's page store uses next door, and for the same reason:
 * the fake keeps that list in a `let` the rest of the file also reads.
 */
import type { PluginBrowser, PluginBrowserTab } from "@patcher/plugin-sdk";
import type { PluginPermission } from "@patcher/domain";

export interface FakeBrowserTabsDeps {
  beginBrowserCall: (
    type: string,
    permission: PluginPermission,
    args?: Record<string, unknown>,
  ) => void;
  readBrowserTabs: () => readonly PluginBrowserTab[];
  writeBrowserTabs: (tabs: readonly PluginBrowserTab[]) => void;
  resolveBrowserTab: (tabId: string | undefined) => PluginBrowserTab;
  activateBrowserTab: (tabId: string) => PluginBrowserTab;
}

export function createFakeBrowserTabs({
  beginBrowserCall,
  readBrowserTabs,
  writeBrowserTabs,
  resolveBrowserTab,
  activateBrowserTab,
}: FakeBrowserTabsDeps): PluginBrowser["tabs"] {
  return {
    list() {
      beginBrowserCall("tabs.list", "tabs.read");
      return Promise.resolve(readBrowserTabs().map((tab) => ({ ...tab })));
    },
    open(args) {
      beginBrowserCall("tabs.open", "tabs.modify", { ...args });
      const tabId = `fake-tab-${readBrowserTabs().length + 1}`;
      const activate = args?.activate ?? true;
      const url = args?.url ?? "";
      const tab: PluginBrowserTab = {
        tabId,
        url,
        title: null,
        active: activate,
        // A tab opened in the foreground is not live *yet*: the strip has to
        // mount its view, which has not happened by the time this answers.
        // A background open is, and that is not a quirk of the fake — the
        // host attaches a hidden view and waits for it, precisely so that
        // "open without stealing focus" leaves something readable behind.
        live: !activate && url.length > 0,
        loading: false,
        canGoBack: false,
        canGoForward: false,
      };
      writeBrowserTabs(
        activate
          ? [
              ...readBrowserTabs().map((each) => ({ ...each, active: false })),
              tab,
            ]
          : [...readBrowserTabs(), tab],
      );
      return Promise.resolve({ ...tab });
    },
    close(args) {
      beginBrowserCall("tabs.close", "tabs.modify", { ...args });
      const tab = resolveBrowserTab(args.tabId);
      writeBrowserTabs(
        readBrowserTabs().filter((each) => each.tabId !== tab.tabId),
      );
      if (tab.active && readBrowserTabs().length > 0) {
        writeBrowserTabs(
          readBrowserTabs().map((each, index) => ({
            ...each,
            active: index === readBrowserTabs().length - 1,
          })),
        );
      }
      return Promise.resolve({
        closedTabId: tab.tabId,
        tabs: readBrowserTabs().map((each) => ({ ...each })),
      });
    },
    release(args) {
      beginBrowserCall("tabs.release", "tabs.read", { ...args });
      // The fake models no ownership at all, so there is no claim to drop —
      // what it can answer for is the call shape and the price.
      return Promise.resolve({ ...resolveBrowserTab(args.tabId) });
    },
    activate(args) {
      beginBrowserCall("tabs.activate", "tabs.modify", { ...args });
      resolveBrowserTab(args.tabId);
      return Promise.resolve({ ...activateBrowserTab(args.tabId) });
    },
    // Pinning and muting are strip state the real browser holds and a
    // `PluginBrowserTab` does not carry, so the fake records the call — which
    // is what a plugin test can assert — and answers with the tab unchanged.
    pin(args) {
      beginBrowserCall("tabs.pin", "tabs.modify", { ...args });
      return Promise.resolve({ ...resolveBrowserTab(args.tabId) });
    },
    mute(args) {
      beginBrowserCall("tabs.mute", "tabs.modify", { ...args });
      return Promise.resolve({ ...resolveBrowserTab(args.tabId) });
    },
    move(args) {
      beginBrowserCall("tabs.move", "tabs.modify", { ...args });
      const moved = resolveBrowserTab(args.tabId);
      const rest = readBrowserTabs().filter(
        (each) => each.tabId !== moved.tabId,
      );
      const toIndex = Math.min(Math.max(args.toIndex, 0), rest.length);
      writeBrowserTabs([
        ...rest.slice(0, toIndex),
        moved,
        ...rest.slice(toIndex),
      ]);
      return Promise.resolve({ ...moved });
    },
    duplicate(args) {
      beginBrowserCall("tabs.duplicate", "tabs.modify", { ...args });
      const source = resolveBrowserTab(args.tabId);
      const duplicate: PluginBrowserTab = {
        ...source,
        tabId: `fake-tab-${readBrowserTabs().length + 1}`,
        active: true,
      };
      // Beside its source, where the real one puts it.
      const index = readBrowserTabs().findIndex(
        (each) => each.tabId === source.tabId,
      );
      const rest = readBrowserTabs().map((each) => ({
        ...each,
        active: false,
      }));
      writeBrowserTabs([
        ...rest.slice(0, index + 1),
        duplicate,
        ...rest.slice(index + 1),
      ]);
      return Promise.resolve({ ...duplicate });
    },
  };
}
