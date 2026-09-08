import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION,
  PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
} from "@patcher/desktop-contract";
import { PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT } from "../src/desktop-browser-capture.js";
import {
  PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT,
  PATCHER_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS,
  PATCHER_DESKTOP_BROWSER_PAGE_READ_WORLD_ID,
} from "../src/desktop-browser-page-read.js";
import {
  type CreateDesktopBrowserViewManagerArgs,
  type DesktopBrowserViewManager,
} from "../src/desktop-browser-view.js";
import { FakeHostWindow } from "./desktop-browser-host-window-fakes.js";
import {
  type FakeNetworkRequestListener,
  electronMock,
  resetElectronMock,
} from "./desktop-browser-electron-fakes.js";
import {
  attachBrowserTab,
  createDesktopBrowserViewManager,
  requireFakeView,
  settlePendingCaptures,
} from "./desktop-browser-view-manager-harness.js";

/**
 * What the shell reads back out of a page: its text, its PDFs, its accessibility
 * snapshots, an observation, and a full-page image.
 *
 * Part of the `desktop-browser-view-manager` suite — see that file for the
 * shared harness and the rest of the split (#80).
 */

vi.mock("electron", async () => {
  const fakes = await import("./desktop-browser-electron-fakes.js");
  return fakes.electronModule;
});

beforeEach(resetElectronMock);

