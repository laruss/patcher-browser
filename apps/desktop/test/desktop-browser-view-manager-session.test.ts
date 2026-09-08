import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_SECURITY_CHANNEL,
} from "../src/desktop-browser-ipc.js";
import { type DesktopBrowserViewManager } from "../src/desktop-browser-view.js";
import { FakeHostWindow } from "./desktop-browser-host-window-fakes.js";
import {
  electronMock,
  resetElectronMock,
} from "./desktop-browser-electron-fakes.js";
import {
  attachBrowserTab,
  createDesktopBrowserViewManager,
  requireFakeView,
} from "./desktop-browser-view-manager-harness.js";

/**
 * The browsing session rather than the tab: the cookies and web storage it holds,
 * and the questions the network asks it — permissions, HTTP auth, certificates.
 *
 * Part of the `desktop-browser-view-manager` suite — see that file for the
 * shared harness and the rest of the split (#80).
 */

vi.mock("electron", async () => {
  const fakes = await import("./desktop-browser-electron-fakes.js");
  return fakes.electronModule;
});

beforeEach(resetElectronMock);

describe("DesktopBrowserViewManager storage", () => {
  type FakeSessionRecord = (typeof electronMock.fakeSessions)[number];

  interface StorageHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    session: FakeSessionRecord;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  }

  function attachTabForStorage(
    url = "https://example.com/app",
  ): StorageHarness {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 94,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    const session = electronMock.fakeSessions.at(-1);
    if (session === undefined) {
      throw new Error("Expected a browser session to be created.");
    }
    return {
      hostWindow,
      manager,
      session,
      webContents: requireFakeView(0).webContents,
    };
  }

  beforeEach(() => {
    electronMock.fakeSessions.length = 0;
    electronMock.fakeViews.length = 0;
  });

  it("reads the tab's cookies without attaching a debugger", async () => {
    const { hostWindow, manager, session, webContents } = attachTabForStorage();
    session.storedCookies = [
      {
        name: "session",
        value: "abc",
        domain: ".example.com",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
      },
    ];

    const result = await manager.storage({
      hostWindow,
      request: { tabId: "browser:a", operation: { kind: "cookies-get" } },
    });

    expect(result).toEqual({
      ok: true,
      kind: "cookies",
      tabId: "browser:a",
      url: "https://example.com/app",
      title: null,
      cookies: [
        {
          name: "session",
          value: "abc",
          domain: ".example.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
    });
    // Storage is an observation: reading it must not move this tab's dialogs
    // off Chromium's native path.
    expect(webContents.debugger.attachCalls).toEqual([]);
  });

  it("counts the cookies a saved state could not write instead of abandoning it", async () => {
    const { hostWindow, manager, session } = attachTabForStorage();
    session.cookieSetFailure = new Error("Failed to set cookie");

    await expect(
      manager.storage({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: {
            kind: "cookies-set",
            cookies: [
              {
                name: "a",
                value: "1",
                domain: "",
                path: "/",
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: "Lax",
              },
              {
                name: "b",
                value: "2",
                domain: "",
                path: "/",
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: "Lax",
              },
            ],
          },
        },
      }),
    ).resolves.toEqual({ ok: true, kind: "written", applied: 0, rejected: 2 });
    // Both were attempted: one refusal is not a reason to stop.
    expect(session.cookieSetCalls).toHaveLength(2);
  });

  it("clears the cookies the tab's url carries", async () => {
    const { hostWindow, manager, session } = attachTabForStorage();
    session.storedCookies = [
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ];

    await expect(
      manager.storage({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "cookies-clear", name: null },
        },
      }),
    ).resolves.toEqual({ ok: true, kind: "removed", removed: 2 });
    expect(session.cookieRemoveCalls).toEqual([
      { url: "https://example.com/app", name: "a" },
      { url: "https://example.com/app", name: "b" },
    ]);
  });

  it("reads web storage out of the page's isolated world", async () => {
    const { hostWindow, manager, webContents } = attachTabForStorage();
    webContents.isolatedWorldResult = {
      items: [{ name: "token", value: "abc" }],
      truncated: false,
    };

    await expect(
      manager.storage({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "items-get", area: "local" },
        },
      }),
    ).resolves.toEqual({
      ok: true,
      kind: "items",
      tabId: "browser:a",
      url: "https://example.com/app",
      title: null,
      area: "local",
      items: [{ name: "token", value: "abc" }],
      truncated: false,
    });
    // Same privileged world the page read uses, so a page cannot shadow
    // `localStorage` to forge what it holds.
    expect(webContents.isolatedWorldCalls.at(-1)?.worldId).toBe(1729);
    expect(webContents.debugger.attachCalls).toEqual([]);
  });

  it("passes a page's own refusal back rather than reporting a generic failure", async () => {
    const { hostWindow, manager, webContents } = attachTabForStorage();
    webContents.isolatedWorldResult = {
      error: "This page's storage is not accessible.",
    };

    await expect(
      manager.storage({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "items-get", area: "session" },
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
      message: "This page's storage is not accessible.",
    });
  });

  it("gives up on a page that never runs the script", async () => {
    vi.useFakeTimers();
    try {
      const { hostWindow, manager, webContents } = attachTabForStorage();
      webContents.isolatedWorldResult = "pending";

      const pending = manager.storage({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "items-clear", area: "local", name: null },
        },
      });
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses every operation on a tab that has loaded nothing", async () => {
    // Storage is per-origin, and a tab showing nothing has no origin — unlike
    // the console log, which is the tab's own and answers regardless.
    const { hostWindow, manager } = attachTabForStorage("");

    await expect(
      manager.storage({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "cookies-get" } },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });
  });

  it("reports a tab with no live view", async () => {
    const { hostWindow, manager } = attachTabForStorage();

    await expect(
      manager.storage({
        hostWindow,
        request: {
          tabId: "browser:missing",
          operation: { kind: "cookies-get" },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

describe("questions the network asks", () => {
  function attachVisibleTab(): {
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
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    return { hostWindow, manager, view: requireFakeView(0) };
  }

  function promptPushes(hostWindow: FakeHostWindow): unknown[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) =>
          message.channel === PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
      )
      .map((message) => message.payload);
  }

  function pageSecurityPushes(hostWindow: FakeHostWindow): unknown[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) =>
          message.channel === PATCHER_DESKTOP_BROWSER_PAGE_SECURITY_CHANNEL,
      )
      .map((message) => message.payload);
  }

  function openPrompt(hostWindow: FakeHostWindow): { id: string } | null {
    const pushed = promptPushes(hostWindow).at(-1) as
      | { prompt: { id: string } | null }
      | undefined;
    return pushed?.prompt ?? null;
  }

  describe("basic auth", () => {
    // The dead end this closes: Electron cancels every challenge on its own, so
    // the page simply failed with nothing said.
    it("asks, and hands over what the user typed", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();

      const login = view.webContents.emitLogin({
        isRequestForNavigation: true,
      });
      expect(login.called).toBe(false);
      expect(promptPushes(hostWindow).at(-1)).toMatchObject({
        tabId: "browser:a",
        prompt: { kind: "auth", host: "example.com", insecure: false },
      });

      const prompt = openPrompt(hostWindow);
      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: prompt?.id ?? "",
          answer: { kind: "credentials", username: "ada", password: "hunter2" },
        },
      });

      expect(login.credentials).toEqual(["ada", "hunter2"]);
    });

    it("cancels the request when the user declines", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      const login = view.webContents.emitLogin({
        isRequestForNavigation: true,
      });

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "cancel" },
        },
      });

      // Electron reads "no username" as a cancel, which is what a declined
      // prompt has to mean.
      expect(login.called).toBe(true);
      expect(login.credentials).toBeNull();
    });

    // The phishing shape: any page can embed an image from an attacker's server
    // and have it answer 401, putting a password box over someone else's site.
    it("refuses a cross-origin subresource without asking", () => {
      const { hostWindow, view } = attachVisibleTab();

      const login = view.webContents.emitLogin({
        isRequestForNavigation: false,
        url: "https://cdn.evil.test/pixel.png",
        authInfo: { host: "cdn.evil.test" },
      });

      expect(login.called).toBe(true);
      expect(login.credentials).toBeNull();
      expect(promptPushes(hostWindow)).toEqual([]);
    });

    it("asks for the page's own subresources", () => {
      const { hostWindow, view } = attachVisibleTab();

      view.webContents.emitLogin({
        isRequestForNavigation: false,
        url: "https://example.com/assets/app.css",
      });

      expect(openPrompt(hostWindow)).toMatchObject({ kind: "auth" });
    });

    it("refuses a proxy challenge outright", () => {
      const { hostWindow, view } = attachVisibleTab();

      const login = view.webContents.emitLogin({
        isRequestForNavigation: true,
        authInfo: { isProxy: true },
      });

      expect(login.called).toBe(true);
      expect(promptPushes(hostWindow)).toEqual([]);
    });

    // A protected directory challenges once per request; one password answers
    // the page, its stylesheet and its images together.
    it("settles every request for the same realm with one answer", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      const first = view.webContents.emitLogin({
        isRequestForNavigation: true,
      });
      const second = view.webContents.emitLogin({
        isRequestForNavigation: false,
        url: "https://example.com/style.css",
      });

      // Only one question was asked.
      expect(
        promptPushes(hostWindow).filter(
          (push) => (push as { prompt: unknown }).prompt !== null,
        ),
      ).toHaveLength(1);

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "credentials", username: "ada", password: "hunter2" },
        },
      });

      expect(first.credentials).toEqual(["ada", "hunter2"]);
      expect(second.credentials).toEqual(["ada", "hunter2"]);
    });

    it("says so when the credentials would go in the clear", () => {
      const { hostWindow, view } = attachVisibleTab();

      view.webContents.emitLogin({
        isRequestForNavigation: true,
        url: "http://example.com/private",
        authInfo: { port: 80 },
      });

      expect(openPrompt(hostWindow)).toMatchObject({ insecure: true });
    });
  });

  describe("certificate errors", () => {
    it("asks about the page's own certificate and proceeds when told to", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();

      const first = view.webContents.emitCertificateError({});
      expect(first.trusted).toBeNull();
      expect(openPrompt(hostWindow)).toMatchObject({
        kind: "certificate",
        host: "example.com",
        errorCode: "net::ERR_CERT_AUTHORITY_INVALID",
        issuerName: "Test CA",
      });

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });

      expect(first.trusted).toBe(true);
    });

    // Accepting once is accepting for the session — otherwise every subresource
    // on a dev box with a self-signed certificate is another dialog.
    it("remembers an accepted certificate for the same host", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      view.webContents.emitCertificateError({});
      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });

      const again = view.webContents.emitCertificateError({
        isMainFrame: false,
      });

      expect(again.trusted).toBe(true);
    });

    // A different certificate from the same host is a different decision.
    it("asks again when the certificate changes", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      view.webContents.emitCertificateError({});
      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });

      const swapped = view.webContents.emitCertificateError({
        certificate: { fingerprint: "sha256/BBBB" },
      });

      expect(swapped.trusted).toBeNull();
      expect(openPrompt(hostWindow)).toMatchObject({
        fingerprint: "sha256/BBBB",
      });
    });

    // A user cannot judge a subresource they cannot see.
    it("refuses a subresource's bad certificate without asking", () => {
      const { hostWindow, view } = attachVisibleTab();

      const result = view.webContents.emitCertificateError({
        isMainFrame: false,
      });

      expect(result.trusted).toBe(false);
      expect(promptPushes(hostWindow)).toEqual([]);
    });
  });

  describe("client certificates", () => {
    // Electron's default hands over the first certificate in the store, which
    // is a credential chosen for the user by position.
    it("asks which certificate to present", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      const list = [
        {
          fingerprint: "a",
          issuerName: "Corp CA",
          subjectName: "ada@corp",
          validExpiry: 1_800_000_000,
          validStart: 1_700_000_000,
        },
        {
          fingerprint: "b",
          issuerName: "Corp CA",
          subjectName: "ada@other",
          validExpiry: 1_800_000_000,
          validStart: 1_700_000_000,
        },
      ];

      const selection = view.webContents.emitSelectClientCertificate(list);
      expect(selection.called).toBe(false);
      expect(openPrompt(hostWindow)).toMatchObject({
        kind: "client-certificate",
        certificates: [
          { index: 0, subjectName: "ada@corp" },
          { index: 1, subjectName: "ada@other" },
        ],
      });

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "client-certificate", index: 1 },
        },
      });

      expect(selection.chosen).toBe(list[1]);
    });
  });

  describe("answering", () => {
    it("hides the page while a question is open and reveals it after", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      expect(view.visible).toBe(true);

      view.webContents.emitLogin({ isRequestForNavigation: true });
      expect(view.visible).toBe(false);

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "cancel" },
        },
      });

      expect(view.visible).toBe(true);
      expect(promptPushes(hostWindow).at(-1)).toEqual({
        tabId: "browser:a",
        prompt: null,
      });
    });

    // A human can be typing while the tab moves on; the answer they finish is
    // for a question that is no longer being asked.
    it("drops an answer that names a prompt that is gone", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      view.webContents.emitLogin({ isRequestForNavigation: true });

      await expect(
        manager.respondToPagePrompt({
          hostWindow,
          request: {
            tabId: "browser:a",
            id: "page-prompt-999",
            answer: { kind: "cancel" },
          },
        }),
      ).resolves.toBe(false);
      expect(view.visible).toBe(false);
    });

    // The shapes differ because the decisions do: "proceed" is about a
    // certificate and must never turn into a login.
    it("treats an answer of the wrong shape as a refusal", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      const login = view.webContents.emitLogin({
        isRequestForNavigation: true,
      });

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });

      expect(login.credentials).toBeNull();
      expect(login.called).toBe(true);
    });

    // The padlock's whole reason to exist: a page under a certificate the user
    // waved through is encrypted and unverified, and the renderer cannot tell —
    // it never sees the error, and the exception applies to every later tab on
    // the same host without asking again.
    it("reports a hand-trusted certificate to the renderer on the next navigation", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();

      view.webContents.emitDidNavigate("https://example.com/");
      expect(pageSecurityPushes(hostWindow).at(-1)).toEqual({
        tabId: "browser:a",
        certificateTrustedByUser: false,
      });

      view.webContents.emitCertificateError({});
      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });
      view.webContents.emitDidNavigate("https://example.com/");

      expect(pageSecurityPushes(hostWindow).at(-1)).toEqual({
        tabId: "browser:a",
        certificateTrustedByUser: true,
      });
    });

    // The exception is the host's, not the page's, so leaving it clears the claim.
    it("stops reporting it once the tab leaves that host", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      view.webContents.emitCertificateError({});
      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });

      view.webContents.emitDidNavigate("https://other.test/");

      expect(pageSecurityPushes(hostWindow).at(-1)).toEqual({
        tabId: "browser:a",
        certificateTrustedByUser: false,
      });
    });

    it("refuses a second question while one is open", () => {
      const { hostWindow, view } = attachVisibleTab();
      view.webContents.emitLogin({ isRequestForNavigation: true });

      const certificate = view.webContents.emitCertificateError({});

      expect(certificate.trusted).toBe(false);
      expect(
        promptPushes(hostWindow).filter(
          (push) => (push as { prompt: unknown }).prompt !== null,
        ),
      ).toHaveLength(1);
    });
  });
});
