/**
 * `patcher.browser.control` — driving a tab past the paths that make the rest safe.
 *
 * Moved out of `plugin-api.ts` whole (#80), because that file is pinned at its
 * size and #115 had to add a command to the namespace next door. The seam is
 * where the browser API stops being about tabs, pages and navigation and starts
 * being about the three things it deliberately withholds from them: the
 * caller's own JavaScript, input at raw coordinates, and what a page is told it
 * received from the network. The route helpers come with it because nothing
 * else in that file used them.
 *
 * **What it borrows from the API's closure, and why by injection.**
 * `callBrowser` is the gate every browser call funnels through, and it is
 * generic over the result variant a command answers with, so it travels as a
 * method rather than as a value. `loadBrowserControl` matters more than it
 * looks: it is a lazy `require` rather than an import on purpose — the browser
 * schemas cost ~23MB resident in every plugin host and only a plugin that
 * drives a tab should pay for them (the measurement is at `loadBrowserControl`
 * in `plugin-api.ts`). A static import here would quietly hand that cost back
 * to every host, so the loader is passed in like the rest.
 */
import type {
  BrowserCommand,
  BrowserCommandValue,
  BrowserControlOperation,
} from "@patcher/domain/browser-control";
import type {
  PluginBrowser,
  PluginBrowserCallOptions,
  PluginBrowserRoutes,
} from "@patcher/plugin-sdk";

/** What the control namespace needs from the browser API's own closure. */
export interface PluginBrowserControlDeps {
  callBrowser: <TType extends BrowserCommandValue["type"]>(
    command: BrowserCommand,
    options: PluginBrowserCallOptions | undefined,
    expected: TType,
  ) => Promise<Extract<BrowserCommandValue, { type: TType }>>;
  optionalTabId: (tabId: unknown) => string | null;
  normalizeSnapshotGeneration: (generation: unknown) => number | null;
  loadBrowserControl: () => typeof import("@patcher/domain/browser-control");
}

export function createPluginBrowserControl({
  callBrowser,
  optionalTabId,
  normalizeSnapshotGeneration,
  loadBrowserControl,
}: PluginBrowserControlDeps): PluginBrowser["control"] {
  /**
   * A route, with what an API mock wants without having to say so: 200, an
   * empty body, and a content type read off the body's first character. A mock
   * served as the wrong type fails in a way that looks like the mock never
   * fired, which is an expensive thing to debug.
   */
  function routeCandidate(args: unknown): unknown {
    const record = (
      typeof args === "object" && args !== null ? args : {}
    ) as Record<string, unknown>;
    const body = record.body ?? "";
    return {
      pattern: record.pattern,
      status: record.status ?? 200,
      contentType:
        record.contentType ??
        (typeof body === "string" && /^\s*[[{]/u.test(body)
          ? "application/json"
          : "text/plain"),
      body,
      headers: record.headers ?? [],
    };
  }

  /**
   * Every direct-control operation is checked here, the way `page.act`'s is:
   * against the schema the app will parse it with, so a plugin's own mistake
   * reads as that plugin's error rather than as a refusal that travelled to the
   * browser and back.
   */
  function normalizeControlOperation(
    candidate: unknown,
    method: string,
  ): BrowserControlOperation {
    const parsed =
      loadBrowserControl().browserControlOperationSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      throw new Error(
        `${method} received invalid arguments${
          path === "" ? "" : ` (${path})`
        }: ${issue?.message ?? "unrecognized"}`,
      );
    }
    return parsed.data;
  }

  /** The three route calls differ only in the operation they send. */
  async function controlRoutes(
    operation: BrowserControlOperation,
    tabId: string | undefined,
    options: PluginBrowserCallOptions | undefined,
  ): Promise<PluginBrowserRoutes> {
    const value = await callBrowser(
      {
        type: "page.control",
        tabId: optionalTabId(tabId),
        generation: null,
        operation,
      },
      options,
      "routes",
    );
    return {
      tabId: value.tabId,
      url: value.url,
      title: value.title,
      routes: value.routes,
      offline: value.offline,
    };
  }

  return {
    async evaluate(args, options) {
      const value = await callBrowser(
        {
          type: "page.control",
          tabId: optionalTabId(args?.tabId),
          generation: normalizeSnapshotGeneration(args?.generation),
          operation: normalizeControlOperation(
            {
              kind: "evaluate",
              expression: args?.expression,
              ref: args?.ref ?? null,
            },
            "browser.control.evaluate",
          ),
        },
        options,
        "evaluated",
      );
      return {
        tabId: value.tabId,
        url: value.url,
        title: value.title,
        value: value.value,
        truncated: value.truncated,
      };
    },
    async mouseMove(args, options) {
      const value = await callBrowser(
        {
          type: "page.control",
          tabId: optionalTabId(args?.tabId),
          generation: null,
          operation: normalizeControlOperation(
            { kind: "mouse-move", x: args?.x, y: args?.y },
            "browser.control.mouseMove",
          ),
        },
        options,
        "interacted",
      );
      return { tabId: value.tabId, url: value.url, title: value.title };
    },
    async mouseButton(args, options) {
      const value = await callBrowser(
        {
          type: "page.control",
          tabId: optionalTabId(args?.tabId),
          generation: null,
          operation: normalizeControlOperation(
            {
              kind: "mouse-button",
              button: args?.button ?? "left",
              down: args?.down,
            },
            "browser.control.mouseButton",
          ),
        },
        options,
        "interacted",
      );
      return { tabId: value.tabId, url: value.url, title: value.title };
    },
    async mouseWheel(args, options) {
      const value = await callBrowser(
        {
          type: "page.control",
          tabId: optionalTabId(args?.tabId),
          generation: null,
          operation: normalizeControlOperation(
            {
              kind: "mouse-wheel",
              deltaX: args?.deltaX ?? 0,
              deltaY: args?.deltaY ?? 0,
            },
            "browser.control.mouseWheel",
          ),
        },
        options,
        "interacted",
      );
      return { tabId: value.tabId, url: value.url, title: value.title };
    },
    async route(args, options) {
      return await controlRoutes(
        normalizeControlOperation(
          { kind: "route-set", route: routeCandidate(args) },
          "browser.control.route",
        ),
        args?.tabId,
        options,
      );
    },
    async routes(args, options) {
      return await controlRoutes({ kind: "route-list" }, args?.tabId, options);
    },
    async unroute(args, options) {
      return await controlRoutes(
        normalizeControlOperation(
          { kind: "route-clear", pattern: args?.pattern ?? null },
          "browser.control.unroute",
        ),
        args?.tabId,
        options,
      );
    },
    async setOffline(args, options) {
      const value = await callBrowser(
        {
          type: "page.control",
          tabId: optionalTabId(args?.tabId),
          generation: null,
          operation: normalizeControlOperation(
            { kind: "offline", offline: args?.offline },
            "browser.control.setOffline",
          ),
        },
        options,
        "interacted",
      );
      return { tabId: value.tabId, url: value.url, title: value.title };
    },
  };
}
