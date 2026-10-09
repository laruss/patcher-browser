import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPluginChannel } from "../../../src/services/plugins/plugin-channel.js";
import { createChildProcessPort } from "../../../src/services/plugins/plugin-ports.js";
import { createPortMultiplexer } from "../../../src/services/plugins/plugin-port-multiplexer.js";
import { BOOTSTRAP_METHOD } from "../../../src/services/plugins/plugin-child-runtime.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  migrate,
  upsertInstalledPlugin,
  listProtectedCredentials,
  findProtectedCredential,
  replaceProtectedCredential,
  type DbConnection,
} from "@patcher/db";
import type { SealedCredential } from "@patcher/domain/protected-credentials";
import {
  createProtectedCredentials,
  credentialSourceHash,
} from "../../../src/services/plugins/protected-credentials.js";
import { createPluginSiteAccess } from "../../../src/services/plugins/plugin-site-access.js";
import { runWithPluginSiteCallers } from "../../../src/services/browser/plugin-site-caller.js";
import { runAsCredentialAgent } from "../../../src/services/browser/credential-agent-scope.js";
import {
  rememberBrowserCaller,
  runAsRememberedBrowserCaller,
} from "../../../src/services/browser/browser-caller-handoff.js";
import { runAsBrowserCommandIssuer } from "../../../src/services/browser/browser-command-issuer.js";
import {
  createPluginHostCallServer,
  type PluginHostCapabilities,
} from "../../../src/services/plugins/plugin-host-call-server.js";
import type { PluginManifest } from "../../../src/services/plugins/manifest.js";

