import { beforeEach, describe, expect, it, vi } from "vitest";
import { type PatcherDesktopBrowserPageScriptCall } from "@patcher/desktop-contract";
import { PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL } from "../src/desktop-browser-ipc.js";
import { type DesktopBrowserViewManager } from "../src/desktop-browser-view.js";
import { FakeHostWindow } from "./desktop-browser-host-window-fakes.js";
import {
  electronMock,
  resetElectronMock,
} from "./desktop-browser-electron-fakes.js";
import {
  TEST_PAGE_SCRIPT_PRELOAD_PATH,
  attachBrowserTab,
  createDesktopBrowserViewManager,
  requireFakeSession,
  requireFakeView,
} from "./desktop-browser-view-manager-harness.js";

/**
 * What a plugin contributes to a browsed page: its styles and its page scripts.
 *
 * Part of the `desktop-browser-view-manager` suite — see that file for the
 * shared harness and the rest of the split (#80).
 */

vi.mock("electron", async () => {
  const fakes = await import("./desktop-browser-electron-fakes.js");
  return fakes.electronModule;
});

beforeEach(resetElectronMock);

describe("plugin page styles", () => {
  const GITHUB_STYLE = {
    pluginId: "declutter",
    styleId: "feed",
    matches: ["https://github.com/**"],
    css: ".feed { display: none }",
  };

  function attachTab(url: string): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({ hostWindow, manager, tabId: "browser:a", url });
    return { hostWindow, manager, view: requireFakeView(0) };
  }

  // The whole point of holding these in the shell: inserted CSS lives one
  // document, so the moment the page commits is the moment to re-apply, and a
  // renderer round trip would be a race against first paint.
  it("applies a matching style when the page commits", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();
    view.webContents.insertedCss.length = 0;

    view.webContents.emitDidNavigate("https://github.com/patcher/pulls");
    await Promise.resolve();

    expect(view.webContents.insertedCss).toEqual([".feed { display: none }"]);
  });

  it("leaves a page no declared site matches alone", async () => {
    const { hostWindow, manager, view } = attachTab("https://example.test/");
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();

    view.webContents.emitDidNavigate("https://example.test/other");
    await Promise.resolve();

    expect(view.webContents.insertedCss).toEqual([]);
  });

  // A pattern only names a website because `patcher.sites` normalised it, and that
  // happened two processes away — so the shell decides for itself that Patcher's own
  // blank page is not a site. `**` is the pattern that shows it: a style for
  // "everything" must not restyle the app's own pages.
  it("treats a page that is not a site as no page at all", async () => {
    const { hostWindow, manager, view } = attachTab("");
    manager.setPageStyles({
      hostWindow,
      request: {
        styles: [{ ...GITHUB_STYLE, matches: ["**"] }],
      },
    });
    await Promise.resolve();

    expect(view.webContents.insertedCss).toEqual([]);
  });

  it("applies to a page already open when the style arrives", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.emitDidNavigate("https://github.com/");
    await Promise.resolve();
    expect(view.webContents.insertedCss).toEqual([]);

    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();

    expect(view.webContents.insertedCss).toEqual([".feed { display: none }"]);
  });

  // Removing the plugin has to take the styling off the page in front of the
  // user, not wait for them to navigate.
  it("removes a style the renderer stopped declaring", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.emitDidNavigate("https://github.com/");
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();
    await Promise.resolve();

    manager.setPageStyles({ hostWindow, request: { styles: [] } });
    await Promise.resolve();

    expect(view.webContents.removedCssKeys).toEqual(["css-1"]);
  });

  it("does not insert the same style twice for one document", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.emitDidNavigate("https://github.com/");
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(view.webContents.insertedCss).toEqual([".feed { display: none }"]);
  });

  // An SPA route change keeps the document, so the stylesheets survive with it —
  // but the address moved, and that is where one site's pattern stops matching.
  it("reconciles when a same-document navigation leaves the matching path", async () => {
    const { hostWindow, manager, view } = attachTab(
      "https://github.com/patcher/pulls",
    );
    view.webContents.emitDidNavigate("https://github.com/patcher/pulls");
    manager.setPageStyles({
      hostWindow,
      request: {
        styles: [
          { ...GITHUB_STYLE, matches: ["https://github.com/patcher/**"] },
        ],
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.webContents.insertedCss).toHaveLength(1);

    view.webContents.emitDidNavigateInPage("https://github.com/elsewhere");
    await Promise.resolve();
    await Promise.resolve();

    expect(view.webContents.removedCssKeys).toEqual(["css-1"]);
  });

  // `insertCSS` is a promise, so a second commit can land between asking and
  // being answered — and the answer for the document that is gone must not take
  // the new document's key with it, or the stylesheet stays on the page with
  // nothing remembering it: unremovable, and inserted a second time by the next
  // push.
  it("keeps the new document's key when a stale insertion answers late", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.deferInsertCss = true;
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();

    // The page commits while the first insertion is still open, and the new
    // document's own insertion answers first.
    view.webContents.emitDidNavigate("https://github.com/patcher/pulls");
    await Promise.resolve();
    expect(view.webContents.deferredInsertions).toHaveLength(2);
    view.webContents.deferredInsertions[1]?.();
    await Promise.resolve();
    await Promise.resolve();
    view.webContents.deferredInsertions[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    // The style is still known to be applied, so dropping the plugin takes it
    // off the page the user is looking at.
    manager.setPageStyles({ hostWindow, request: { styles: [] } });
    await Promise.resolve();

    expect(view.webContents.removedCssKeys).toEqual(["css-2"]);
  });

  // The same race as above, the other way round: the insertion that answers late
  // *failed*. A page being torn down is exactly what rejects one, which is also
  // exactly when the next document commits — so if the stale failure clears the
  // slot, the new document's insertion finds it gone, concludes it was released,
  // and takes its own stylesheet back off the page.
  it("leaves the new document's claim alone when a stale insertion fails late", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.deferInsertCss = true;
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();

    view.webContents.emitDidNavigate("https://github.com/patcher/pulls");
    await Promise.resolve();
    expect(view.webContents.deferredInsertions).toHaveLength(2);
    // The old document's insertion fails first, while the new one is still open.
    view.webContents.deferredInsertions[0]?.(true);
    await Promise.resolve();
    await Promise.resolve();
    view.webContents.deferredInsertions[1]?.();
    await Promise.resolve();
    await Promise.resolve();

    // Nothing was taken back, and the style is known to be applied — so dropping
    // the plugin takes it off the page the user is looking at.
    expect(view.webContents.removedCssKeys).toEqual([]);
    manager.setPageStyles({ hostWindow, request: { styles: [] } });
    await Promise.resolve();
    expect(view.webContents.removedCssKeys).toEqual(["css-2"]);
  });

  // And the other half of that condition: within one document a style can be
  // released and re-declared while the first insertion is still open — a plugin
  // disabled and re-enabled, or two pushes in a row. The late failure belongs to
  // a claim nobody holds any more, so it must not drop the live key.
  it("leaves a re-claimed slot alone when the released insertion fails late", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.emitDidNavigate("https://github.com/");
    view.webContents.deferInsertCss = true;
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();
    // Released while its insertion is still open, then declared again.
    manager.setPageStyles({ hostWindow, request: { styles: [] } });
    await Promise.resolve();
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();
    expect(view.webContents.deferredInsertions).toHaveLength(2);

    view.webContents.deferredInsertions[1]?.();
    await Promise.resolve();
    await Promise.resolve();
    view.webContents.deferredInsertions[0]?.(true);
    await Promise.resolve();
    await Promise.resolve();

    manager.setPageStyles({ hostWindow, request: { styles: [] } });
    await Promise.resolve();

    // The empty key is the released claim; `css-2` is the live stylesheet, and it
    // came off because the shell still knew about it.
    expect(view.webContents.removedCssKeys).toEqual(["", "css-2"]);
  });

  it("keeps going when one page refuses an insertion", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.emitDidNavigate("https://github.com/");
    view.webContents.insertCssFailure = new Error("view is being destroyed");

    manager.setPageStyles({
      hostWindow,
      request: {
        styles: [
          GITHUB_STYLE,
          { ...GITHUB_STYLE, styleId: "second", css: ".other { color: red }" },
        ],
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Both were attempted: the first one's rejection did not abandon the
    // second, and neither was remembered as applied.
    expect(view.webContents.insertedCss).toEqual([
      ".feed { display: none }",
      ".other { color: red }",
    ]);
    expect(view.webContents.removedCssKeys).toEqual([]);
  });
});

