import { createHash, randomUUID } from "node:crypto";
import {
  getInstalledPlugin,
  firstProtectedCredential,
  listProtectedCredentials,
  findProtectedCredential,
  insertProtectedCredential,
  replaceProtectedCredential,
  deleteProtectedCredential,
  type DbConnection,
  type InstalledPluginRow,
} from "@patcher/db";
import {
  credentialListArgsSchema,
  credentialRequestArgsSchema,
  credentialMetadataSchema,
  sealedCredentialSchema,
  credentialPrivateResultSchema,
  type SealedCredential,
} from "@patcher/domain/protected-credentials";
import { currentBrowserCommandIssuer } from "../browser/browser-command-issuer.js";
import { currentExternalBrowserCaller } from "../browser/browser-external-access.js";
import { credentialAgentCaller } from "../browser/credential-agent-scope.js";
import type { PluginSiteAccess } from "./plugin-site-access.js";
import type { RequestCredentials } from "./plugin-api-credentials.js";

export function credentialSourceHash(row: InstalledPluginRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: row.sourceKind,
        path: row.sourcePath,
        builtin: row.sourceBuiltinName,
        npm: row.sourceNpmPackage,
        registry: row.sourceNpmRegistry,
        git: row.sourceGitUrl,
        subdirectory: row.sourceGitSubdirectory,
      }),
    )
    .digest("hex");
}
export function credentialMetadata(record: SealedCredential) {
  const {
    id,
    version,
    origin,
    accountId,
    username,
    protection,
    createdAt,
    updatedAt,
  } = record;
  return credentialMetadataSchema.parse({
    id,
    version,
    origin,
    accountId,
    username,
    protection,
    createdAt,
    updatedAt,
  });
}
export function createProtectedCredentials(args: {
  db: DbConnection;
  sites: PluginSiteAccess;
  request?: (
    method: "credential.context" | "credential.operation",
    payload: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}) {
  const busy = new Set<string>();
  function owner(id: string) {
    if (
      credentialAgentCaller() ||
      currentBrowserCommandIssuer() ||
      currentExternalBrowserCaller()
    )
      throw new Error(
        "Protected credentials refuse agent and external callers",
      );
    const row = getInstalledPlugin(args.db, id);
    if (!row?.enabled) throw new Error("Protected credentials unavailable");
    return credentialSourceHash(row);
  }
  const call =
    (id: string): RequestCredentials =>
    async (method, input, inputSignal) => {
      // Parsing errors never echo request fields into plugin/tool errors.
      const parsed = (
        method === "list"
          ? credentialListArgsSchema
          : credentialRequestArgsSchema
      ).safeParse(input);
      if (!parsed.success) throw new Error("Invalid credential request");
      const sourceHash = owner(id);
      if (!args.request) {
        if (method === "list")
          throw new Error("Protected credentials unavailable");
        return { status: "unavailable" };
      }
      const lease = await args.sites.credentialLease(
        id,
        parsed.data.tabId,
        inputSignal,
      );
      let lock: string | undefined;
      try {
        const rows = () =>
          listProtectedCredentials(args.db, id, sourceHash, lease.origin);
        if (method === "list") {
          await args.request(
            "credential.context",
            { token: lease.token, owner: id },
            lease.signal,
          );
          await lease.check();
          if (owner(id) !== sourceHash)
            throw new Error("Protected credentials unavailable");
          return rows().map((row) =>
            credentialMetadata(sealedCredentialSchema.parse(row.record)),
          );
        }
        const request = credentialRequestArgsSchema.parse(parsed.data);
        let record: SealedCredential | undefined;
        if (request.operation !== "save") {
          const row = findProtectedCredential(args.db, request.reference.id);
          if (
            !row ||
            row.owner !== id ||
            row.sourceHash !== sourceHash ||
            row.origin !== lease.origin ||
            row.version !== request.reference.version
          )
            return { status: "denied" };
          record = sealedCredentialSchema.parse(row.record);
          if (
            record.id !== row.id ||
            record.version !== row.version ||
            record.owner !== id ||
            record.sourceHash !== sourceHash ||
            record.origin !== lease.origin ||
            record.accountId !== row.accountId
          )
            return { status: "denied" };
        }
        lock = JSON.stringify([
          id,
          sourceHash,
          lease.origin,
          record?.accountId ??
            (request.operation === "save" ? request.accountId : ""),
        ]);
        if (busy.has(lock)) {
          lock = undefined;
          return { status: "busy" };
        }
        busy.add(lock);
        if (
          request.operation === "save" &&
          rows().some((row) => row.accountId === request.accountId)
        )
          return { status: "denied" };
        const existing = firstProtectedCredential(args.db);
        const expectedVaultId = existing
          ? sealedCredentialSchema.parse(existing.record).vaultId
          : undefined;
        const draft = record
          ? undefined
          : { id: randomUUID(), createdAt: Date.now() };
        const response = credentialPrivateResultSchema.parse(
          await args.request(
            "credential.operation",
            {
              token: lease.token,
              owner: id,
              sourceHash,
              request,
              ...(expectedVaultId ? { expectedVaultId } : {}),
              ...(record ? { record } : { draft }),
            },
            lease.signal,
          ),
        );
        await lease.check();
        if (lease.signal.aborted || owner(id) !== sourceHash)
          return { status: "denied" };
        if (
          response.result.status === "saved" ||
          response.result.status === "updated"
        ) {
          const next = response.record;
          if (
            !next ||
            next.owner !== id ||
            next.sourceHash !== sourceHash ||
            next.origin !== lease.origin ||
            (record &&
              (next.id !== record.id ||
                next.accountId !== record.accountId ||
                next.version !== record.version + 1 ||
                next.protection !== record.protection)) ||
            (!record &&
              (request.operation !== "save" ||
                next.accountId !== request.accountId ||
                next.version !== 1 ||
                next.id !== draft?.id))
          )
            return { status: "denied" };
          const row = {
            id: next.id,
            owner: id,
            sourceHash,
            origin: next.origin,
            accountId: next.accountId,
            version: next.version,
            record: next,
          };
          if (record) {
            if (!replaceProtectedCredential(args.db, row, record.version))
              return { status: "denied" };
          } else insertProtectedCredential(args.db, row);
          return {
            status: response.result.status,
            credential: credentialMetadata(next),
          };
        }
        if (
          response.result.status === "deleted" &&
          record &&
          !deleteProtectedCredential(args.db, record.id, record.version)
        )
          return { status: "denied" };
        return response.result;
      } catch {
        if (method === "list")
          throw new Error("Protected credentials unavailable");
        return { status: inputSignal?.aborted ? "cancelled" : "denied" };
      } finally {
        if (lock) busy.delete(lock);
        lease.close();
      }
    };
  return { call };
}
export type ProtectedCredentials = ReturnType<
  typeof createProtectedCredentials
>;