const databases: DbConnection[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.$client.close());
});
export async function credentialFixture() {
  const db = createConnection(":memory:");
  migrate(db);
  databases.push(db);
  const row = upsertInstalledPlugin(db, {
    id: "plugin",
    source: "/plugin",
    provenance: { kind: "direct" },
    sourceIntent: { kind: "path", canonicalPath: "/plugin" },
    exactResolution: { kind: "path" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
    rootDir: "/plugin",
    version: "1.0.0",
    enabled: true,
  });
  const context = {
    tabId: "tab",
    url: "https://example.com/login",
    origin: "https://example.com",
    documentId: randomUUID(),
  };
  const requestSite = vi.fn(async (method, data) =>
    method === "site.context"
      ? { token: randomUUID(), ...context, hostWebContentsId: 12 }
      : true,
  );
  const sites = createPluginSiteAccess({
    db,
    request: requestSite,
    changed: () => {},
  });
  const manifest = {
    id: "plugin",
    name: "Plugin",
    siteAccess: "runtime",
    sites: ["https://example.com/*"],
    permissions: ["credentials.manage"],
    packageName: "plugin",
    version: "1.0.0",
    description: "Fixture",
    branding: {},
    patcherEngineRange: undefined,
    patcherPluginSdkRange: ">=1.2.0",
    serverEntry: "/plugin/server.js",
    appEntry: undefined,
    themes: [],
    skillsRootPaths: [],
    skillNames: [],
    rootDir: "/plugin",
  } satisfies PluginManifest;
  await sites.register(row, manifest);
  let finish!: (result: unknown) => void;
  let input: any;
  const request = vi.fn(async (method, payload, signal) => {
    if (method === "credential.context") return { origin: context.origin };
    input = payload;
    return new Promise((resolve) => {
      finish = resolve;
      signal.addEventListener(
        "abort",
        () => resolve({ result: { status: "cancelled" } }),
        { once: true },
      );
    });
  });
  const service = createProtectedCredentials({ db, sites, request });
  function approve(status?: string) {
    const old = input.record as SealedCredential | undefined;
    const operation = input.request.operation;
    if (operation === "fill" || operation === "delete") {
      finish({
        result: {
          status: status ?? (operation === "fill" ? "filled" : "deleted"),
        },
      });
      return;
    }
    const record: SealedCredential = {
      id: old?.id ?? input.draft.id,
      version: old ? old.version + 1 : 1,
      owner: input.owner,
      sourceHash: input.sourceHash,
      origin: context.origin,
      accountId: old?.accountId ?? input.request.accountId,
      username: "alice",
      protection: old?.protection ?? "require-touch-id",
      createdAt: old?.createdAt ?? input.draft.createdAt,
      updatedAt: Date.now(),
      format: 1,
      vaultId: randomUUID(),
      seal: "opaque-sealed-metadata",
      nonce: "nonce",
      tag: "tag",
      ciphertext: "ciphertext",
    };
    const {
      owner,
      sourceHash,
      format,
      vaultId,
      seal,
      nonce,
      tag,
      ciphertext,
      ...metadata
    } = record;
    finish({
      result: {
        status: status ?? (old ? "updated" : "saved"),
        credential: metadata,
      },
      record,
    });
  }
  return {
    db,
    row,
    context,
    sites,
    manifest,
    service,
    request,
    requestSite,
    approve,
    input: () => input,
  };
}
describe("server-owned protected credential references", () => {
  it("stores only sealed records and returns references/metadata, with current origin listing", async () => {
    const f = await credentialFixture();
    const pending = f.service.call("plugin")("request", {
      operation: "save",
      tabId: "tab",
      accountId: "primary",
    });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalled());
    f.approve();
    const response = (await pending) as any;
    expect(response.status).toBe("saved");
    expect(response).not.toHaveProperty("record");
    expect(
      listProtectedCredentials(
        f.db,
        "plugin",
        credentialSourceHash(f.row),
        f.context.origin,
      ),
    ).toHaveLength(1);
    expect(await f.service.call("plugin")("list", { tabId: "tab" })).toEqual([
      response.credential,
    ]);
    f.context.origin = "https://elsewhere.example";
    expect(await f.service.call("plugin")("list", { tabId: "tab" })).toEqual(
      [],
    );
  });
  it("locks an account through native approval, enforces versions and CAS updates", async () => {
    const f = await credentialFixture(),
      call = f.service.call("plugin");
    const first = call("request", {
      operation: "save",
      tabId: "tab",
      accountId: "primary",
    });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    expect(
      await call("request", {
        operation: "save",
        tabId: "tab",
        accountId: "primary",
      }),
    ).toEqual({ status: "busy" });
    f.approve();
    const saved = (await first) as any;
    const reference = { id: saved.credential.id, version: 1 };
    const update = call("request", {
      operation: "update",
      tabId: "tab",
      reference,
    });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
    expect(
      await call("request", { operation: "fill", tabId: "tab", reference }),
    ).toEqual({ status: "busy" });
    f.approve();
    expect(((await update) as any).credential.version).toBe(2);
    expect(
      await call("request", { operation: "fill", tabId: "tab", reference }),
    ).toEqual({ status: "denied" });
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it("does not commit after any deputy is revoked", async () => {
    const f = await credentialFixture();
    const deputy = { ...f.row, id: "deputy" };
    await f.sites.register(deputy, { ...f.manifest, id: "deputy" });
    const pending = runWithPluginSiteCallers(["deputy"], () =>
      f.service.call("plugin")("request", {
        operation: "save",
        tabId: "tab",
        accountId: "primary",
      }),
    );
    await vi.waitFor(() => expect(f.request).toHaveBeenCalled());
    expect(
      f.requestSite.mock.calls.find(
        ([method]) => method === "site.context",
      )?.[1].owners,
    ).toHaveLength(2);
    await f.sites.disable("deputy");
    f.approve();
    expect(await pending).toEqual({ status: "denied" });
    expect(
      listProtectedCredentials(
        f.db,
        "plugin",
        credentialSourceHash(f.row),
        f.context.origin,
      ),
    ).toEqual([]);
  });
  it("refuses a deputy without the separate permission before native work", async () => {
    const f = await credentialFixture();
    await f.sites.register(
      { ...f.row, id: "deputy" },
      { ...f.manifest, id: "deputy", permissions: ["page.credentials"] },
    );
    await expect(
      runWithPluginSiteCallers(["deputy"], () =>
        f.service.call("plugin")("list", { tabId: "tab" }),
      ),
    ).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
  it("denies direct agents and carries that denial across a child call handoff", async () => {
    const f = await credentialFixture(),
      call = () => f.service.call("plugin")("list", { tabId: "tab" });
    await expect(runAsCredentialAgent(call)).rejects.toThrow();
    await expect(
      runAsBrowserCommandIssuer(
        { kind: "grant", grantId: "grant", label: "Agent", level: "read" },
        call,
      ),
    ).rejects.toThrow();
    const forget = runAsCredentialAgent(() =>
      rememberBrowserCaller("agent-call"),
    );
    try {
      await expect(
        runAsRememberedBrowserCaller("agent-call", call),
      ).rejects.toThrow();
    } finally {
      forget();
    }
    expect(f.request).not.toHaveBeenCalled();
  });
  it("retains ciphertext on revoke/removal and keeps source identity stable across upgrades", async () => {
    const f = await credentialFixture(),
      call = f.service.call("plugin");
    const pending = call("request", {
      operation: "save",
      tabId: "tab",
      accountId: "primary",
    });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalled());
    f.approve();
    const result = (await pending) as any;
    await f.sites.remove("plugin");
    expect(findProtectedCredential(f.db, result.credential.id)).toBeDefined();
    expect(
      credentialSourceHash({
        ...f.row,
        version: "2.0.0",
        sourceGitRequestedRef: "new-version",
      }),
    ).toBe(credentialSourceHash(f.row));
    expect(credentialSourceHash({ ...f.row, sourcePath: "/other" })).not.toBe(
      credentialSourceHash(f.row),
    );
  });
  it("rejects a forged DB row and an altered live version", async () => {
    const f = await credentialFixture(),
      call = f.service.call("plugin");
    const pending = call("request", {
      operation: "save",
      tabId: "tab",
      accountId: "primary",
    });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalled());
    f.approve();
    const result = (await pending) as any;
    const row = findProtectedCredential(f.db, result.credential.id)!;
    replaceProtectedCredential(f.db, { ...row, version: 2 }, 1);
    expect(
      await call("request", {
        operation: "fill",
        tabId: "tab",
        reference: { id: row.id, version: 2 },
      }),
    ).toEqual({ status: "denied" });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("revalidates undeclared child calls and rejects password/approved/owner/selector fields", async () => {
    const f = await credentialFixture();
    const caps = {
      pluginId: "plugin",
      permissions: ["page.credentials"],
      logger: { warn: vi.fn() },
      requestCredentials: f.service.call("plugin"),
    } as unknown as PluginHostCapabilities;
    const invoke = (body: any) =>
      createPluginHostCallServer(caps).onRequest({
        method: "browser.credentials.request",
        payload: body,
        signal: new AbortController().signal,
      });
    await expect(
      invoke({ operation: "save", tabId: "tab", accountId: "primary" }),
    ).rejects.toThrow();
    caps.permissions = ["credentials.manage"];
    for (const field of [
      "password",
      "approved",
      "owner",
      "originOverride",
      "selector",
    ])
      await expect(
        invoke({
          operation: "save",
          tabId: "tab",
          accountId: "primary",
          [field]: true,
        }),
      ).rejects.toThrow("Invalid credential request");
    expect(f.request).not.toHaveBeenCalled();
  });
});

it("round-trips an actual forked toolbar plugin through the guarded host and inert native proposal", async () => {
  const f = await credentialFixture(),
    dir = await mkdtemp(join(tmpdir(), "credential-child-test-"));
  const here = dirname(fileURLToPath(import.meta.url));
  const child = fork(
    resolve(here, "../../../src/services/plugins/plugin-host-entry.ts"),
    [],
    {
      execArgv: ["--conditions=source", "--import", import.meta.resolve("tsx")],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const errors: string[] = [],
    wire: unknown[] = [],
    kv = new Map<string, string>();
  child.stderr?.on("data", (chunk) => errors.push(String(chunk)));
  const caps = {
    pluginId: "plugin",
    permissions: ["credentials.manage", "toolbar.register"],
    sites: ["https://example.com/*"],
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    dataDir: dir,
    kvStore: {
      get: async (key) => kv.get(key),
      set: async (key, json) => {
        kv.set(key, json);
      },
      delete: async (key) => {
        kv.delete(key);
      },
      list: async () => [...kv.keys()],
    },
    readSettingsValues: async () => ({}),
    getSdk: () => undefined,
    getLoopbackBaseUrl: () => undefined,
    publishSignal() {},
    reportNeedsConfiguration() {},
    isAgentToolNameTaken: () => undefined,
    reportAgentToolProblem() {},
    requestBrowserCommand: async () => {
      throw Error("Browser commands not used for passwords");
    },
    getBrowserHostStatus: () => ({ connected: true, hostCount: 1 }),
    requestInteraction: async () => {
      throw Error("Renderer cannot authorize credentials");
    },
    requestCredentials: f.service.call("plugin"),
  } satisfies PluginHostCapabilities;
  const host = createPluginHostCallServer(caps);
  const multiplexer = createPortMultiplexer({
    port: createChildProcessPort(child),
    onUnroutable: (error) => errors.push(String(error)),
  });
  const channel = createPluginChannel({
    port: multiplexer.open("plugin"),
    name: "credential-server",
    onNotify: host.onNotify,
    onRequest: (request) => {
      wire.push(request.payload);
      return host.onRequest(request);
    },
  });
  try {
    const snapshot = (await channel.request({
      method: BOOTSTRAP_METHOD,
      payload: {
        pluginId: "plugin",
        permissions: caps.permissions,
        sites: caps.sites,
        dataDir: dir,
        loopbackBaseUrl: "http://127.0.0.1:1",
        apiKey: "fixture",
        serverEntry: resolve(here, "fixtures/credential-plugin/server.ts"),
      },
    })) as any;
    expect(snapshot.toolbarItems[0].id).toBe("credential");
    expect(snapshot.agentTools).toEqual([]);
    const running = channel.request({
      method: "browserToolbarRun",
      target: "credential",
      payload: { tabId: "tab", pageUrl: f.context.url },
    });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    expect(kv.has("credential-result")).toBe(false); // proposal awaits a person
    f.approve();
    await running;
    expect(JSON.parse(kv.get("credential-result")!).status).toBe("saved");
    expect(JSON.stringify(wire)).not.toContain("ciphertext");
    expect(JSON.parse(kv.get("credential-result")!)).not.toHaveProperty(
      "password",
    );
    expect(errors).toEqual([]);
  } finally {
    channel.close("Test completed");
    multiplexer.close("Test completed");
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
