import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  pluginPermissionsFromManifest,
  pluginSitesFromManifest,
  type FakePluginHost,
} from "@patcher/plugin-sdk/testing";
import plugin from "./server.js";

const origin = "https://example.test";
const target = { tabId: "tab", origin };
const hosts: FakePluginHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  vi.restoreAllMocks();
});
function load() {
  const host = createFakePluginHost({
    pluginId: "password-manager",
    permissions: pluginPermissionsFromManifest(import.meta.url),
    sites: pluginSitesFromManifest(import.meta.url),
  });
  hosts.push(host);
  host.harness.browser.setTabs([
    { tabId: "tab", url: `${origin}/login`, title: null },
  ]);
  plugin(host.patcher);
  return host;
}
function account(accountId: string, version = 1) {
  return {
    id: randomUUID(),
    version,
    origin,
    accountId,
    username: accountId,
    protection: "require-touch-id" as const,
    createdAt: 1,
    updatedAt: 2,
  };
}
describe("password manager backend", () => {
  it("uses only metadata and guarded core operations, with no storage or agent tools", async () => {
    const host = load(),
      accounts = [account("personal"), account("work")];
    const list = vi
      .spyOn(host.patcher.browser.credentials, "list")
      .mockResolvedValue(accounts);
    const request = vi
      .spyOn(host.patcher.browser.credentials, "request")
      .mockResolvedValue({ status: "filled" });
    expect(await host.harness.callRpc("view", target)).toEqual({
      status: "ready",
      accounts,
    });
    expect(list).toHaveBeenCalledWith({ tabId: "tab" }, expect.anything());
    const reference = { id: accounts[1]!.id, version: 1 };
    expect(
      await host.harness.callRpc("request", {
        ...target,
        requestId: randomUUID(),
        operation: "fill",
        reference,
      }),
    ).toEqual({ status: "filled" });
    expect(request).toHaveBeenCalledWith(
      { tabId: "tab", operation: "fill", reference },
      { signal: expect.any(AbortSignal) },
    );
    expect(host.harness.registrations.agentTools).toEqual([]);
    expect(host.harness.registrations.httpRoutes).toEqual([]);
    expect(host.harness.registrations.pageScripts).toHaveLength(1);
    expect(host.harness.registrations.toolbarItems).toHaveLength(1);
  });
  it("does not turn page hints or toolbar clicks into list/request calls", async () => {
    const host = load();
    const list = vi.spyOn(host.patcher.browser.credentials, "list");
    const request = vi.spyOn(host.patcher.browser.credentials, "request");
    expect(
      await host.harness.callRpc("hint", {
        origin,
        kind: "submit",
        present: true,
      }),
    ).toEqual({ ok: true });
    await host.harness.registrations.toolbarItems[0]!.run({
      tabId: "tab",
      url: `${origin}/login?token=private`,
      title: null,
    });
    expect(list).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(host.harness.realtimeSignals)).not.toContain(
      "private",
    );
  });
  it("refuses origin swaps, malformed references and password/approval fields without calling core", async () => {
    const host = load();
    const request = vi.spyOn(host.patcher.browser.credentials, "request");
    expect(
      await host.harness.callRpc("request", {
        ...target,
        origin: "https://example.test.evil",
        requestId: randomUUID(),
        operation: "save",
        accountId: "personal",
      }),
    ).toEqual({ status: "unsupported" });
    for (const key of [
      "password",
      "approved",
      "selector",
      "owner",
      "originOverride",
    ]) {
      await expect(
        host.harness.callRpc("request", {
          ...target,
          requestId: randomUUID(),
          operation: "save",
          accountId: "personal",
          [key]: "PASSWORD-SENTINEL",
        }),
      ).rejects.toThrow();
      await expect(
        host.harness.callRpc("hint", {
          origin,
          kind: "form",
          present: true,
          [key]: "PASSWORD-SENTINEL",
        }),
      ).rejects.toThrow();
    }
    await expect(
      host.harness.callRpc("request", {
        ...target,
        requestId: randomUUID(),
        operation: "fill",
        reference: { id: "not-an-id", version: 0 },
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(host.harness.logEntries)).not.toContain(
      "PASSWORD-SENTINEL",
    );
  });
  it("keeps a manual request on its RPC stack, cancels only its matching id and cancels on disable", async () => {
    const host = load();
    const request = vi
      .spyOn(host.patcher.browser.credentials, "request")
      .mockImplementation(
        async (_args, { signal } = {}) =>
          new Promise((resolve) =>
            signal!.addEventListener(
              "abort",
              () => resolve({ status: "cancelled" }),
              { once: true },
            ),
          ),
      );
    const firstId = randomUUID();
    const first = host.harness.callRpc("request", {
      ...target,
      requestId: firstId,
      operation: "save",
      accountId: "personal",
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(
      await host.harness.callRpc("request", {
        ...target,
        requestId: randomUUID(),
        operation: "save",
        accountId: "other",
      }),
    ).toEqual({ status: "busy" });
    expect(
      await host.harness.callRpc("cancel", { requestId: randomUUID() }),
    ).toEqual({ cancelled: false });
    expect(
      await host.harness.callRpc("cancel", { requestId: firstId }),
    ).toEqual({ cancelled: true });
    expect(await first).toEqual({ status: "cancelled" });
    const second = host.harness.callRpc("request", {
      ...target,
      requestId: randomUUID(),
      operation: "save",
      accountId: "work",
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await host.harness.dispose();
    expect(await second).toEqual({ status: "cancelled" });
  });
  it("reports disconnected and native-unavailable hosts without simulating approval", async () => {
    const host = load();
    expect(await host.harness.callRpc("view", target)).toEqual({
      status: "denied",
      accounts: [],
    });
    expect(
      await host.harness.callRpc("request", {
        ...target,
        requestId: randomUUID(),
        operation: "save",
        accountId: "personal",
      }),
    ).toEqual({ status: "denied" });
    host.harness.browser.setConnected(false);
    expect(await host.harness.callRpc("view", target)).toEqual({
      status: "unavailable",
      accounts: [],
    });
  });
});
