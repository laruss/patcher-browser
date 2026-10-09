import type { Session } from "electron";
import { matchesBrowserUrlPattern } from "@patcher/domain/browser-url-pattern";
import {
  SITE_ACCESS_CHANNELS,
  PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH,
  type PatcherDesktopBrowserPageStyle,
  type PatcherDesktopBrowserPageScript,
  type PatcherDesktopPageScriptWorld,
  type PatcherDesktopPageScriptRpcRequest,
  type PatcherDesktopPageScriptRpcAnswer,
  type PatcherDesktopBrowserPageScriptCall,
  type ScopedPageCall,
} from "@patcher/desktop-contract";
import { PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL } from "./desktop-browser-ipc.js";
import type {
  BrowserViewEntry,
  DesktopBrowserHostWindow,
} from "./desktop-browser-view.js";
import type { DesktopSiteAuthority } from "./desktop-site-authority.js";

/** Identifies the browsing session's page-script preload, for unregistering. */
const PAGE_SCRIPT_PRELOAD_ID = "patcher-page-scripts";

/**
 * Where the isolated worlds page scripts run in start.
 *
 * High on purpose. Chromium hands out the world ids behind
 * `Page.createIsolatedWorld` — the mechanism behind Patcher's own automation world —
 * from a low counter, so starting here keeps the two apart. Measured on Electron
 * 41.7.0: with world 9001 in use, a CDP-created world came back as 5, and neither
 * could see the other's globals.
 */
const PAGE_SCRIPT_WORLD_BASE = 9001;

/**
 * How long a page script's `patcher.rpc` waits.
 *
 * A backstop rather than a policy: the answer travels through this window's
 * renderer to the Patcher server and back, and nothing in that path has a deadline of
 * its own, so without this a plugin that never answers leaves a page script
 * awaiting a promise for the life of the tab.
 */
const PAGE_SCRIPT_CALL_TIMEOUT_MS = 30_000;

/**
 * The sliding window on `patcher.rpc`.
 *
 * Generous enough for a script answering clicks and typing, and bounded because
 * a page script in a loop would otherwise be a page driving the Patcher server.
 */

const PAGE_SCRIPT_RATE_WINDOW_MS = 10_000;
const PAGE_SCRIPT_RATE_MAX_IN_WINDOW = 60;

