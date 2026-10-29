import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_ACCESS_CHANNELS } from "@patcher/desktop-contract";
import {
  createNativeSiteAuthority,
  registerDesktopSiteIpc,
} from "../src/desktop-site-ipc.js";
import { siteDigest } from "../src/desktop-site-authority.js";
import type { DesktopBrowserViewManager } from "../src/desktop-browser-view.js";

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  windows: [] as any[],
  dialog: vi.fn(async (..._args: any[]) => ({ response: 1 })),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: (...args: any[]) => any) =>
      mock.handlers.set(channel, listener),
    on: (channel: string, listener: (...args: any[]) => any) =>
      mock.listeners.set(channel, listener),
  },
  BrowserWindow: {
    getAllWindows: () => mock.windows,
    fromWebContents: (contents: unknown) =>
      mock.windows.find((window) => window.webContents === contents) ?? null,
  },
  dialog: { showMessageBox: (...args: any[]) => mock.dialog(...args) },
}));
beforeEach(() => {
  mock.handlers.clear();
  mock.listeners.clear();
  mock.windows.length = 0;
  mock.dialog.mockClear();
});
function fixture() {
  const mainFrame = { url: "https://actual.example.com/" };
  const sender = { id: 12, mainFrame },
    window = { webContents: sender };
  mock.windows.push(window);
  const documentId = randomUUID();
  const manager = {
    resolveSiteTarget: () => ({
      context: {
        tabId: "tab",
        url: mainFrame.url,
        origin: "https://actual.example.com",
        documentId,
      },
      hostWebContentsId: 12,
      authPrompt: () => ({
        id: "prompt",
        url: mainFrame.url,
        urls: [mainFrame.url],
        host: "actual.example.com",
        insecure: false,
        isProxy: false,
      }),
      current: () => ({
        tabId: "tab",
        url: mainFrame.url,
        origin: "https://actual.example.com",
        documentId,
      }),
    }),
    sitePolicyChanged: vi.fn(),
    siteCleanup: () => [],
    siteScriptBootstrap: vi.fn(() => ({ worlds: [], documentId })),
    siteDocumentRestored: vi.fn(() => documentId),
    respondToPagePrompt: vi.fn(async () => true),
    pageScriptRpc: vi.fn(async () => ({ ok: true, result: "" })),
  } as unknown as DesktopBrowserViewManager;
  const authority = createNativeSiteAuthority(() => manager);
  registerDesktopSiteIpc({
    manager,
    current: () => authority,
    authorize: (event) =>
      event.senderFrame === sender.mainFrame && event.sender === sender,
  });
  return {
    manager,
    authority,
    window,
    event: { sender, senderFrame: mainFrame },
  };
}
describe("site access native IPC", () => {
  it("writes the synchronous bootstrap answer once, after it has been computed", () => {
    const f = fixture(),
      values: unknown[] = [];
    const event = {
      ...f.event,
      set returnValue(value: unknown) {
        values.push(value);
      },
    };
    mock.listeners.get(SITE_ACCESS_CHANNELS.bootstrap)!(event);
    expect(values).toEqual([{ worlds: [], documentId: expect.any(String) }]);
    expect(f.manager.siteScriptBootstrap).toHaveBeenCalledWith(
      12,
      "https://actual.example.com/",
    );
  });
  it("refuses a subframe bootstrap/RPC and unauthorized command/contribution sender", async () => {
    const f = fixture(),
      event = {
        ...f.event,
        senderFrame: { url: "https://forged.example.com/" },
        returnValue: undefined as unknown,
      };
    mock.listeners.get(SITE_ACCESS_CHANNELS.bootstrap)!(event);
    expect(event.returnValue).toEqual({ worlds: [], documentId: null });
    expect(f.manager.siteScriptBootstrap).not.toHaveBeenCalled();
    expect(
      await mock.handlers.get(SITE_ACCESS_CHANNELS.rpc)!(event, {
        pluginId: "plugin",
        method: "m",
        input: "",
        documentId: randomUUID(),
      }),
    ).toMatchObject({ ok: false });
    expect(f.manager.pageScriptRpc).not.toHaveBeenCalled();
    expect(
      await mock.handlers.get(SITE_ACCESS_CHANNELS.execute)!(event, {
        token: randomUUID(),
        command: { type: "page.get_url", tabId: "tab" },
      }),
    ).toMatchObject({ ok: false });
  });
  it("delivers auth only through an authorized app sender with a matching one-use native ticket", async () => {
    const f = fixture(),
      revision = randomUUID();
    await f.authority.request(
      "site.policy",
      {
        pluginId: "plugin",
        name: "Plugin",
        revision,
        enabled: true,
        sites: ["https://actual.example.com/**"],
        origins: ["https://actual.example.com"],
        permissions: ["auth.provide"],
        scripts: [],
        styles: [],
      },
      new AbortController().signal,
    );
    const answer = {
      kind: "credentials" as const,
      username: "user",
      password: "sentinel",
    };
    const { token } = (await f.authority.request(
      "site.auth",
      {
        owners: [{ pluginId: "plugin", revision }],
        tabId: "tab",
        id: "prompt",
        digest: siteDigest(answer),
      },
      new AbortController().signal,
    )) as { token: string };
    const handler = mock.handlers.get(SITE_ACCESS_CHANNELS.auth)!;
    const payload = { token, tabId: "tab", id: "prompt", answer };
    expect(await handler({ ...f.event, senderFrame: {} }, payload)).toBe(false);
    expect(
      await handler(f.event, {
        ...payload,
        answer: { ...answer, password: "tampered" },
      }),
    ).toBe(false);
    expect(f.manager.respondToPagePrompt).not.toHaveBeenCalled();
    expect(await handler(f.event, payload)).toBe(true);
    expect(await handler(f.event, payload)).toBe(false);
    expect(f.manager.respondToPagePrompt).toHaveBeenCalledOnce();
  });
  it("native confirmation shows the actual target and cancels on policy change", async () => {
    const f = fixture(),
      revision = randomUUID();
    await f.authority.request(
      "site.policy",
      {
        pluginId: "plugin",
        name: "Plugin",
        revision,
        enabled: true,
        sites: ["https://actual.example.com/**"],
        origins: [],
        permissions: ["page.read"],
        scripts: [],
        styles: [],
      },
      new AbortController().signal,
    );
    await f.authority.request(
      "site.confirm",
      { pluginId: "plugin", revision, tabId: "tab" },
      new AbortController().signal,
    );
    expect(mock.dialog).toHaveBeenCalledWith(
      f.window,
      expect.objectContaining({
        message: "Allow Plugin on https://actual.example.com?",
        defaultId: 0,
        signal: expect.any(AbortSignal),
      }),
    );
    let finish: (value: { response: number }) => void = () => {};
    mock.dialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.authority.request(
      "site.confirm",
      { pluginId: "plugin", revision, tabId: "tab" },
      new AbortController().signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    const options = mock.dialog.mock.calls.at(-1)![1] as {
      signal: AbortSignal;
    };
    f.authority.documentChanged("tab");
    expect(options.signal.aborted).toBe(true);
    finish({ response: 1 });
    await rejected;
  });
});
