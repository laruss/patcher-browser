import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCredentialVault } from "../src/desktop-credential-vault.js";
import { createCredentialKeyStore } from "../src/desktop-credential-key.js";
import {
  createDesktopSiteAuthority,
  type SiteTarget,
} from "../src/desktop-site-authority.js";
import type {
  CredentialProtection,
  SealedCredential,
} from "@patcher/domain/protected-credentials";

const roots: string[] = [];
afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.useRealTimers();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "credential-vault-test-"));
  roots.push(root);
  const backend = {
    available: vi.fn(() => true),
    encrypt: vi.fn((value: string) => Buffer.from(`os:${value}`)),
    decrypt: vi.fn((value: Buffer) => {
      const raw = value.toString();
      if (!raw.startsWith("os:")) throw Error("Corrupt");
      return raw.slice(3);
    }),
  };
  const keys = createCredentialKeyStore(join(root, "key.bin"), backend);
  const context = {
    tabId: "tab",
    url: "https://example.com/login",
    origin: "https://example.com",
    documentId: randomUUID(),
  };
  const captured = { username: "alice", password: "SENTINEL-password-Ω-123" };
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const release = vi.fn(async () => {}),
    fill = vi.fn(),
    capture = vi.fn(() => ({ ...captured }));
  const interactive = vi.fn(() => true);
  const target: SiteTarget = {
    context: { ...context },
    current: () => context,
    hostWebContentsId: 12,
    credentials: {
      webContentsId: 13,
      rememberPassword: vi.fn(),
      interactive,
      async execute(code) {
        calls.push({ method: "isolated", params: { code } });
        if (code.includes("?.delete")) {
          await release();
          return true;
        }
        const prepare = code.match(/take\("([^"]+)", "prepare"\)/);
        if (prepare) {
          if (!vault.take(prepare[1]!, "prepare", 13, context.url))
            throw Error("Preparation refused");
          return { username: captured.username, x: 20, y: 20 };
        }
        const action = code.match(/\.(capture|fill)\("([^"]+)"\)/);
        if (!action) throw Error("Unexpected isolated code");
        const value = vault.take(
          action[2]!,
          action[1] as "capture" | "fill",
          13,
          context.url,
        );
        if (!value) throw Error("Release refused");
        if (action[1] === "capture") return capture();
        fill(value);
        return true;
      },
      async send(method, params) {
        calls.push({ method, params });
        if (method === "DOM.getNodeForLocation") return { backendNodeId: 101 };
        throw Error("Unexpected CDP");
      },
    },
  };
  const sites = createDesktopSiteAuthority({
    resolve: () => target,
    confirm: async () => true,
    changed: () => {},
  });
  const policy = {
    pluginId: "plugin",
    name: "Plugin",
    revision: randomUUID(),
    enabled: true,
    permissions: ["credentials.manage"] as const,
    sites: ["https://example.com/*"],
    origins: [context.origin],
    scripts: [],
    styles: [],
  };
  const signal = new AbortController();
  const confirm = vi.fn(
    async (): Promise<CredentialProtection | null> => "confirm-each-time",
  );
  const touchId = vi.fn(async () => {}),
    touchIdAvailable = vi.fn(() => true),
    ready = vi.fn(() => true);
  const vault = createCredentialVault({
    sites,
    keys,
    available: backend.available,
    ready,
    confirm,
    touchId,
    touchIdAvailable,
    changed: () => {},
  });
  const sourceHash = "a".repeat(64);
  async function proposal(
    operation = "save",
    record?: SealedCredential,
    wait = true,
  ) {
    await sites.request("site.policy", policy, signal.signal);
    const lease = (await sites.request(
      "site.context",
      {
        owners: [{ pluginId: "plugin", revision: policy.revision }],
        tabId: "tab",
      },
      signal.signal,
    )) as { token: string };
    const input = {
      token: lease.token,
      owner: "plugin",
      sourceHash,
      request:
        operation === "save"
          ? { operation, tabId: "tab", accountId: "primary" }
          : {
              operation,
              tabId: "tab",
              reference: { id: record!.id, version: record!.version },
            },
      ...(record
        ? { record }
        : { draft: { id: randomUUID(), createdAt: Date.now() } }),
    };
    const completion = vault.request(
      "credential.operation",
      input,
      signal.signal,
    ) as Promise<{ result: { status: string }; record?: SealedCredential }>;
    if (wait) await vi.waitFor(() => expect(vault.list(12)).toHaveLength(1));
    return { completion, id: wait ? vault.list(12)[0]!.id : "", input };
  }
  function stored(protection: CredentialProtection = "confirm-each-time") {
    return keys.seal(
      {
        id: randomUUID(),
        version: 1,
        owner: "plugin",
        sourceHash,
        origin: context.origin,
        accountId: "primary",
        username: captured.username,
        protection,
        createdAt: 1,
        updatedAt: 1,
      },
      captured.password,
    );
  }
  return {
    target,
    root,
    backend,
    keys,
    context,
    captured,
    calls,
    capture,
    fill,
    release,
    interactive,
    sites,
    policy,
    signal,
    confirm,
    touchId,
    touchIdAvailable,
    ready,
    vault,
    proposal,
    stored,
  };
}

