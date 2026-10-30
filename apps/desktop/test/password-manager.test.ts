import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  StoredPassword,
  PasswordStoreRequest,
} from "@patcher/domain/password-manager";
import { createPasswordManager } from "../src/password-manager.js";
import { createCredentialKeyStore } from "../src/desktop-credential-key.js";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "password-manager-test-"));
  roots.push(root);
  const key = createCredentialKeyStore(join(root, "key.bin"), {
    available: () => true,
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  });
  let enabled = true;
  const records = new Map<string, StoredPassword>();
  const sourceHash = "a".repeat(64);
  const authenticate = vi.fn(
    async (_reason: string, _signal: AbortSignal) => true,
  );
  const store = vi.fn(
    async (request: PasswordStoreRequest): Promise<unknown> => {
      if (request.operation === "status")
        return enabled ? { enabled, sourceHash, vault: records.values().next().value } : { enabled };
      if (!enabled) throw new Error("disabled");
      if (request.operation === "list") {
        const entries = [...records.values()]
          .filter(
            (entry) =>
              (!request.origin || entry.origin === request.origin) &&
              (!request.after || entry.id > request.after),
          )
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, 8);
        return {
          records: entries,
          after: entries.length === 8 ? entries.at(-1)!.id : null,
        };
      }
      if (request.operation === "delete") {
        records.delete(request.id);
        return true;
      }
      if (request.operation === "put") {
        records.set(request.record.id, request.record);
        return true;
      }
      for (const record of request.records) records.set(record.id, record);
      return true;
    },
  );
  const manager = createPasswordManager({
    store,
    key: () => key,
    authenticate,
    changed: vi.fn(),
  });
  const current = vi.fn(() => true);
  return {
    manager,
    key,
    records,
    authenticate,
    current,
    sourceHash,
    store,
    root,
    disable() {
      enabled = false;
    },
  };
}
const draft = {
  origin: "https://example.com",
  username: "alice",
  password: "secret-test-Ω",
};
describe("Password Manager system-auth policy", () => {
  it("never creates a replacement key if records exist but the key and marker are missing", async () => {
    const f = fixture();
    await f.manager.request({ operation: 'add', ...draft }, 1, f.current);
    rmSync(join(f.root, 'key.bin')); rmSync(join(f.root, 'key.bin.initialized'));
    f.manager.reset();
    expect(await f.manager.request({ operation: 'add', ...draft, origin: 'https://other.example' }, 1, f.current)).toEqual({ status: 'unavailable' });
    expect(f.records.size).toBe(1);
    expect(existsSync(join(f.root, 'key.bin'))).toBe(false);
  });
  it("keeps plaintext out of metadata/storage and fills without OS authentication, including HTTP", async () => {
    const f = fixture();
    expect(
      await f.manager.request(
        { operation: "add", ...draft, origin: "http://example.com" },
        1,
        f.current,
      ),
    ).toEqual({ status: "done" });
    const list = await f.manager.request({ operation: "list" }, 1, f.current);
    expect(JSON.stringify(list)).not.toContain(draft.password);
    expect(JSON.stringify([...f.records.values()])).not.toContain(
      draft.password,
    );
    const [entry] = await f.manager.forSite("http://example.com");
    expect(await f.manager.password(entry!, f.current)).toBe(draft.password);
    expect(await f.manager.forSite("https://example.com")).toEqual([]);
    expect(f.authenticate).not.toHaveBeenCalled();
  });
  it("requires fresh OS approval for each reveal, edit and delete; cancellation changes nothing", async () => {
    const f = fixture();
    await f.manager.request({ operation: "add", ...draft }, 1, f.current);
    const entry = [...f.records.values()][0]!;
    f.authenticate.mockResolvedValue(false);
    for (const operation of ["reveal", "edit", "delete"] as const)
      expect(
        await f.manager.request(
          { operation, id: entry.id, version: 1 },
          1,
          f.current,
        ),
      ).toEqual({ status: "cancelled" });
    expect(f.records.get(entry.id)).toEqual(entry);
    f.authenticate.mockResolvedValue(true);
    expect(
      await f.manager.request(
        { operation: "reveal", id: entry.id, version: 1 },
        1,
        f.current,
      ),
    ).toEqual({ status: "revealed", password: draft.password });
    const edit = await f.manager.request(
      { operation: "edit", id: entry.id, version: 1 },
      1,
      f.current,
    );
    if (edit.status !== "editing") throw new Error("edit did not authenticate");
    expect(
      await f.manager.request(
        {
          operation: "update",
          ...draft,
          password: "changed",
          editToken: edit.editToken,
        },
        2,
        f.current,
      ),
    ).toEqual({ status: "cancelled" });
    expect(
      await f.manager.request(
        {
          operation: "update",
          ...draft,
          password: "changed",
          editToken: edit.editToken,
        },
        1,
        f.current,
      ),
    ).toEqual({ status: "done" });
    expect(
      await f.manager.request(
        { operation: "delete", id: entry.id, version: 2 },
        1,
        f.current,
      ),
    ).toEqual({ status: "done" });
    expect(f.authenticate).toHaveBeenCalledTimes(6);
    expect(f.records.size).toBe(0);
  });
  it("migrates all old records only after one OS confirmation, preserving passwords and identifiers", async () => {
    const f = fixture();
    for (const protection of [
      "require-touch-id",
      "confirm-each-time",
    ] as const) {
      const record = f.key.seal(
        {
          id: randomUUID(),
          version: 1,
          owner: "password-manager",
          sourceHash: f.sourceHash,
          origin: draft.origin,
          accountId: protection,
          username: protection,
          protection,
          createdAt: 123,
          updatedAt: 456,
        },
        protection,
      );
      f.records.set(record.id, record);
    }
    const original = [...f.records.values()];
    await expect(f.manager.forSite(draft.origin)).rejects.toThrow(
      "migration-required",
    );
    f.authenticate.mockResolvedValue(false);
    expect(
      await f.manager.request({ operation: "migrate" }, 1, f.current),
    ).toEqual({ status: "cancelled" });
    expect([...f.records.values()]).toEqual(original);
    f.authenticate.mockResolvedValue(true);
    f.authenticate.mockClear();
    expect(
      await f.manager.request({ operation: "migrate" }, 1, f.current),
    ).toEqual({ status: "done" });
    expect(f.authenticate).toHaveBeenCalledTimes(1);
    for (const record of f.records.values()) {
      expect(record).toMatchObject({
        format: 2,
        protection: "system-auth",
        version: 2,
        createdAt: 123,
        updatedAt: 456,
      });
      expect(
        original.some(
          (entry) =>
            entry.id === record.id && entry.accountId === record.accountId,
        ),
      ).toBe(true);
      expect(f.key.open(record, (password) => password)).toBe(record.accountId);
    }
  });
  it("refuses release if the page navigates or the plugin is disabled during OS authentication", async () => {
    const f = fixture();
    await f.manager.request({ operation: "add", ...draft }, 1, f.current);
    const entry = [...f.records.values()][0]!;
    f.authenticate.mockImplementationOnce(async () => {
      f.current.mockReturnValue(false);
      return true;
    });
    expect(
      await f.manager.request(
        { operation: "reveal", id: entry.id, version: 1 },
        1,
        f.current,
      ),
    ).toEqual({ status: "cancelled" });
    f.current.mockReturnValue(true);
    f.authenticate.mockImplementationOnce(async () => {
      f.disable();
      return true;
    });
    expect(
      await f.manager.request(
        { operation: "delete", id: entry.id, version: 1 },
        1,
        f.current,
      ),
    ).toEqual({ status: "disabled" });
    expect(f.records.size).toBe(1);
  });
  it("updates after a website login without OS approval, with version checks and explicit save only", async () => {
    const f = fixture();
    await f.manager.saveFromSite(draft.origin, draft.username, draft.password);
    const first = [...f.records.values()][0]!;
    await f.manager.saveFromSite(
      draft.origin,
      draft.username,
      "new-password",
      first,
    );
    expect(f.records.get(first.id)?.version).toBe(2);
    expect(f.authenticate).not.toHaveBeenCalled();
    await expect(
      f.manager.saveFromSite(draft.origin, draft.username, "stale", first),
    ).rejects.toThrow("conflict");
  });
});
