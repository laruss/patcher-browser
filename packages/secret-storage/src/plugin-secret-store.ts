import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  decryptRecord,
  encryptRecord,
  keyEnvelopeSchema,
  MAX_SECRET_BYTES,
  parseRecord,
  parseVersioned,
  SECRET_KEY_PATTERN,
  SECRET_OWNER_PATTERN,
  SECRET_STORE_DIRECTORY,
  storeStateSchema,
  validateSecretScope,
  type KeyEnvelope,
  type StoreState,
} from "./encrypted-record.js";
import {
  durableDelete,
  durableWrite,
  missingFile,
  privateDirectory,
  readPrivateFile,
  type DurableStep,
} from "./durable-file.js";
import { SecretStorageError, type SecretStorageCode } from "./storage-error.js";

export interface OrdinarySettingsKeyBroker {
  wrap(storeId: string, key: Buffer): Promise<string>;
  unwrap(envelope: KeyEnvelope): Promise<Buffer>;
}
export interface PluginSecretAccess {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  assertWritable(): Promise<void>;
}
export interface PluginSecretStorageStatus {
  mode: "plaintext" | "encrypted";
  available: boolean;
  migrationPending: boolean;
  unprocessedEntries: number;
  error: SecretStorageCode | null;
}

/** Guard new formats before starting/mutating the database. Absence is legacy. */
export async function assertSecretStorageFormat(
  dataDir: string,
): Promise<void> {
  const bytes = await readPrivateFile(
    join(dataDir, SECRET_STORE_DIRECTORY, "state.json"),
    16_384,
  );
  if (bytes === undefined) return;
  let state: unknown;
  try {
    state = JSON.parse(bytes.toString("utf8"));
  } catch {
    return;
  }
  if (
    state !== null &&
    typeof state === "object" &&
    "version" in state &&
    state.version !== 1
  )
    throw new SecretStorageError("unsupported_version");
}

/** One server-owned store. Its queue covers reads, writes, activation and deletion. */
export class PluginSecretStore {
  private readonly root: string;
  private tail: Promise<unknown> = Promise.resolve();
  private initialized = false;
  private state: StoreState | undefined;
  private stateError: SecretStorageError | undefined;
  private mode: "plaintext" | "encrypted" = "plaintext";
  private dataKey: Buffer | undefined;
  private epoch = 0;
  private blocked: SecretStorageCode | undefined;
  private unprocessedEntries = 0;

  constructor(
    private readonly args: {
      dataDir: string;
      broker?: OrdinarySettingsKeyBroker;
      afterDurableStep?: (step: DurableStep) => void;
    },
  ) {
    this.root = join(args.dataDir, SECRET_STORE_DIRECTORY);
  }

  lock(reason: SecretStorageCode = "locked"): void {
    this.epoch += 1;
    this.blocked = reason;
    this.dataKey?.fill(0);
    this.dataKey = undefined;
  }
  unlock(): void {
    if (this.blocked === undefined) return;
    this.epoch += 1;
    this.blocked = undefined;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }

