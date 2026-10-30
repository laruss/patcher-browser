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
  type PasswordManagerRequest,
  type PasswordManagerResponse,
  type PasswordEntry,
} from "@patcher/desktop-contract";
import type { CredentialKeyStore } from "./desktop-credential-key.js";

export function passwordMetadata(record: StoredPassword): PasswordEntry {
  const { id, version, origin, username, createdAt, updatedAt } = record;
  return { id, version, origin, username, createdAt, updatedAt };
}

export function createPasswordManager(args: {
  store(request: PasswordStoreRequest): Promise<unknown>;
  key(): CredentialKeyStore;
  authenticate(reason: string, signal: AbortSignal): Promise<boolean>;
  changed(enabled: boolean): void;
}) {
  let epoch = 0,
    enabled = false;
  let active = false;
  let expectedVaultId: string | undefined;
  let authenticating = false,
    migrationOffered = false;
  const prompts = new Set<AbortController>();
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
    epoch++;
    active = false;
    expectedVaultId = undefined;
    migrationOffered = false;
    for (const prompt of prompts) prompt.abort();
    prompts.clear();
    edits.clear();
  }
  async function authorize(reason: string, current: () => boolean) {
    if (authenticating || !current()) return false;
    authenticating = true;
    const controller = new AbortController(),
      generation = epoch;
    prompts.add(controller);
    try {
      return (
        (await args.authenticate(reason, controller.signal)) &&
        !controller.signal.aborted &&
        generation === epoch &&
        current()
      );
    } finally {
      authenticating = false;
      prompts.delete(controller);
    }
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
    input: PasswordManagerRequest,
    host: number,
    current: () => boolean,
  ): Promise<PasswordManagerResponse> {
    if (!current()) return { status: "unavailable" };
    const parsed = passwordManagerRequestSchema.safeParse(input);
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
        if (
          generation !== epoch ||
          !current() ||
          (await status()) !== sourceHash
        )
          throw new Error("unavailable");
      };
      await assert();
      if (request.operation === "list")
        return {
          status: "ready",
          entries: entries.map(passwordMetadata),
          migrationNeeded: entries.some((entry) => entry.format === 1),
        };
      if (request.operation === "migrate") {
        const legacy = entries.filter((entry) => entry.format === 1);
        if (!legacy.length) return { status: "done" };
        if (
          !(await authorize(
            "Enable automatic filling for your saved passwords",
            current,
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
            edit.expires < Date.now() &&
            !(await authorize("Save changes to your password", current))
          )
            return { status: "cancelled" };
          await assert();
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
        };
        if (!(await authorize(reasons[request.operation], current)))
          return { status: "cancelled" };
        await assert();
        const latest = (await records(sourceHash)).find(
          (entry) => entry.id === record.id && entry.version === record.version,
        );
        if (!latest) return { status: "conflict" };
        if (request.operation === "delete")
          await args.store({
            operation: "delete",
            sourceHash,
            id: record.id,
            version: record.version,
          });
        else {
          await assert();
          return args.key().open(record, (password) => {
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
            : code === "conflict"
              ? "conflict"
              : code === "invalid"
                ? "invalid"
                : "unavailable",
      };
    }
  }
  return {
    request,
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
