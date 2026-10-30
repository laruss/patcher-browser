import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  createConnection,
  migrate,
  upsertInstalledPlugin,
  getInstalledPlugin,
  protectedCredentials,
  type DbConnection,
} from "@patcher/db";
import type { ManagerCredential } from "@patcher/domain/password-manager";
import { createPasswordManagerStore } from "../../../src/services/plugins/password-manager-store.js";
import { credentialSourceHash } from "../../../src/services/plugins/protected-credentials.js";

const databases: DbConnection[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.$client.close()));
function fixture(builtin = true) {
  const db = createConnection(":memory:");
  migrate(db);
  databases.push(db);
  const input = {
    id: "password-manager",
    source: "builtin:password-manager",
    provenance: { kind: "builtin" as const },
    sourceIntent: builtin
      ? { kind: "builtin" as const, name: "password-manager" }
      : { kind: "path" as const, canonicalPath: "/tmp/impostor" },
    exactResolution: {
      kind: builtin ? ("builtin" as const) : ("path" as const),
    },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
    rootDir: "/builtin/password-manager",
    version: "0.1.0",
    enabled: true,
  };
  upsertInstalledPlugin(db, input);
  const sourceHash = credentialSourceHash(getInstalledPlugin(db, input.id)!);
  const store = createPasswordManagerStore(db);
  const record = (
    overrides: Partial<ManagerCredential> = {},
  ): ManagerCredential => ({
    id: randomUUID(),
    version: 1,
    owner: input.id,
    sourceHash,
    origin: "http://example.com",
    accountId: randomUUID(),
    username: "alice",
    protection: "system-auth",
    createdAt: 1,
    updatedAt: 1,
    format: 2,
    vaultId: randomUUID(),
    seal: "sealed",
    nonce: "",
    ciphertext: "encrypted",
    tag: "",
    ...overrides,
  });
  return { db, input, sourceHash, store, record };
}
it("persists encrypted envelopes, paginates all sites and enforces update/delete versions", async () => {
  const f = fixture(),
    record = f.record();
  await f.store({ operation: "put", sourceHash: f.sourceHash, record });
  expect(
    await f.store({ operation: "list", sourceHash: f.sourceHash }),
  ).toEqual({ records: [record], after: null });
  expect(
    await f.store({
      operation: "list",
      sourceHash: f.sourceHash,
      origin: "https://other.com",
    }),
  ).toEqual({ records: [], after: null });
  await expect(
    f.store({
      operation: "put",
      sourceHash: f.sourceHash,
      previousVersion: 2,
      record: { ...record, version: 3 },
    }),
  ).rejects.toThrow();
  await expect(
    f.store({
      operation: "delete",
      sourceHash: f.sourceHash,
      id: record.id,
      version: 2,
    }),
  ).rejects.toThrow();
  await f.store({
    operation: "put",
    sourceHash: f.sourceHash,
    previousVersion: 1,
    record: { ...record, version: 2 },
  });
  await f.store({
    operation: "delete",
    sourceHash: f.sourceHash,
    id: record.id,
    version: 2,
  });
  expect(f.db.select().from(protectedCredentials).all()).toEqual([]);
});
it("refuses an impostor plugin and keeps ciphertext when the real plugin is disabled", async () => {
  const impostor = fixture(false);
  expect(await impostor.store({ operation: "status" })).toEqual({
    enabled: false,
  });
  await expect(
    impostor.store({ operation: "list", sourceHash: impostor.sourceHash }),
  ).rejects.toThrow();
  const f = fixture(),
    record = f.record();
  await f.store({ operation: "put", sourceHash: f.sourceHash, record });
  upsertInstalledPlugin(f.db, { ...f.input, enabled: false });
  expect(await f.store({ operation: "status" })).toEqual({ enabled: false });
  await expect(
    f.store({ operation: "list", sourceHash: f.sourceHash }),
  ).rejects.toThrow();
  expect(f.db.select().from(protectedCredentials).all()).toHaveLength(1);
});
it("rolls back the complete migration batch if one legacy version changed", async () => {
  const f = fixture();
  const originals = [
    f.record({ origin: "https://example.com" }),
    f.record({ origin: "https://other.com" }),
  ].map((record) => ({
    ...record,
    format: 1 as const,
    protection: "require-touch-id" as const,
  }));
  for (const record of originals)
    f.db
      .insert(protectedCredentials)
      .values({
        id: record.id,
        owner: record.owner,
        sourceHash: record.sourceHash,
        origin: record.origin,
        accountId: record.accountId,
        version: record.version,
        record,
      })
      .run();
  const migrated = originals.map((record, index) => ({
    ...record,
    format: 2 as const,
    protection: "system-auth" as const,
    version: index === 0 ? 2 : 3,
  }));
  await expect(
    f.store({
      operation: "migrate",
      sourceHash: f.sourceHash,
      records: migrated,
    }),
  ).rejects.toThrow();
  expect(
    f.db
      .select()
      .from(protectedCredentials)
      .all()
      .map((row) => row.version),
  ).toEqual([1, 1]);
});

it("atomically rejects concurrent initial saves for the same website and username", async () => {
  const f = fixture();
  const results = await Promise.allSettled(
    [f.record(), f.record()].map((record) =>
      f.store({ operation: "put", sourceHash: f.sourceHash, record }),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(f.db.select().from(protectedCredentials).all()).toHaveLength(1);
});