  private async load(): Promise<void> {
    if (this.initialized) return;
    const bytes = await readPrivateFile(join(this.root, "state.json"), 16_384);
    this.mode = bytes === undefined ? "plaintext" : "encrypted";
    if (bytes !== undefined) {
      try {
        this.state = parseVersioned(bytes, storeStateSchema);
      } catch (error) {
        this.stateError = error as SecretStorageError;
      }
    }
    this.initialized = true;
  }
  private requireState(): StoreState {
    if (this.stateError !== undefined) throw this.stateError;
    if (this.state === undefined) throw new SecretStorageError("corrupt");
    return this.state;
  }
  private requireBroker(): OrdinarySettingsKeyBroker {
    if (this.blocked !== undefined) throw new SecretStorageError(this.blocked);
    if (this.args.broker === undefined)
      throw new SecretStorageError("unavailable");
    return this.args.broker;
  }
  private checkEpoch(epoch: number): void {
    this.requireBroker();
    if (epoch !== this.epoch) throw new SecretStorageError("cancelled");
  }
  private async envelope(): Promise<KeyEnvelope> {
    const bytes = await readPrivateFile(join(this.root, "key.json"), 16_384);
    if (bytes === undefined) throw new SecretStorageError("corrupt");
    return parseVersioned(bytes, keyEnvelopeSchema);
  }
  private async key(): Promise<Buffer> {
    const state = this.requireState();
    const broker = this.requireBroker();
    if (this.dataKey !== undefined) return this.dataKey;
    const epoch = this.epoch;
    const envelope = await this.envelope();
    if (envelope.storeId !== state.storeId)
      throw new SecretStorageError("corrupt");
    const key = await broker.unwrap(envelope);
    if (epoch !== this.epoch || this.blocked !== undefined) {
      key.fill(0);
      throw new SecretStorageError(this.blocked ?? "cancelled");
    }
    if (key.length !== 32) {
      key.fill(0);
      throw new SecretStorageError("corrupt");
    }
    this.dataKey = key;
    return key;
  }
  private legacy(owner: string, key: string): string {
    validateSecretScope(owner, key);
    return join(this.args.dataDir, "plugins", owner, "secrets", key);
  }
  private record(owner: string, key: string): string {
    validateSecretScope(owner, key);
    return join(this.root, "records", owner, key);
  }
  private async readRecord(owner: string, key: string) {
    const bytes = await readPrivateFile(
      this.record(owner, key),
      2 * MAX_SECRET_BYTES,
    );
    return bytes === undefined ? undefined : parseRecord(bytes);
  }
  private async legacyValue(
    owner: string,
    key: string,
  ): Promise<Buffer | undefined> {
    return readPrivateFile(this.legacy(owner, key), MAX_SECRET_BYTES);
  }
  private async legacyExists(owner: string, key: string): Promise<boolean> {
    try {
      return (await lstat(this.legacy(owner, key))).isFile();
    } catch (error) {
      if (missingFile(error)) return false;
      throw error;
    }
  }
  private async legacyIdentity(owner: string, key: string) {
    try {
      const info = await lstat(this.legacy(owner, key), { bigint: true });
      if (!info.isFile()) throw new SecretStorageError("corrupt");
      return {
        device: String(info.dev),
        inode: String(info.ino),
        modified: String(info.mtimeNs),
        changed: String(info.ctimeNs),
        size: String(info.size),
      };
    } catch (error) {
      if (missingFile(error)) return undefined;
      throw error;
    }
  }
  private async finishDeletion(
    owner: string,
    key: string,
    record: Extract<
      import("./encrypted-record.js").EncryptedRecord,
      { kind: "deleted" }
    >,
  ) {
    const current = await this.legacyIdentity(owner, key);
    if (current === undefined) return;
    // Only the exact file present at the authorized deletion is crash residue.
    // A new file from an old binary must remain visible as a conflict.
    if (
      record.legacy === undefined ||
      JSON.stringify(record.legacy) !== JSON.stringify(current)
    )
      throw new SecretStorageError("conflict");
    await durableDelete(this.legacy(owner, key), this.args.afterDurableStep);
  }
  private async putRecord(
    owner: string,
    key: string,
    value: Buffer,
  ): Promise<void> {
    const state = this.requireState();
    const epoch = this.epoch;
    const dataKey = await this.key();
    this.checkEpoch(epoch);
    const record = encryptRecord(dataKey, state.storeId, owner, key, value);
    await privateDirectory(join(this.root, "records"));
    await durableWrite(
      this.record(owner, key),
      JSON.stringify(record),
      this.args.afterDurableStep,
    );
    const stored = await this.readRecord(owner, key);
    if (stored === undefined) throw new SecretStorageError("corrupt");
    const verificationKey = await this.key();
    this.checkEpoch(epoch);
    const verified = decryptRecord(
      verificationKey,
      state.storeId,
      owner,
      key,
      stored,
    );
    if (verified === undefined || !verified.equals(value))
      throw new SecretStorageError("corrupt");
  }
  private access(owner: string, queued: boolean): PluginSecretAccess {
    validateSecretScope(owner);
    const run = <T>(fn: () => Promise<T>) =>
      queued ? this.exclusive(fn) : fn();
    return {
      get: (key) =>
        run(async () => {
          await this.load();
          if (this.mode === "plaintext")
            return (await this.legacyValue(owner, key))?.toString("utf8");
          this.requireState();
          const record = await this.readRecord(owner, key);
          if (await this.legacyExists(owner, key))
            throw new SecretStorageError("conflict");
          const epoch = this.epoch;
          const dataKey = await this.key();
          this.checkEpoch(epoch);
          if (record === undefined || record.kind === "deleted")
            return undefined;
          return decryptRecord(
            dataKey,
            this.requireState().storeId,
            owner,
            key,
            record,
          )?.toString("utf8");
        }),
      has: (key) =>
        run(async () => {
          await this.load();
          if (this.mode === "plaintext") return this.legacyExists(owner, key);
          const bytes = await readPrivateFile(
            this.record(owner, key),
            2 * MAX_SECRET_BYTES,
          );
          if (bytes !== undefined) {
            try {
              return (
                parseRecord(bytes).kind !== "deleted" ||
                (await this.legacyExists(owner, key))
              );
            } catch {
              return true;
            }
          }
          return this.legacyExists(owner, key);
        }),
      assertWritable: () =>
        run(async () => {
          await this.load();
          if (this.mode === "encrypted") await this.key();
        }),
      set: (key, value) =>
        run(async () => {
          await this.load();
          const bytes = Buffer.from(value, "utf8");
          if (bytes.length > MAX_SECRET_BYTES)
            throw new SecretStorageError("invalid_request");
          if (this.mode === "plaintext") {
            await durableWrite(this.legacy(owner, key), bytes);
            return;
          }
          if (await this.legacyExists(owner, key))
            throw new SecretStorageError("conflict");
          await this.putRecord(owner, key, bytes);
        }),
      delete: (key) =>
        run(async () => {
          await this.load();
          if (this.mode === "encrypted") {
            await this.key();
            const legacy = await this.legacyIdentity(owner, key);
            await privateDirectory(join(this.root, "records"));
            await durableWrite(
              this.record(owner, key),
              JSON.stringify({
                version: 1,
                kind: "deleted",
                ...(legacy === undefined ? {} : { legacy }),
              }),
              this.args.afterDurableStep,
            );
            await this.finishDeletion(owner, key, {
              version: 1,
              kind: "deleted",
              ...(legacy === undefined ? {} : { legacy }),
            });
            return;
          }
          await durableDelete(
            this.legacy(owner, key),
            this.args.afterDurableStep,
          );
        }),
    };
  }
  forPlugin(owner: string): PluginSecretAccess {
    return this.access(owner, true);
  }
  transaction<T>(
    owner: string,
    fn: (access: PluginSecretAccess) => Promise<T>,
    commit: (value: T) => void,
  ): Promise<T> {
    return this.exclusive(async () => {
      await this.load();
      const epoch = this.epoch;
      const before = new Map<string, Buffer | undefined>();
      let encryptedAccess = false;
      const access = this.access(owner, false);
      const remember = async (key: string) => {
        if (this.mode !== "encrypted") return;
        encryptedAccess = true;
        // Updates cannot delete a legacy migration/conflict source.
        if (await this.legacyExists(owner, key))
          throw new SecretStorageError("conflict");
        if (!before.has(key))
          before.set(
            key,
            await readPrivateFile(
              this.record(owner, key),
              2 * MAX_SECRET_BYTES,
            ),
          );
      };
      try {
        const value = await fn({
          ...access,
          get: (key) => {
            encryptedAccess ||= this.mode === "encrypted";
            return access.get(key);
          },
          set: async (key, value) => {
            await remember(key);
            await access.set(key, value);
          },
          delete: async (key) => {
            await remember(key);
            await access.delete(key);
          },
        });
        if (encryptedAccess) this.checkEpoch(epoch);
        // Synchronous SQL commit cannot interleave with a lock notification.
        commit(value);
        return value;
      } catch (error) {
        // Ciphertext before-images permit rollback after key erasure. This is
        // operation rollback, not a multi-setting crash-atomicity guarantee.
        try {
          for (const [key, bytes] of before) {
            if (bytes === undefined)
              await durableDelete(this.record(owner, key));
            else await durableWrite(this.record(owner, key), bytes);
          }
        } catch {
          this.stateError = new SecretStorageError("corrupt");
          this.lock("corrupt");
          throw this.stateError;
        }
        throw error;
      }
    });
  }

