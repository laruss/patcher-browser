import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserCommandSchema } from "@patcher/domain";
import {
  SITE_ACCESS_CHANNELS,
  type DesktopSitePolicy,
} from "@patcher/desktop-contract";
import {
  createDesktopSiteAuthority,
  siteDigest,
  type DesktopSiteAuthority,
} from "../src/desktop-site-authority.js";
import { executeScopedBrowserCommand } from "../src/desktop-scoped-browser-command.js";
import { FakeHostWindow } from "./desktop-browser-host-window-fakes.js";
import { resetElectronMock } from "./desktop-browser-electron-fakes.js";
import {
  attachBrowserTab,
  createDesktopBrowserViewManager,
  requireFakeView,
} from "./desktop-browser-view-manager-harness.js";

vi.mock(
  "electron",
  async () =>
    (await import("./desktop-browser-electron-fakes.js")).electronModule,
);
beforeEach(resetElectronMock);
async function fixture() {
  let authority: DesktopSiteAuthority | undefined;
  const manager = createDesktopBrowserViewManager({
    siteAuthority: () => authority,
  });
  authority = createDesktopSiteAuthority({
    resolve: manager.resolveSiteTarget,
    changed: manager.sitePolicyChanged,
    confirm: async () => true,
    cancelAuth: (target, id) => {
      void manager.respondToPagePrompt({
        hostWindow: host,
        request: {
          tabId: target.context.tabId,
          id,
          answer: { kind: "cancel" },
        },
      });
    },
  });
  const host = new FakeHostWindow({
    webContentsId: 12,
    contentBounds: { width: 900, height: 600 },
  });
  attachBrowserTab({
    hostWindow: host,
    manager,
    tabId: "tab",
    url: "https://a.example.com/",
  });
  const view = requireFakeView(0);
  const script = {
    pluginId: "plugin",
    scriptId: "s",
    matches: ["https://*.example.com/**"],
    code: "window.marker = true",
  };
  let policy: DesktopSitePolicy = {
    pluginId: "plugin",
    name: "Plugin",
    enabled: true,
    revision: randomUUID(),
    sites: ["https://*.example.com/**"],
    permissions: [
      "tabs.read",
      "page.read",
      "pageScript.register",
      "pageStyle.register",
    ],
    origins: ["https://a.example.com"],
    scripts: [siteDigest(script)],
    styles: [],
  };
  const request = (method: string, payload: unknown) =>
    authority!.request(method, payload, new AbortController().signal);
  await request("site.policy", policy);
  authority.setContributions({ scripts: [script], styles: [] });
  async function revoke() {
    policy = { ...policy, revision: randomUUID(), origins: [] };
    await request("site.policy", policy);
  }
  return {
    authority,
    manager,
    host,
    view,
    script,
    request,
    policy: () => policy,
    revoke,
  };
}
describe("runtime native browser path", () => {
  async function authFixture() {
    const f = await fixture();
    await f.request("site.policy", {
      ...f.policy(),
      permissions: [...f.policy().permissions, "auth.provide"],
    });
    const login = f.view.webContents.emitLogin({
      isRequestForNavigation: true,
      url: "https://a.example.com/private/auth",
      authInfo: { host: "a.example.com" },
    });
    const id = f.manager.resolveSiteTarget("tab")!.authPrompt!()!.id;
    const answer = {
      kind: "credentials" as const,
      username: "user",
      password: "sentinel",
    };
    const prepare = async () =>
      f.request("site.auth", {
        owners: [{ pluginId: "plugin", revision: f.policy().revision }],
        tabId: "tab",
        id,
        digest: siteDigest(answer),
      }) as Promise<{ token: string }>;
    return { ...f, login, id, answer, prepare };
  }
  it("delivers a scoped native auth response once and denies tampering/window swaps", async () => {
    const f = await authFixture(),
      { token } = await f.prepare();
    expect(() =>
      f.authority.consumeAuth(
        { token, tabId: "tab", id: f.id, answer: f.answer },
        13,
      ),
    ).toThrow();
    expect(() =>
      f.authority.consumeAuth(
        {
          token,
          tabId: "tab",
          id: f.id,
          answer: { ...f.answer, password: "modified" },
        },
        12,
      ),
    ).toThrow();
    expect(
      f.authority.consumeAuth(
        { token, tabId: "tab", id: f.id, answer: f.answer },
        12,
      ),
    ).toBe(true);
    await f.manager.respondToPagePrompt({
      hostWindow: f.host,
      request: { tabId: "tab", id: f.id, answer: f.answer },
    });
    expect(f.login.credentials).toEqual(["user", "sentinel"]);
    expect(() =>
      f.authority.consumeAuth(
        { token, tabId: "tab", id: f.id, answer: f.answer },
        12,
      ),
    ).toThrow();
  });
  it.each(["revoke", "navigation"])(
    "rejects an auth answer delayed until after %s and cancels the native callback",
    async (action) => {
      const f = await authFixture(),
        { token } = await f.prepare();
      if (action === "revoke") await f.revoke();
      else f.view.webContents.emitDidStartNavigation("https://b.example.com/");
      expect(() =>
        f.authority.consumeAuth(
          { token, tabId: "tab", id: f.id, answer: f.answer },
          12,
        ),
      ).toThrow();
      expect(f.login.called).toBe(true);
      expect(f.login.credentials).toBeNull();
    },
  );
  it.each([{ isProxy: true }, { scheme: "digest" }])(
    "does not coalesce a late proxy or different scheme into an origin auth capability (%j)",
    async (authInfo) => {
      const f = await authFixture(),
        { token } = await f.prepare();
      const extra = f.view.webContents.emitLogin({
        isRequestForNavigation: false,
        url: "https://a.example.com/private/auth",
        authInfo: { host: "a.example.com", ...authInfo },
      });
      expect(extra.called).toBe(true);
      expect(extra.credentials).toBeNull();
      expect(
        f.authority.consumeAuth(
          { token, tabId: "tab", id: f.id, answer: f.answer },
          12,
        ),
      ).toBe(true);
      await f.manager.respondToPagePrompt({
        hostWindow: f.host,
        request: { tabId: "tab", id: f.id, answer: f.answer },
      });
      expect(f.login.credentials).toEqual(["user", "sentinel"]);
      expect(extra.credentials).toBeNull();
    },
  );
  it("checks challenged paths and every coalesced auth request against the ceiling before callback/delivery", async () => {
    const f = await fixture();
    f.view.webContents.emitDidStartNavigation(
      "https://a.example.com/private/base",
    );
    f.view.webContents.emitDidNavigate("https://a.example.com/private/base");
    await f.request("site.policy", {
      ...f.policy(),
      sites: ["https://a.example.com/private/*"],
      permissions: ["auth.provide"],
    });
    f.view.webContents.emitLogin({
      isRequestForNavigation: true,
      url: "https://a.example.com/public/auth",
      authInfo: { host: "a.example.com" },
    });
    const target = f.manager.resolveSiteTarget("tab")!,
      id = target.authPrompt!()!.id;
    await expect(
      f.request("site.context", {
        owners: [{ pluginId: "plugin", revision: f.policy().revision }],
        tabId: "tab",
        authPromptId: id,
      }),
    ).rejects.toThrow();
    await f.manager.respondToPagePrompt({
      hostWindow: f.host,
      request: { tabId: "tab", id, answer: { kind: "cancel" } },
    });
    f.view.webContents.emitLogin({
      isRequestForNavigation: true,
      url: "https://a.example.com/private/auth",
      authInfo: { host: "a.example.com" },
    });
    const newId = target.authPrompt!()!.id,
      answer = {
        kind: "credentials" as const,
        username: "user",
        password: "sentinel",
      };
    const { token } = (await f.request("site.auth", {
      owners: [{ pluginId: "plugin", revision: f.policy().revision }],
      tabId: "tab",
      id: newId,
      digest: siteDigest(answer),
    })) as { token: string };
    f.view.webContents.emitLogin({
      isRequestForNavigation: false,
      url: "https://a.example.com/public/style.css",
      authInfo: { host: "a.example.com" },
    });
    expect(() =>
      f.authority.consumeAuth({ token, tabId: "tab", id: newId, answer }, 12),
    ).toThrow();
  });
  it("keeps runtime worlds out of legacy bootstrap and rejects legacy RPC", async () => {
    const f = await fixture();
    f.manager.setPageScripts({
      hostWindow: f.host,
      request: { scripts: [f.script] },
    });
    expect(
      f.manager.pageScriptBootstrap({
        webContentsId: f.view.webContents.id,
        url: "https://a.example.com/",
      }).worlds,
    ).toEqual([]);
    expect(
      f.manager.siteScriptBootstrap(
        f.view.webContents.id,
        "https://b.example.com/",
      ).worlds,
    ).toEqual([]);
    const boot = f.manager.siteScriptBootstrap(
      f.view.webContents.id,
      "https://a.example.com/",
    );
    expect(boot.worlds).toHaveLength(1);
    expect(
      await f.manager.pageScriptRpc({
        webContentsId: f.view.webContents.id,
        url: "https://a.example.com/",
        request: { pluginId: "plugin", method: "m", input: "" },
      }),
    ).toMatchObject({ ok: false });
  });
  it("settles pending RPC on revoke and reports cleanup until a new document", async () => {
    const f = await fixture(),
      boot = f.manager.siteScriptBootstrap(
        f.view.webContents.id,
        "https://a.example.com/",
      );
    const pending = f.manager.pageScriptRpc({
      webContentsId: f.view.webContents.id,
      url: "https://a.example.com/",
      documentId: boot.documentId!,
      request: { pluginId: "plugin", method: "m", input: "" },
    });
    expect(
      f.host.webContents.sentMessages.some(
        (message) => message.channel === SITE_ACCESS_CHANNELS.pageCall,
      ),
    ).toBe(true);
    await f.revoke();
    expect(await pending).toMatchObject({ ok: false });
    expect(f.manager.siteCleanup()).toEqual([
      { pluginId: "plugin", tabId: "tab" },
    ]);
    f.view.webContents.emitDidStartNavigation("https://b.example.com/");
    f.view.webContents.emitDidNavigate("https://b.example.com/");
    f.manager.siteScriptBootstrap(
      f.view.webContents.id,
      "https://b.example.com/",
    );
    expect(f.manager.siteCleanup()).toEqual([]);
    // BFCache can restore code from the old document even after a clean new document.
    f.manager.siteDocumentRestored(f.view.webContents.id);
    expect(f.manager.siteCleanup()).toEqual([
      { pluginId: "plugin", tabId: "tab" },
    ]);
  });
  it("rejects late replies after document navigation", async () => {
    const f = await fixture(),
      boot = f.manager.siteScriptBootstrap(
        f.view.webContents.id,
        "https://a.example.com/",
      );
    const pending = f.manager.pageScriptRpc({
      webContentsId: f.view.webContents.id,
      url: "https://a.example.com/",
      documentId: boot.documentId!,
      request: { pluginId: "plugin", method: "m", input: "" },
    });
    const call = f.host.webContents.sentPayloads.find(
      (value) => "token" in value && "callId" in value,
    )!;
    f.view.webContents.emitDidStartNavigation("https://b.example.com/");
    f.view.webContents.emitDidNavigate("https://b.example.com/");
    f.manager.respondToPageScriptCall({
      result: {
        callId: (call as { callId: string }).callId,
        ok: true,
        result: '"secret"',
      },
    });
    expect(await pending).toMatchObject({ ok: false });
  });
  it("settles unfinished reads and RPC on navigation start without waiting for a reply", async () => {
    const f = await fixture(),
      boot = f.manager.siteScriptBootstrap(
        f.view.webContents.id,
        "https://a.example.com/",
      );
    const rpc = f.manager.pageScriptRpc({
      webContentsId: f.view.webContents.id,
      url: "https://a.example.com/",
      documentId: boot.documentId!,
      request: { pluginId: "plugin", method: "m", input: "" },
    });
    const command = browserCommandSchema.parse({
      type: "page.get_url",
      tabId: "tab",
    });
    const data = (await f.request("site.prepare", {
      owners: [{ pluginId: "plugin", revision: f.policy().revision }],
      tabId: "tab",
      digest: siteDigest(command),
    })) as { token: string };
    vi.spyOn(f.manager, "readPage").mockImplementation(
      () => new Promise(() => {}),
    );
    const read = executeScopedBrowserCommand({
      ...f,
      hostWindow: f.host,
      token: data.token,
      command,
    });
    f.view.webContents.emitDidStartNavigation("https://b.example.com/");
    expect(await rpc).toMatchObject({ ok: false });
    expect(await read).toMatchObject({
      ok: false,
      code: "external_access_denied",
    });
  });
  it("accepts a redeemed RPC response and tracks newly injected code after a reload", async () => {
    const f = await fixture();
    f.manager.reload({ hostWindow: f.host, tabId: "tab" });
    f.view.webContents.emitDidStartNavigation("https://a.example.com/");
    const boot = f.manager.siteScriptBootstrap(
      f.view.webContents.id,
      "https://a.example.com/",
    );
    f.view.webContents.emitDidNavigate("https://a.example.com/");
    const pending = f.manager.pageScriptRpc({
      webContentsId: f.view.webContents.id,
      url: "https://a.example.com/",
      documentId: boot.documentId!,
      request: { pluginId: "plugin", method: "m", input: "" },
    });
    const call = f.host.webContents.sentPayloads.find(
      (value) => "token" in value && "callId" in value,
    )! as { callId: string; token: string };
    await f.request("site.redeem", {
      token: call.token,
      pluginId: "plugin",
      digest: siteDigest({ pluginId: "plugin", method: "m", input: "" }),
    });
    await f.request("site.check", { token: call.token });
    f.manager.respondToPageScriptCall({
      result: { callId: call.callId, ok: true, result: '"accepted"' },
    });
    expect(await pending).toEqual({ ok: true, result: '"accepted"' });
    await expect(
      f.request("site.check", { token: call.token }),
    ).rejects.toThrow();
    await f.revoke();
    expect(f.manager.siteCleanup()).toEqual([
      { pluginId: "plugin", tabId: "tab" },
    ]);
  });
  it("refuses a different host window and ambiguous tab identities", async () => {
    const f = await fixture(),
      command = browserCommandSchema.parse({
        type: "page.get_url",
        tabId: "tab",
      });
    const data = (await f.request("site.prepare", {
      owners: [{ pluginId: "plugin", revision: f.policy().revision }],
      tabId: "tab",
      digest: siteDigest(command),
    })) as { token: string };
    const other = new FakeHostWindow({
      webContentsId: 13,
      contentBounds: { width: 900, height: 600 },
    });
    expect(
      await executeScopedBrowserCommand({
        ...f,
        hostWindow: other,
        token: data.token,
        command,
      }),
    ).toMatchObject({ ok: false, code: "external_access_denied" });
    attachBrowserTab({
      hostWindow: other,
      manager: f.manager,
      tabId: "tab",
      url: "https://a.example.com/",
    });
    expect(f.manager.resolveSiteTarget("tab")).toBeNull();
  });
  it("cancels an unfinished native read immediately after revoke", async () => {
    const f = await fixture(),
      command = browserCommandSchema.parse({
        type: "page.get_url",
        tabId: "tab",
      });
    const data = (await f.request("site.prepare", {
      owners: [{ pluginId: "plugin", revision: f.policy().revision }],
      tabId: "tab",
      digest: siteDigest(command),
    })) as { token: string };
    vi.spyOn(f.manager, "readPage").mockImplementation(
      () => new Promise(() => {}),
    );
    const pending = executeScopedBrowserCommand({
      ...f,
      hostWindow: f.host,
      token: data.token,
      command,
    });
    await f.revoke();
    expect(await pending).toMatchObject({
      ok: false,
      code: "external_access_denied",
    });
  });
});
