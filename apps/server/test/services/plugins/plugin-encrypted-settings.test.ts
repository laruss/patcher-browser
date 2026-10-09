import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  getPluginSettingsValues,
  getPluginKvValue,
  migrate,
} from "@patcher/db";
import type { Logger } from "@patcher/logger";
import { PluginSecretStore } from "@patcher/secret-storage";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import {
  createPluginHostCallServer,
  type PluginHostCapabilities,
} from "../../../src/services/plugins/plugin-host-call-server.js";
import { testLogger } from "../../helpers/test-app.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
async function fixture(
  outOfProcess: boolean,
  afterDurableStep?: (step: string) => void,
) {
  const dataDir = await mkdtemp(join(tmpdir(), "patcher-encrypted-plugin-"));
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const rootDir = join(dataDir, "fixture-source");
  await mkdir(rootDir);
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "patcher-plugin-encrypted-settings",
      version: "0.1.0",
      patcher: {
        name: "Encrypted settings",
        description: "Fixture",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    `
    export default async function(patcher: any) {
      const settings = patcher.settings.define({token:{type:"string",label:"Token",secret:true,default:"unsafe-default"},note:{type:"string",label:"Note",default:"old"}});
      const values = await settings.get();
      if (values.token !== "sentinel-秘密-token\\n") throw new Error("Expected fixture credential");
      settings.onChange(() => {});
      patcher.onDispose(async () => {
        await patcher.storage.kv.set("disposing", true);
        await new Promise(resolve => setTimeout(resolve, 100));
      });
    }
  `,
  );
  const secrets = join(dataDir, "plugins", "encrypted-settings", "secrets");
  await mkdir(secrets, { recursive: true });
  await writeFile(join(secrets, "token"), "sentinel-秘密-token\n");
  let key = randomBytes(32);
  const store = new PluginSecretStore({
    dataDir,
    ...(afterDurableStep === undefined ? {} : { afterDurableStep }),
    broker: {
      wrap: async (_storeId, value) => {
        key = Buffer.from(value);
        return "b3BhcXVl";
      },
      unwrap: async () => Buffer.from(key),
    },
  });
  await store.activate();
  const db = createConnection(":memory:");
  migrate(db);
  const service: PluginService = createPluginService({
    db,
    dataDir,
    secretStore: store,
    appVersion: "0.9.0",
    logger: testLogger as unknown as Logger,
    runPluginOutOfProcess: () => outOfProcess,
    loadTimeoutMs: 10000,
    hub: {
      getDaemonSessionIdForHost: () => null,
      notifyPluginSignal: () => 0,
      notifySystem: () => {},
    },
  });
  cleanups.push(() => service.stop());
  return { dataDir, db, store, service, rootDir };
}
describe.each([false, true])(
  "encrypted plugin settings (child=%s)",
  (child) => {
    it("restores ciphertext and leaves SQL untouched if the Mac locks during an update", async () => {
      let armed = false;
      let lock!: () => void;
      const { service, rootDir, store, db } = await fixture(child, (step) => {
        if (armed && step === "renamed") {
          armed = false;
          lock();
        }
      });
      lock = () => store.lock();
      const entry = await service.installPath(rootDir);
      armed = true;
      await expect(
        service.updateSettings(entry.id, {
          token: "must-roll-back",
          note: "must-not-commit",
        }),
      ).rejects.toMatchObject({ code: "locked" });
      expect(getPluginSettingsValues(db, entry.id)).toEqual({});
      store.unlock();
      expect(await store.forPlugin(entry.id).get("token")).toBe(
        "sentinel-秘密-token\n",
      );
    });
    it("removes an ordinary-only plugin while the encrypted store is locked", async () => {
      const { service, rootDir, store } = await fixture(child);
      const manifest = JSON.parse(
        await readFile(join(rootDir, "package.json"), "utf8"),
      );
      manifest.name = "patcher-plugin-ordinary-settings";
      await writeFile(join(rootDir, "package.json"), JSON.stringify(manifest));
      await writeFile(
        join(rootDir, "server.ts"),
        `export default function(patcher: any) {patcher.settings.define({note:{type:"string",label:"Note"}});}`,
      );
      store.lock();
      const entry = await service.installPath(rootDir);
      expect(await service.remove(entry.id)).toBe(true);
    });
    it("updates ordinary-only settings while encrypted storage is locked", async () => {
      const { service, rootDir, store, db } = await fixture(child);
      await writeFile(
        join(rootDir, "server.ts"),
        `export default function(patcher: any) { patcher.settings.define({note: {type: "string", label: "Note"}}); }`,
      );
      store.lock();
      const entry = await service.installPath(rootDir);
      expect(entry.status).toBe("running");
      await service.updateSettings(entry.id, { note: "updated" });
      expect(getPluginSettingsValues(db, entry.id)).toEqual({
        note: '"updated"',
      });
    });
    it("does not resurrect a secret when an update races plugin removal", async () => {
      const { service, rootDir, store, db } = await fixture(child);
      const entry = await service.installPath(rootDir);
      const removal = service.remove(entry.id);
      await vi.waitFor(() =>
        expect(getPluginKvValue(db, entry.id, "disposing")).toBe("true"),
      );
      const update = service.updateSettings(entry.id, {
        token: "must-not-survive",
      });
      await removal;
      expect(await update).toBeUndefined();
      expect(await store.forPlugin(entry.id).get("token")).toBeUndefined();
    });
    it("supports load-safe get and keeps secrets out of metadata and ordinary DB rows", async () => {
      const { service, rootDir, dataDir, db, store } = await fixture(child);
      const entry = await service.installPath(rootDir);
      expect(entry.status).toBe("running");
      expect(entry.placement).toBe(child ? "process" : "server");
      const view = await service.getSettings(entry.id);
      expect(view?.values.token).toEqual({ set: true });
      expect(view?.schema.token).not.toHaveProperty("default");
      await service.updateSettings(entry.id, {
        token: "new-secret\n",
        note: "updated",
      });
      expect(await store.forPlugin(entry.id).get("token")).toBe("new-secret\n");
      expect(getPluginSettingsValues(db, entry.id)).toEqual({
        note: '"updated"',
      });
      await expect(
        readFile(join(dataDir, "plugins", entry.id, "secrets", "token")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      store.lock();
      await expect(service.remove(entry.id)).rejects.toMatchObject({
        code: "locked",
      });
      expect(service.list().some((plugin) => plugin.id === entry.id)).toBe(
        true,
      );
      store.unlock();
      await service.remove(entry.id);
      expect(await store.forPlugin(entry.id).get("token")).toBeUndefined();
    });
    it("keeps metadata available after a locked factory and rejects updates without partial DB writes", async () => {
      const { service, rootDir, db, store } = await fixture(child);
      store.lock();
      const entry = await service.installPath(rootDir);
      expect(entry.status).toBe("needs-configuration");
      expect(entry.hasSettings).toBe(true);
      expect((await service.getSettings(entry.id))?.values.token).toEqual({
        set: true,
      });
      await expect(
        service.updateSettings(entry.id, { token: "changed", note: "changed" }),
      ).rejects.toMatchObject({ code: "locked" });
      expect(getPluginSettingsValues(db, entry.id)).toEqual({});
      store.unlock();
      await service.reload(entry.id);
      expect(service.list().find((p) => p.id === entry.id)?.status).toBe(
        "running",
      );
      expect(service.list().find((p) => p.id === entry.id)?.placement).toBe(
        child ? "process" : "server",
      );
    });
  },
);
it("validates load-safe child descriptors before resolving server-owned scope", async () => {
  let observed: unknown;
  const caps = {
    pluginId: "owner",
    permissions: [],
    readSettingsValues: async (descriptors: unknown) => {
      observed = descriptors;
      return { token: "own-token" };
    },
  } as unknown as PluginHostCapabilities;
  const host = createPluginHostCallServer(caps);
  const signal = new AbortController().signal;
  for (const descriptors of [
    { "../victim": { type: "string", label: "Token", secret: true } },
    {
      token: { type: "string", label: "Token", secret: true, owner: "victim" },
    },
    [],
    null,
  ]) {
    await expect(
      host.onRequest({
        method: "settings.<handle>.get",
        payload: { descriptors } as never,
        signal,
      }),
    ).rejects.toThrow();
  }
  expect(observed).toBeUndefined();
  expect(
    await host.onRequest({
      method: "settings.<handle>.get",
      payload: {
        descriptors: {
          token: { type: "string", label: "Token", secret: true },
        },
        owner: "victim",
        pluginId: "victim",
      },
      signal,
    }),
  ).toEqual({ token: "own-token" });
  expect(observed).toEqual({
    token: { type: "string", label: "Token", secret: true },
  });
});