// Reading page content is the one browser command that answers, and the one
// that hands page-controlled bytes to an agent — so every refusal is typed and
// the read never runs in the page's own JS world.
describe("DesktopBrowserViewManager page reads", () => {
  function attachTabForReads(url = "https://example.com/"): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 80,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    return { hostWindow, manager, webContents: requireFakeView(0).webContents };
  }

  it("reads text and selection in an isolated world, never the page's own", async () => {
    const { hostWindow, manager, webContents } = attachTabForReads();
    webContents.setTitle("Example Domain");
    webContents.isolatedWorldResult = {
      contentType: "text/html",
      text: "hello world",
      textTruncated: false,
      selection: "world",
      selectionTruncated: false,
    };

    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({
      ok: true,
      tabId: "browser:a",
      url: "https://example.com/",
      title: "Example Domain",
      isLoading: false,
      contentKind: "html",
      text: "hello world",
      textTruncated: false,
      selection: "world",
      selectionTruncated: false,
    });
    // The world matters: in the page's own world a hostile document could
    // redefine innerText to forge this, and could detect the read happening.
    expect(webContents.mainWorldCalls).toBe(0);
    expect(webContents.isolatedWorldCalls).toHaveLength(1);
    expect(webContents.isolatedWorldCalls[0]?.worldId).toBe(
      PATCHER_DESKTOP_BROWSER_PAGE_READ_WORLD_ID,
    );
    expect(webContents.isolatedWorldCalls[0]?.scripts).toEqual([
      { code: PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT },
    ]);
  });

  it("distinguishes a missing view from a destroyed one and from an empty tab", async () => {
    const { hostWindow, manager, webContents } = attachTabForReads();

    await expect(
      manager.readPage({ hostWindow, tabId: "browser:missing" }),
    ).resolves.toEqual({ ok: false, reason: "no-view" });

    // The empty-URL new-tab convention: a live view showing nothing.
    webContents.setUrl("");
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "no-page" });
    expect(webContents.isolatedWorldCalls).toHaveLength(0);

    webContents.setUrl("https://example.com/");
    webContents.destroyed = true;
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "no-view" });
  });

  it("times out a page that never answers, and ignores its late reply", async () => {
    vi.useFakeTimers();
    try {
      const { hostWindow, manager, webContents } = attachTabForReads();
      webContents.isolatedWorldResult = "pending";

      const pending = manager.readPage({ hostWindow, tabId: "browser:a" });
      await vi.advanceTimersByTimeAsync(
        PATCHER_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS + 1,
      );

      await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a throwing or malformed script as unreadable", async () => {
    const { hostWindow, manager, webContents } = attachTabForReads();

    webContents.isolatedWorldResult = "reject";
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });

    webContents.isolatedWorldResult = { text: "only text" };
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });
  });

  it("truncates a page-supplied title to the contract cap", async () => {
    const { hostWindow, manager, webContents } = attachTabForReads();
    webContents.setTitle(
      "t".repeat(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH + 50),
    );
    webContents.isolatedWorldResult = {
      contentType: "text/html",
      text: "",
      textTruncated: false,
      selection: "",
      selectionTruncated: false,
    };

    const result = await manager.readPage({ hostWindow, tabId: "browser:a" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toHaveLength(
        PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
      );
    }
  });

  // The scoped read's own tests, which it had none of at this level: it reaches
  // the element over the debugger rather than through the read script, so none
  // of the cases above touch a single line of it.
  function attachTabForScopedReads(): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  } {
    const attached = attachTabForReads();
    const { debugger: cdp } = attached.webContents;
    cdp.results.set("DOM.getDocument", { root: { nodeId: 1 } });
    cdp.results.set("DOM.querySelector", { nodeId: 4 });
    cdp.results.set("DOM.describeNode", { node: { backendNodeId: 44 } });
    cdp.results.set("Page.getFrameTree", {
      frameTree: { frame: { id: "f1" } },
    });
    cdp.results.set("Page.createIsolatedWorld", { executionContextId: 7 });
    cdp.results.set("DOM.resolveNode", { object: { objectId: "object-1" } });
    cdp.results.set("Runtime.callFunctionOn", {
      result: { value: { text: "The article.", textTruncated: false } },
    });
    return attached;
  }

  it("reads the text of the element a selector matches", async () => {
    const { hostWindow, manager, webContents } = attachTabForScopedReads();

    const result = await manager.readPageIn({
      hostWindow,
      request: { tabId: "browser:a", selector: "article" },
    });

    expect(result).toMatchObject({
      ok: true,
      text: "The article.",
      textTruncated: false,
      contentKind: "html",
      // An element is not a selection, and answering with the page's would be
      // answering with something this read never looked at.
      selection: "",
    });
    // Into the automation world, not the page's own: `innerText` is ours for
    // the same reason the unscoped read runs in an isolated world.
    expect(webContents.debugger.commands).toContainEqual({
      method: "DOM.resolveNode",
      params: { backendNodeId: 44, executionContextId: 7 },
    });
  });

  it("times out a scoped read the page never answers", async () => {
    vi.useFakeTimers();
    try {
      const { hostWindow, manager, webContents } = attachTabForScopedReads();
      // Every step of this read is a CDP send, and a CDP send has no deadline
      // of its own — so before the fix a page that would not describe its own
      // document held the IPC invoke open until something further out gave up,
      // and `wait --selector` asked for one of these every 250ms.
      webContents.debugger.results.set(
        "DOM.getDocument",
        () =>
          new Promise(() => {
            // Never settles.
          }),
      );

      const pending = manager.readPageIn({
        hostWindow,
        request: { tabId: "browser:a", selector: "article" },
      });
      await vi.advanceTimersByTimeAsync(
        PATCHER_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS + 1,
      );

      await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});

// A PDF is the one document the read script cannot see: Chromium's viewer
// leaves an empty wrapper in the main frame and renders the document in a
// process of its own. These cover the seam that replaces the DOM read — the
// refetch and what happens to each way it can fail.
describe("DesktopBrowserViewManager PDF reads", () => {
  const PDF_URL = "https://example.com/report.pdf";

  function attachPdfTab(
    args: {
      extractPdfText?: CreateDesktopBrowserViewManagerArgs["extractPdfText"];
    } = {},
  ): {
    fakeSession: (typeof electronMock.fakeSessions)[number];
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
      ...(args.extractPdfText === undefined
        ? {}
        : { extractPdfText: args.extractPdfText }),
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 85,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url: PDF_URL });
    const view = requireFakeView(0);
    view.webContents.setTitle("report.pdf");
    // What the viewer leaves behind: the content type says PDF, the body is
    // empty, and nothing in the DOM is the document.
    view.webContents.isolatedWorldResult = {
      contentType: "application/pdf",
      text: "",
      textTruncated: false,
      selection: "",
      selectionTruncated: false,
    };
    const fakeSession = electronMock.fakeSessions.at(-1);
    if (fakeSession === undefined) {
      throw new Error("Expected a browser session to be created.");
    }
    fakeSession.fetchResponse = {
      ok: true,
      headers: { get: () => "application/pdf" },
      arrayBuffer: async () => Buffer.from("%PDF-1.7 bytes"),
    };
    return { fakeSession, hostWindow, manager };
  }

  it("refetches the document through the browsing session and answers with its text", async () => {
    const calls: Array<{ bytes: Uint8Array; timeoutMs: number }> = [];
    const { fakeSession, hostWindow, manager } = attachPdfTab({
      extractPdfText: async (request) => {
        calls.push(request);
        return { ok: true, text: "Quarterly Report", truncated: false };
      },
    });

    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({
      ok: true,
      tabId: "browser:a",
      url: PDF_URL,
      title: "report.pdf",
      isLoading: false,
      contentKind: "pdf",
      text: "Quarterly Report",
      textTruncated: false,
      // A PDF's selection belongs to PDFium; the wrapper frame has none.
      selection: "",
      selectionTruncated: false,
    });

    expect(fakeSession.fetchedUrls).toContain(PDF_URL);
    // The cookies are the point: a PDF behind a login is refetched with the
    // session that opened it, or it is not readable at all.
    expect(fakeSession.fetchInits.at(-1)?.credentials).toBe("include");
    expect(calls[0]?.bytes).toEqual(
      new Uint8Array(Buffer.from("%PDF-1.7 bytes")),
    );
    expect(calls[0]?.timeoutMs).toBeGreaterThan(0);
  });

  it("refuses a document the session will not hand back, without parsing anything", async () => {
    let parsed = false;
    const { fakeSession, hostWindow, manager } = attachPdfTab({
      extractPdfText: async () => {
        parsed = true;
        return { ok: true, text: "", truncated: false };
      },
    });

    // A `blob:` URL, a POST-only document, a server that stopped answering:
    // all arrive here as one refusal, because none is fixed by asking again.
    fakeSession.fetchRejection = new Error("net::ERR_FAILED");
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });

    fakeSession.fetchRejection = null;
    fakeSession.fetchResponse = {
      ok: false,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => Buffer.from(""),
    };
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });

    expect(parsed).toBe(false);
  });

  it("passes the parser's own refusals through to the caller", async () => {
    // `too-large` and `password-protected` exist because each is worth a
    // different next step than "could not be read".
    for (const reason of [
      "too-large",
      "password-protected",
      "timeout",
    ] as const) {
      const { hostWindow, manager } = attachPdfTab({
        extractPdfText: async () => ({ ok: false, reason }),
      });

      await expect(
        manager.readPage({ hostWindow, tabId: "browser:a" }),
      ).resolves.toEqual({ ok: false, reason });

      electronMock.fakeViews.length = 0;
      electronMock.fakeSessions.length = 0;
    }
  });

  it("reads an ordinary page the ordinary way, with no refetch at all", async () => {
    const { fakeSession, hostWindow, manager } = attachPdfTab({
      extractPdfText: async () => ({ ok: true, text: "pdf", truncated: false }),
    });
    requireFakeView(0).webContents.isolatedWorldResult = {
      contentType: "text/html",
      text: "hello",
      textTruncated: false,
      selection: "",
      selectionTruncated: false,
    };

    const result = await manager.readPage({ hostWindow, tabId: "browser:a" });

    expect(result).toMatchObject({
      ok: true,
      contentKind: "html",
      text: "hello",
    });
    expect(fakeSession.fetchedUrls).toEqual([]);
  });
});

