import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CREDENTIAL_REQUEST_TIMEOUT_MS,
  credentialPrivateRequestSchema,
  credentialMetadataSchema,
  type CredentialPending,
  type CredentialProtection,
  type CredentialResult,
  type SealedCredential,
} from "@patcher/domain/protected-credentials";
import type { DesktopSiteAuthority } from "./desktop-site-authority.js";
import type { CredentialKeyStore } from "./desktop-credential-key.js";
import { prepareCredentialForm } from "./desktop-credential-form.js";

type Lease = ReturnType<DesktopSiteAuthority["consumeCredentialContext"]>;
type Form = Awaited<ReturnType<typeof prepareCredentialForm>>;
type Response = { result: CredentialResult; record?: SealedCredential };
interface Pending {
  metadata: CredentialPending;
  lease: Lease;
  form?: Form;
  host: number;
  assert(): void;
  signal: AbortSignal;
  controller: AbortController;
  finish(value: Response): void;
  input: z.infer<typeof credentialPrivateRequestSchema>;
}
// Survives server/vault replacement. An unabortable native prompt owns this
// slot until the actual native promise settles, even after logical cancellation.
let authenticating = false;
export function createCredentialVault(args: {
  sites: DesktopSiteAuthority;
  keys: CredentialKeyStore;
  available(): boolean;
  ready(host: number): boolean;
  confirm(
    request: CredentialPending,
    host: number,
    signal: AbortSignal,
  ): Promise<CredentialProtection | null>;
  touchIdAvailable(): boolean;
  touchId(reason: string): Promise<void>;
  changed(): void;
}) {
  const pending = new Map<string, Pending>();
  const releases = new Map<
    string,
    { one: Pending; operation: "prepare" | "capture" | "fill" }
  >();
  const lastProposal = new Map<number, number>();
  let enabled = true;
  const check = (lease: Lease) => {
    lease.assert();
    if (
      !enabled ||
      !args.available() ||
      !lease.target.credentials?.interactive() ||
      !args.ready(lease.target.hostWebContentsId)
    )
      throw new Error("Unavailable");
  };
  function cancel(filter: (one: Pending) => boolean) {
    for (const one of [...pending.values()])
      if (filter(one)) one.controller.abort();
  }
  async function request(
    method: string,
    payload: unknown,
    inputSignal: AbortSignal,
  ): Promise<unknown> {
    if (method === "credential.context") {
      const input = z
        .object({ token: z.uuid(), owner: z.string().min(1).max(128) })
        .strict()
        .parse(payload);
      const lease = args.sites.consumeCredentialContext(
        input.token,
        input.owner,
      );
      // Metadata listing needs a selected live page, but no UI prompt readiness.
      lease.assert();
      if (
        !enabled ||
        !args.available() ||
        !lease.target.credentials?.interactive() ||
        inputSignal.aborted
      )
        throw new Error("Unavailable");
      return { origin: lease.target.context.origin };
    }
    if (method !== "credential.operation") throw new Error("Invalid request");
    const parsed = credentialPrivateRequestSchema.safeParse(payload);
    if (!parsed.success) return { result: { status: "denied" } };
    const input = parsed.data;
    let lease: Lease;
    try {
      lease = args.sites.consumeCredentialContext(input.token, input.owner);
    } catch {
      return { result: { status: "denied" } };
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      lease.signal,
      inputSignal,
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let form: Form | undefined;
    try {
      const host = lease.target.hostWebContentsId;
      const assert = () => {
        if (signal.aborted) throw new Error("Cancelled");
        check(lease);
      };
      assert();
      if (!lease.target.context.url.startsWith("https:"))
        return { result: { status: "unsupported" } };
      if (input.request.tabId !== lease.target.context.tabId)
        return { result: { status: "denied" } };
      if (
        pending.size >= 16 ||
        [...pending.values()].some(
          (one) => one.metadata.tabId === input.request.tabId,
        ) ||
        Date.now() - (lastProposal.get(host) ?? 0) < 1000
      )
        return { result: { status: "busy" } };
      const record = input.record;
      if (input.request.operation === "save") {
        if (record || !input.draft) return { result: { status: "denied" } };
      } else {
        if (
          !record ||
          input.draft ||
          record.id !== input.request.reference.id ||
          record.version !== input.request.reference.version ||
          record.owner !== input.owner ||
          record.sourceHash !== input.sourceHash ||
          record.origin !== lease.target.context.origin
        )
          return { result: { status: "denied" } };
        args.keys.verify(record);
      }
      // Reserve before any CDP await; concurrent proposals cannot slip past it.
      const metadata: CredentialPending = {
        id: randomUUID(),
        tabId: input.request.tabId,
        pluginId: input.owner,
        pluginName: lease.name,
        origin: lease.target.context.origin,
        accountId:
          record?.accountId ??
          (input.request.operation === "save" ? input.request.accountId : ""),
        operation: input.request.operation,
        ...(record ? { protection: record.protection } : {}),
        reviewing: false,
      };
      let settle!: (value: Response) => void;
      const completion = new Promise<Response>((resolve) => {
        settle = resolve;
      });
      let finished = false;
      const finish = (value: Response) => {
        if (finished) return;
        finished = true;
        pending.delete(metadata.id);
        for (const [token, release] of releases)
          if (release.one === one) releases.delete(token);
        settle(value);
        args.changed();
      };
      const one: Pending = {
        metadata,
        lease,
        host,
        assert,
        signal,
        controller,
        finish,
        input,
      };
      pending.set(metadata.id, one);
      lastProposal.set(host, Date.now());
      const abort = () => finish({ result: { status: "cancelled" } });
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => controller.abort(),
        CREDENTIAL_REQUEST_TIMEOUT_MS,
      );
      try {
        if (metadata.operation !== "delete") {
          const token = randomUUID();
          releases.set(token, { one, operation: "prepare" });
          form = await prepareCredentialForm(
            lease.target,
            assert,
            signal,
            token,
          );
          one.form = form;
        }
        assert();
        args.changed();
        return await completion;
      } catch {
        finish({
          result: { status: signal.aborted ? "cancelled" : "unsupported" },
        });
        return await completion;
      } finally {
        signal.removeEventListener("abort", abort);
      }
    } catch {
      return { result: { status: signal.aborted ? "cancelled" : "denied" } };
    } finally {
      if (timer) clearTimeout(timer);
      await form?.close(); /* Server owns lease until its SQL commit. */
    }
  }
  async function review(id: string, host: number): Promise<CredentialResult> {
    const one = pending.get(id);
    if (!one || one.host !== host || one.metadata.reviewing || authenticating)
      return { status: "denied" };
    try {
      one.assert();
    } catch {
      one.controller.abort();
      return { status: "denied" };
    }
    one.metadata.reviewing = true;
    authenticating = true;
    args.changed();
    let auth: Promise<CredentialProtection | null>;
    try {
      auth = (async () => {
        one.assert();
        const protection = await args.confirm(one.metadata, host, one.signal);
        one.assert();
        if (
          !protection ||
          (one.input.record && protection !== one.input.record.protection)
        )
          return null;
        if (protection === "require-touch-id") {
          if (!args.touchIdAvailable()) return null;
          await args.touchId(
            `Approve ${one.metadata.operation} for ${one.metadata.origin}`,
          );
          one.assert();
        }
        return protection;
      })();
      // Logical cancellation must not free the native-auth slot.
      void auth
        .finally(() => {
          authenticating = false;
        })
        .catch(() => {});
      let rejectAbort!: () => void;
      const cancelled = new Promise<null>((resolve) => {
        rejectAbort = () => resolve(null);
        one.signal.addEventListener("abort", rejectAbort, { once: true });
        if (one.signal.aborted) resolve(null);
      });
      let protection: CredentialProtection | null;
      try {
        protection = await Promise.race([auth, cancelled]);
      } finally {
        one.signal.removeEventListener("abort", rejectAbort);
      }
      if (!protection) {
        one.finish({ result: { status: "cancelled" } });
        return { status: "cancelled" };
      }
      one.assert();
      const record = one.input.record;
      let response: Response;
      if (one.metadata.operation === "delete")
        response = { result: { status: "deleted" } };
      else if (one.metadata.operation === "fill" && record && one.form) {
        const token = randomUUID();
        releases.set(token, { one, operation: "fill" });
        await one.form.fill(token);
        one.assert();
        response = { result: { status: "filled" } };
      } else if (one.form) {
        const token = randomUUID();
        releases.set(token, { one, operation: "capture" });
        const captured = await one.form.capture(token);
        one.assert();
        const now = Date.now();
        const sealed = args.keys.seal(
          {
            owner: one.input.owner,
            sourceHash: one.input.sourceHash,
            origin: one.metadata.origin,
            id: record?.id ?? one.input.draft!.id,
            accountId: one.metadata.accountId,
            username: captured.username,
            version: record ? record.version + 1 : 1,
            protection,
            createdAt: record?.createdAt ?? one.input.draft!.createdAt,
            updatedAt: now,
          },
          captured.password,
          record?.vaultId ?? one.input.expectedVaultId,
        );
        one.assert();
        const {
          owner: _owner,
          sourceHash: _source,
          vaultId: _vault,
          format: _format,
          seal: _seal,
          nonce: _nonce,
          ciphertext: _cipher,
          tag: _tag,
          ...metadata
        } = sealed;
        response = {
          result: {
            status: record ? "updated" : "saved",
            credential: credentialMetadataSchema.parse(metadata),
          },
          record: sealed,
        };
      } else throw new Error("Unsupported");
      one.finish(response);
      // Never give ciphertext to the renderer that clicked Review.
      return response.result;
    } catch {
      one.finish({
        result: { status: one.signal.aborted ? "cancelled" : "denied" },
      });
      return { status: one.signal.aborted ? "cancelled" : "denied" };
    }
  }
  return {
    request,
    take(
      token: string,
      operation: "prepare" | "capture" | "fill",
      webContentsId: number,
      url: string,
    ) {
      const release = releases.get(token);
      if (!release || release.operation !== operation) return null;
      releases.delete(token);
      const one = release.one;
      try {
        one.assert();
        if (
          one.lease.target.credentials?.webContentsId !== webContentsId ||
          one.lease.target.context.url !== url
        )
          return null;
        if (operation === "prepare") return true;
        if (!one.metadata.reviewing) return null;
        if (operation === "capture") return true;
        const record = one.input.record;
        return record
          ? args.keys.open(record, (password) => ({
              username: record.username,
              password,
            }))
          : null;
      } catch {
        return null;
      }
    },
    review,
    list: (host: number) =>
      [...pending.values()]
        .filter(
          (one) =>
            (one.host === host && one.form !== undefined) ||
            (one.host === host && one.metadata.operation === "delete"),
        )
        .map((one) => ({ ...one.metadata })),
    dismiss(id: string, host: number) {
      const one = pending.get(id);
      if (!one || one.host !== host) return false;
      one.controller.abort();
      return true;
    },
    cancelHost(host: number) {
      cancel((one) => one.host === host);
      lastProposal.delete(host);
    },
    cancelView(id: number) {
      cancel((one) => one.lease.target.credentials?.webContentsId === id);
    },
    availability(value: boolean) {
      enabled = value;
      if (!value) cancel(() => true);
    },
    close() {
      enabled = false;
      cancel(() => true);
      lastProposal.clear();
    },
  };
}
export type CredentialVault = ReturnType<typeof createCredentialVault>;
