/**
 * `patcher.browser.tabs` — the strip, driven.
 *
 * Moved out of `plugin-api.ts` whole (#80), for the reason its sibling
 * `plugin-api-browser-control.ts` was: that file is pinned at its size, and
 * #117 had to add a method here — `release`, which hands a tab back to the
 * person without closing it. The pinned files are the debt rather than an
 * exemption, so code that needs room goes into a module instead of pushing a
 * pin up.
 *
 * The seam is the one the SDK already draws: these nine methods are about which
 * tabs exist and where they sit, and none of them reaches into what a page
 * contains. What they borrow from the API's closure is passed in for the same
 * reason the control namespace's is — `callBrowser` is the gate every browser
 * call funnels through and is generic over the result variant a command answers
 * with, so it travels as a method rather than as a value.
 */
import type {
  BrowserCommand,
  BrowserCommandValue,
} from "@patcher/domain/browser-control";
import type {
  PluginBrowser,
  PluginBrowserCallOptions,
} from "@patcher/plugin-sdk";

/** What the tabs namespace needs from the browser API's own closure. */
export interface PluginBrowserTabsDeps {
  callBrowser: <TType extends BrowserCommandValue["type"]>(
    command: BrowserCommand,
    options: PluginBrowserCallOptions | undefined,
    expected: TType,
  ) => Promise<Extract<BrowserCommandValue, { type: TType }>>;
  requireTabId: (tabId: unknown, method: string) => string;
  normalizeBrowserUrlArg: (url: unknown, method: string) => string | null;
}

export function createPluginBrowserTabs({
  callBrowser,
  requireTabId,
  normalizeBrowserUrlArg,
}: PluginBrowserTabsDeps): PluginBrowser["tabs"] {
  return {
    async list(options) {
      return (await callBrowser({ type: "tabs.list" }, options, "tabs")).tabs;
    },
    async open(args, options) {
      return (
        await callBrowser(
          {
            type: "tabs.open",
            url: normalizeBrowserUrlArg(args?.url, "tabs.open"),
            activate: args?.activate ?? true,
          },
          options,
          "tab",
        )
      ).tab;
    },
    async close(args, options) {
      const value = await callBrowser(
        {
          type: "tabs.close",
          tabId: requireTabId(args?.tabId, "tabs.close"),
        },
        options,
        "closed",
      );
      return { closedTabId: value.closedTabId, tabs: value.tabs };
    },
    async release(args, options) {
      return (
        await callBrowser(
          {
            type: "tabs.release",
            tabId: requireTabId(args?.tabId, "tabs.release"),
          },
          options,
          "tab",
        )
      ).tab;
    },
    async activate(args, options) {
      return (
        await callBrowser(
          {
            type: "tabs.activate",
            tabId: requireTabId(args?.tabId, "tabs.activate"),
          },
          options,
          "tab",
        )
      ).tab;
    },
    async pin(args, options) {
      return (
        await callBrowser(
          {
            type: "tabs.pin",
            tabId: requireTabId(args?.tabId, "tabs.pin"),
            pinned: args?.pinned ?? true,
          },
          options,
          "tab",
        )
      ).tab;
    },
    async mute(args, options) {
      return (
        await callBrowser(
          {
            type: "tabs.mute",
            tabId: requireTabId(args?.tabId, "tabs.mute"),
            muted: args?.muted ?? true,
          },
          options,
          "tab",
        )
      ).tab;
    },
    async duplicate(args, options) {
      return (
        await callBrowser(
          {
            type: "tabs.duplicate",
            tabId: requireTabId(args?.tabId, "tabs.duplicate"),
          },
          options,
          "tab",
        )
      ).tab;
    },
    async move(args, options) {
      return (
        await callBrowser(
          {
            type: "tabs.move",
            tabId: requireTabId(args?.tabId, "tabs.move"),
            toIndex: args?.toIndex ?? 0,
          },
          options,
          "tab",
        )
      ).tab;
    },
  };
}