// The snapshot is what makes elements addressable, so these cover the seam the
// pure builder cannot: when the debugger attaches, and when the refs it handed
// out stop being trustworthy.
describe("DesktopBrowserViewManager snapshots", () => {
  function attachTabForSnapshots(url = "https://example.com/"): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 90,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    return { hostWindow, manager, webContents: requireFakeView(0).webContents };
  }

  function axTree(): { nodes: unknown[] } {
    return {
      nodes: [
        { nodeId: "1", role: { value: "main" }, childIds: ["2"] },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "Save" },
          backendDOMNodeId: 77,
        },
      ],
    };
  }

  it("attaches the debugger on first use, not when the tab is created", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.results.set("Accessibility.getFullAXTree", axTree());

    // A debugger on every tab from creation is overhead and exposure, and it
    // would move this tab's dialogs off Chromium's native path.
    expect(webContents.debugger.attachCalls).toHaveLength(0);

    const result = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });

    expect(webContents.debugger.attachCalls).toEqual(["1.3"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot).toContain('- button "Save" [ref=e1]');
      expect(result.refCount).toBe(1);
      expect(result.url).toBe("https://example.com/");
    }
  });

  it("reuses one session and enables the domain once across snapshots", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.results.set("Accessibility.getFullAXTree", axTree());

    await manager.snapshot({ hostWindow, request: { tabId: "browser:a" } });
    await manager.snapshot({ hostWindow, request: { tabId: "browser:a" } });

    expect(webContents.debugger.attachCalls).toHaveLength(1);
    expect(
      webContents.debugger.commands.filter(
        (command) => command.method === "Accessibility.enable",
      ),
    ).toHaveLength(1);
  });

  it("moves the generation on when a navigation invalidates its refs", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.results.set("Accessibility.getFullAXTree", axTree());

    const first = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });
    webContents.emitDidNavigate("https://example.com/next");
    const second = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });

    // Refs name nodes in the document that produced them. A caller holding an
    // old generation must be refused rather than resolved against whatever owns
    // that node id now.
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.generation).toBeGreaterThan(first.generation);
    }
  });

  it("says so when another debugger already holds the tab", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.attached = true;

    const result = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });

    // DevTools on the view is the realistic cause, and it is worth naming.
    expect(result).toMatchObject({ ok: false, reason: "debugger-unavailable" });
  });

  it("reports a protocol failure without throwing", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.failures.set(
      "Accessibility.getFullAXTree",
      new Error("Not allowed"),
    );

    await expect(
      manager.snapshot({ hostWindow, request: { tabId: "browser:a" } }),
    ).resolves.toMatchObject({ ok: false, reason: "failed" });
  });

  it("separates a missing view from a tab showing nothing", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();

    await expect(
      manager.snapshot({ hostWindow, request: { tabId: "browser:missing" } }),
    ).resolves.toEqual({ ok: false, reason: "no-view" });

    webContents.setUrl("");
    await expect(
      manager.snapshot({ hostWindow, request: { tabId: "browser:a" } }),
    ).resolves.toEqual({ ok: false, reason: "no-page" });
  });

  it("releases the debugger when the tab is closed", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.results.set("Accessibility.getFullAXTree", axTree());
    await manager.snapshot({ hostWindow, request: { tabId: "browser:a" } });

    manager.detach({ hostWindow, tabId: "browser:a" });

    expect(webContents.debugger.detachCalls).toBe(1);
  });

  it("recovers by reattaching after the session is lost", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.results.set("Accessibility.getFullAXTree", axTree());
    await manager.snapshot({ hostWindow, request: { tabId: "browser:a" } });

    // DevTools opening, or a renderer crash, takes the session away.
    webContents.debugger.emitDetach("canceled by user");
    webContents.debugger.attached = false;

    const result = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });

    expect(result.ok).toBe(true);
    expect(webContents.debugger.attachCalls).toHaveLength(2);
  });
});