  private async inventory(): Promise<Array<{ owner: string; key: string }>> {
    const entries: Array<{ owner: string; key: string }> = [];
    this.unprocessedEntries = 0;
    let owners;
    try {
      owners = await readdir(join(this.args.dataDir, "plugins"), {
        withFileTypes: true,
      });
    } catch (error) {
      if (missingFile(error)) return entries;
      throw error;
    }
    for (const owner of owners) {
      if (!owner.isDirectory() || !SECRET_OWNER_PATTERN.test(owner.name)) {
        this.unprocessedEntries++;
        continue;
      }
      const dir = join(this.args.dataDir, "plugins", owner.name, "secrets");
      let files;
      try {
        const info = await lstat(dir);
        if (!info.isDirectory() || info.isSymbolicLink()) {
          this.unprocessedEntries++;
          continue;
        }
        files = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (missingFile(error)) continue;
        throw error;
      }
      for (const file of files) {
        if (file.name === ".http-token") continue;
        if (!file.isFile() || !SECRET_KEY_PATTERN.test(file.name)) {
          this.unprocessedEntries++;
          continue;
        }
        entries.push({ owner: owner.name, key: file.name });
      }
    }
    return entries;
  }
  private async migrate(signal?: AbortSignal): Promise<void> {
    const state = this.requireState();
    for (const { owner, key } of await this.inventory()) {
      if (signal?.aborted) throw new SecretStorageError("cancelled");
      this.requireBroker();
      const source = await this.legacyValue(owner, key);
      if (source === undefined) continue;
      const record = await this.readRecord(owner, key);
      if (record?.kind === "deleted") {
        await this.finishDeletion(owner, key, record);
        continue;
      }
      if (record !== undefined) {
        const epoch = this.epoch;
        const dataKey = await this.key();
        this.checkEpoch(epoch);
        const target = decryptRecord(
          dataKey,
          state.storeId,
          owner,
          key,
          record,
        );
        if (target === undefined || !target.equals(source))
          throw new SecretStorageError("conflict");
      } else {
        await this.putRecord(owner, key, source);
      }
      this.requireBroker();
      if (signal?.aborted) throw new SecretStorageError("cancelled");
      await durableDelete(this.legacy(owner, key), this.args.afterDurableStep);
    }
    const active: StoreState = { ...state, phase: "active" };
    await durableWrite(
      join(this.root, "state.json"),
      JSON.stringify(active),
      this.args.afterDurableStep,
    );
    this.state = active;
  }
  async initialize(): Promise<void> {
    await this.exclusive(async () => {
      await this.load();
      if (this.state?.phase === "migrating") {
        await this.key();
        await this.migrate();
      } else if (this.mode === "encrypted") {
        this.requireState();
        // A durable deletion marker is authoritative, including after a crash.
        for (const { owner, key } of await this.inventory()) {
          const record = await this.readRecord(owner, key);
          if (record?.kind === "deleted")
            await this.finishDeletion(owner, key, record);
        }
      }
    });
  }
  async activate(signal?: AbortSignal): Promise<PluginSecretStorageStatus> {
    await this.exclusive(async () => {
      await this.load();
      const broker = this.requireBroker();
      if (signal?.aborted) throw new SecretStorageError("cancelled");
      if (this.stateError !== undefined) throw this.stateError;
      if (this.state === undefined) {
        const existing = await readPrivateFile(
          join(this.root, "key.json"),
          16_384,
        );
        let envelope: KeyEnvelope;
        if (existing !== undefined) {
          envelope = parseVersioned(existing, keyEnvelopeSchema);
          const verified = await broker.unwrap(envelope);
          try {
            if (verified.length !== 32) throw new SecretStorageError("corrupt");
          } finally {
            verified.fill(0);
          }
        } else {
          const key = randomBytes(32);
          const storeId = randomUUID();
          try {
            envelope = {
              version: 1,
              storeId,
              wrappedKey: await broker.wrap(storeId, key),
            };
            keyEnvelopeSchema.parse(envelope);
            await durableWrite(
              join(this.root, "key.json"),
              JSON.stringify(envelope),
              this.args.afterDurableStep,
            );
            const verified = await broker.unwrap(envelope);
            try {
              if (
                verified.length !== key.length ||
                !timingSafeEqual(key, verified)
              )
                throw new SecretStorageError("corrupt");
            } finally {
              verified.fill(0);
            }
          } finally {
            key.fill(0);
          }
        }
        this.requireBroker();
        if (signal?.aborted) throw new SecretStorageError("cancelled");
        const state: StoreState = {
          version: 1,
          storeId: envelope.storeId,
          phase: "migrating",
        };
        try {
          await durableWrite(
            join(this.root, "state.json"),
            JSON.stringify(state),
            this.args.afterDurableStep,
          );
        } catch (error) {
          // A rename may already have committed. Re-read before permitting any legacy write.
          this.initialized = false;
          await this.load();
          throw error;
        }
        this.state = state;
        this.mode = "encrypted";
      }
      if (this.state.phase === "migrating") {
        await this.key();
        await this.migrate(signal);
      }
    });
    return this.status();
  }
  async status(): Promise<PluginSecretStorageStatus> {
    return this.exclusive(async () => {
      await this.load();
      const legacy = this.mode === "encrypted" ? await this.inventory() : [];
      const error =
        this.stateError?.code ??
        this.blocked ??
        (this.mode === "encrypted" && this.args.broker === undefined
          ? "unavailable"
          : null) ??
        (this.state?.phase === "active" && legacy.length > 0
          ? "conflict"
          : null);
      return {
        mode: this.mode,
        available: error === null && this.args.broker !== undefined,
        migrationPending:
          this.state?.phase === "migrating" || this.unprocessedEntries > 0,
        unprocessedEntries: this.unprocessedEntries,
        error,
      };
    });
  }
  async deletePlugin(owner: string): Promise<void> {
    validateSecretScope(owner);
    await this.exclusive(async () => {
      const access = this.access(owner, false);
      const keys = new Set<string>();
      for (const dir of [
        join(this.root, "records", owner),
        join(this.args.dataDir, "plugins", owner, "secrets"),
      ]) {
        let names: string[];
        try {
          names = await readdir(dir);
        } catch (error) {
          if (missingFile(error)) continue;
          throw error;
        }
        for (const name of names) {
          const key = name;
          if (SECRET_KEY_PATTERN.test(key)) keys.add(key);
        }
      }
      const liveKeys: string[] = [];
      for (const key of keys) {
        let deleted = false;
        try {
          deleted = (await this.readRecord(owner, key))?.kind === "deleted";
        } catch {
          /* A corrupt record still needs explicit deletion. */
        }
        if (!deleted || (await this.legacyExists(owner, key)))
          liveKeys.push(key);
      }
      if (liveKeys.length > 0) await access.assertWritable();
      for (const key of liveKeys) await access.delete(key);
      await rm(join(this.args.dataDir, "plugins", owner, "secrets"), {
        recursive: true,
        force: true,
      });
    });
  }
}