export function createDesktopPageContributions(args: {
  siteAuthority?: () => DesktopSiteAuthority | undefined;
  pageScriptPreloadPath: string;
  entriesByWebContentsId: Map<number, BrowserViewEntry>;
  ensureHardenedSession(): Session;
  send(
    hostWindow: DesktopBrowserHostWindow,
    channel: string,
    payload: PatcherDesktopBrowserPageScriptCall | ScopedPageCall,
  ): void;
}) {
  const { entriesByWebContentsId, ensureHardenedSession, send } = args;
  const runtimePageCalls = new Map<string, { assert(): void; close(): void }>();
  /**
   * Plugin page styles, as the renderer last declared them. Held here for a
   * sharper reason than the menu entries above: this is where navigation
   * happens, and inserted CSS lasts exactly one document, so re-applying it is
   * something only the shell can do at the moment the page commits.
   */
  let pageStyles: readonly PatcherDesktopBrowserPageStyle[] = [];

  /**
   * Bring one view's applied stylesheets in line with what should be applied to
   * the page it is showing.
   *
   * Reconciliation rather than "insert on navigate", because two different
   * things call it: a commit, where nothing is applied yet, and a change to the
   * declared set, where a document may already be carrying styles that should
   * now go. One function that compares desired against applied answers both, and
   * cannot double-insert.
   *
   * Failures are swallowed per style. A page that is being torn down rejects an
   * insertion, and the tab it happened in is not a place to report anything —
   * whereas letting it reject would abandon the styles queued behind it.
   */
  async function reconcilePageStyles(entry: BrowserViewEntry): Promise<void> {
    const webContents = entry.view.webContents;
    if (webContents.isDestroyed()) {
      return;
    }
    const url = webContents.getURL();
    const wanted = new Map<string, PatcherDesktopBrowserPageStyle>();
    // Only a real page: `about:blank` and the empty URL of a fresh view are not
    // sites, and a pattern like `https://**/**` must not be read as claiming them.
    if (url.startsWith("https://") || url.startsWith("http://")) {
      const authority = args.siteAuthority?.();
      for (const style of [
        ...pageStyles.filter((style) => !authority?.known(style.pluginId)),
        ...(authority?.styles() ?? []),
      ]) {
        if (
          authority?.known(style.pluginId) &&
          !authority.acceptsContribution(style, url)
        )
          continue;
        if (
          style.matches.some((pattern) =>
            matchesBrowserUrlPattern(pattern, url),
          )
        ) {
          wanted.set(`${style.pluginId}:${style.styleId}`, style);
        }
      }
    }
    const document = entry.pageStyleDocument;
    for (const [id, cssKey] of [...entry.appliedPageStyles]) {
      if (wanted.has(id)) continue;
      entry.appliedPageStyles.delete(id);
      try {
        await webContents.removeInsertedCSS(cssKey);
      } catch {
        // The document that carried it is gone, which is the outcome asked for.
      }
    }
    for (const [id, style] of wanted) {
      if (entry.appliedPageStyles.has(id)) continue;
      // Claim the slot before awaiting: a second reconcile for the same document
      // — a push arriving mid-commit — would otherwise insert the same
      // stylesheet twice and remember only one of the two keys.
      entry.appliedPageStyles.set(id, "");
      try {
        if (
          args.siteAuthority?.()?.known(style.pluginId) &&
          !args
            .siteAuthority?.()
            ?.acceptsContribution(style, webContents.getURL())
        )
          continue;
        const cssKey = await webContents.insertCSS(style.css);
        if (
          args.siteAuthority?.()?.known(style.pluginId) &&
          !args
            .siteAuthority?.()
            ?.acceptsContribution(style, webContents.getURL())
        ) {
          await webContents.removeInsertedCSS(cssKey);
          entry.appliedPageStyles.delete(id);
          continue;
        }
        if (entry.pageStyleDocument !== document) {
          // The page moved on while this was in flight. The key names a
          // stylesheet in a document that no longer exists, so it is not worth
          // filing — and the commit that replaced it cleared this map and
          // reconciled again, so whatever stands under `id` now is that
          // document's and must not be dropped on this pass's way out.
          continue;
        }
        if (entry.appliedPageStyles.get(id) !== "") {
          // The slot stopped being ours: a reconcile for this same document
          // released it because the style is no longer declared. Take the
          // stylesheet back rather than leaving one nothing remembers.
          try {
            await webContents.removeInsertedCSS(cssKey);
          } catch {
            // The document that carried it is gone, which is the outcome asked
            // for.
          }
          continue;
        }
        entry.appliedPageStyles.set(id, cssKey);
      } catch {
        // Same two questions as the success path, in the same order. The
        // document first: a page being torn down is what rejects an insertion,
        // and that is exactly when the next one commits — so a stale failure
        // must not clear a slot the new document's reconcile is holding, or that
        // reconcile finds its own claim gone and takes its stylesheet back.
        // Then the slot, so a release for this same document is not undone.
        if (
          entry.pageStyleDocument === document &&
          entry.appliedPageStyles.get(id) === ""
        ) {
          entry.appliedPageStyles.delete(id);
        }
      }
    }
  }
  /**
   * Plugin page scripts, as the renderer last declared them, and the worlds they
   * run in.
   *
   * Held here for the reason the styles above are, one step sharper: a script has
   * to reach a document *as it is created*, before the page's own first script
   * runs, and this is the only process present at that moment.
   */
  let pageScripts: readonly PatcherDesktopBrowserPageScript[] = [];
  /**
   * Whether the browsing session currently carries the page-script preload.
   *
   * The load-bearing property of this whole surface: while no plugin declares a
   * page script, no preload is installed, so a browsed renderer holds no Patcher code
   * at all and the shell's standing rule needs no qualification. Measured: after
   * `unregisterPreloadScript`, the next document has no preload and the isolated
   * world is empty.
   */
  let pageScriptPreloadRegistered = false;
  /**
   * `pluginId` → the isolated world its scripts run in, allocated on first sight
   * and stable after.
   *
   * One world per plugin, not one per script and not one shared: two scripts of
   * the same plugin are one program and may share globals, while two plugins are
   * two programs and — measured — cannot see each other's `patcher` or anything else.
   */
  const pageScriptWorldIds = new Map<string, number>();
  let pageScriptCallSequence = 0;
  /**
   * `patcher.rpc` calls in flight: callId → how to answer the page that asked.
   *
   * The request starts in a browsed renderer, is answered by this window's
   * renderer, and has to find its way back, so the correlation lives here. A late
   * answer resolves nothing and is dropped, exactly as a late dialog answer is.
   */
  const pendingPageScriptCalls = new Map<
    string,
    (answer: PatcherDesktopPageScriptRpcAnswer) => void
  >();

  function pageScriptWorldId(pluginId: string): number {
    const existing = pageScriptWorldIds.get(pluginId);
    if (existing !== undefined) {
      return existing;
    }
    const worldId = PAGE_SCRIPT_WORLD_BASE + pageScriptWorldIds.size;
    pageScriptWorldIds.set(pluginId, worldId);
    return worldId;
  }

  /**
   * The worlds a document at this address should get, grouped by plugin.
   *
   * The same matching a page style gets, against the same declared patterns, and
   * the same refusal to treat a blank page as a site: `https://**` must not be
   * read as claiming `about:blank`.
   */
  function pageScriptWorldsFor(url: string): PatcherDesktopPageScriptWorld[] {
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      return [];
    }
    const worlds = new Map<string, PatcherDesktopPageScriptWorld>();
    const authority = args.siteAuthority?.();
    for (const script of [
      ...pageScripts.filter((script) => !authority?.known(script.pluginId)),
      ...(authority?.scripts() ?? []),
    ]) {
      if (
        authority?.known(script.pluginId) &&
        !authority.acceptsContribution(script, url)
      )
        continue;
      if (
        !script.matches.some((pattern) =>
          matchesBrowserUrlPattern(pattern, url),
        )
      ) {
        continue;
      }
      let world = worlds.get(script.pluginId);
      if (world === undefined) {
        world = {
          pluginId: script.pluginId,
          worldId: pageScriptWorldId(script.pluginId),
          scripts: [],
        };
        worlds.set(script.pluginId, world);
      }
      world.scripts.push({ scriptId: script.scriptId, code: script.code });
    }
    return [...worlds.values()];
  }

  /**
   * Install or remove the browsing session's page-script preload to match what is
   * declared.
   *
   * Preloads are read as a frame's document is created, so this takes effect on
   * the next load of a page — which is also what Chrome's content scripts do, and
   * the honest thing to tell a plugin author: a script registered while a matching
   * page is open runs when that page is reloaded.
   */
  function syncPageScriptPreload(): void {
    const wanted =
      pageScripts.length > 0 ||
      (args.siteAuthority?.()?.scripts().length ?? 0) > 0;
    if (wanted === pageScriptPreloadRegistered) {
      return;
    }
    const browserSession = ensureHardenedSession();
    try {
      if (wanted) {
        browserSession.registerPreloadScript({
          id: PAGE_SCRIPT_PRELOAD_ID,
          type: "frame",
          filePath: args.pageScriptPreloadPath,
        });
      } else {
        browserSession.unregisterPreloadScript(PAGE_SCRIPT_PRELOAD_ID);
      }
      pageScriptPreloadRegistered = wanted;
    } catch {
      // A session that will not take the preload leaves page scripts not
      // running, which is the safe direction: nothing half-installed, and the
      // flag stays false so the next push tries again.
    }
  }

  function refusePageScriptCall(
    message: string,
  ): PatcherDesktopPageScriptRpcAnswer {
    return { ok: false, message };
  }

  /**
   * One `patcher.rpc` from a page script.
   *
   * `url` is the frame's address as Chromium reports it to this process, never
   * something the payload claimed, and the plugin is re-checked against it on
   * every call rather than once at injection. That is what bounds a browsed
   * renderer that has been taken over: it can reach the plugins that already
   * claim the page it is actually on, and nothing else — the same set a
   * well-behaved script on that page could reach.
   */
  async function callPageScriptRpc(callArgs: {
    webContentsId: number;
    url: string;
    request: PatcherDesktopPageScriptRpcRequest;
    documentId?: string;
  }): Promise<PatcherDesktopPageScriptRpcAnswer> {
    const entry = entriesByWebContentsId.get(callArgs.webContentsId);
    if (entry === undefined) {
      return refusePageScriptCall("patcher.rpc is not available in this page.");
    }
    const { pluginId, method, input } = callArgs.request;
    const authority = args.siteAuthority?.();
    const runtime = authority?.known(pluginId) === true;
    if (
      runtime &&
      (callArgs.documentId === undefined ||
        callArgs.documentId !== entry.runtimeDocumentId ||
        entry.view.webContents.getURL() !== callArgs.url)
    )
      return refusePageScriptCall(
        "Runtime page context is stale or unavailable",
      );
    if (
      !pageScriptWorldsFor(callArgs.url).some(
        (world) => world.pluginId === pluginId,
      )
    ) {
      return refusePageScriptCall(
        `patcher.rpc: plugin "${pluginId}" declares no page script for this address.`,
      );
    }
    const now = Date.now();
    const recent = entry.pageScriptCallTimestamps.filter(
      (stamp) => now - stamp < PAGE_SCRIPT_RATE_WINDOW_MS,
    );
    if (recent.length >= PAGE_SCRIPT_RATE_MAX_IN_WINDOW) {
      entry.pageScriptCallTimestamps = recent;
      return refusePageScriptCall(
        `patcher.rpc: too many calls — at most ${PAGE_SCRIPT_RATE_MAX_IN_WINDOW} every ${
          PAGE_SCRIPT_RATE_WINDOW_MS / 1000
        } seconds.`,
      );
    }
    entry.pageScriptCallTimestamps = [...recent, now];

    const hostWindow = entry.hostWindow;
    if (hostWindow.webContents.isDestroyed()) {
      return refusePageScriptCall(
        "patcher.rpc: this tab's Patcher window is gone.",
      );
    }
    const callId = `page-script-${(pageScriptCallSequence += 1)}`;
    const token = runtime
      ? authority!.rpcToken(pluginId, entry.tabId, method, input)
      : undefined;
    const guard = token === undefined ? undefined : authority!.rpcGuard(token);
    return await new Promise<PatcherDesktopPageScriptRpcAnswer>((resolve) => {
      const timer = setTimeout(() => {
        if (pendingPageScriptCalls.delete(callId)) {
          runtimePageCalls.delete(callId);
          guard?.close();
          resolve(
            refusePageScriptCall(
              `patcher.rpc("${method}"): no answer within ${
                PAGE_SCRIPT_CALL_TIMEOUT_MS / 1000
              } seconds.`,
            ),
          );
        }
      }, PAGE_SCRIPT_CALL_TIMEOUT_MS);
      // Unref'd so a call in flight cannot hold the process open at shutdown.
      timer.unref?.();
      pendingPageScriptCalls.set(callId, (answer) => {
        clearTimeout(timer);
        runtimePageCalls.delete(callId);
        try {
          guard?.assert();
          resolve(answer);
        } catch {
          resolve(
            refusePageScriptCall(
              "Runtime page access was revoked or the document changed",
            ),
          );
        } finally {
          guard?.close();
        }
      });
      if (guard) runtimePageCalls.set(callId, guard);
      if (token !== undefined) {
        send(hostWindow, SITE_ACCESS_CHANNELS.pageCall, {
          callId,
          token,
          pluginId,
          method,
          input,
        });
        return;
      }
      send(hostWindow, PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL, {
        callId,
        tabId: entry.tabId,
        pluginId,
        method,
        input,
        url: callArgs.url.slice(0, PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
      });
    });
  }

  return {
    reconcilePageStyles,
    pageScriptWorldsFor,
    syncPageScriptPreload,
    callPageScriptRpc,
    pendingPageScriptCalls,
    runtimePageCalls,
    setStyles(value: readonly PatcherDesktopBrowserPageStyle[]) {
      pageStyles = value;
    },
    setScripts(value: readonly PatcherDesktopBrowserPageScript[]) {
      pageScripts = value;
    },
  };
}
