import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginSecretStore,
  SecretStorageError,
  assertSecretStorageFormat,
  type OrdinarySettingsKeyBroker,
} from "../src/index.js";
import {
  encryptRecord,
  decryptRecord,
  parseRecord,
} from "../src/encrypted-record.js";

const dirs: string[] = [];
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "patcher-secret-store-"));
  dirs.push(dir);
  return dir;
}
function broker(): OrdinarySettingsKeyBroker {
  const keys = new Map<string, Buffer>();
  return {
    wrap: vi.fn(async (_storeId, key) => {
      const id = randomBytes(24).toString("base64");
      keys.set(id, Buffer.from(key));
      return id;
    }),
    unwrap: vi.fn(async ({ wrappedKey }) => {
      const key = keys.get(wrappedKey);
      if (key === undefined) throw new SecretStorageError("locked");
      return Buffer.from(key);
    }),
  };
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const legacyPath = (dataDir: string, owner = "fixture", key = "token") =>
  join(dataDir, "plugins", owner, "secrets", key);
const recordPath = (dataDir: string, key = "token") =>
  join(dataDir, "plugin-secret-storage", "records", "fixture", key);
async function legacy(
  dir: string,
  value: string,
  owner = "fixture",
  key = "token",
) {
  const path = legacyPath(dir, owner, key);
  await mkdir(join(dir, "plugins", owner, "secrets"), { recursive: true });
  await writeFile(path, value);
}

describe("authenticated secret records", () => {
  it("preserves empty and Unicode values and binds ciphertext to store, owner and key", () => {
    const key = randomBytes(32);
    const store = randomUUID();
    for (const value of ["", "  токен\n秘密🙂\n"]) {
      const record = encryptRecord(
        key,
        store,
        "fixture",
        "token",
        Buffer.from(value),
      );
      expect(
        decryptRecord(key, store, "fixture", "token", record)?.toString(),
      ).toBe(value);
      for (const scope of [
        [randomUUID(), "fixture", "token"],
        [store, "other", "token"],
        [store, "fixture", "other"],
      ] as const) {
        expect(() =>
          decryptRecord(key, scope[0], scope[1], scope[2], record),
        ).toThrow(SecretStorageError);
      }
      if (record.kind !== "value") throw new Error();
      expect(() =>
        decryptRecord(key, store, "fixture", "token", {
          ...record,
          tag: randomBytes(16).toString("base64"),
        }),
      ).toThrow(SecretStorageError);
      expect(() =>
        parseRecord(Buffer.from(JSON.stringify({ ...record, nonce: "AA==" }))),
      ).toThrow(SecretStorageError);
      expect(() =>
        parseRecord(Buffer.from(JSON.stringify({ ...record, version: 2 }))),
      ).toThrow(expect.objectContaining({ code: "unsupported_version" }));
      expect(() => parseRecord(Buffer.from("{"))).toThrow(SecretStorageError);
    }
  });
});
describe("plugin secret store", () => {
  it("removes empty or tombstone-only owners while locked without unwrap", async () => {
    const dataDir = await directory();
    const keys = broker();
    const store = new PluginSecretStore({ dataDir, broker: keys });
    await store.activate();
    await store.forPlugin("deleted").set("token", "old");
    await store.forPlugin("deleted").delete("token");
    store.lock();
    vi.mocked(keys.unwrap).mockClear();
    await store.deletePlugin("empty");
    await store.deletePlugin("deleted");
    expect(keys.unwrap).not.toHaveBeenCalled();
  });
  it("preserves a new legacy token after deletion as a downgrade conflict", async () => {
    const dataDir = await directory();
    const keys = broker();
    const store = new PluginSecretStore({ dataDir, broker: keys });
    await legacy(dataDir, "old");
    await store.activate();
    await legacy(dataDir, "stale");
    await store.forPlugin("fixture").delete("token");
    // Even identical bytes written by an old binary are a new file, not crash residue.
    await legacy(dataDir, "stale");
    const returned = new PluginSecretStore({ dataDir, broker: keys });
    await expect(returned.initialize()).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await readFile(legacyPath(dataDir), "utf8")).toBe("stale");
    expect(await returned.forPlugin("fixture").has("token")).toBe(true);
    expect(await returned.status()).toMatchObject({ error: "conflict" });
  });
  it("keeps repeated unlock idempotent during delayed migration unwrap", async () => {
    const dataDir = await directory();
    const keys = broker();
    await legacy(dataDir, "preserved");
    let count = 0;
    const initial = new PluginSecretStore({
      dataDir,
      broker: keys,
      afterDurableStep: () => {
        if (++count === 6) throw new Error("crash");
      },
    });
    await expect(initial.activate()).rejects.toThrow();
    let release!: () => void;
    let entered = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resumed = new PluginSecretStore({
      dataDir,
      broker: {
        wrap: keys.wrap,
        unwrap: async (envelope) => {
          entered = true;
          await gate;
          return keys.unwrap(envelope);
        },
      },
    });
    resumed.lock();
    resumed.unlock();
    const migration = resumed.initialize();
    await vi.waitFor(() => expect(entered).toBe(true));
    resumed.unlock();
    release();
    await migration;
    expect(await resumed.forPlugin("fixture").get("token")).toBe("preserved");
  });
  it("preserves previously valid long setting filenames during migration", async () => {
    const dataDir = await directory();
    const store = new PluginSecretStore({ dataDir, broker: broker() });
    for (const length of [129, 255]) {
      const key = "k".repeat(length);
      await legacy(dataDir, "preserved", "fixture", key);
      expect(await store.forPlugin("fixture").get(key)).toBe("preserved");
    }
    await store.activate();
    for (const length of [129, 255])
      expect(await store.forPlugin("fixture").get("k".repeat(length))).toBe(
        "preserved",
      );
  });
  it("migrates disabled-plugin inventory, preserves exact bytes and excludes bootstrap tokens and unknown entries", async () => {
    const dataDir = await directory();
    const keys = broker();
    const value = "sentinel-秘密-token\n\n";
    await legacy(dataDir, value);
    await legacy(dataDir, "", "disabled", "empty");
    await legacy(dataDir, "bootstrap-token", "fixture", ".http-token");
    await legacy(dataDir, "old-backup", "fixture", "token.bak");
    const store = new PluginSecretStore({ dataDir, broker: keys });
    expect(await store.status()).toMatchObject({ mode: "plaintext" });
    expect(await store.forPlugin("fixture").get("token")).toBe(value);
    const status = await store.activate();
    expect(status).toMatchObject({
      mode: "encrypted",
      migrationPending: true,
      unprocessedEntries: 1,
    });
    expect(await store.forPlugin("fixture").get("token")).toBe(value);
    expect(await store.forPlugin("disabled").get("empty")).toBe("");
    await expect(readFile(legacyPath(dataDir))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await readFile(legacyPath(dataDir, "fixture", ".http-token"), "utf8"),
    ).toBe("bootstrap-token");
    expect((await stat(recordPath(dataDir))).mode & 0o777).toBe(0o600);
    expect(
      (await stat(join(dataDir, "plugin-secret-storage"))).mode & 0o777,
    ).toBe(0o700);
    async function contents(dir: string): Promise<string> {
      const files = await readdir(dir, { withFileTypes: true });
      return (
        await Promise.all(
          files.map((file) =>
            file.isDirectory()
              ? contents(join(dir, file.name))
              : readFile(join(dir, file.name), "utf8"),
          ),
        )
      ).join("");
    }
    expect(
      await contents(join(dataDir, "plugin-secret-storage")),
    ).not.toContain(value);
  });
  it.each(Array.from({ length: 13 }, (_, i) => i + 1))(
    "recovers migration after durable step %i",
    async (stopAt) => {
      const dataDir = await directory();
      const keys = broker();
      const value = "exact\n秘密\n";
      await legacy(dataDir, value);
      let count = 0;
      const interrupted = new PluginSecretStore({
        dataDir,
        broker: keys,
        afterDurableStep: () => {
          if (++count === stopAt) throw new Error("crash");
        },
      });
      await expect(interrupted.activate()).rejects.toThrow("crash");
      let stateExists = true;
      try {
        await stat(join(dataDir, "plugin-secret-storage", "state.json"));
      } catch {
        stateExists = false;
      }
      expect((await interrupted.status()).mode).toBe(
        stateExists ? "encrypted" : "plaintext",
      );
      const recovered = new PluginSecretStore({ dataDir, broker: keys });
      await recovered.initialize();
      if ((await recovered.status()).mode === "plaintext")
        await recovered.activate();
      expect(await recovered.forPlugin("fixture").get("token")).toBe(value);
      expect(await recovered.status()).toMatchObject({
        mode: "encrypted",
        migrationPending: false,
        error: null,
      });
      await expect(readFile(legacyPath(dataDir))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
  it("reports locked, unavailable, corrupt and conflicting values without plaintext fallback", async () => {
    const dataDir = await directory();
    const keys = broker();
    const store = new PluginSecretStore({ dataDir, broker: keys });
    await legacy(dataDir, "sentinel");
    await store.activate();
    store.lock();
    expect(await store.forPlugin("fixture").has("token")).toBe(true);
    await expect(store.forPlugin("fixture").get("token")).rejects.toMatchObject(
      { code: "locked" },
    );
    await expect(
      store.forPlugin("fixture").get("missing"),
    ).rejects.toMatchObject({ code: "locked" });
    const headless = new PluginSecretStore({ dataDir });
    await expect(
      headless.forPlugin("fixture").get("token"),
    ).rejects.toMatchObject({ code: "unavailable" });
    const copied = new PluginSecretStore({ dataDir, broker: broker() });
    await expect(
      copied.forPlugin("fixture").get("token"),
    ).rejects.toMatchObject({ code: "locked" });
    store.unlock();
    await legacy(dataDir, "divergent");
    await expect(store.forPlugin("fixture").get("token")).rejects.toMatchObject(
      { code: "conflict" },
    );
    expect(await store.status()).toMatchObject({
      available: false,
      error: "conflict",
    });
    await rm(legacyPath(dataDir));
    await writeFile(recordPath(dataDir), "truncated");
    await expect(store.forPlugin("fixture").get("token")).rejects.toMatchObject(
      { code: "corrupt" },
    );
    expect(await store.forPlugin("fixture").has("token")).toBe(true);
    await writeFile(
      join(dataDir, "plugin-secret-storage", "state.json"),
      '{"version":2}',
    );
    await expect(assertSecretStorageFormat(dataDir)).rejects.toMatchObject({
      code: "unsupported_version",
    });
  });
  it("rejects a divergent migration pair, preserves legacy on denial, and serializes set/delete", async () => {
    const dataDir = await directory();
    const keys = broker();
    await legacy(dataDir, "old");
    let count = 0;
    const first = new PluginSecretStore({
      dataDir,
      broker: keys,
      afterDurableStep: () => {
        if (++count === 9) throw new Error("crash");
      },
    });
    await expect(first.activate()).rejects.toThrow();
    await legacy(dataDir, "new");
    const store = new PluginSecretStore({ dataDir, broker: keys });
    await expect(store.initialize()).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await readFile(legacyPath(dataDir), "utf8")).toBe("new");
    await store.forPlugin("fixture").delete("token");
    await store.initialize();
    const access = store.forPlugin("fixture");
    await Promise.all([
      access.set("token", "one"),
      access.set("token", "two"),
      access.delete("token"),
    ]);
    expect(await access.get("token")).toBeUndefined();
    expect(await access.has("token")).toBe(false);
    await expect(access.set("../other", "bad")).rejects.toMatchObject({
      code: "invalid_request",
    });
    const deniedDir = await directory();
    await legacy(deniedDir, "kept");
    const denied = new PluginSecretStore({
      dataDir: deniedDir,
      broker: {
        wrap: async () => {
          throw new SecretStorageError("locked");
        },
        unwrap: keys.unwrap,
      },
    });
    await expect(denied.activate()).rejects.toMatchObject({ code: "locked" });
    expect(await readFile(legacyPath(deniedDir), "utf8")).toBe("kept");
  });
  it("finishes deletion after a crash without reviving a legacy value", async () => {
    const dataDir = await directory();
    const keys = broker();
    const store = new PluginSecretStore({ dataDir, broker: keys });
    await legacy(dataDir, "old");
    await store.activate();
    await legacy(dataDir, "stale");
    let count = 0;
    const deleting = new PluginSecretStore({
      dataDir,
      broker: keys,
      afterDurableStep: () => {
        if (++count === 3) throw new Error("crash");
      },
    });
    await expect(
      deleting.forPlugin("fixture").delete("token"),
    ).rejects.toThrow();
    const recovered = new PluginSecretStore({ dataDir, broker: keys });
    await recovered.initialize();
    expect(await recovered.forPlugin("fixture").get("token")).toBeUndefined();
    await expect(readFile(legacyPath(dataDir))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
