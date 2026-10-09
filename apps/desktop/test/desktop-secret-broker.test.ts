import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex, PassThrough } from "node:stream";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PrivateSecretChannel,
  type PluginSecretStore,
  SecretStorageError,
} from "@patcher/secret-storage";
import { createDesktopSiteAuthority } from "../src/desktop-site-authority.js";
import {
  createDesktopSecretBroker,
  type DesktopKeyBackend,
} from "../src/desktop-secret-broker.js";
type Relay = new (stream: Duplex) => {
  attach(stream: Duplex): void;
  close(): void;
};
let DesktopSecretRelay: Relay;
let createDesktopSecretStorage: (
  dataDir: string,
  stream: Duplex,
) => { store: PluginSecretStore; close(): void };
beforeAll(async () => {
  ({ DesktopSecretRelay } = await vi.importActual<{
    DesktopSecretRelay: Relay;
  }>("../../../packages/patcher-app/src/desktop-secret-relay.js"));
  ({ createDesktopSecretStorage } = await vi.importActual<{
    createDesktopSecretStorage: typeof createDesktopSecretStorage;
  }>("../../server/src/services/plugins/desktop-secret-storage.js"));
});

function pair() {
  const left = new PassThrough();
  const right = new PassThrough();
  left.on("error", () => {});
  right.on("error", () => {});
  const streams = [
    Duplex.from({ readable: left, writable: right }),
    Duplex.from({ readable: right, writable: left }),
  ] as const;
  streams.forEach((stream) => stream.on("error", () => {}));
  return streams;
}
function backend(): DesktopKeyBackend {
  const key = randomBytes(32);
  return {
    available: () => true,
    encrypt(value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      return Buffer.concat([
        nonce,
        cipher.update(value),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
    },
    decrypt(value) {
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        value.subarray(0, 12),
      );
      cipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([
        cipher.update(value.subarray(12, -16)),
        cipher.final(),
      ]).toString();
    },
  };
}
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function stack() {
  const dataDir = await mkdtemp(join(tmpdir(), "patcher-private-settings-"));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const [main, launcher] = pair();
  const broker = createDesktopSecretBroker(main, backend());
  const relay = new DesktopSecretRelay(launcher);
  cleanup.push(() => {
    broker.close();
    relay.close();
  });
  function restart() {
    const [launcherServer, child] = pair();
    relay.attach(launcherServer);
    const storage = createDesktopSecretStorage(dataDir, child);
    cleanup.push(() => storage.close());
    return storage;
  }
  const storage = restart();
  await vi.waitFor(async () =>
    expect((await broker.action("status")).available).toBe(true),
  );
  return { broker, storage, restart };
}
describe("desktop-owned settings channel", () => {
  it("ordinary background unwrap cannot open a protected credential key", async () => {
    const [main, child] = pair(),
      os = backend();
    const broker = createDesktopSecretBroker(main, os),
      server = new PrivateSecretChannel(child);
    cleanup.push(() => {
      broker.close();
      server.close();
    });
    const vaultId = randomUUID();
    const wrappedKey = os
      .encrypt(
        JSON.stringify({
          format: 1,
          purpose: "protected-credentials",
          vaultId,
          key: randomBytes(32).toString("base64"),
        }),
      )
      .toString("base64");
    await expect(
      server.request("unwrap", { version: 1, storeId: vaultId, wrappedKey }),
    ).rejects.toMatchObject({ code: "corrupt" });
    const ordinary = {
      storeId: randomUUID(),
      key: randomBytes(32).toString("base64"),
    };
    const settingsKey = await server.request("wrap", ordinary);
    await expect(
      server.request("unwrap", {
        version: 1,
        storeId: ordinary.storeId,
        wrappedKey: settingsKey,
      }),
    ).resolves.toBe(ordinary.key);
  });
  it("keeps site policy independent of Keychain lock and resets it when the owned server disconnects", async () => {
    const [main, child] = pair();
    const authority = createDesktopSiteAuthority({
      resolve: () => null,
      confirm: async () => false,
      changed: vi.fn(),
    });
    const unavailableBackend = { ...backend(), available: () => false };
    const broker = createDesktopSecretBroker(
        main,
        unavailableBackend,
        authority,
      ),
      server = new PrivateSecretChannel(child);
    cleanup.push(() => {
      broker.close();
      server.close();
    });
    server.notify("server", true);
    await expect(
      server.request("site.policy", {
        pluginId: "plugin",
        name: "Plugin",
        revision: randomUUID(),
        enabled: true,
        sites: ["https://a.example.com/**"],
        origins: ["https://a.example.com"],
        permissions: ["page.read"],
        scripts: [],
        styles: [],
      }),
    ).resolves.toBe(true);
    expect(authority.allows("plugin", "https://a.example.com/")).toBe(true);
    await expect(
      server.request("wrap", {
        storeId: randomUUID(),
        key: randomBytes(32).toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "locked" });
    server.notify("server", false);
    await vi.waitFor(() =>
      expect(authority.allows("plugin", "https://a.example.com/")).toBe(false),
    );
    await expect(server.request("site.cleanup", null)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
  it("allows activation to be retried after a cancelled OS key operation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "patcher-cancelled-secret-"));
    cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
    const [left, right] = pair();
    let first = true;
    let key: Buffer | undefined;
    const main = new PrivateSecretChannel(left, {
      request: async (method, payload) => {
        if (first) {
          first = false;
          throw new SecretStorageError("cancelled");
        }
        if (method === "wrap") {
          key = Buffer.from((payload as { key: string }).key, "base64");
          return "b3BhcXVl";
        }
        return key?.toString("base64");
      },
    });
    const storage = createDesktopSecretStorage(dataDir, right);
    cleanup.push(() => {
      storage.close();
      main.close();
    });
    await expect(storage.store.activate()).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(await storage.store.status()).toMatchObject({
      available: true,
      error: null,
    });
    expect(await storage.store.activate()).toMatchObject({
      mode: "encrypted",
      error: null,
    });
  });
  it("unwraps only ordinary-settings keys for the matching store", async () => {
    const [main, server] = pair();
    const os = backend();
    const broker = createDesktopSecretBroker(main, os);
    const peer = new PrivateSecretChannel(server);
    cleanup.push(() => {
      broker.close();
      peer.close();
    });
    const storeId = randomUUID();
    const key = randomBytes(32).toString("base64");
    const wrappedKey = await peer.request("wrap", { storeId, key });
    expect(
      await peer.request("unwrap", { version: 1, storeId, wrappedKey }),
    ).toBe(key);
    await expect(
      peer.request("unwrap", { version: 1, storeId: randomUUID(), wrappedKey }),
    ).rejects.toMatchObject({ code: "corrupt" });
    const foreign = os
      .encrypt(
        JSON.stringify({ version: 1, purpose: "password-vault", storeId, key }),
      )
      .toString("base64");
    await expect(
      peer.request("unwrap", { version: 1, storeId, wrappedKey: foreign }),
    ).rejects.toMatchObject({ code: "corrupt" });
    await expect(
      peer.request("wrap", { storeId, key, owner: "other" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("survives a server restart and clears access on lock and shell disconnect", async () => {
    const { broker, storage, restart } = await stack();
    expect(await broker.action("activate")).toMatchObject({
      mode: "encrypted",
      error: null,
    });
    await storage.store.forPlugin("fixture").set("token", "sentinel-秘密\n");
    storage.close();
    const next = restart();
    await vi.waitFor(async () =>
      expect(await next.store.forPlugin("fixture").get("token")).toBe(
        "sentinel-秘密\n",
      ),
    );
    broker.availability(false);
    await vi.waitFor(async () => {
      await expect(
        next.store.forPlugin("fixture").get("token"),
      ).rejects.toMatchObject({ code: "locked" });
    });
    expect(await next.store.forPlugin("fixture").has("token")).toBe(true);
    broker.availability(true);
    await vi.waitFor(async () =>
      expect(await next.store.forPlugin("fixture").get("token")).toBe(
        "sentinel-秘密\n",
      ),
    );
    broker.close();
    await vi.waitFor(async () => {
      await expect(
        next.store.forPlugin("fixture").get("token"),
      ).rejects.toMatchObject({ code: "unavailable" });
    });
  });
  it("rejects pending requests on EOF, propagates cancellation, and rejects oversized frames", async () => {
    const [left, right] = pair();
    let cancelled = false;
    const receiver = new PrivateSecretChannel(right, {
      request: async (_method, _payload, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              cancelled = true;
              reject(new SecretStorageError("cancelled"));
            },
            { once: true },
          );
        }),
    });
    const sender = new PrivateSecretChannel(left);
    cleanup.push(() => {
      sender.close();
      receiver.close();
    });
    const controller = new AbortController();
    const pending = sender.request("status", null, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(sender.connected).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await vi.waitFor(() => expect(cancelled).toBe(true));
    const disconnected = sender.request("status");
    receiver.close();
    await expect(disconnected).rejects.toMatchObject({ code: "unavailable" });
    const [large, raw] = pair();
    const limited = new PrivateSecretChannel(large);
    cleanup.push(() => {
      limited.close();
      raw.destroy();
    });
    const header = Buffer.alloc(4);
    header.writeUInt32BE(1_048_577);
    raw.write(header);
    await expect(limited.request("status")).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
