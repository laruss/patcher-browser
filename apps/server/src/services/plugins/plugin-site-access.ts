import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { currentCredentialPluginCallers } from "../browser/credential-plugin-caller.js";
import { runAsCredentialAgent } from "../browser/credential-agent-scope.js";
import {
  browserCommandSchema,
  permissionForBrowserCommand,
} from "@patcher/domain";
import {
  pluginSiteAccessAllows,
  pluginSiteOrigin,
  PLUGIN_SITE_GRANT_MAX_COUNT,
  runtimeSiteCommandSupported,
} from "@patcher/domain/plugin-site-access";
import {
  deletePluginSiteGrant,
  listPluginSiteGrants,
  putPluginSiteGrant,
  type DbConnection,
  type InstalledPluginRow,
} from "@patcher/db";
import {
  siteContextSchema,
  type DesktopSitePolicy,
  type PluginSitePageContributions as ScopedPageContributions,
} from "@patcher/domain/plugin-site-access";
import type { SecretChannelMethod } from "@patcher/secret-storage";
import type { PluginManifest } from "./manifest.js";
import type { PluginApiHandle } from "./plugin-api.js";
import type {
  BrowserBridge,
  BrowserBridgeCallArgs,
} from "../browser/browser-bridge.js";
import {
  currentPluginSiteCallers,
  runWithPluginSiteCallers,
} from "../browser/plugin-site-caller.js";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
interface State {
  policy: DesktopSitePolicy;
  fingerprint: string;
  contributions: ScopedPageContributions;
  controller: AbortController;
}
const leaseSchema = siteContextSchema
  .extend({ token: z.uuid(), hostWebContentsId: z.number().int().positive() })
  .strict();
