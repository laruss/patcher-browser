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
import { createDesktopSiteAuthority } from "../src/desktop-site-authority.js";

const roots: string[] = [];
const managers: ReturnType<typeof createPasswordManager>[] = [];
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.reset());
  vi.restoreAllMocks();
  vi.useRealTimers();
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "password-manager-test-"));
  roots.push(root);
  const backend = {
    available: () => true,
    encrypt: (value: string) => Buffer.from(value),
    decrypt: (value: Buffer) => value.toString(),
  };
  const key = createCredentialKeyStore(join(root, "key.bin"), backend);
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
  const copy = vi.fn();
  const locked = vi.fn();
  const manager = createPasswordManager({
    store,
    key: () => key,
    authenticate,
    changed: vi.fn(),
    copy,
    locked,
  });
  managers.push(manager);
  const current = vi.fn(() => true);
  return {
    manager,
    backend,
    copy,
    locked,
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

describe("Password Manager five-minute session", () => {
  it.each(["copy", "reveal"] as const)(
    "rejects %s if decryption outlasts the approval interval",
    async (operation) => {
      vi.useFakeTimers();
      const f = fixture();
      await f.manager.request({ operation: "add", ...draft }, 1, f.current);
      const entry = [...f.records.values()][0]!;
      await f.manager.requestSession(
        { operation: "open", origin: draft.origin },
        1,
        f.current,
      );
      vi.spyOn(f.backend, "decrypt").mockImplementation((value) => {
        const decoded = value.toString();
        if (typeof JSON.parse(decoded).key === "string")
          vi.spyOn(performance, "now").mockReturnValue(300_001);
        return decoded;
      });
      const input =
        operation === "copy"
          ? { operation, id: entry.id, version: 1, field: "password" as const }
          : { operation, id: entry.id, version: 1 };
      expect(await f.manager.requestSession(input, 1, f.current)).toEqual({
        status: "cancelled",
      });
      expect(f.copy).not.toHaveBeenCalled();
    },
  );
  it("revokes on a disabled native policy even when every status refresh sees enabled", async () => {
    const f = fixture();
    await f.manager.request({ operation: "add", ...draft }, 1, f.current);
    const entry = [...f.records.values()][0]!;
    await f.manager.requestSession(
      { operation: "open", origin: draft.origin },
      1,
      f.current,
    );
    const refreshes: Promise<void>[] = [];
    const authority = createDesktopSiteAuthority({
      resolve: () => null,
      confirm: async () => false,
      changed: () => {
        if (
          authority.known("password-manager") &&
          !authority.enabled("password-manager")
        )
          f.manager.reset();
        refreshes.push(f.manager.refresh());
      },
    });
    const policy = {
      pluginId: "password-manager",
      name: "Password manager",
      revision: randomUUID(),
      enabled: false,
      sites: [],
      origins: [],
      permissions: [],
      scripts: [],
      styles: [],
    };
    await authority.request(
      "site.policy",
      policy,
      new AbortController().signal,
    );
    await authority.request(
      "site.policy",
      { ...policy, enabled: true, revision: randomUUID() },
      new AbortController().signal,
    );
    await Promise.all(refreshes);
    expect(f.locked).toHaveBeenCalled();
    f.authenticate.mockResolvedValue(false);
    expect(
      await f.manager.requestSession(
        { operation: "copy", id: entry.id, version: 1, field: "password" },
        1,
        f.current,
      ),
    ).toEqual({ status: "cancelled" });
    expect(f.copy).not.toHaveBeenCalled();
    expect(f.authenticate).toHaveBeenCalledTimes(2);
  });
  it("cannot reinstate a grant revoked immediately after authentication completes", async () => {
    const f = fixture();
    await f.manager.request({ operation: "add", ...draft }, 1, f.current);
    const entry = [...f.records.values()][0]!;
    let approve!: (value: boolean) => void, entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.authenticate.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve;
          entered();
        }),
    );
    const opening = f.manager.requestSession(
      { operation: "open", origin: draft.origin },
      1,
      f.current,
    );
    await waiting;
    approve(true);
    queueMicrotask(() => f.manager.reset());
    expect(await opening).toEqual({ status: "unavailable" });
    f.authenticate.mockResolvedValue(false);
    expect(
      await f.manager.requestSession(
        { operation: "copy", id: entry.id, version: 1, field: "password" },
        1,
        f.current,
      ),
    ).toEqual({ status: "cancelled" });
    expect(f.copy).not.toHaveBeenCalled();
    expect(f.authenticate).toHaveBeenCalledTimes(2);
  });
  it("does not copy after foreground focus is lost during the final status RPC", async () => {
    const f = fixture();
    await f.manager.request({ operation: "add", ...draft }, 1, f.current);
    const entry = [...f.records.values()][0]!;
    await f.manager.requestSession(
      { operation: "open", origin: draft.origin },
      1,
      f.current,
    );
    const original = f.store.getMockImplementation()!;
    let entered!: () => void,
      release!: () => void,
      statuses = 0;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.store.mockImplementation(async (input) => {
      const value = await original(input);
      if (input.operation === "status" && ++statuses === 4) {
        entered();
        await barrier;
      }
      return value;
    });
    const reply = f.manager.requestSession(
      { operation: "copy", id: entry.id, version: 1, field: "password" },
      1,
      f.current,
    );
    await waiting;
    f.current.mockReturnValue(false);
    release();
    expect(await reply).toEqual({ status: "unavailable" });
    expect(f.copy).not.toHaveBeenCalled();
  });
  it("authenticates on entry and reuses the grant across sites/windows for copy, reveal, edit and delete", async () => {
    const f = fixture();
    await f.manager.request({ operation: "add", ...draft }, 1, f.current);
    await f.manager.request(
      { operation: "add", ...draft, origin: "http://other.example" },
      1,
      f.current,
    );
    const [first, second] = [...f.records.values()];
    const openKey = vi.spyOn(f.key, "open");
    expect(
      await f.manager.requestSession(
        { operation: "open", origin: draft.origin },
        1,
        f.current,
      ),
    ).toEqual({ status: "done" });
    expect(openKey).not.toHaveBeenCalled();
    expect(
      await f.manager.requestSession(
        { operation: "open", origin: second!.origin },
        2,
        f.current,
      ),
    ).toEqual({ status: "done" });
    for (const field of ["username", "password"] as const) {
      expect(
        await f.manager.requestSession(
          { operation: "copy", id: second!.id, version: 1, field },
          2,
          f.current,
        ),
      ).toEqual({ status: "done" });
      expect(f.copy).toHaveBeenLastCalledWith(draft[field]);
    }
    expect(
      await f.manager.requestSession(
        { operation: "reveal", id: first!.id, version: 1 },
        1,
        f.current,
      ),
    ).toEqual({ status: "revealed", password: draft.password });
    const edit = await f.manager.requestSession(
      { operation: "edit", id: first!.id, version: 1 },
      1,
      f.current,
    );
    if (edit.status !== "editing") throw Error("Missing edit grant");
    expect(
      await f.manager.requestSession(
        {
          operation: "update",
          ...draft,
          password: "updated",
          editToken: edit.editToken,
        },
        1,
        f.current,
      ),
    ).toEqual({ status: "done" });
    expect(
      await f.manager.requestSession(
        { operation: "delete", id: first!.id, version: 2 },
        1,
        f.current,
      ),
    ).toEqual({ status: "done" });
    expect(f.authenticate).toHaveBeenCalledTimes(1);
  });

  it("expires at exactly five minutes without extending on use or wall-clock changes", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.manager.request({ operation: "add", ...draft }, 1, f.current);
    const entry = [...f.records.values()][0]!;
    await f.manager.requestSession(
      { operation: "open", origin: draft.origin },
      1,
      f.current,
    );
    await vi.advanceTimersByTimeAsync(299_999);
    vi.setSystemTime(new Date("2000-01-01"));
    expect(
      await f.manager.requestSession(
        { operation: "copy", id: entry.id, version: 1, field: "password" },
        1,
        f.current,
      ),
    ).toEqual({ status: "done" });
    expect(f.authenticate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.locked).toHaveBeenCalledTimes(1);
    f.authenticate.mockResolvedValue(false);
    expect(
      await f.manager.requestSession(
        { operation: "copy", id: entry.id, version: 1, field: "password" },
        1,
        f.current,
      ),
    ).toEqual({ status: "cancelled" });
    expect(f.copy).toHaveBeenCalledTimes(1);
    expect(f.authenticate).toHaveBeenCalledTimes(2);
  });

  it("never grants access after cancellation, navigation or a runtime/screen-lock reset", async () => {
    const f = fixture();
    await f.manager.request({ operation: "add", ...draft }, 1, f.current);
    const entry = [...f.records.values()][0]!;
    f.authenticate.mockResolvedValue(false);
    expect(
      await f.manager.requestSession(
        { operation: "open", origin: draft.origin },
        1,
        f.current,
      ),
    ).toEqual({ status: "cancelled" });
    expect(
      await f.manager.requestSession(
        { operation: "copy", id: entry.id, version: 1, field: "password" },
        1,
        f.current,
      ),
    ).toEqual({ status: "cancelled" });
    expect(f.copy).not.toHaveBeenCalled();
    f.authenticate.mockResolvedValue(true);
    await f.manager.requestSession(
      { operation: "open", origin: draft.origin },
      1,
      f.current,
    );
    f.manager.reset();
    f.authenticate.mockResolvedValue(false);
    expect(
      await f.manager.requestSession(
        { operation: "reveal", id: entry.id, version: 1 },
        1,
        f.current,
      ),
    ).toEqual({ status: "cancelled" });
    f.current.mockReturnValue(false);
    expect(
      await f.manager.requestSession(
        { operation: "copy", id: entry.id, version: 1, field: "password" },
        1,
        f.current,
      ),
    ).toEqual({ status: "unavailable" });
    expect(f.copy).not.toHaveBeenCalled();
  });

  it("discards an in-flight password when the grant expires during storage access", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.manager.request({ operation: "add", ...draft }, 1, f.current);
    const entry = [...f.records.values()][0]!;
    await f.manager.requestSession(
      { operation: "open", origin: draft.origin },
      1,
      f.current,
    );
    const original = f.store.getMockImplementation()!;
    let entered!: () => void,
      release!: () => void,
      lists = 0;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.store.mockImplementation(async (input) => {
      const result = await original(input);
      if (input.operation === "list" && ++lists === 2) {
        entered();
        await barrier;
      }
      return result;
    });
    const reply = f.manager.requestSession(
      { operation: "reveal", id: entry.id, version: 1 },
      1,
      f.current,
    );
    await waiting;
    await vi.advanceTimersByTimeAsync(300_000);
    release();
    expect(await reply).toEqual({ status: "cancelled" });
  });

  it("waits for macOS focus to return before granting native clipboard access", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.manager.request({ operation: "add", ...draft }, 1, f.current);
    f.authenticate.mockImplementationOnce(async () => {
      f.current.mockReturnValue(false);
      setTimeout(() => f.current.mockReturnValue(true), 150);
      return true;
    });
    const reply = f.manager.requestSession(
      { operation: "open", origin: draft.origin },
      1,
      f.current,
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(await reply).toEqual({ status: "done" });
    expect(f.authenticate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(299_799);
    expect(f.locked).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.locked).toHaveBeenCalledTimes(1);
  });
});
