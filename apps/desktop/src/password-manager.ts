import { randomUUID } from "node:crypto";
import {
  passwordOrigin,
  passwordStoreStatusSchema,
  passwordStorePageSchema,
  type PasswordStoreRequest,
  type StoredPassword,
  type ManagerCredential,
} from "@patcher/domain/password-manager";
import {
  passwordManagerRequestSchema,
  passwordManagerSessionRequestSchema,
  type PasswordManagerRequest,
  type PasswordManagerSessionRequest,
  type PasswordManagerResponse,
  type PasswordEntry,
} from "@patcher/desktop-contract";
import type { CredentialKeyStore } from "./desktop-credential-key.js";

const UNLOCK_DURATION_MS = 5 * 60_000;

export function passwordMetadata(record: StoredPassword): PasswordEntry {
  const { id, version, origin, username, createdAt, updatedAt } = record;
  return { id, version, origin, username, createdAt, updatedAt };
}

export function createPasswordManager(args: {
  store(request: PasswordStoreRequest): Promise<unknown>;
  key(): CredentialKeyStore;
  authenticate(reason: string, signal: AbortSignal): Promise<boolean>;
  changed(enabled: boolean): void;
  copy?(value: string): void;
  locked?(): void;
}) {
  let epoch = 0,
    enabled = false;
  let active = false;
  let expectedVaultId: string | undefined;
  let authenticating = false,
    migrationOffered = false;
  let authenticatedAt = 0;
  const prompts = new Set<AbortController>();
  let unlockedUntil = 0;
  let unlockedSourceHash: string | undefined;
  let unlockTimer: ReturnType<typeof setTimeout> | undefined;
  const edits = new Map<
    string,
    {
      host: number;
      epoch: number;
      sourceHash: string;
      record: StoredPassword;
      expires: number;
    }
  >();
  async function status() {
    const generation = epoch;
    const value = passwordStoreStatusSchema.parse(
      await args.store({ operation: "status" }),
    );
    if (generation !== epoch) throw new Error("unavailable");
    if (unlockedSourceHash && unlockedSourceHash !== value.sourceHash) lock();
    if (value.vault) {
      args.key().verify(value.vault);
      if (expectedVaultId && expectedVaultId !== value.vault.vaultId) throw new Error("unavailable");
      expectedVaultId = value.vault.vaultId;
    }
    active = value.enabled;
    if (value.enabled !== enabled) {
      enabled = value.enabled;
      if (!enabled) reset();
      args.changed(enabled);
    }
    if (!value.enabled || !value.sourceHash) throw new Error("disabled");
    return value.sourceHash;
  }
  async function records(
    sourceHash: string,
    origin?: string,
  ): Promise<StoredPassword[]> {
    let after: string | undefined;
    const all: StoredPassword[] = [];
    do {
      const page = passwordStorePageSchema.parse(
        await args.store({
          operation: "list",
          sourceHash,
          ...(origin ? { origin } : {}),
          ...(after ? { after } : {}),
        }),
      );
      for (const record of page.records) {
        args.key().verify(record);
        all.push(record);
      }
      if (page.after && after && page.after <= after)
        throw new Error("unavailable");
      after = page.after ?? undefined;
    } while (after);
    return all;
  }
  async function snapshot(origin?: string) {
    const generation = epoch;
    const sourceHash = await status(),
      entries = await records(sourceHash, origin);
    if (generation !== epoch) throw new Error("unavailable");
    return { sourceHash, entries };
  }
  function reset() {
    lock();
    epoch++;
    active = false;
    expectedVaultId = undefined;
    migrationOffered = false;
    for (const prompt of prompts) prompt.abort();
    prompts.clear();
  }
  function lock() {
    unlockedUntil = 0;
    unlockedSourceHash = undefined;
    clearTimeout(unlockTimer);
    unlockTimer = undefined;
    edits.clear();
    args.locked?.();
  }
  function unlocked() {
    if (unlockedUntil > performance.now()) return true;
    if (unlockedUntil !== 0) lock();
    return false;
  }
  async function authorize(
    reason: string,
    current: () => boolean,
    waitForFocus = false,
  ) {
    if (authenticating || !current()) return false;
    authenticating = true;
    const controller = new AbortController(),
      generation = epoch;
    prompts.add(controller);
    try {
      const approved = await args.authenticate(reason, controller.signal);
      const completedAt = performance.now();
      // LocalAuthentication may finish before macOS returns focus to the
      // manager. Native copy must wait for that return before writing secrets.
      if (approved && waitForFocus) {
        const deadline = performance.now() + 1000;
        while (
          !current() &&
          !controller.signal.aborted &&
          generation === epoch &&
          performance.now() < deadline
        )
          await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const accepted =
        approved &&
        !controller.signal.aborted &&
        generation === epoch &&
        current();
      if (accepted) authenticatedAt = completedAt;
      return accepted;
    } finally {
      authenticating = false;
      prompts.delete(controller);
    }
  }
  async function authorizeManager(
    reason: string,
    current: () => boolean,
    useSession: boolean,
    sourceHash: string,
  ) {
    if (!useSession) return authorize(reason, current);
    if (unlocked() && unlockedSourceHash === sourceHash) return current();
    const generation = epoch;
    const approved = await authorize(reason, current, true);
    if (generation !== epoch) throw new Error("unavailable");
    if (!approved || !current()) return false;
    unlockedSourceHash = sourceHash;
    unlockedUntil = authenticatedAt + UNLOCK_DURATION_MS;
    unlockTimer = setTimeout(lock, unlockedUntil - performance.now());
    unlockTimer.unref();
    return true;
  }
  function site(value: string) {
    const origin = passwordOrigin(
      value.includes("://") ? value : `https://${value}`,
    );
    if (!origin) throw new Error("invalid");
    return origin;
  }
  function sealNew(
    sourceHash: string,
    origin: string,
    username: string,
    password: string,
    previous?: StoredPassword,
  ) {
    const now = Date.now();
    const sealed = args.key().sealManager(
      {
        id: previous?.id ?? randomUUID(),
        version: (previous?.version ?? 0) + 1,
        owner: "password-manager",
        sourceHash,
        origin,
        username,
        accountId: previous?.accountId ?? randomUUID(),
        protection: "system-auth",
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      },
      password,
      previous?.vaultId ?? expectedVaultId,
    );
    expectedVaultId ??= sealed.vaultId;
    return sealed;
  }
  async function request(
    input: PasswordManagerSessionRequest,
    host: number,
    current: () => boolean,
    useSession = false,
  ): Promise<PasswordManagerResponse> {
    if (!current()) return { status: "unavailable" };
    const parsed = (
      useSession ? passwordManagerSessionRequestSchema : passwordManagerRequestSchema
    ).safeParse(input);
    if (!parsed.success) return { status: "invalid" };
    const request = parsed.data,
      generation = epoch;
    if (request.operation === "cancel-edit") {
      if (edits.get(request.editToken)?.host === host)
        edits.delete(request.editToken);
      return { status: "done" };
    }
    try {
      const { sourceHash, entries } = await snapshot();
      const assert = async () => {
        if (generation !== epoch || !current()) throw new Error("unavailable");
        const latestSourceHash = await status();
        if (
          generation !== epoch ||
          !current() ||
          latestSourceHash !== sourceHash
        )
          throw new Error("unavailable");
      };
      await assert();
      const assertAccess = () => {
        if (generation !== epoch || !current()) throw new Error("unavailable");
        if (useSession && !unlocked()) throw new Error("cancelled");
      };
      if (request.operation === "list")
        return {
          status: "ready",
          entries: entries.map(passwordMetadata),
          migrationNeeded: entries.some((entry) => entry.format === 1),
        };
      if (request.operation === "open") {
        if (!entries.some((entry) => entry.origin === request.origin))
          return { status: "conflict" };
        if (!(await authorizeManager("Unlock Password Manager", current, true, sourceHash)))
          return { status: "cancelled" };
        await assert();
        assertAccess();
        return { status: "done" };
      }
      if (request.operation === "migrate") {
        const legacy = entries.filter((entry) => entry.format === 1);
        if (!legacy.length) return { status: "done" };
        if (
          !(await authorize(
            "Enable automatic filling for your saved passwords",
            current,
            useSession,
          ))
        )
          return { status: "cancelled" };
        await assert();
        for (let offset = 0; offset < legacy.length; offset += 8) {
          const batch = legacy.slice(offset, offset + 8).map((record) =>
            args.key().open(record, (password) =>
              args.key().sealManager(
                {
                  ...passwordMetadata(record),
                  accountId: record.accountId,
                  owner: record.owner,
                  sourceHash,
                  protection: "system-auth",
                  version: record.version + 1,
                },
                password,
                record.vaultId,
              ),
            ),
          );
          await assert();
          await args.store({
            operation: "migrate",
            sourceHash,
            records: batch,
          });
        }
      } else if (
        request.operation === "add" ||
        request.operation === "update"
      ) {
        const origin = site(request.origin);
        let previous: StoredPassword | undefined;
        if (request.operation === "update") {
          const edit = edits.get(request.editToken);
          if (
            !edit ||
            edit.host !== host ||
            edit.epoch !== epoch ||
            edit.sourceHash !== sourceHash
          )
            return { status: "cancelled" };
          if (
            (useSession || edit.expires < Date.now()) &&
            !(await authorizeManager("Save changes to your password", current, useSession, sourceHash))
          )
            return { status: "cancelled" };
          await assert();
          assertAccess();
          previous = entries.find(
            (entry) =>
              entry.id === edit.record.id &&
              entry.version === edit.record.version,
          );
          if (!previous) return { status: "conflict" };
        }
        if (
          entries.some(
            (entry) =>
              entry.origin === origin &&
              entry.username === request.username &&
              entry.id !== previous?.id,
          )
        )
          return { status: "duplicate" };
        if (request.operation === "update") edits.delete(request.editToken);
        const record = sealNew(
          sourceHash,
          origin,
          request.username,
          request.password,
          previous,
        );
        await assert();
        if (request.operation === "update") assertAccess();
        await args.store({
          operation: "put",
          sourceHash,
          record,
          ...(previous ? { previousVersion: previous.version } : {}),
        });
      } else {
        const record = entries.find(
          (entry) =>
            entry.id === request.id && entry.version === request.version,
        );
        if (!record) return { status: "conflict" };
        const reasons = {
          reveal: "Show your saved password",
          edit: "Edit your saved password",
          delete: "Delete your saved password",
          copy: "Copy your saved login",
        };
        if (!(await authorizeManager(
          reasons[request.operation], current, useSession, sourceHash,
        )))
          return { status: "cancelled" };
        await assert();
        const latest = (await records(sourceHash)).find(
          (entry) => entry.id === record.id && entry.version === record.version,
        );
        if (!latest) return { status: "conflict" };
        await assert();
        assertAccess();
        if (request.operation === "delete")
          await args.store({
            operation: "delete",
            sourceHash,
            id: record.id,
            version: record.version,
          });
        else {
          if (request.operation === "copy") {
            if (!args.copy) return { status: "unavailable" };
            if (request.field === "username") args.copy(record.username);
            else args.key().open(record, (password) => {
              assertAccess();
              args.copy!(password);
            });
            return { status: "done" };
          }
          return args.key().open(record, (password) => {
            assertAccess();
            if (request.operation === "reveal")
              return { status: "revealed", password };
            const editToken = randomUUID();
            // Only the authenticated, still-open manager window may save this edit.
            edits.set(editToken, {
              host,
              epoch,
              sourceHash,
              record,
              expires: Date.now() + 120_000,
            });
            return { status: "editing", password, editToken };
          });
        }
      }
      args.changed(enabled);
      return { status: "done" };
    } catch (error) {
      const code =
        (error as { code?: string }).code ?? (error as Error).message;
      return {
        status:
          code === "disabled"
            ? "disabled"
            : code === "cancelled"
              ? "cancelled"
            : code === "conflict"
              ? "conflict"
              : code === "invalid"
                ? "invalid"
                : "unavailable",
      };
    }
  }
  return {
    request: (input: PasswordManagerRequest, host: number, current: () => boolean) =>
      request(input, host, current),
    requestSession: (input: PasswordManagerSessionRequest, host: number, current: () => boolean) =>
      request(input, host, current, true),
    reset,
    enabled: () => enabled && active,
    async prepareSite(origin: string, host: number, current: () => boolean) {
      const { entries } = await snapshot(origin);
      if (
        !migrationOffered &&
        entries.some((entry) => entry.format === 1 && entry.origin === origin)
      ) {
        migrationOffered = true;
        await request({ operation: "migrate" }, host, current);
      }
    },
    async refresh() {
      const generation = epoch;
      try {
        await status();
      } catch {
        if (generation === epoch && enabled) {
          enabled = false;
          reset();
          args.changed(false);
        }
      }
    },
    async forSite(origin: string) {
      const { entries } = await snapshot(origin);
      if (
        entries.some((entry) => entry.format === 1 && entry.origin === origin)
      )
        throw new Error("migration-required");
      // Old policies are never decrypted by automation before consent.
      return entries.filter(
        (entry): entry is ManagerCredential =>
          entry.format === 2 && entry.origin === origin,
      );
    },
    async password(record: ManagerCredential, current: () => boolean) {
      const generation = epoch;
      const { entries } = await snapshot(record.origin);
      if (
        generation !== epoch ||
        !current() ||
        !entries.some(
          (entry) => entry.id === record.id && entry.version === record.version,
        )
      )
        throw new Error("unavailable");
      return args.key().open(record, (password) => password);
    },
    async saveFromSite(
      origin: string,
      username: string,
      password: string,
      expected?: { id: string; version: number },
      current: () => boolean = () => true,
    ) {
      const generation = epoch;
      const { sourceHash, entries } = await snapshot(origin);
      if (generation !== epoch || !current()) throw new Error("unavailable");
      const previous = entries.find(
        (entry) => entry.origin === origin && entry.username === username,
      );
      if (
        previous?.format === 1 ||
        (expected
          ? previous?.id !== expected.id ||
            previous.version !== expected.version
          : previous !== undefined)
      )
        throw new Error("conflict");
      const record = sealNew(
        sourceHash,
        site(origin),
        username,
        password,
        previous,
      );
      if (generation !== epoch || !current()) throw new Error("unavailable");
      await args.store({
        operation: "put",
        sourceHash,
        record,
        ...(previous ? { previousVersion: previous.version } : {}),
      });
      args.changed(enabled);
    },
  };
}
export type PasswordManager = ReturnType<typeof createPasswordManager>;