describe("protected credential presence boundary", () => {
  it("cancels stalled preparation and cleanup, rejects its late token, and frees the proposal slot", async () => {
    const f = fixture(),
      execute = f.target.credentials!.execute;
    const queued: string[] = [];
    f.target.credentials!.execute = vi.fn((code) => {
      queued.push(code);
      return new Promise(() => {});
    });
    const p = await f.proposal("save", undefined, false);
    await vi.waitFor(() => expect(queued).toHaveLength(1));
    f.vault.cancelHost(12);
    expect((await p.completion).result.status).toBe("cancelled");
    const token = queued[0]!.match(/take\("([^"]+)", "prepare"\)/)![1]!;
    expect(f.vault.take(token, "prepare", 13, f.context.url)).toBeNull();
    f.target.credentials!.execute = execute;
    const next = await f.proposal();
    f.vault.dismiss(next.id, 12);
    await next.completion;
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it("keeps queued fill free of plaintext and refuses its token after cancellation", async () => {
    const f = fixture(),
      p = await f.proposal("fill", f.stored());
    const execute = f.target.credentials!.execute;
    let resume!: () => Promise<unknown>,
      code = "";
    f.target.credentials!.execute = vi.fn((script) => {
      if (!script.includes(".fill(")) return execute(script);
      code = script;
      return new Promise((resolve, reject) => {
        resume = () => execute(script).then(resolve, reject);
      });
    });
    const review = f.vault.review(p.id, 12);
    await vi.waitFor(() => expect(code).toContain(".fill("));
    const decrypts = f.backend.decrypt.mock.calls.length;
    expect(code).not.toContain(f.captured.password);
    f.signal.abort();
    expect((await review).status).toBe("cancelled");
    expect((await p.completion).result.status).toBe("cancelled");
    await resume();
    expect(f.backend.decrypt).toHaveBeenCalledTimes(decrypts);
    expect(f.fill).not.toHaveBeenCalled();
  });
  it("queues without capture/decrypt/prompt, then saves ciphertext and metadata only", async () => {
    const f = fixture(),
      p = await f.proposal();
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.backend.decrypt).not.toHaveBeenCalled();
    const ui = await f.vault.review(p.id, 12),
      response = await p.completion;
    expect(ui.status).toBe("saved");
    expect(response.record).toBeDefined();
    expect(f.capture).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([ui, response, f.vault.list(12)])).not.toContain(
      f.captured.password,
    );
    expect(f.touchId).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.keys.open(response.record!, (value) => value)).toBe(
      f.captured.password,
    );
  });
  it("requires a fresh review after restart and sends fill only through the private form helper", async () => {
    const f = fixture(),
      record = f.stored();
    const restarted = createCredentialKeyStore(
      join(f.root, "key.bin"),
      f.backend,
    );
    expect(restarted.open(record, (value) => value)).toBe(f.captured.password);
    const p = await f.proposal("fill", record);
    expect(f.fill).not.toHaveBeenCalled();
    expect(await f.vault.review(p.id, 99)).toEqual({ status: "denied" });
    expect((await f.vault.review(p.id, 12)).status).toBe("filled");
    expect(await p.completion).toEqual({ result: { status: "filled" } });
    expect(f.fill).toHaveBeenCalledTimes(1);
    expect(await f.vault.review(p.id, 12)).toEqual({ status: "denied" });
  });
  it.each(["save", "update", "fill", "delete"])(
    "native cancel refuses %s without reading or filling",
    async (operation) => {
      const f = fixture(),
        p = await f.proposal(
          operation,
          operation === "save" ? undefined : f.stored("require-touch-id"),
        );
      f.confirm.mockResolvedValue(null);
      expect((await f.vault.review(p.id, 12)).status).toBe("cancelled");
      await p.completion;
      expect(f.capture).not.toHaveBeenCalled();
      expect(f.fill).not.toHaveBeenCalled();
      expect(f.touchId).not.toHaveBeenCalled();
    },
  );
  it.each(["unavailable", "error"])(
    "Require Touch ID fails closed on %s",
    async (mode) => {
      const f = fixture(),
        p = await f.proposal("fill", f.stored("require-touch-id"));
      f.confirm.mockResolvedValue("require-touch-id");
      if (mode === "unavailable") f.touchIdAvailable.mockReturnValue(false);
      else f.touchId.mockRejectedValue(Error("Native failure"));
      expect(["cancelled", "denied"]).toContain(
        (await f.vault.review(p.id, 12)).status,
      );
      await p.completion;
      expect(f.fill).not.toHaveBeenCalled();
      expect(
        f.backend.decrypt.mock.calls.filter(([buffer]) =>
          buffer.toString().includes('"key"'),
        ),
      ).toHaveLength(1); // stored() only
    },
  );
  it("ignores late Touch ID success and keeps its slot busy until native settlement", async () => {
    const f = fixture(),
      p = await f.proposal("fill", f.stored("require-touch-id"));
    f.confirm.mockResolvedValue("require-touch-id");
    let resolve!: () => void;
    f.touchId.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const review = f.vault.review(p.id, 12);
    await vi.waitFor(() => expect(f.touchId).toHaveBeenCalled());
    f.signal.abort();
    expect((await review).status).toBe("cancelled");
    await p.completion;
    const other = fixture(),
      next = await other.proposal();
    expect(await other.vault.review(next.id, 12)).toEqual({ status: "denied" });
    resolve();
    await new Promise((done) => setImmediate(done));
    expect(f.fill).not.toHaveBeenCalled();
    expect((await other.vault.review(next.id, 12)).status).toBe("saved");
    await next.completion;
  });
  it.each(["navigate", "reload", "hidden", "locked", "revoke", "disconnect"])(
    "refuses a pending request after %s",
    async (mode) => {
      const f = fixture(),
        p = await f.proposal();
      if (mode === "navigate") f.context.url = "https://other.example/login";
      if (mode === "reload") f.context.documentId = randomUUID();
      if (mode === "hidden") {
        f.interactive.mockReturnValue(false);
        f.vault.cancelView(13);
      }
      if (mode === "locked") f.vault.availability(false);
      if (mode === "revoke")
        await f.sites.request(
          "site.policy",
          { ...f.policy, revision: randomUUID(), origins: [] },
          f.signal.signal,
        );
      if (mode === "disconnect") f.vault.close();
      expect(["denied", "cancelled"]).toContain(
        (await f.vault.review(p.id, 12)).status,
      );
      await p.completion;
      expect(f.capture).not.toHaveBeenCalled();
    },
  );
  it("does not downgrade a sealed protection policy", async () => {
    const f = fixture(),
      p = await f.proposal("fill", f.stored("require-touch-id"));
    f.confirm.mockResolvedValue("confirm-each-time");
    expect((await f.vault.review(p.id, 12)).status).toBe("cancelled");
    await p.completion;
    expect(f.fill).not.toHaveBeenCalled();
  });
  it("dismisses once, rejects another sender, and times out without a prompt", async () => {
    const f = fixture(),
      p = await f.proposal();
    expect(f.vault.dismiss(p.id, 99)).toBe(false);
    expect(f.vault.dismiss(p.id, 12)).toBe(true);
    expect((await p.completion).result.status).toBe("cancelled");
    expect(f.vault.dismiss(p.id, 12)).toBe(false);
    vi.useFakeTimers();
    const other = fixture(),
      next = await other.proposal();
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await next.completion).result.status).toBe("cancelled");
    expect(other.confirm).not.toHaveBeenCalled();
  });
  it.each([
    "owner",
    "sourceHash",
    "origin",
    "accountId",
    "version",
    "protection",
    "username",
    "id",
    "vaultId",
  ])("rejects metadata tampering: %s", (field) => {
    const f = fixture(),
      record = f.stored("require-touch-id");
    const altered = {
      ...record,
      [field]:
        field === "version"
          ? 2
          : field === "protection"
            ? "confirm-each-time"
            : "changed",
    } as SealedCredential;
    expect(() => f.keys.verify(altered)).toThrow();
    expect(() => f.keys.open(altered, (value) => value)).toThrow();
  });
  it("rejects ciphertext tampering and a missing/corrupt key without replacing it", () => {
    const f = fixture(),
      record = f.stored();
    expect(() =>
      f.keys.open({ ...record, ciphertext: "AAAA" }, (value) => value),
    ).toThrow();
    rmSync(join(f.root, "key.bin"));
    expect(() => f.keys.open(record, (value) => value)).toThrow();
  });
});

it("does not silently recreate an initialized key for a later Save, including copied ciphertext", () => {
  const f = fixture(),
    record = f.stored();
  const { vaultId, format, seal, nonce, ciphertext, tag, ...metadata } = record;
  rmSync(join(f.root, "key.bin"));
  expect(() => f.keys.seal(metadata, "another-password")).toThrow();
  rmSync(join(f.root, "key.bin.initialized"));
  expect(() => f.keys.seal(metadata, "another-password", vaultId)).toThrow();
});
