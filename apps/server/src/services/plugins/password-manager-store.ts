import { and, asc, eq, gt } from "drizzle-orm";
import {
  getInstalledPlugin,
  firstProtectedCredential,
  protectedCredentials as table,
  type DbConnection,
} from "@patcher/db";
import {
  passwordStoreRequestSchema,
  storedPasswordSchema,
} from "@patcher/domain/password-manager";
import { SecretStorageError } from "@patcher/secret-storage";
import { credentialSourceHash } from "./protected-credentials.js";

/** Only the Electron-owned inherited pipe can call this store. Values remain
 * encrypted here; the plugin process and HTTP API have no read/reveal endpoint. */
export function createPasswordManagerStore(db: DbConnection) {
  return async (input: unknown): Promise<unknown> => {
    const parsed = passwordStoreRequestSchema.safeParse(input);
    if (!parsed.success) throw new SecretStorageError("invalid_request");
    const request = parsed.data;
    const plugin = getInstalledPlugin(db, "password-manager");
    const enabled =
      plugin?.enabled === true &&
      plugin.removedAt === null &&
      plugin.sourceKind === "builtin" &&
      plugin.sourceBuiltinName === "password-manager";
    if (request.operation === "status") {
      const first = enabled ? firstProtectedCredential(db) : undefined;
      return enabled ? { enabled: true, sourceHash: credentialSourceHash(plugin!), ...(first ? { vault: storedPasswordSchema.parse(first.record) } : {}) } : { enabled: false };
    }
    if (!enabled || credentialSourceHash(plugin!) !== request.sourceHash)
      throw new SecretStorageError("unavailable");
    const owner = "password-manager",
      sourceHash = request.sourceHash;
    const owned = and(eq(table.owner, owner), eq(table.sourceHash, sourceHash));
    if (request.operation === "list") {
      const rows = db
        .select()
        .from(table)
        .where(
          and(
            owned,
            request.origin ? eq(table.origin, request.origin) : undefined,
            request.after ? gt(table.id, request.after) : undefined,
          ),
        )
        .orderBy(asc(table.id))
        .limit(8)
        .all();
      const records = rows.map((row) => {
        const record = storedPasswordSchema.parse(row.record);
        if (
          record.id !== row.id ||
          record.owner !== owner ||
          record.sourceHash !== sourceHash ||
          record.origin !== row.origin ||
          record.accountId !== row.accountId ||
          record.version !== row.version
        )
          throw new SecretStorageError("corrupt");
        return record;
      });
      return { records, after: rows.length === 8 ? rows.at(-1)!.id : null };
    }
    if (request.operation === "delete") {
      if (
        db
          .delete(table)
          .where(
            and(
              owned,
              eq(table.id, request.id),
              eq(table.version, request.version),
            ),
          )
          .run().changes !== 1
      )
        throw new SecretStorageError("conflict");
      return true;
    }
    const records =
      request.operation === "migrate" ? request.records : [request.record];
    db.transaction((tx) => {
      for (const record of records) {
        if (record.owner !== owner || record.sourceHash !== sourceHash)
          throw new SecretStorageError("conflict");
        const previous = tx
          .select()
          .from(table)
          .where(eq(table.id, record.id))
          .get();
        const expected =
          request.operation === "migrate"
            ? record.version - 1
            : request.previousVersion;
        if (
          (expected === undefined && previous) ||
          (expected !== undefined &&
            (!previous ||
              previous.owner !== owner ||
              previous.sourceHash !== sourceHash ||
              previous.version !== expected ||
              record.version !== expected + 1))
        )
          throw new SecretStorageError("conflict");
        if (
          request.operation === "migrate" &&
          (!previous ||
            storedPasswordSchema.parse(previous.record).format !== 1)
        )
          throw new SecretStorageError("conflict");
        const old = previous
          ? storedPasswordSchema.parse(previous.record)
          : undefined;
        if (
          request.operation === "put" &&
          (!old ||
            old.origin !== record.origin ||
            old.username !== record.username)
        ) {
          // Account IDs are intentionally opaque and legacy duplicates survive
          // migration. New account identity must still be checked atomically.
          const occupied = tx
            .select()
            .from(table)
            .where(and(owned, eq(table.origin, record.origin)))
            .all();
          if (
            occupied.some(
              (row) =>
                row.id !== record.id &&
                storedPasswordSchema.parse(row.record).username ===
                  record.username,
            )
          )
            throw new SecretStorageError("conflict");
        }
        const row = {
          id: record.id,
          owner,
          sourceHash,
          origin: record.origin,
          accountId: record.accountId,
          version: record.version,
          record,
        };
        if (previous)
          tx.update(table).set(row).where(eq(table.id, record.id)).run();
        else tx.insert(table).values(row).run();
      }
    });
    return true;
  };
}