export class PluginSiteAccessError extends Error {
  constructor() {
    super(
      "Runtime site access is unavailable or has not been allowed for this page",
    );
    this.name = "PluginSiteAccessError";
  }
}
function refuse(): never {
  throw new PluginSiteAccessError();
}
async function untilRevoked<T>(
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  if (signal.aborted) return refuse();
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new PluginSiteAccessError());
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try {
    return await Promise.race([run(), aborted]);
  } finally {
    if (rejectAbort) signal.removeEventListener("abort", rejectAbort);
  }
}
export function createPluginSiteAccess(args: {
  db: DbConnection;
  request?: (
    method: SecretChannelMethod,
    payload: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  changed: () => void;
}) {
  const states = new Map<string, State>();
  const queues = new Map<string, Promise<unknown>>();
  let bridge: BrowserBridge | undefined;
  let available = false;
  async function request(
    method: SecretChannelMethod,
    payload: unknown,
    signal?: AbortSignal,
  ) {
    if (!args.request || signal?.aborted) return refuse();
    try {
      return await args.request(method, payload, signal);
    } catch {
      return refuse();
    }
  }
  function stateFor(id: string) {
    const state = states.get(id);
    if (!state?.policy.enabled) return refuse();
    return state;
  }
  function owners(ids: readonly string[]) {
    return [...new Set(ids)].map((pluginId) => ({
      pluginId,
      revision: stateFor(pluginId).policy.revision,
    }));
  }
  function refresh(
    state: State,
    origins = state.policy.origins,
    enabled = state.policy.enabled,
  ) {
    state.controller.abort();
    state.controller = new AbortController();
    state.policy = {
      ...state.policy,
      origins,
      enabled,
      revision: randomUUID(),
    };
  }
  async function publish(id: string) {
    const state = states.get(id);
    if (!state) return;
    const policy = state.policy;
    const previous = queues.get(id) ?? Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(async () => {
        try {
          await request("site.policy", policy);
          available = true;
        } catch (error) {
          available = false;
          throw error;
        }
      });
    queues.set(id, work);
    try {
      await work;
    } finally {
      if (queues.get(id) === work) queues.delete(id);
      args.changed();
    }
  }
  function persistedOrigins(id: string, fingerprint: string) {
    return listPluginSiteGrants(args.db, id)
      .filter((row) => row.fingerprint === fingerprint)
      .map((row) => row.origin);
  }
  async function register(
    row: InstalledPluginRow,
    manifest: PluginManifest,
    handle?: PluginApiHandle,
  ) {
    const old = states.get(row.id);
    if (manifest.siteAccess !== "runtime" && old === undefined) return;
    const fingerprint = digest({
      source: {
        kind: row.sourceKind,
        path: row.sourcePath,
        builtin: row.sourceBuiltinName,
        npm: row.sourceNpmPackage,
        registry: row.sourceNpmRegistry,
        git: row.sourceGitUrl,
        subdirectory: row.sourceGitSubdirectory,
      },
      sites: [...(manifest.sites ?? [])].sort(),
      permissions: [...(manifest.permissions ?? [])].sort(),
      mode: manifest.siteAccess,
    });
    // Policy/source changes permanently invalidate prior grants, including on rollback.
    for (const grant of listPluginSiteGrants(args.db, row.id))
      if (grant.fingerprint !== fingerprint)
        deletePluginSiteGrant(args.db, row.id, grant.origin);
    const contributions: ScopedPageContributions = {
      scripts: (handle?.pageScripts ?? []).map((record) => ({
        pluginId: row.id,
        scriptId: record.id,
        matches: [...record.matches],
        code: record.code,
      })),
      styles: (handle?.pageStyles ?? []).map((record) => ({
        pluginId: row.id,
        styleId: record.id,
        matches: [...record.matches],
        css: record.css,
      })),
    };
    old?.controller.abort();
    states.set(row.id, {
      fingerprint,
      contributions,
      controller: new AbortController(),
      policy: {
        pluginId: row.id,
        name: manifest.name,
        revision: randomUUID(),
        enabled: row.enabled && manifest.siteAccess === "runtime",
        sites: [...(manifest.sites ?? [])],
        permissions: [...(manifest.permissions ?? [])],
        origins: persistedOrigins(row.id, fingerprint),
        scripts: contributions.scripts.map(digest),
        styles: contributions.styles.map(digest),
      },
    });
    // No broker is a supported headless state; runtime page work still refuses.
    try {
      await publish(row.id);
    } catch {
      /* Metadata remains usable. */
    }
  }
  async function disable(id: string) {
    const state = states.get(id);
    if (!state) return;
    refresh(state, state.policy.origins, false);
    try {
      await publish(id);
    } catch {
      /* A disconnected main has no capabilities. */
    }
  }
  async function remove(id: string) {
    const state = states.get(id);
    if (!state) return;
    deletePluginSiteGrant(args.db, id);
    refresh(state, [], false);
    try {
      await publish(id);
    } catch {
      /* A disconnected main has no capabilities. */
    }
  }
  async function confirm(id: string, tabId: string) {
    const state = stateFor(id),
      revision = state.policy.revision;
    const context = siteContextSchema.parse(
      await request(
        "site.confirm",
        { pluginId: id, revision, tabId },
        state.controller.signal,
      ),
    );
    if (
      states.get(id) !== state ||
      state.policy.revision !== revision ||
      state.controller.signal.aborted
    )
      return refuse();
    if (
      !state.policy.origins.includes(context.origin) &&
      state.policy.origins.length >= PLUGIN_SITE_GRANT_MAX_COUNT
    )
      return refuse();
    putPluginSiteGrant(args.db, id, context.origin, state.fingerprint);
    refresh(state, persistedOrigins(id, state.fingerprint));
    await publish(id);
    return context.origin;
  }
  async function revoke(id: string, origin: string) {
    const state = states.get(id);
    if (!state || pluginSiteOrigin(origin) !== origin) return refuse();
    deletePluginSiteGrant(args.db, id, origin);
    refresh(
      state,
      state.policy.origins.filter((item) => item !== origin),
    );
    await publish(id);
  }
  async function callBrowser(
    call: BrowserBridgeCallArgs,
    ids = currentPluginSiteCallers(),
  ) {
    const command = browserCommandSchema.parse(call.command);
    if (
      !runtimeSiteCommandSupported(command) ||
      !bridge?.callScoped ||
      !("tabId" in command) ||
      !command.tabId
    )
      return refuse();
    const scope = owners(ids);
    for (const owner of scope)
      if (
        !stateFor(owner.pluginId).policy.permissions.includes(
          permissionForBrowserCommand(command),
        )
      )
        return refuse();
    const signals = scope.map(
      (owner) => stateFor(owner.pluginId).controller.signal,
    );
    const signal = AbortSignal.any([
      ...signals,
      ...(call.signal ? [call.signal] : []),
    ]);
    const lease = leaseSchema.parse(
      await request(
        "site.prepare",
        { owners: scope, tabId: command.tabId, digest: digest(command) },
        signal,
      ),
    );
    try {
      for (const owner of scope) {
        const state = stateFor(owner.pluginId);
        if (
          state.policy.revision !== owner.revision ||
          !pluginSiteAccessAllows(
            state.policy.sites,
            state.policy.origins,
            lease.url,
          )
        )
          return refuse();
      }
      const result = await bridge.callScoped({
        ...call,
        command,
        signal,
        token: lease.token,
        nativeWebContentsId: lease.hostWebContentsId,
      });
      for (const owner of scope)
        if (
          signal.aborted ||
          stateFor(owner.pluginId).policy.revision !== owner.revision
        )
          return refuse();
      return result;
    } finally {
      void request("site.release", { token: lease.token }).catch(() => {});
    }
  }
  async function pageCallback<T>(
    id: string,
    kind: string,
    payload: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    const state = states.get(id);
    if (!state || !kind.startsWith("browser")) return run();
    const supported = new Set([
      "browserContextMenu",
      "browserTabAction",
      "browserFindAction",
      "browserToolbarState",
      "browserToolbarRun",
      "browserSiteInfo",
      "browserAuth",
    ]);
    if (!supported.has(kind)) return refuse();
    if (typeof payload !== "object" || payload === null) return refuse();
    const body = payload as Record<string, unknown>;
    if (typeof body.tabId !== "string") return refuse();
    const ids = [...currentPluginSiteCallers(), id];
    const scope = owners(ids);
    const url =
      typeof body.pageUrl === "string"
        ? body.pageUrl
        : typeof body.url === "string"
          ? body.url
          : undefined;
    const signal = AbortSignal.any(
      scope.map((owner) => stateFor(owner.pluginId).controller.signal),
    );
    const lease = leaseSchema.parse(
      await request(
        "site.context",
        {
          owners: scope,
          tabId: body.tabId,
          ...(url === undefined ? {} : { url }),
        },
        signal,
      ),
    );
    try {
      if (
        kind === "browserAuth" &&
        (body.host !== new URL(lease.url).host ||
          body.insecure !== lease.url.startsWith("http:"))
      )
        return refuse();
      const result = await runWithPluginSiteCallers(ids, () =>
        untilRevoked(signal, run),
      );
      await request("site.check", { token: lease.token }, signal);
      return result;
    } finally {
      void request("site.release", { token: lease.token }).catch(() => {});
    }
  }
  async function pageRpc<T>(
    id: string,
    token: string,
    method: string,
    input: string,
    run: () => Promise<T>,
  ) {
    const signal = stateFor(id).controller.signal;
    await request(
      "site.redeem",
      { token, pluginId: id, digest: digest({ pluginId: id, method, input }) },
      signal,
    );
    try {
      const result = await runWithPluginSiteCallers([id], () =>
        // Page RPC is untrusted input, never a human credential action. Carry
        // the existing denial scope through child calls and SDK HTTP too.
        runAsCredentialAgent(() => untilRevoked(signal, run)),
      );
      stateFor(id);
      await request("site.check", { token }, signal);
      return result;
    } catch (error) {
      void request("site.release", { token }).catch(() => {});
      throw error;
    }
    // Main owns this ticket until the answer reaches the page (or times out).
    // Releasing it before the renderer forwards the HTTP response aborts that answer.
  }
  async function withAuthPrompt<T>(
    id: string,
    tabId: string,
    promptId: string,
    run: () => Promise<T>,
  ) {
    const signal = stateFor(id).controller.signal;
    const lease = leaseSchema.parse(
      await request(
        "site.context",
        {
          owners: owners([...currentPluginSiteCallers(), id]),
          tabId,
          authPromptId: promptId,
        },
        signal,
      ),
    );
    try {
      const result = await untilRevoked(signal, run);
      await request("site.check", { token: lease.token }, signal);
      return result;
    } finally {
      void request("site.release", { token: lease.token }).catch(() => {});
    }
  }
  async function prepareAuth(
    id: string,
    tabId: string,
    promptId: string,
    credentials: { username: string; password: string },
  ) {
    const state = stateFor(id),
      scope = owners([...currentPluginSiteCallers(), id]);
    return z
      .object({ token: z.uuid() })
      .strict()
      .parse(
        await request(
          "site.auth",
          {
            owners: scope,
            tabId,
            id: promptId,
            digest: digest({ kind: "credentials", ...credentials }),
          },
          state.controller.signal,
        ),
      ).token;
  }
  async function credentialLease(
    id: string,
    tabId: string,
    inputSignal?: AbortSignal,
  ) {
    const scope = owners([
      ...currentCredentialPluginCallers(),
      ...currentPluginSiteCallers(),
      id,
    ]);
    for (const owner of scope)
      if (
        !stateFor(owner.pluginId).policy.permissions.includes(
          "credentials.manage",
        )
      )
        return refuse();
    const signal = AbortSignal.any([
      ...scope.map((owner) => stateFor(owner.pluginId).controller.signal),
      ...(inputSignal ? [inputSignal] : []),
    ]);
    const lease = leaseSchema.parse(
      await request("site.context", { owners: scope, tabId }, signal),
    );
    return {
      ...lease,
      signal,
      check: () => request("site.check", { token: lease.token }, signal),
      close: () => {
        void request("site.release", { token: lease.token }).catch(() => {});
      },
    };
  }
  return {
    credentialLease,
    register,
    disable,
    remove,
    confirm,
    revoke,
    pageCallback,
    prepareAuth,
    withAuthPrompt,
    pageRpc,
    callBrowser,
    isRuntime: (id: string) => states.has(id),
    setBridge: (value: BrowserBridge) => {
      bridge = value;
    },
    contributions: () => ({
      scripts: [...states.values()]
        .filter((state) => state.policy.enabled)
        .flatMap((state) => state.contributions.scripts),
      styles: [...states.values()]
        .filter((state) => state.policy.enabled)
        .flatMap((state) => state.contributions.styles),
    }),
    cleanup: async () => {
      try {
        return z
          .array(z.object({ pluginId: z.string(), tabId: z.string() }).strict())
          .parse(await request("site.cleanup", null));
      } catch {
        available = false;
        return [];
      }
    },
    list: () =>
      [...states.values()].map((state) => ({
        pluginId: state.policy.pluginId,
        name: state.policy.name,
        enabled: state.policy.enabled,
        available,
        origins: state.policy.origins,
        permissions: state.policy.permissions,
        sites: state.policy.sites,
      })),
  };
}
export type PluginSiteAccess = ReturnType<typeof createPluginSiteAccess>;
