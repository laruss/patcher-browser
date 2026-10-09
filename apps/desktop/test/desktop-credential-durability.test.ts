import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ sync: vi.fn(), write: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  calls.sync.mockImplementation(fs.fsyncSync);
  calls.write.mockImplementation(fs.writeFileSync);
  return { ...fs, fsyncSync: calls.sync, writeFileSync: calls.write };
});
import { createCredentialKeyStore } from "../src/desktop-credential-key.js";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
it("flushes the key and identity files/directories before returning ciphertext, and fails closed on a failed sync", () => {
  const root = mkdtempSync(join(tmpdir(), "credential-durable-test-"));
  roots.push(root);
  const store = createCredentialKeyStore(join(root, "vault", "key.bin"), {
    available: () => true,
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  });
  const metadata = {
    id: randomUUID(),
    owner: "plugin",
    sourceHash: "a".repeat(64),
    origin: "https://example.com",
    accountId: "one",
    username: "alice",
    version: 1,
    protection: "confirm-each-time" as const,
    createdAt: 1,
    updatedAt: 1,
  };
  calls.sync.mockImplementationOnce(() => {
    throw Error("Filesystem sync failed");
  });
  expect(() => store.seal(metadata, "sentinel")).toThrow();
  expect(calls.write).not.toHaveBeenCalled(); // no result may escape before its parent is durable
  const record = store.seal(metadata, "sentinel");
  expect(calls.write).toHaveBeenCalledTimes(2);
  for (const [, , options] of calls.write.mock.calls)
    expect(options).toMatchObject({ flag: "wx", mode: 0o600, flush: true });
  expect(calls.sync.mock.calls.length).toBeGreaterThanOrEqual(5);
  expect(store.open(record, (password) => password)).toBe("sentinel");
  const writes = calls.write.mock.calls.length;
  calls.sync.mockImplementationOnce(() => {
    throw Error("Filesystem sync failed");
  });
  expect(() => store.seal(metadata, "replacement", record.vaultId)).toThrow();
  expect(calls.write).toHaveBeenCalledTimes(writes);
});