// The other half of the page surface. A style is data the shell applies; a script
// is the plugin's own program in a website's renderer, so these tests are mostly
// about what the shell refuses.
describe("plugin page scripts", () => {
  const GITHUB_SCRIPT = {
    pluginId: "site-tweaks",
    scriptId: "toolbar",
    matches: ["https://github.com/**"],
    code: "patcher.ready(function(){})",
  };

  function attachTab(url: string): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({ hostWindow, manager, tabId: "browser:a", url });
    return { hostWindow, manager, view: requireFakeView(0) };
  }

  function pageScriptCalls(
    hostWindow: FakeHostWindow,
  ): PatcherDesktopBrowserPageScriptCall[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) =>
          message.channel === PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL,
      )
      .map((message) => message.payload as PatcherDesktopBrowserPageScriptCall);
  }

  // The property the whole surface rests on: a user with no page-script plugin
  // runs a browser whose pages hold no Patcher code at all.
  it("installs no preload until a script is declared, and removes it again", () => {
    const { hostWindow, manager } = attachTab("https://github.com/");
    const browserSession = requireFakeSession();
    expect([...browserSession.preloadScripts.keys()]).toEqual([]);

    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });
    expect([...browserSession.preloadScripts.values()]).toEqual([
      TEST_PAGE_SCRIPT_PRELOAD_PATH,
    ]);

    manager.setPageScripts({ hostWindow, request: { scripts: [] } });
    expect([...browserSession.preloadScripts.keys()]).toEqual([]);
  });

  it("hands a matching frame the script, grouped into one world per plugin", () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: {
        scripts: [
          GITHUB_SCRIPT,
          { ...GITHUB_SCRIPT, scriptId: "second", code: "/* second */" },
          {
            ...GITHUB_SCRIPT,
            pluginId: "other",
            scriptId: "only",
            code: "/* other */",
          },
        ],
      },
    });

    const bootstrap = manager.pageScriptBootstrap({
      webContentsId: view.webContents.id,
      url: "https://github.com/patcher/pulls",
    });

    expect(bootstrap.worlds).toEqual([
      {
        pluginId: "site-tweaks",
        worldId: 9001,
        scripts: [
          { scriptId: "toolbar", code: "patcher.ready(function(){})" },
          { scriptId: "second", code: "/* second */" },
        ],
      },
      {
        pluginId: "other",
        worldId: 9002,
        scripts: [{ scriptId: "only", code: "/* other */" }],
      },
    ]);
  });

  it("hands nothing to a page no declared site matches", () => {
    const { hostWindow, manager, view } = attachTab("https://example.test/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    expect(
      manager.pageScriptBootstrap({
        webContentsId: view.webContents.id,
        url: "https://example.test/",
      }).worlds,
    ).toEqual([]);
  });

  // A pattern is only known to name a website because `patcher.sites` normalised it,
  // and normalising happens two processes away. So the shell decides for itself
  // that a blank page, a `file://` document and Patcher's own pages are not sites —
  // `**` reaching them would be a plugin on every page a tab can show.
  it("hands nothing to a page that is not a site", () => {
    const { hostWindow, manager, view } = attachTab("about:blank");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [{ ...GITHUB_SCRIPT, matches: ["**"] }] },
    });

    for (const url of ["about:blank", "file:///Users/me/notes.html"]) {
      expect(
        manager.pageScriptBootstrap({
          webContentsId: view.webContents.id,
          url,
        }).worlds,
      ).toEqual([]);
    }
  });

  it("hands nothing to a webContents this manager does not own", () => {
    const { hostWindow, manager } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    expect(
      manager.pageScriptBootstrap({
        webContentsId: 9999,
        url: "https://github.com/",
      }).worlds,
    ).toEqual([]);
  });

  it("forwards a call to the window's renderer and answers the page", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    const answer = manager.pageScriptRpc({
      webContentsId: view.webContents.id,
      url: "https://github.com/patcher/pulls",
      request: {
        pluginId: "site-tweaks",
        method: "addNote",
        input: '{"body":"hi"}',
      },
    });
    await Promise.resolve();

    const forwarded = pageScriptCalls(hostWindow);
    expect(forwarded).toEqual([
      {
        callId: "page-script-1",
        tabId: "browser:a",
        pluginId: "site-tweaks",
        method: "addNote",
        input: '{"body":"hi"}',
        url: "https://github.com/patcher/pulls",
      },
    ]);

    manager.respondToPageScriptCall({
      result: { callId: "page-script-1", ok: true, result: '{"notes":[]}' },
    });
    await expect(answer).resolves.toEqual({
      ok: true,
      result: '{"notes":[]}',
    });
  });

  // The check that bounds a browsed renderer that has been taken over: the
  // address is Chromium's answer, and the plugin is re-checked against it on
  // every call rather than once when the script was injected.
  it("refuses a plugin that declares no script for the address it is on", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    await expect(
      manager.pageScriptRpc({
        webContentsId: view.webContents.id,
        url: "https://example.test/",
        request: { pluginId: "site-tweaks", method: "addNote", input: "" },
      }),
    ).resolves.toEqual({
      ok: false,
      message:
        'patcher.rpc: plugin "site-tweaks" declares no page script for this address.',
    });
    expect(pageScriptCalls(hostWindow)).toEqual([]);
  });

  it("refuses a plugin the page's own scripts do not include", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    await expect(
      manager.pageScriptRpc({
        webContentsId: view.webContents.id,
        url: "https://github.com/",
        request: { pluginId: "somebody-else", method: "read", input: "" },
      }),
    ).resolves.toEqual({
      ok: false,
      message:
        'patcher.rpc: plugin "somebody-else" declares no page script for this address.',
    });
  });

  it("stops answering a script that calls in a loop", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });
    const call = (): Promise<unknown> =>
      manager.pageScriptRpc({
        webContentsId: view.webContents.id,
        url: "https://github.com/",
        request: { pluginId: "site-tweaks", method: "notes", input: "" },
      });

    for (let index = 0; index < 60; index += 1) {
      void call();
    }
    await Promise.resolve();
    expect(pageScriptCalls(hostWindow)).toHaveLength(60);

    await expect(call()).resolves.toEqual({
      ok: false,
      message: "patcher.rpc: too many calls — at most 60 every 10 seconds.",
    });
    expect(pageScriptCalls(hostWindow)).toHaveLength(60);
  });

  // Correlating by id is what makes this safe: the page that asked may be gone.
  it("drops an answer to a call nothing is waiting on", () => {
    const { hostWindow, manager } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    expect(() =>
      manager.respondToPageScriptCall({
        result: { callId: "page-script-404", ok: false, message: "late" },
      }),
    ).not.toThrow();
  });

  it("carries a plugin's refusal back to the script that asked", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    const answer = manager.pageScriptRpc({
      webContentsId: view.webContents.id,
      url: "https://github.com/",
      request: { pluginId: "site-tweaks", method: "nope", input: "" },
    });
    await Promise.resolve();
    manager.respondToPageScriptCall({
      result: {
        callId: "page-script-1",
        ok: false,
        message: 'plugin "site-tweaks" has no rpc method "nope"',
      },
    });

    await expect(answer).resolves.toEqual({
      ok: false,
      message: 'plugin "site-tweaks" has no rpc method "nope"',
    });
  });

  // A session that will not take the preload leaves scripts not running, and
  // must not remember that it succeeded — the next push has to try again.
  it("retries the preload after a session refuses it", () => {
    const { hostWindow, manager } = attachTab("https://github.com/");
    const browserSession = requireFakeSession();
    browserSession.registerPreloadFailure = new Error(
      "session is shutting down",
    );

    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });
    expect([...browserSession.preloadScripts.keys()]).toEqual([]);

    browserSession.registerPreloadFailure = null;
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });
    expect([...browserSession.preloadScripts.keys()]).toEqual([
      "patcher-page-scripts",
    ]);
  });
});