describe("DesktopBrowserViewManager observations", () => {
  interface ObservationHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: ReturnType<typeof requireFakeView>;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  }

  function attachTabForObservations(
    url = "https://example.com/",
  ): ObservationHarness {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 93,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    const view = requireFakeView(0);
    return { hostWindow, manager, view, webContents: view.webContents };
  }

  function requireNetworkListener(
    kind: "completed" | "error",
  ): FakeNetworkRequestListener {
    const fakeSession = electronMock.fakeSessions.at(-1);
    if (fakeSession === undefined) {
      throw new Error("Expected a browser session to be created.");
    }
    const listener =
      kind === "completed"
        ? fakeSession.completedListener
        : fakeSession.errorListener;
    if (listener === null) {
      throw new Error(`Expected an ${kind} listener to be registered.`);
    }
    return listener;
  }

  beforeEach(() => {
    electronMock.fakeSessions.length = 0;
    electronMock.fakeViews.length = 0;
  });

  it("captures the viewport without attaching a debugger to the tab", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    webContents.setTitle("Example");

    const pending = manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "screenshot", format: "jpeg", quality: 70 },
      },
    });
    await settlePendingCaptures(requireFakeView(0));

    expect(await pending).toEqual({
      ok: true,
      kind: "screenshot",
      tabId: "browser:a",
      url: "https://example.com/",
      title: "Example",
      mimeType: "image/jpeg",
      base64: Buffer.from("jpeg-bytes").toString("base64"),
      width: 800,
      height: 600,
    });
    // The whole point of the observation channel: a tab a human is browsing
    // keeps its dialogs on Chromium's native path, because nothing here
    // attaches the debugger or enables the Page domain.
    expect(webContents.debugger.attachCalls).toEqual([]);
  });

  it("encodes PNG when asked, so exact pixels survive", async () => {
    const { hostWindow, manager } = attachTabForObservations();

    const pending = manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "screenshot", format: "png", quality: 80 },
      },
    });
    await settlePendingCaptures(requireFakeView(0));
    const result = await pending;

    expect(result).toMatchObject({
      ok: true,
      mimeType: "image/png",
      base64: Buffer.from("png-bytes").toString("base64"),
    });
  });

  // The user's Cmd+P, which is a different thing from rendering a PDF for a
  // program: it opens the OS dialog and reports nothing back.
  it("opens the print dialog for a page, and not for an empty tab", () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();

    manager.print({ hostWindow, tabId: "browser:a" });
    expect(webContents.printCalls).toBe(1);

    // A tab showing nothing would print a blank sheet — a worse answer than
    // leaving the dialog closed.
    webContents.setUrl("");
    manager.print({ hostWindow, tabId: "browser:a" });
    expect(webContents.printCalls).toBe(1);

    // And a tab nobody has heard of is not an error, just nothing to print.
    manager.print({ hostWindow, tabId: "browser:missing" });
    expect(webContents.printCalls).toBe(1);
  });

  it("prints the page to a PDF", async () => {
    const { hostWindow, manager } = attachTabForObservations();

    await expect(
      manager.observe({
        hostWindow,
        request: { tabId: "browser:a", observation: { kind: "pdf" } },
      }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "pdf",
      base64: Buffer.from("%PDF-1.4\n").toString("base64"),
      byteLength: 9,
    });
  });

  it("refuses a capture of a tab that has loaded nothing", async () => {
    const { hostWindow, manager } = attachTabForObservations("");

    await expect(
      manager.observe({
        hostWindow,
        request: {
          tabId: "browser:a",
          observation: { kind: "screenshot", format: "jpeg", quality: 70 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });
  });

  it("reports a failed print as a refusal rather than rejecting", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    webContents.pdfResult = new Error("printing failed");

    await expect(
      manager.observe({
        hostWindow,
        request: { tabId: "browser:a", observation: { kind: "pdf" } },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
      message: "printing failed",
    });
  });

  it("records console messages from the moment the tab exists", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    webContents.emitConsoleMessage({
      level: "error",
      message: "boom",
      lineNumber: 12,
      sourceId: "https://example.com/app.js",
    });
    webContents.emitConsoleMessage({ level: "info", message: "hello" });

    const result = await manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "console", limit: 10 },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "console",
      droppedCount: 0,
    });
    expect(
      result.ok && result.kind === "console" ? result.entries : [],
    ).toEqual([
      expect.objectContaining({ level: "error", text: "boom", line: 12 }),
      expect.objectContaining({ level: "info", text: "hello" }),
    ]);
  });

  it("keeps the console log across a navigation, because the tab is the subject", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    webContents.emitConsoleMessage({ message: "before" });
    webContents.emitDidNavigate("https://example.com/next");
    webContents.emitConsoleMessage({ message: "after" });

    const result = await manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "console", limit: 10 },
      },
    });

    expect(
      result.ok && result.kind === "console"
        ? result.entries.map((entry) => entry.text)
        : [],
    ).toEqual(["before", "after"]);
  });

  it("records finished requests against the tab that made them", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    const completed = requireNetworkListener("completed");
    const failed = requireNetworkListener("error");

    completed({
      url: "https://example.com/app.js",
      method: "GET",
      resourceType: "script",
      statusCode: 200,
      fromCache: true,
      webContentsId: webContents.id,
      timestamp: 1_700_000_000_000,
    });
    failed({
      url: "http://127.0.0.1:9/",
      method: "GET",
      resourceType: "xhr",
      error: "net::ERR_BLOCKED_BY_CLIENT",
      webContentsId: webContents.id,
      timestamp: 1_700_000_000_001,
    });
    // A request from some other view must not land in this tab's log.
    completed({
      url: "https://elsewhere.test/",
      method: "GET",
      resourceType: "xhr",
      statusCode: 200,
      webContentsId: webContents.id + 1_000,
    });

    const result = await manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "network", limit: 50 },
      },
    });

    expect(
      result.ok && result.kind === "network" ? result.entries : [],
    ).toEqual([
      {
        method: "GET",
        url: "https://example.com/app.js",
        resourceType: "script",
        status: 200,
        fromCache: true,
        error: null,
        timestamp: 1_700_000_000_000,
      },
      {
        method: "GET",
        url: "http://127.0.0.1:9/",
        resourceType: "xhr",
        status: null,
        fromCache: false,
        error: "net::ERR_BLOCKED_BY_CLIENT",
        timestamp: 1_700_000_000_001,
      },
    ]);
  });

  it("says how many log entries the limit left behind", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    for (const index of [1, 2, 3]) {
      webContents.emitConsoleMessage({ message: `line ${index}` });
    }

    const result = await manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "console", limit: 1 },
      },
    });

    expect(result).toMatchObject({ droppedCount: 2 });
    expect(
      result.ok && result.kind === "console"
        ? result.entries.map((entry) => entry.text)
        : [],
    ).toEqual(["line 3"]);
  });

  it("answers the console log for a tab with no page rather than refusing", async () => {
    // A new tab has nothing to capture, but "what has this tab logged" is still
    // a question with an answer, and the answer is "nothing".
    const { hostWindow, manager } = attachTabForObservations("");

    await expect(
      manager.observe({
        hostWindow,
        request: {
          tabId: "browser:a",
          observation: { kind: "console", limit: 10 },
        },
      }),
    ).resolves.toMatchObject({ ok: true, kind: "console", entries: [] });
  });

  it("reports a tab with no live view", async () => {
    const { hostWindow, manager } = attachTabForObservations();

    await expect(
      manager.observe({
        hostWindow,
        request: {
          tabId: "browser:missing",
          observation: { kind: "network", limit: 10 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

describe("DesktopBrowserViewManager scoped snapshots", () => {
  function attachTabForScope(url = "https://example.com/") {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 96,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    const { webContents } = requireFakeView(0);
    webContents.debugger.results.set("Accessibility.getFullAXTree", {
      nodes: [
        { nodeId: "1", role: { value: "main" }, childIds: ["2", "4"] },
        {
          nodeId: "2",
          role: { value: "form" },
          name: { value: "Checkout" },
          backendDOMNodeId: 42,
          childIds: ["3"],
        },
        {
          nodeId: "3",
          role: { value: "button" },
          name: { value: "Pay" },
          backendDOMNodeId: 43,
        },
        {
          nodeId: "4",
          role: { value: "button" },
          name: { value: "Help" },
          backendDOMNodeId: 44,
        },
      ],
    });
    webContents.debugger.results.set("DOM.getDocument", {
      root: { nodeId: 1 },
    });
    webContents.debugger.results.set("DOM.querySelector", { nodeId: 9 });
    webContents.debugger.results.set("DOM.describeNode", {
      node: { backendNodeId: 42 },
    });
    return { hostWindow, manager, webContents };
  }

  it("snapshots what the selector matched and hands out refs for it alone", async () => {
    const { hostWindow, manager, webContents } = attachTabForScope();

    const result = await manager.snapshotIn({
      hostWindow,
      request: { tabId: "browser:a", selector: "form.checkout" },
    });

    expect(webContents.debugger.commands).toContainEqual({
      method: "DOM.querySelector",
      params: { nodeId: 1, selector: "form.checkout" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The sibling button outside the scope is the assertion: a scoped
      // snapshot that still carried the rest of the page would be pointless.
      expect(result.snapshot).toContain('button "Pay"');
      expect(result.snapshot).not.toContain("Help");
      expect(result.refCount).toBe(1);
    }
  });

  it("acts on the element the scoped refs name, not the one they used to", async () => {
    const { hostWindow, manager } = attachTabForScope();

    const whole = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });
    const scoped = await manager.snapshotIn({
      hostWindow,
      request: { tabId: "browser:a", selector: "form" },
    });

    // Both snapshots call something `e1`, so the second has to invalidate the
    // first — a stale `e1` resolving silently is the failure this prevents.
    expect(whole.ok && scoped.ok).toBe(true);
    if (whole.ok && scoped.ok) {
      expect(scoped.generation).toBeGreaterThan(whole.generation);
    }
  });

  it("says the selector is the problem when the browser will not parse it", async () => {
    const { hostWindow, manager, webContents } = attachTabForScope();
    webContents.debugger.failures.set(
      "DOM.querySelector",
      new Error("DOM Error while querying"),
    );

    await expect(
      manager.snapshotIn({
        hostWindow,
        request: { tabId: "browser:a", selector: "form.." },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid-selector" });
  });

  it("tells a selector that matched nothing apart from one it cannot parse", async () => {
    const { hostWindow, manager, webContents } = attachTabForScope();
    // Zero is how the protocol spells "matched nothing"; it does not fail.
    webContents.debugger.results.set("DOM.querySelector", { nodeId: 0 });

    await expect(
      manager.snapshotIn({
        hostWindow,
        request: { tabId: "browser:a", selector: "#missing" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-match" });
  });

  it("refuses an element the accessibility tree does not describe", async () => {
    const { hostWindow, manager, webContents } = attachTabForScope();
    webContents.debugger.results.set("DOM.describeNode", {
      node: { backendNodeId: 4242 },
    });

    // A hidden element is in the DOM and not in the tree. Falling back to the
    // whole page here would answer a question nobody asked.
    await expect(
      manager.snapshotIn({
        hostWindow,
        request: { tabId: "browser:a", selector: "#hidden" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-match" });
  });

  it("answers for a blank tab and a tab with no view the way the unscoped one does", async () => {
    const blank = attachTabForScope("");
    await expect(
      blank.manager.snapshotIn({
        hostWindow: blank.hostWindow,
        request: { tabId: "browser:a", selector: "#main" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });

    const live = attachTabForScope();
    await expect(
      live.manager.snapshotIn({
        hostWindow: live.hostWindow,
        request: { tabId: "browser:gone", selector: "#main" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

describe("DesktopBrowserViewManager full-page captures", () => {
  function attachTabForFullPage(url = "https://example.com/") {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 97,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    const { webContents } = requireFakeView(0);
    webContents.isolatedWorldResult = { width: 1280, height: 4200 };
    webContents.debugger.results.set("Page.captureScreenshot", {
      data: Buffer.from("full-page-bytes").toString("base64"),
    });
    return { hostWindow, manager, webContents };
  }

  it("captures the measured document, at 1:1 and beyond the viewport", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.setTitle("Example");

    const result = await manager.captureFullPage({
      hostWindow,
      request: { tabId: "browser:a", format: "jpeg", quality: 70 },
    });

    // The size is measured in the page-read isolated world, not through
    // `Page.getLayoutMetrics`: that would want the `Page` domain, and enabling
    // it is what moves a tab's dialogs off Chromium's native modal.
    expect(webContents.isolatedWorldCalls.at(-1)?.scripts).toEqual([
      { code: PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT },
    ]);
    expect(webContents.debugger.commands).toContainEqual({
      method: "Page.captureScreenshot",
      params: {
        format: "jpeg",
        quality: 70,
        clip: { x: 0, y: 0, width: 1280, height: 4200, scale: 1 },
        captureBeyondViewport: true,
      },
    });
    expect(result).toEqual({
      ok: true,
      tabId: "browser:a",
      url: "https://example.com/",
      title: "Example",
      mimeType: "image/jpeg",
      base64: Buffer.from("full-page-bytes").toString("base64"),
      width: 1280,
      height: 4200,
      truncated: false,
    });
  });

  it("attaches the debugger without taking the tab's dialogs over", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();

    await manager.captureFullPage({
      hostWindow,
      request: { tabId: "browser:a", format: "jpeg", quality: 70 },
    });

    // The trade this capture makes, pinned in both directions: it does need a
    // session, and it must not enable `Page` — a picture should not cost the
    // user Chromium's own alert() modal for the rest of the session.
    expect(webContents.debugger.attachCalls).toEqual(["1.3"]);
    expect(
      webContents.debugger.commands.map((command) => command.method),
    ).not.toContain("Page.enable");
  });

  it("omits quality for PNG, which has no such knob", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();

    await manager.captureFullPage({
      hostWindow,
      request: { tabId: "browser:a", format: "png", quality: 70 },
    });

    expect(
      webContents.debugger.commands.find(
        (command) => command.method === "Page.captureScreenshot",
      )?.params,
    ).toEqual({
      format: "png",
      clip: { x: 0, y: 0, width: 1280, height: 4200, scale: 1 },
      captureBeyondViewport: true,
    });
  });

  it("clips a document past the texture limit and says it did", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.isolatedWorldResult = {
      width: 1280,
      height: PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION * 3,
    };

    const result = await manager.captureFullPage({
      hostWindow,
      request: { tabId: "browser:a", format: "jpeg", quality: 70 },
    });

    expect(result).toMatchObject({
      ok: true,
      height: PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION,
      truncated: true,
    });
  });

  it("refuses a picture past what the bridge carries rather than cutting it", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.debugger.results.set("Page.captureScreenshot", {
      data: "a".repeat(
        PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH + 1,
      ),
    });

    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:a", format: "jpeg", quality: 70 },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "too-large" });
  });

  it("reports a page that will not say how large it is", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.isolatedWorldResult = "pending";

    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:a", format: "jpeg", quality: 70 },
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "failed",
      message: "The page did not answer how large it is in time.",
    });
    // Nothing was asked of Chromium: a clip built from a size nobody measured
    // is a capture of the wrong region.
    expect(
      webContents.debugger.commands.map((command) => command.method),
    ).not.toContain("Page.captureScreenshot");
  });

  it("says when DevTools has the tab, instead of quietly capturing the viewport", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.debugger.attachFailure = new Error(
      "Another debugger is attached",
    );

    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:a", format: "jpeg", quality: 70 },
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "debugger-unavailable",
      message:
        "Could not attach the browser debugger: Another debugger is attached",
    });
  });

  it("distinguishes a tab with no view from one that has loaded nothing", async () => {
    const { hostWindow, manager } = attachTabForFullPage("");

    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:missing", format: "jpeg", quality: 70 },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:a", format: "jpeg", quality: 70 },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });
  });

  it("reports a rejected capture as a refusal rather than rejecting", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.debugger.failures.set(
      "Page.captureScreenshot",
      new Error("capture failed"),
    );

    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:a", format: "jpeg", quality: 70 },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
      message: "capture failed",
    });
  });
});

describe("PDF", () => {
  // One webPreferences flag decides whether a whole class of link works, and a
  // later edit could flip it without anything failing loudly: `plugins` is what
  // loads Chromium's PDF viewer, and without it a PDF link is not a page but a
  // download — Chromium's fallback for a document it cannot display.
  it("keeps Chromium's PDF viewer enabled", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    attachBrowserTab({
      hostWindow: new FakeHostWindow({
        contentBounds: { width: 900, height: 600 },
        webContentsId: 1,
      }),
      manager,
      tabId: "browser:a",
      url: "https://example.com/paper.pdf",
    });

    expect(requireFakeView(0).options.webPreferences).toMatchObject({
      plugins: true,
    });
  });
});
