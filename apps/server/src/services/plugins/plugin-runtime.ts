import { realpathSync, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire, registerHooks } from "node:module";
import { performance } from "node:perf_hooks";
import { createJiti } from "jiti";
import semver from "semver";
import {
  PLUGIN_SDK_MAJOR,
  PLUGIN_SDK_VERSION,
  type Thread,
} from "@patcher/domain";
import { buildPluginApp } from "@patcher/plugin-build";
import { getPluginBuildToolchain } from "./build-toolchain.js";
import {
  createNodePatcherSdk,
  createNodeWebsocketFactory,
  createRequestTimeoutFetch,
  DEFAULT_PATCHER_REQUEST_TIMEOUT_MS,
  type PatcherSdk,
} from "@patcher/sdk";
import {
  createPluginApiFetch,
  createPluginApiIdentities,
  pluginApiHeaders,
} from "./plugin-api-identity.js";
import { linkCancellation } from "./plugin-cancellation.js";
import { readPluginSettingsValues } from "./plugin-settings.js";
import { pluginExternalsAlias } from "./plugin-externals-alias.js";
import { createPluginHostCallServer } from "./plugin-host-call-server.js";
import { createRemotePluginApiHandle } from "./plugin-remote-handle.js";
import {
  createPluginSupervisor,
  type PluginSupervisor,
} from "./plugin-supervisor.js";
import {
  assertCallbackCrosses,
  describeCallback,
  type PluginCallback,
} from "./plugin-callbacks.js";
import {
  deletePluginKvValue,
  getInstalledPlugin,
  getPluginKvValue,
  listInstalledPlugins,
  listPluginKvKeys,
  prunePluginSchedules,
  setPluginKvValue,
  upsertPluginSchedule,
  type InstalledPluginRow,
} from "@patcher/db";
import { toThreadResponseFromThread } from "../threads/thread-runtime-display.js";
import {
  loadPluginAppBundle,
  loadPluginBrandingAssets,
  parsePluginAppBundleMeta,
  readPluginAppBundleMeta,
  validatePluginArtifactMeta,
  type PluginAppBundleSnapshot,
  type PluginBrandingAssetSet,
} from "./app-bundle.js";
import { parsePluginSource } from "./install-sources.js";
import { readPluginManifest, type PluginManifest } from "./manifest.js";
import {
  createPluginApi,
  isNeedsConfigurationError,
  type PatcherPluginApi,
  type PluginApiHandle,
  type PluginThreadEventName,
  type PluginThreadEventPayloads,
} from "./plugin-api.js";
import type {
  LoadedPlugin,
  PluginHandlerStats,
  PluginRuntimeStatus,
  PluginServiceDeps,
  PluginWireLookup,
  ServiceRuntime,
} from "./plugin-service-internal.js";

/**
 * Per-root reload generation for mutable (path:/source-builtin) plugin trees.
 * `jiti.import` hands a `"type": "module"` entry to native `import()`, and
 * Node's ESM registry keys modules by resolved URL forever — so a re-import
 * after an edit returns the first-evaluated module and `patcher plugin reload`
 * silently keeps the old code. A resolve hook stamps the current generation
 * onto every URL inside a mutable plugin root, which makes each reload a
 * distinct URL for the entry AND every file it imports.
 */
interface MutableRoot {
  /** Stable while the root stays registered; never reused after removal. */
  id: number;
  /** Process-wide unique load epoch, so a re-registered root cannot collide. */
  epoch: number;
}

const mutableRoots = new Map<string, MutableRoot>();
/** Marker shape: `<root id>.<epoch>`. */
const MUTABLE_ROOT_MARKER = /[?&]patcherPluginLoad=(\d+)\.(\d+)/;
let nextMutableRootId = 1;
let nextMutableRootEpoch = 1;
let mutableRootHooks: { deregister: () => void } | null = null;

function registerMutableRootHooks(): void {
  if (mutableRootHooks !== null) return;
  mutableRootHooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (mutableRoots.size === 0) return resolved;
      if (!resolved.url.startsWith("file:")) return resolved;
      // Longest match wins: a plugin nested inside another plugin's tree owns
      // its own files, and the outer root must not claim them.
      let match: MutableRoot | undefined;
      let matchedLength = 0;
      for (const [rootUrl, root] of mutableRoots) {
        if (rootUrl.length <= matchedLength) continue;
        if (!resolved.url.startsWith(rootUrl)) continue;
        match = root;
        matchedLength = rootUrl.length;
      }
      if (match === undefined) return resolved;
      // A plugin's own files keep the epoch of the parent that pulled them in,
      // so a later dynamic import from a still-active plugin cannot mix its
      // modules with those of a newer (or failed) load. The marker carries the
      // root id too: an import that crosses into a different plugin's tree
      // must take that plugin's epoch, not the importer's.
      const parent = MUTABLE_ROOT_MARKER.exec(context.parentURL ?? "");
      const epoch =
        parent !== null && Number(parent[1]) === match.id
          ? parent[2]
          : match.epoch;
      const separator = resolved.url.includes("?") ? "&" : "?";
      return {
        ...resolved,
        url: `${resolved.url}${separator}patcherPluginLoad=${match.id}.${epoch}`,
        shortCircuit: true,
      };
    },
  });
}

/**
 * Node canonicalizes ESM files through symbolic links, so the tracked root
 * must be the real path — otherwise a symlinked install never matches and
 * reload silently serves cached code.
 */
function mutableRootDir(rootDir: string): string {
  try {
    return realpathSync(rootDir);
  } catch {
    // A vanished root fails later with a useful load error; the un-resolved
    // path is a good enough key until then.
    return rootDir;
  }
}

function mutableRootUrl(canonicalDir: string): string {
  return pathToFileURL(join(canonicalDir, "/")).href;
}

/**
 * The URL marker only re-keys ESM modules. Node caches a CommonJS child by
 * resolved filename and ignores the query, so a `.cjs` file (or anything
 * reached through `createRequire`) would survive the reload untouched. There
 * is one CommonJS cache per filename and no room for a per-epoch key, so the
 * evicted entries are returned and restored if the candidate never commits.
 */
function evictCommonJsCache(canonicalDir: string): Map<string, NodeModule> {
  const prefix = join(canonicalDir, "/");
  const cache = createRequire(import.meta.url).cache;
  const evicted = new Map<string, NodeModule>();
  for (const filename of Object.keys(cache)) {
    if (!filename.startsWith(prefix)) continue;
    const entry = cache[filename];
    if (entry !== undefined) evicted.set(filename, entry);
    delete cache[filename];
  }
  return evicted;
}

/**
 * Invalidate a mutable plugin tree so the next import re-reads from disk.
 * Returns a rollback for the candidate that never commits: the retained
 * plugin keeps its own epoch, so a cross-root import cannot reach the
 * rejected files, and its CommonJS children are put back as they were.
 */
function bumpMutableRootGeneration(rootDir: string): () => void {
  registerMutableRootHooks();
  const canonicalDir = mutableRootDir(rootDir);
  const rootUrl = mutableRootUrl(canonicalDir);
  const previous = mutableRoots.get(rootUrl);
  mutableRoots.set(rootUrl, {
    // A removed-then-reinstalled root takes a fresh id, so its new modules
    // can never collide with URLs the old registration already evaluated.
    id: previous?.id ?? nextMutableRootId++,
    epoch: nextMutableRootEpoch++,
  });
  const evicted = evictCommonJsCache(canonicalDir);
  return () => {
    if (previous === undefined) mutableRoots.delete(rootUrl);
    else mutableRoots.set(rootUrl, previous);
    const cache = createRequire(import.meta.url).cache;
    for (const [filename, entry] of evicted) {
      // Only restore what the failed candidate did not already replace.
      if (cache[filename] === undefined) cache[filename] = entry;
    }
  };
}

/**
 * Drop a root once its plugin is uninstalled, so the resolve hook does not
 * keep scanning roots that no longer exist. Reload must NOT call this: the
 * surviving module graph of a failed reload still resolves against its id.
 */
export function forgetMutableRoot(rootDir: string): void {
  releaseMutableRoots([mutableRootUrl(mutableRootDir(rootDir))]);
}

/**
 * Release roots owned by a stopping runtime and tear the hook down once no
 * roots remain, so a process that creates many services (tests, restarts)
 * does not pay for historical roots on every later resolve.
 */
function releaseMutableRoots(rootUrls: Iterable<string>): void {
  for (const rootUrl of rootUrls) mutableRoots.delete(rootUrl);
  if (mutableRoots.size > 0 || mutableRootHooks === null) return;
  mutableRootHooks.deregister();
  mutableRootHooks = null;
}

const DEFAULT_LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_SERVICE_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_SERVICE_RESTART_BASE_MS = 1_000;
const SERVICE_RESTART_MAX_MS = 60_000;
/** A crash after this much healthy runtime resets the backoff sequence. */
const SERVICE_HEALTHY_RESET_MS = 5 * 60_000;

export interface PluginRuntimeContext {
  deps: PluginServiceDeps;
  nextCronRunAt: (cron: string, now: number) => number;
  settledWithin: (
    promise: Promise<unknown>,
    timeoutMs: number,
  ) => Promise<boolean>;
}

export function createPluginRuntime(context: PluginRuntimeContext) {
  const { deps, nextCronRunAt, settledWithin } = context;
  const logger = deps.logger;
  const loadTimeoutMs = deps.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const serviceStopTimeoutMs =
    deps.serviceStopTimeoutMs ?? DEFAULT_SERVICE_STOP_TIMEOUT_MS;
  const serviceRestartBaseMs =
    deps.serviceRestartBaseMs ?? DEFAULT_SERVICE_RESTART_BASE_MS;

  const loaded = new Map<string, LoadedPlugin>();
  // Per-plugin lifecycle mutex: every load/dispose mutation for one plugin
  // runs strictly serialized. disposeOne removes the `loaded` entry before
  // stopServices finishes, so without this a concurrent reload/enable/
  // install could enter loadOne mid-dispose (no loaded entry, no hung
  // marker yet) and double-start the plugin's services.
  const lifecycleChains = new Map<string, Promise<void>>();
  const artifactChains = new Map<string, Promise<void>>();
  const pluginOperationChains = new Map<string, Promise<void>>();
  const REGISTRATION_MUTATION_KEY = "plugin-registration-mutations";
  const disposingPluginIds = new Set<string>();
  const builtinSourceWatchers: FSWatcher[] = [];
  /** Mutable roots this runtime registered, released when it stops. */
  const ownedRootUrls = new Set<string>();

  function withLifecycleLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = lifecycleChains.get(id) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    lifecycleChains.set(id, tail);
    void tail.then(() => {
      if (lifecycleChains.get(id) === tail) lifecycleChains.delete(id);
    });
    return result;
  }

  function withArtifactLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = artifactChains.get(key) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    artifactChains.set(key, tail);
    void tail.then(() => {
      if (artifactChains.get(key) === tail) artifactChains.delete(key);
    });
    return result;
  }

  function withPluginOperationLock<T>(
    id: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = pluginOperationChains.get(id) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    pluginOperationChains.set(id, tail);
    void tail.then(() => {
      if (pluginOperationChains.get(id) === tail) {
        pluginOperationChains.delete(id);
      }
    });
    return result;
  }
  const statuses = new Map<
    string,
    { status: PluginRuntimeStatus; detail: string | null }
  >();
  const baseStatuses = new Map<
    string,
    { status: PluginRuntimeStatus; detail: string | null }
  >();
  const devBuildProblems = new Map<string, string>();
  const statusListeners = new Map<
    string,
    Set<(status: PluginRuntimeStatus, detail: string | null) => void>
  >();
  const stabilizingPluginIds = new Set<string>();
  // Frontend bundle snapshots (design §5.1), keyed by plugin id: the wire
  // state for list() plus the on-disk asset paths + content hash the asset
  // routes serve. Refreshed on every load (install/boot/reload).
  const appBundles = new Map<string, PluginAppBundleSnapshot>();
  // Branding assets (compact icon + logo variants), refreshed alongside
  // appBundles on every load.
  const brandingAssets = new Map<string, PluginBrandingAssetSet>();
  // Static identity — parsed manifest + branding snapshots — for EVERY
  // installed plugin, loaded or not. Unlike `brandingAssets`/`appBundles`,
  // which are gated on the live runtime, this survives the load lifecycle so
  // the inventory and branding asset route can recognize disabled or
  // incompatible plugins. Refreshed on every load attempt; pruned on remove.
  const identities = new Map<
    string,
    { manifest: PluginManifest; brandingAssets: PluginBrandingAssetSet }
  >();
  // Services that ignored their abort past the stop bound. While a plugin
  // has entries here it is not re-loaded (that would double-start the
  // service); the marker clears when the hung start() finally settles.
  const hungServices = new Map<string, Set<string>>();
  // needs-configuration messages reported during the current load; cleared
  // on the next load so a reconfigured plugin comes back as running.
  const needsConfiguration = new Map<string, string>();
  // Agent-tool registration problems (cross-plugin name collisions): the
  // plugin keeps running, but the dropped registration is surfaced as its
  // status detail. Cleared on the next load.
  const agentToolProblems = new Map<string, string>();
  // Why a plugin asked to run in a plugin process is running in the server
  // instead. Placement is best effort, and a silent fallback is the dangerous
  // kind: an operator who moved a plugin for isolation would have no way to
  // see it did not move. Cleared at the start of every load.
  const placementFallbacks = new Map<string, string>();
  // Cumulative per plugin for this server session (kept across reloads so a
  // reload cannot hide cost); removed with the plugin registration.
  const handlerStats = new Map<string, PluginHandlerStats>();
  // Bound once the HTTP listener is up; patcher.sdk is gated on it (design §3
  // two-phase load/bind).
  //
  // One client per plugin rather than one shared: each carries that plugin's
  // identity headers, so the API can apply its permissions to traffic that
  // arrives as HTTP — which is what `patcher.sdk` is. See plugin-api-identity.ts.
  let boundLoopbackBaseUrl: string | undefined;
  const pluginSdks = new Map<string, PatcherSdk>();
  // Owned here rather than injected: it is the loader that knows which plugins
  // exist, and a dep would have to be threaded through every hand-built test
  // deps object for something none of them exercise.
  const apiIdentities = createPluginApiIdentities();
  /** Correlates a cancel message with the call it cancels. */
  let callSequence = 0;

  function sdkFor(pluginId: string): PatcherSdk | undefined {
    if (boundLoopbackBaseUrl === undefined) return undefined;
    let sdk = pluginSdks.get(pluginId);
    if (sdk === undefined) {
      const key = apiIdentities.keyFor(pluginId);
      sdk = createNodePatcherSdk({
        baseUrl: boundLoopbackBaseUrl,
        // Wrapped around the timeout fetch, not instead of it: supplying
        // `fetch` opts out of the one createNodeTransport would have added,
        // and a hung route would leave the plugin's promise pending forever.
        fetch: createPluginApiFetch({
          pluginId,
          key,
          fetch: createRequestTimeoutFetch({
            timeoutMs: DEFAULT_PATCHER_REQUEST_TIMEOUT_MS,
          }),
        }),
        // The realtime socket identifies itself too. `/ws` is not under
        // `/api/v1`, so the request gate never sees it — without this, a
        // plugin's subscriptions would be the one unpoliced way in.
        websocket: createNodeWebsocketFactory({
          headers: pluginApiHeaders({ pluginId, key }),
        }),
      });
      pluginSdks.set(pluginId, sdk);
    }
    return sdk;
  }

  function publishStatus(
    id: string,
    status: PluginRuntimeStatus,
    detail: string | null,
  ): void {
    statuses.set(id, { status, detail });
    for (const listener of statusListeners.get(id) ?? []) {
      listener(status, detail);
    }
  }

  function setStatus(
    id: string,
    status: PluginRuntimeStatus,
    detail: string | null = null,
  ): void {
    baseStatuses.set(id, { status, detail });
    const buildProblem = devBuildProblems.get(id);
    publishStatus(
      id,
      status,
      [detail, buildProblem]
        .filter((part): part is string => part !== null && part !== undefined)
        .join("; ") || null,
    );
  }

  function setDevBuildProblem(id: string, message: string | null): void {
    if (message === null) devBuildProblems.delete(id);
    else devBuildProblems.set(id, `frontend bundle build failed: ${message}`);
    const base = baseStatuses.get(id);
    if (base !== undefined) setStatus(id, base.status, base.detail);
  }

  function statsFor(id: string): PluginHandlerStats {
    let stats = handlerStats.get(id);
    if (!stats) {
      stats = { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 };
      handlerStats.set(id, stats);
    }
    return stats;
  }

  function reportNeedsConfiguration(id: string, message: string): void {
    needsConfiguration.set(id, message);
    setStatus(id, "needs-configuration", message);
  }

  function reportAgentToolProblem(id: string, message: string): void {
    agentToolProblems.set(id, message);
    logger.warn(`[plugin:${id}] ${message}`);
    // Post-load registration (mid-session): surface the detail right away.
    // During load, loadOne applies it when it sets the final status.
    if (statuses.get(id)?.status === "running") {
      setStatus(id, "running", message);
    }
  }

  /** Another loaded plugin already owns this tool name? Returns its id. */
  /** Which plugin owns each registered agent tool name, right now. */
  function agentToolOwners(): Record<string, string> {
    const owners: Record<string, string> = {};
    for (const [otherId, plugin] of loaded) {
      for (const tool of plugin.handle.agentTools) owners[tool.name] = otherId;
    }
    return owners;
  }

  function browserHostStatus(): { connected: boolean; hostCount: number } {
    const snapshot = deps.browserBridge?.status();
    return {
      connected: snapshot?.connected ?? false,
      hostCount: snapshot?.hostCount ?? 0,
    };
  }

  /** Tell every plugin process what changed on this side. */
  function pushHostFacts(): void {
    const states = supervisor?.states() ?? [];
    if (states.length === 0) return;
    const browserStatus = browserHostStatus();
    const owners = agentToolOwners();
    for (const state of states) {
      state.channel.notify({
        method: "host.browserStatus" as never,
        payload: browserStatus as never,
      });
      state.channel.notify({
        method: "host.agentToolOwners" as never,
        payload: owners as never,
      });
    }
  }

  function findAgentToolOwner(
    name: string,
    excludePluginId: string,
  ): string | undefined {
    for (const [otherId, plugin] of loaded) {
      if (otherId === excludePluginId) continue;
      if (plugin.handle.agentTools.some((tool) => tool.name === name)) {
        return otherId;
      }
    }
    return undefined;
  }

  /** Start (or restart) one background service instance. */
  function runService(id: string, service: ServiceRuntime): void {
    const controller = new AbortController();
    service.controller = controller;
    service.state = "running";
    service.startedAt = Date.now();
    // The async wrapper normalizes sync throws from start() into rejections.
    const current = (async () => {
      await service.record.start(controller.signal);
    })();
    service.current = current;
    current.then(
      () => onServiceSettled(id, service, { crashed: false }),
      (error: unknown) =>
        onServiceSettled(id, service, { crashed: true, error }),
    );
  }

  function onServiceSettled(
    id: string,
    service: ServiceRuntime,
    outcome: { crashed: false } | { crashed: true; error: unknown },
  ): void {
    service.current = null;
    service.controller = null;
    if (service.disposed) return; // the dispose path owns state + logging
    const name = service.record.name;
    if (!outcome.crashed) {
      // Resolved without being aborted: the service chose to stop.
      service.state = "stopped";
      logger.info(`[plugin:${id}] service ${name} stopped`);
      return;
    }
    if (isNeedsConfigurationError(outcome.error)) {
      service.state = "stopped";
      reportNeedsConfiguration(
        id,
        outcome.error.message || `service ${name} needs configuration`,
      );
      logger.info(
        `[plugin:${id}] service ${name} needs configuration; not restarting until reload`,
      );
      return;
    }
    // Crash → restart with capped exponential backoff; a crash after a
    // healthy stretch restarts the sequence from the base delay.
    const message =
      outcome.error instanceof Error
        ? outcome.error.message
        : String(outcome.error);
    if (stabilizingPluginIds.has(id)) {
      service.state = "stopped";
      setStatus(id, "error", `service ${name} crashed: ${message}`);
      logger.warn(
        `[plugin:${id}] service ${name} crashed during activation: ${message}`,
      );
      return;
    }
    if (Date.now() - service.startedAt >= SERVICE_HEALTHY_RESET_MS) {
      service.consecutiveCrashes = 0;
    }
    const delayMs = Math.min(
      serviceRestartBaseMs * 2 ** service.consecutiveCrashes,
      SERVICE_RESTART_MAX_MS,
    );
    service.consecutiveCrashes += 1;
    service.state = "backoff";
    logger.warn(
      `[plugin:${id}] service ${name} crashed: ${message} — restarting in ${delayMs}ms`,
    );
    const timer = setTimeout(() => {
      service.restartTimer = null;
      if (!service.disposed) runService(id, service);
    }, delayMs);
    timer.unref?.();
    service.restartTimer = timer;
  }

  /**
   * §3 reload sequence step 1: abort every service, then await each start()
   * promise with a bounded timeout. A service that does not stop marks the
   * plugin degraded and blocks re-load until its promise finally settles.
   */
  async function stopServices(id: string, plugin: LoadedPlugin): Promise<void> {
    for (const service of plugin.services) {
      service.disposed = true;
      if (service.restartTimer !== null) {
        clearTimeout(service.restartTimer);
        service.restartTimer = null;
      }
      service.controller?.abort();
    }
    for (const service of plugin.services) {
      const current = service.current;
      const name = service.record.name;
      if (current !== null) {
        const stopped = await settledWithin(current, serviceStopTimeoutMs);
        if (!stopped) {
          let hung = hungServices.get(id);
          if (!hung) {
            hung = new Set();
            hungServices.set(id, hung);
          }
          hung.add(name);
          setStatus(id, "degraded", `service ${name} did not stop`);
          logger.warn(
            `[plugin:${id}] service ${name} did not stop within ${serviceStopTimeoutMs}ms — plugin degraded until it does`,
          );
          void current.then(
            () => onHungServiceSettled(id, name),
            () => onHungServiceSettled(id, name),
          );
        }
      }
      service.state = "stopped";
    }
  }

  function onHungServiceSettled(id: string, name: string): void {
    const hung = hungServices.get(id);
    if (!hung) return;
    hung.delete(name);
    if (hung.size === 0) hungServices.delete(id);
    logger.info(
      `[plugin:${id}] service ${name} eventually stopped — reload to recover`,
    );
  }

  function hasThreadEventHandlers(event: PluginThreadEventName): boolean {
    if (loaded.size === 0) return false;
    for (const plugin of loaded.values()) {
      if (plugin.handle.threadEventHandlers[event].length > 0) return true;
    }
    return false;
  }

  /**
   * One wrapped plugin-handler invocation (design §3 failure isolation):
   * caught, logged, wall-time recorded into handlerStats. Shared by thread
   * events and the wire surfaces (http routes, rpc methods).
   */
  /** In-flight invokeWrapped markers per plugin, drained during dispose. */
  const pendingInvocations = new Map<string, Set<Promise<void>>>();

  async function invokeWrapped<T>(
    id: string,
    label: string,
    run: () => T | Promise<T>,
  ): Promise<
    { ok: true; value: T } | { ok: false; error: string; cause: unknown }
  > {
    const stats = statsFor(id);
    const startedAt = performance.now();
    let settle!: () => void;
    const marker = new Promise<void>((resolveMarker) => {
      settle = resolveMarker;
    });
    let pending = pendingInvocations.get(id);
    if (!pending) {
      pending = new Set();
      pendingInvocations.set(id, pending);
    }
    pending.add(marker);
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.errorCount += 1;
      logger.warn(`[plugin:${id}] ${label} failed: ${message}`);
      if (statuses.get(id)?.status === "running") {
        setStatus(id, "running", `${label} failed: ${message}`);
      }
      return { ok: false, error: message, cause: error };
    } finally {
      const elapsedMs = performance.now() - startedAt;
      stats.count += 1;
      stats.totalMs += elapsedMs;
      if (elapsedMs > stats.maxMs) stats.maxMs = elapsedMs;
      pending.delete(marker);
      settle();
    }
  }

  /**
   * `invokeWrapped` with the call described instead of anonymous.
   *
   * The closure still runs in-process — this changes nothing about how a call
   * executes. What it changes is that every server→plugin call now says what
   * it is sending, in a vocabulary a transport could carry, which is what plan
   * Phase 7 has to replace the closure with.
   *
   * `run` receives the declared payload rather than closing over its own copy.
   * That is the whole reason this is not just a nicer label: the description
   * and the argument are one value, so they cannot disagree — and under test
   * the value is checked against what the description claims about it.
   *
   * Its second argument is the cancellation signal, which is deliberately not
   * in the payload: a signal is a capability, so it travels as its own message
   * (./plugin-cancellation.ts) and the far side builds a signal from it. Today
   * that far side is this same process, which is what makes the relay
   * exercised by every cancellable call in the suite rather than described.
   */
  async function invokeCallback<TPayload, TResult>(
    id: string,
    call: PluginCallback<TPayload>,
    run: (
      payload: TPayload,
      signal: AbortSignal | undefined,
    ) => TResult | Promise<TResult>,
    cancellation?: { source: AbortSignal | undefined },
  ): Promise<
    { ok: true; value: TResult } | { ok: false; error: string; cause: unknown }
  > {
    assertCallbackCrosses(call, "payload", call.payload);
    callSequence += 1;
    const { signal, detach } = linkCancellation({
      callId: `${id}:${callSequence}`,
      source: cancellation?.source,
    });
    try {
      const outcome = await invokeWrapped(id, describeCallback(call), () =>
        run(call.payload, signal),
      );
      if (outcome.ok) assertCallbackCrosses(call, "result", outcome.value);
      return outcome;
    } finally {
      // A source signal outlives the calls made under it — one CLI request,
      // many calls — so the listener has to come off when this one settles.
      detach();
    }
  }

  /**
   * Reload sequence step 3 (design §3): bounded wait for in-flight handler
   * invocations so dispose does not close database handles or invalidate the
   * API under a still-running rpc/http/event handler.
   */
  async function drainInvocations(id: string): Promise<void> {
    const pending = pendingInvocations.get(id);
    if (!pending || pending.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      Promise.all([...pending]).then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), serviceStopTimeoutMs);
        timer.unref?.();
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (!drained) {
      logger.warn(
        `plugin ${id}: ${pending.size} in-flight invocation(s) did not settle before dispose; proceeding`,
      );
    }
    if (pending.size === 0) pendingInvocations.delete(id);
  }

  async function invokeThreadEventHandler<E extends PluginThreadEventName>(
    id: string,
    event: E,
    handler: (payload: PluginThreadEventPayloads[E]) => void | Promise<void>,
    payload: PluginThreadEventPayloads[E],
  ): Promise<void> {
    await invokeCallback(
      id,
      { kind: "threadEvent", target: event, payload },
      (delivered) => handler(delivered),
    );
  }

  /**
   * Fire-and-forget dispatch: the lifecycle seam returns immediately; the
   * payload is assembled and handlers run on the next macrotask, after the
   * transition (and any surrounding transaction) has settled. Handlers are
   * looked up live at dispatch time, so a plugin disposed in between
   * receives nothing.
   */
  function emitThreadEvent<E extends PluginThreadEventName>(
    event: E,
    buildPayload: () => PluginThreadEventPayloads[E],
  ): void {
    if (!hasThreadEventHandlers(event)) return;
    setImmediate(() => {
      let payload: PluginThreadEventPayloads[E];
      try {
        payload = buildPayload();
      } catch (error) {
        logger.warn(
          `failed to build ${event} plugin event payload: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      for (const [id, plugin] of loaded) {
        for (const handler of [...plugin.handle.threadEventHandlers[event]]) {
          void invokeThreadEventHandler(id, event, handler, payload);
        }
      }
    });
  }

  function buildThreadDto(thread: Thread) {
    return toThreadResponseFromThread(
      { db: deps.db, hub: deps.hub },
      { thread },
    );
  }

  function checkEngineRange(manifest: PluginManifest): string | undefined {
    if (!manifest.patcherEngineRange) return undefined;
    const version = semver.coerce(deps.appVersion);
    if (!version) {
      // Dev builds may carry a non-semver version; do not block on it.
      logger.warn(
        `cannot parse app version "${deps.appVersion}" for engines check; skipping`,
      );
      return undefined;
    }
    if (version.major === 0 && version.minor === 0 && version.patch === 0) {
      // Dev servers report 0.0.0 (or 0.0.0-test); a real release never does.
      // Enforcing ranges against it would mark every version-gated plugin
      // incompatible in development.
      return undefined;
    }
    if (!semver.satisfies(version, manifest.patcherEngineRange)) {
      return `requires Patcher ${manifest.patcherEngineRange}, this is ${version.version}`;
    }
    return undefined;
  }

  function checkPluginSdkRange(manifest: PluginManifest): string | undefined {
    if (!manifest.patcherPluginSdkRange) return undefined;
    if (!semver.satisfies(PLUGIN_SDK_VERSION, manifest.patcherPluginSdkRange)) {
      return `requires patcher plugin SDK ${manifest.patcherPluginSdkRange}, running SDK is ${PLUGIN_SDK_VERSION}`;
    }
    return undefined;
  }

  /**
   * The load deadline, wherever a load waits on plugin code — the factory
   * here, or a plugin process's bootstrap, which runs the same factory one
   * pipe away. One copy, so the two placements cannot drift apart on how long
   * a plugin may take to load.
   */
  async function withLoadTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`load timed out after ${loadTimeoutMs}ms`)),
            loadTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function runFactoryTimeBoxed(
    factory: (api: PatcherPluginApi) => unknown,
    api: PatcherPluginApi,
  ): Promise<void> {
    await withLoadTimeout(Promise.resolve(factory(api)));
  }

  /** Parse an incoming install display spec for validation/build policy. */
  function sourceKind(source: string): "path" | "git" | "npm" | "builtin" {
    try {
      return parsePluginSource(source).kind;
    } catch {
      return "path";
    }
  }

  function builtinName(row: InstalledPluginRow): string | null {
    return row.sourceKind === "builtin" ? row.sourceBuiltinName : null;
  }

  function isPackagedBuiltinAppEntry(args: {
    kind: ReturnType<typeof sourceKind>;
    manifest: PluginManifest;
    rootDir: string;
  }): boolean {
    return (
      args.kind === "builtin" &&
      args.manifest.appEntry === resolve(args.rootDir, "dist", "app.js")
    );
  }

  function isPackagedBuiltinServerEntry(args: {
    kind: ReturnType<typeof sourceKind>;
    manifest: PluginManifest;
    rootDir: string;
  }): boolean {
    return (
      args.kind === "builtin" &&
      args.manifest.serverEntry === resolve(args.rootDir, "dist", "server.js")
    );
  }

  async function packagedBuiltinArtifactProblem(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<string | null> {
    const kind = sourceKind(row.source);
    if (
      !isPackagedBuiltinServerEntry({
        kind,
        manifest,
        rootDir: row.rootDir,
      })
    ) {
      return null;
    }
    async function validate(
      artifact: "server" | "app",
    ): Promise<string | null> {
      let raw: string;
      try {
        raw = await readFile(
          join(row.rootDir, "dist", `${artifact}.meta.json`),
          "utf8",
        );
      } catch {
        return `${artifact} artifact for plugin "${manifest.id}" is missing dist/${artifact}.meta.json`;
      }
      return validatePluginArtifactMeta({
        artifact,
        raw,
        pluginId: manifest.id,
        pluginVersion: manifest.version,
      });
    }
    const serverProblem = await validate("server");
    if (serverProblem !== null) return serverProblem;
    if (isPackagedBuiltinAppEntry({ kind, manifest, rootDir: row.rootDir })) {
      return validate("app");
    }
    return null;
  }

  function isBuiltinPluginId(id: string): boolean {
    const row = getInstalledPlugin(deps.db, id);
    return row !== undefined && row.provenance === "builtin";
  }

  function isPrebuiltServerSdkCompatible(
    meta: { sdkMajor: number; sdkVersion: string } | null,
  ): boolean {
    if (meta === null) return false;
    return meta.sdkMajor === PLUGIN_SDK_MAJOR;
  }

  /**
   * A same-major artifact built against a *newer* SDK than this host runs is
   * accepted above, deliberately: semver says a 1.4 bundle runs on a 1.x host,
   * and `engines.patcherPluginSdk` is where an author states otherwise. What
   * semver cannot promise is that every export the bundle imports exists here —
   * a 1.4-only export resolves to `undefined` through the runtime shim, and the
   * factory dies on a TypeError that names a property and not the reason. This
   * records the version gap so the load failure can say it.
   */
  const prebuiltServerSdkAhead = new Map<string, string>();

  /**
   * The backend entry to import for this load. Managed (git:/npm:) installs
   * prefer a fresh, SDK-compatible prebuilt `dist/server.js` (design
   * §3 loader amendment, §6 prebuilt distribution) so consumers never need
   * npm or node_modules. Path installs and source-layout builtins ALWAYS load
   * from source, so author iteration via `patcher plugin reload` and the builtin
   * dev watcher sees edited files; packaged builtins declare dist/server.js
   * as their manifest entry and still load that artifact. A present-but-stale
   * or meta-less managed dist falls back to source with one warning. Now that
   * the SDK is past 1.0 a matching major is the whole test; before it, minor
   * bumps were breaking, so compatibility demanded the exact SDK version — and
   * because the major was 0, the effective rule was an exact match. Widening it
   * gave up the fall-back-to-source safety net for same-major artifacts, so a
   * newer-minor dist that reaches an export this host lacks now dies at load
   * instead. `prebuiltServerSdkAhead` below is what makes that failure legible.
   */
  async function resolveServerEntry(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<string> {
    // Every path that does not end up loading a prebuilt bundle clears the note,
    // including these two: a plugin reinstalled from a path, or updated to a
    // version that ships no `dist/server.js`, otherwise keeps the version gap
    // recorded for the artifact it no longer loads, and the next unrelated load
    // failure is reported as an SDK mismatch.
    if (
      row.sourceKind === "path" ||
      (row.sourceKind === "builtin" &&
        !isPackagedBuiltinServerEntry({
          kind: row.sourceKind,
          manifest,
          rootDir: row.rootDir,
        }))
    ) {
      prebuiltServerSdkAhead.delete(row.id);
      return manifest.serverEntry;
    }
    const distJsPath = join(row.rootDir, "dist", "server.js");
    try {
      await stat(distJsPath);
    } catch {
      prebuiltServerSdkAhead.delete(row.id);
      return manifest.serverEntry; // no prebuilt bundle shipped — normal
    }
    let meta: { sdkMajor: number; sdkVersion: string } | null = null;
    try {
      meta = parsePluginAppBundleMeta(
        await readFile(join(row.rootDir, "dist", "server.meta.json"), "utf8"),
      );
    } catch {
      // missing sidecar → meta stays null
    }
    if (!isPrebuiltServerSdkCompatible(meta)) {
      logger.warn(
        `plugin ${row.id}: ignoring prebuilt dist/server.js (built with SDK ${meta?.sdkVersion ?? "unknown"}, running SDK is ${PLUGIN_SDK_VERSION}) — loading from source`,
      );
      prebuiltServerSdkAhead.delete(row.id);
      return manifest.serverEntry;
    }
    if (meta !== null && semver.gt(meta.sdkVersion, PLUGIN_SDK_VERSION)) {
      prebuiltServerSdkAhead.set(row.id, meta.sdkVersion);
    } else {
      prebuiltServerSdkAhead.delete(row.id);
    }
    return distJsPath;
  }

  /**
   * Refresh a plugin's frontend-bundle snapshot for this load (design §5.1).
   * Mutable path: and source-builtin trees are rebuilt when the recorded SDK
   * version differs from the running one. Managed git/npm artifacts are
   * immutable after promotion and are served exactly as validated;
   * incompatible metadata is surfaced without rewriting cached bytes.
   */
  async function loadAppBundleCandidate(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<{
    snapshot: PluginAppBundleSnapshot;
    problem: string | null;
  }> {
    if (manifest.appEntry === undefined) {
      return {
        snapshot: { state: { hasApp: false, bundle: null }, assets: null },
        problem: null,
      };
    }
    const kind = row.sourceKind;
    if (
      (kind === "path" || kind === "builtin") &&
      !isPackagedBuiltinAppEntry({ kind, manifest, rootDir: row.rootDir })
    ) {
      const meta = await readPluginAppBundleMeta(row.rootDir);
      if (meta?.sdkVersion !== PLUGIN_SDK_VERSION) {
        logger.info(
          `plugin ${row.id}: rebuilding frontend bundle (built with SDK ${meta?.sdkVersion ?? "unknown"}, running SDK is ${PLUGIN_SDK_VERSION})`,
        );
        try {
          await buildPluginApp(
            row.rootDir,
            deps.appVersion,
            await getPluginBuildToolchain(deps),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.warn(
            `plugin ${row.id}: frontend bundle rebuild failed: ${message}`,
          );
          return {
            snapshot: { state: { hasApp: true, bundle: null }, assets: null },
            problem: `frontend bundle rebuild failed: ${message}`,
          };
        }
      }
    }
    return {
      snapshot: await loadPluginAppBundle(row.id, row.rootDir),
      problem: null,
    };
  }

  // Best-effort static identity for the inventory + logo asset route,
  // independent of whether the plugin loads. A plugin whose manifest can't be
  // read (missing/corrupt) simply has no identity to show — it falls back to
  // its id and the generic glyph.
  async function populateIdentity(row: InstalledPluginRow): Promise<void> {
    try {
      const manifest = await readPluginManifest(row.rootDir);
      identities.set(row.id, {
        manifest,
        brandingAssets: await loadPluginBrandingAssets(row.id, manifest),
      });
    } catch {
      identities.delete(row.id);
    }
  }

  async function loadOne(row: InstalledPluginRow): Promise<void> {
    // Refresh identity first so even a disabled/incompatible/errored plugin
    // keeps its name, icon, and logo in the list.
    await populateIdentity(row);
    if (!row.enabled) {
      setStatus(row.id, "disabled");
      return;
    }
    const previous = loaded.get(row.id);
    function failBeforeFactory(
      status: PluginRuntimeStatus,
      detail: string,
    ): void {
      if (previous !== undefined) {
        setStatus(row.id, "running", `reload failed: ${detail}`);
      } else {
        setStatus(row.id, status, detail);
      }
    }
    const hung = hungServices.get(row.id);
    if (hung !== undefined && hung.size > 0) {
      // A previous instance's service never stopped; loading now would
      // double-start it (design §3: degraded rather than double-starting).
      setStatus(
        row.id,
        "degraded",
        `service ${[...hung].join(", ")} did not stop`,
      );
      return;
    }
    try {
      await stat(row.rootDir);
    } catch {
      failBeforeFactory(
        "missing",
        `plugin directory not found: ${row.rootDir} (reinstall)`,
      );
      return;
    }
    let manifest: PluginManifest;
    try {
      manifest = await readPluginManifest(row.rootDir);
    } catch (error) {
      failBeforeFactory(
        "error",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    const engineProblem =
      checkEngineRange(manifest) ?? checkPluginSdkRange(manifest);
    if (engineProblem) {
      failBeforeFactory("incompatible", engineProblem);
      return;
    }
    const artifactProblem = await packagedBuiltinArtifactProblem(row, manifest);
    if (artifactProblem !== null) {
      failBeforeFactory("incompatible", artifactProblem);
      return;
    }
    // Build candidate assets without publishing them; a failed reload keeps
    // the previous backend and frontend registration sets together.
    const appBundleCandidate = await loadAppBundleCandidate(row, manifest);
    // Branding refresh rides every load too, so `patcher plugin reload` picks up a
    // changed compact icon or logo file.
    const brandingAssetCandidate = await loadPluginBrandingAssets(
      row.id,
      manifest,
    );
    // One capability object, two consumers: `createPluginApi` builds `patcher` from
    // it in-process, and `createPluginHostCallServer` performs the same calls
    // for a plugin that lives elsewhere. Constructing it once is what stops
    // the two placements drifting.
    const capabilities = {
      pluginId: row.id,
      permissions: manifest.permissions,
      sites: manifest.sites,
      logger: deps.logger,
      // The server's own implementation of the two stores `patcher` reads through.
      // A plugin process supplies the same shape backed by its channel; both
      // sit under one copy of the semantics in plugin-api.ts.
      kvStore: {
        get: async (key) => getPluginKvValue(deps.db, row.id, key),
        set: async (key, json) => {
          setPluginKvValue(deps.db, row.id, key, json);
        },
        delete: async (key) => {
          deletePluginKvValue(deps.db, row.id, key);
        },
        list: async (prefix) => listPluginKvKeys(deps.db, row.id, prefix),
      },
      readSettingsValues: (descriptors) =>
        readPluginSettingsValues({
          db: deps.db,
          dataDir: deps.dataDir,
          pluginId: row.id,
          descriptors,
        }),
      dataDir: deps.dataDir,
      getSdk: () => sdkFor(row.id),
      getLoopbackBaseUrl: () => boundLoopbackBaseUrl,
      publishSignal: (channel, payload) => {
        deps.hub.notifyPluginSignal(row.id, channel, payload);
      },
      reportNeedsConfiguration: (message) => {
        reportNeedsConfiguration(row.id, message);
      },
      isAgentToolNameTaken: (name) => findAgentToolOwner(name, row.id),
      reportAgentToolProblem: (message) => {
        reportAgentToolProblem(row.id, message);
      },
      requestBrowserCommand: (args) => {
        if (!deps.browserBridge) {
          throw new Error("Browser control is unavailable in this host");
        }
        if (disposingPluginIds.has(row.id)) {
          throw new Error(`plugin "${row.id}" is disposing`);
        }
        return deps.browserBridge.call(args);
      },
      getBrowserHostStatus: () =>
        deps.browserBridge?.status() ?? {
          connected: false,
          browserHostId: null,
          hostCount: 0,
        },
      requestInteraction: (args) => {
        if (!deps.pendingInteractions) {
          throw new Error("Plugin interactions are unavailable in this host");
        }
        if (disposingPluginIds.has(row.id)) {
          throw new Error(`plugin "${row.id}" is disposing`);
        }
        return deps.pendingInteractions.requestPluginInteraction({
          ...args,
          pluginId: row.id,
        });
      },
    } satisfies Parameters<typeof createPluginApi>[0];

    // Everything from here is shared: whichever way the handle was built, the
    // rest of loading — services, schedules, the registration commit — reads
    // it through the same `PluginApiHandle` shape and cannot tell them apart.
    let handle: PluginApiHandle | undefined;
    let remoteInstanceId: string | null = null;
    placementFallbacks.delete(row.id);
    if (deps.runPluginOutOfProcess?.(row) === true) {
      const quarantined = placementQuarantine.get(row.id);
      if (quarantined !== undefined) {
        // Trying again is what turns one crashloop into a permanent one.
        fallBackToServer(row.id, quarantined);
      } else {
        // Null means "load it here instead", and the reason is recorded in
        // `placementFallbacks`. Nothing below this branch differs.
        const placed = await loadOutOfProcess(row, manifest, capabilities);
        if (placed !== null) {
          handle = placed.handle;
          remoteInstanceId = placed.instanceId;
        }
      }
    }

    if (handle === undefined) {
      handle = createPluginApi(capabilities);
      // Mutable trees are edited between loads, so invalidate the previous
      // generation's URLs before importing (managed git:/npm: artifacts are
      // immutable after promotion and keep their cached modules).
      let rollbackGeneration: (() => void) | undefined;
      if (row.sourceKind === "path" || row.sourceKind === "builtin") {
        rollbackGeneration = bumpMutableRootGeneration(row.rootDir);
        ownedRootUrls.add(mutableRootUrl(mutableRootDir(row.rootDir)));
      }
      try {
        // Fresh instance per load: guarantees re-imports see current sources.
        const jiti = createJiti(import.meta.url, {
          moduleCache: false,
          ...(pluginExternalsAlias === undefined
            ? {}
            : { alias: pluginExternalsAlias }),
        });
        // Same jiti instance for source and prebuilt dist/server.js, so the
        // @patcher/plugin-sdk resolution applies identically to both.
        const mod = (await jiti.import(
          await resolveServerEntry(row, manifest),
        )) as {
          default?: unknown;
        };
        const factory = mod.default;
        if (typeof factory !== "function") {
          throw new Error(
            `server entry must default-export a factory (patcher) => void, got ${typeof factory}`,
          );
        }
        await runFactoryTimeBoxed(
          factory as (api: PatcherPluginApi) => unknown,
          handle.api,
        );
      } catch (error) {
        // The candidate never commits, so its epoch and its CommonJS evictions
        // must not outlive it: the retained plugin keeps serving its own files.
        rollbackGeneration?.();
        for (const database of handle.databaseHandles.splice(0)) {
          try {
            database.close();
          } catch {
            // The load error below remains the actionable failure. Rollback
            // replaces the database only after all candidate handles close.
          }
        }
        handle.invalidate();
        let message = error instanceof Error ? error.message : String(error);
        // --ignore-scripts already prevents gyp builds at install; a .node
        // addon that slipped through dies here under Electron's ABI.
        if (/ERR_DLOPEN_FAILED|\.node/.test(message)) {
          message +=
            " (native dependencies are not supported in Patcher plugins)";
        }
        const aheadSdkVersion = prebuiltServerSdkAhead.get(row.id);
        if (aheadSdkVersion !== undefined) {
          message += ` (its prebuilt dist/server.js was built against plugin SDK ${aheadSdkVersion}, and this server runs ${PLUGIN_SDK_VERSION} — an export added after ${PLUGIN_SDK_VERSION} is undefined here)`;
        }
        if (previous !== undefined) {
          setStatus(row.id, "running", `reload failed: ${message}`);
        } else {
          setStatus(row.id, "error", message);
        }
        logger.warn(
          `plugin ${row.id} failed to load: ${statuses.get(row.id)?.detail}`,
        );
        return;
      }
    }
    const loadedBuiltinName = builtinName(row);
    const plugin: LoadedPlugin = {
      manifest,
      handle,
      services: handle.backgroundServices.map((record) => ({
        record,
        state: "stopped" as const,
        controller: null,
        current: null,
        restartTimer: null,
        consecutiveCrashes: 0,
        startedAt: 0,
        disposed: false,
      })),
      isBuiltin: loadedBuiltinName !== null,
      builtinName: loadedBuiltinName,
      remoteInstanceId,
    };
    if (previous !== undefined) {
      await disposePluginInstance(row.id, previous);
      if ((hungServices.get(row.id)?.size ?? 0) > 0) {
        loaded.delete(row.id);
        for (const database of handle.databaseHandles.splice(0)) {
          try {
            database.close();
          } catch {
            // The degraded status from the hung service is actionable.
          }
        }
        handle.invalidate();
        // The candidate was never committed, and out of process it is a live
        // process member as well as a handle. Dropping only the handle would
        // leave it bootstrapped and unreachable.
        await stopRemoteInstance(row.id, remoteInstanceId);
        return;
      }
    }
    // One map replacement is the registration commit point. Until this line,
    // every dispatcher continues to resolve the complete previous handle.
    loaded.set(row.id, plugin);
    appBundles.set(row.id, appBundleCandidate.snapshot);
    brandingAssets.set(row.id, brandingAssetCandidate);
    needsConfiguration.delete(row.id);
    agentToolProblems.delete(row.id);
    handle.activate();
    // This load changed who owns which tool name, which is one of the two
    // facts a plugin process holds a copy of.
    pushHostFacts();
    // Sync durable schedule rows to this load's registrations: upsert each
    // (computing next_run_at from its cron) and drop rows for names the
    // plugin no longer registers. Run history on kept rows survives.
    const now = Date.now();
    prunePluginSchedules(
      deps.db,
      row.id,
      handle.schedules.map((schedule) => schedule.name),
    );
    for (const schedule of handle.schedules) {
      upsertPluginSchedule(deps.db, {
        pluginId: row.id,
        name: schedule.name,
        cron: schedule.cron,
        nextRunAt: nextCronRunAt(schedule.cron, now),
      });
    }
    // Services start after the factory completes (design §4.8 bind phase).
    for (const service of plugin.services) {
      runService(row.id, service);
    }
    // A factory (or an immediately-crashing service) may have already
    // reported needs-configuration; do not paper over it with "running".
    // A dropped tool registration or a failed frontend rebuild keeps the
    // plugin running but rides along as the status detail.
    if (!needsConfiguration.has(row.id)) {
      const details = [
        agentToolProblems.get(row.id),
        appBundleCandidate.problem,
        placementFallbacks.get(row.id),
      ].filter((detail): detail is string => typeof detail === "string");
      setStatus(
        row.id,
        "running",
        details.length > 0 ? details.join("; ") : null,
      );
    }
    logger.info(`plugin ${row.id}@${manifest.version} loaded`);
  }

  async function disposePluginInstance(
    id: string,
    plugin: LoadedPlugin,
  ): Promise<void> {
    disposingPluginIds.add(id);
    try {
      try {
        deps.pendingInteractions?.interruptPluginInteractions(id);
      } catch (error) {
        logger.warn(
          `plugin ${id} interaction cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // §3 order: services first (abort + bounded await), then dispose hooks,
      // then vended resources, then handle invalidation.
      await stopServices(id, plugin);
      // LIFO, each hook isolated: one bad hook must not skip the rest.
      for (const hook of [...plugin.handle.disposeHooks].reverse()) {
        try {
          await hook();
        } catch (error) {
          logger.warn(
            `plugin ${id} dispose hook failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // §3 step 3: let in-flight rpc/http/event handlers settle (bounded)
      // before their database handles close and their API handle goes stale.
      await drainInvocations(id);
      // Close host-vended database handles before invalidating: a stale handle
      // throws on use instead of writing to a database mid-reload.
      for (const database of plugin.handle.databaseHandles.splice(0)) {
        try {
          database.close();
        } catch (error) {
          logger.warn(
            `plugin ${id} database close failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // A plugin process is stopped last, after everything above has had its
      // chance to run *inside* it: the supervisor's stop sends the `dispose`
      // callback and then closes the channel. Stopping first would make every
      // step above fail with "the far side is gone".
      //
      // This instance, not this plugin: on a reload the successor is already
      // started, and it is sharing the process with the one being dropped.
      await stopRemoteInstance(id, plugin.remoteInstanceId);
    } finally {
      plugin.handle.invalidate();
      disposingPluginIds.delete(id);
    }
  }

  /**
   * A plugin whose process the supervisor gave up on.
   *
   * It is registered, its channel is shut, and every call into it rejects —
   * which is worse than a plugin that failed to load, because nothing about it
   * looks wrong. So: say so, then put it back in the server, where a plugin
   * that has no working process still works.
   */
  async function recoverAbandonedPlugin(
    plugin: { pluginId: string; instanceId: string },
    problem: string,
  ): Promise<void> {
    const { instanceId, pluginId } = plugin;
    placementQuarantine.set(pluginId, problem);
    remoteCapabilities.delete(instanceId);
    try {
      await withLifecycleLock(pluginId, async () => {
        // Under the lock, because a reload may have replaced this instance
        // while the process was dying: then the plugin is somebody else's
        // already, its status is its own, and reloading would drop a live one.
        if (loaded.get(pluginId)?.remoteInstanceId !== instanceId) return;
        setStatus(pluginId, "error", problem);
        const row = getInstalledPlugin(deps.db, pluginId);
        if (row === null || row === undefined) return;
        await loadOne(row);
      });
    } catch (error) {
      logger.warn(
        `plugin ${pluginId} could not be recovered into the server: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * A channel that always talks to the plugin's *current* process.
   *
   * The supervisor revives a crashed process by re-bootstrapping the same
   * instance, which mints a new channel — while the handle the server is
   * holding captured the old one. So the recovery was real and the plugin was
   * unreachable anyway: every call came back "plugin channel … closed". The
   * handle holds the instance id and looks the channel up per call instead.
   *
   * What a restart does *not* refresh is the registration snapshot: the
   * reinstated process runs the same entry file and registers the same things,
   * and picking up an edited plugin is what `patcher plugin reload` is for.
   */
  function liveRemoteChannel(
    pluginId: string,
    instanceId: string,
  ): Parameters<typeof createRemotePluginApiHandle>[0]["channel"] {
    const live = () => supervisor?.get(instanceId)?.channel;
    return {
      request: (message) => {
        const channel = live();
        if (channel === undefined) {
          return Promise.reject(
            new Error(`plugin "${pluginId}" has no live process`),
          );
        }
        return channel.request(message);
      },
      notify: (message) => live()?.notify(message),
      get pendingCount() {
        return live()?.pendingCount ?? 0;
      },
      get closed() {
        return live() === undefined;
      },
      close: () => {
        // The supervisor opens and closes these; a handle that could close one
        // would be closing a channel it does not own.
        throw new Error("a plugin's channel is closed by the supervisor");
      },
    };
  }

  /** Record why a plugin is loading here, and say so once. */
  function fallBackToServer(id: string, reason: string): null {
    placementFallbacks.set(id, reason);
    logger.warn(`plugin ${id} ${reason}; loading it in the server instead`);
    return null;
  }

  /** Stop one supervised instance; a no-op for a plugin that runs here. */
  async function stopRemoteInstance(
    id: string,
    instanceId: string | null,
  ): Promise<void> {
    if (instanceId === null) return;
    try {
      await supervisor?.stop(instanceId);
    } catch (error) {
      logger.warn(
        `plugin ${id} process stop failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    remoteCapabilities.delete(instanceId);
  }

  async function disposeOne(id: string): Promise<void> {
    const plugin = loaded.get(id);
    if (!plugin) return;
    loaded.delete(id);
    await disposePluginInstance(id, plugin);
    // Its tool names are free again, and the processes still running hold a
    // copy of who owns what.
    pushHostFacts();
  }

  /**
   * A plugin is gone for good, not reloading.
   *
   * Kept out of `disposeOne`, which also runs on every reload: dropping the
   * client there minted a new one — and a new realtime socket — per reload,
   * while the previous socket stayed open on the hub with no owner. The client
   * and the key belong to the plugin id, which a reload does not change.
   */
  function forgetPluginApiClient(id: string): void {
    pluginSdks.delete(id);
    apiIdentities.forget(id);
  }

  async function disposeAll(): Promise<void> {
    for (const id of [...loaded.keys()]) {
      await withLifecycleLock(id, () => disposeOne(id));
    }
    unwatchBrowserHosts?.();
    unwatchBrowserHosts = undefined;
    // This runtime is going away, so hand its roots back. The resolve hook is
    // process-wide and is torn down once the last runtime releases its own.
    releaseMutableRoots(ownedRootUrls);
    ownedRootUrls.clear();
  }

  function clearRuntimeState(id: string): void {
    statuses.delete(id);
    baseStatuses.delete(id);
    devBuildProblems.delete(id);
    appBundles.delete(id);
    brandingAssets.delete(id);
    needsConfiguration.delete(id);
    agentToolProblems.delete(id);
    placementFallbacks.delete(id);
    placementQuarantine.delete(id);
    prebuiltServerSdkAhead.delete(id);
  }

  /**
   * Let a plugin be moved out again. An explicit `patcher plugin reload` is an
   * operator saying they fixed whatever kept killing the process; without this
   * the only way back out is a server restart.
   */
  function clearPlacementQuarantine(id: string): void {
    placementQuarantine.delete(id);
  }

  async function loadAll(): Promise<void> {
    const rows = listInstalledPlugins(deps.db).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const row of rows) {
      if (loaded.has(row.id)) continue;
      await withLifecycleLock(row.id, () => loadOne(row));
    }
  }

  /**
   * Resolve a wire request against the live tables. Handles the shared
   * unknown-plugin / not-running outcomes; `find` picks the record from a
   * running plugin's handle.
   */
  function wireLookup<T>(
    id: string,
    find: (plugin: LoadedPlugin) => T | undefined,
  ): PluginWireLookup<T> {
    const plugin = loaded.get(id);
    if (!plugin) {
      const row = getInstalledPlugin(deps.db, id);
      if (!row) return { outcome: "unknown-plugin" };
      const runtime = statuses.get(id);
      return {
        outcome: "not-running",
        status: runtime?.status ?? (row.enabled ? "error" : "disabled"),
        detail: runtime?.detail ?? (row.enabled ? "not loaded" : null),
      };
    }
    const value = find(plugin);
    if (value === undefined) return { outcome: "not-found" };
    return { outcome: "found", value };
  }

  /**
   * Created on the first plugin that opts out of the server process, so a
   * deployment that moves nothing never spawns anything.
   */
  let supervisor: PluginSupervisor | null = null;
  /**
   * Kept so `disposeAll` can drop it: the hub outlives this runtime, and a
   * listener left behind would push facts into a supervisor that is gone.
   */
  let unwatchBrowserHosts: (() => void) | undefined;
  /**
   * Capabilities per *instance*, so the supervisor's handlers can find them.
   * Per instance because a reload's two instances close over different rows:
   * until the old one is disposed it must keep calling the host it was loaded
   * with, not its successor's.
   */
  const remoteCapabilities = new Map<
    string,
    Parameters<typeof createPluginHostCallServer>[0]
  >();
  /** Mints instance ids; monotonic for the life of the process. */
  let remoteLoadSequence = 0;
  /**
   * Plugins this server will not try to move again, and why.
   *
   * Set when a plugin process crashed past its budget. Without it the recovery
   * below is a loop: the plugin comes back, `runPluginOutOfProcess` still says
   * yes, and it walks into the same crashloop. Held in memory only — a
   * restarted server is a fresh chance — and cleared by an explicit
   * `patcher plugin reload`, which is an operator saying they fixed something.
   */
  const placementQuarantine = new Map<string, string>();

  function pluginSupervisor(): PluginSupervisor {
    // On the first plugin that leaves, not at construction: a server whose
    // plugins all run here has nobody to tell.
    unwatchBrowserHosts ??= deps.browserBridge?.onStatusChange(() => {
      pushHostFacts();
    });
    supervisor ??= createPluginSupervisor({
      shared: () => ({
        dataDir: deps.dataDir,
        // Null until the server is listening; bindSdk pushes the real one.
        loopbackBaseUrl: boundLoopbackBaseUrl ?? null,
        // Read at every start, because both are read by the plugin's factory
        // while it bootstraps and both change as other plugins come and go.
        browserStatus: browserHostStatus(),
        agentToolOwners: agentToolOwners(),
      }),
      handlers: {
        onRequest: (plugin) => (request) => {
          const capabilities = remoteCapabilities.get(plugin.instanceId);
          if (capabilities === undefined) {
            throw new Error(`plugin "${plugin.pluginId}" is not loaded here`);
          }
          return createPluginHostCallServer(capabilities).onRequest(request);
        },
        onNotify: (plugin) => (notification) => {
          const capabilities = remoteCapabilities.get(plugin.instanceId);
          if (capabilities === undefined) return;
          createPluginHostCallServer(capabilities).onNotify(notification);
        },
      },
      onGaveUp: (plugins, problem) => {
        for (const plugin of plugins) {
          void recoverAbandonedPlugin(plugin, problem);
        }
      },
      logger: {
        warn: (message) => logger.warn(message),
        info: (message) => logger.info(message),
      },
      ...(deps.spawnPluginHost === undefined
        ? {}
        : { spawn: deps.spawnPluginHost }),
      ...(deps.pluginProcessRestart === undefined
        ? {}
        : { restart: deps.pluginProcessRestart }),
    });
    return supervisor;
  }

  /**
   * Try to load a plugin into a plugin process.
   *
   * Null means "load it in the server instead", for a plugin whose process did
   * not work out. **Placement is best effort — the server is the floor.** A
   * plugin an operator moved for isolation still runs if the move fails; what
   * it must not do is fail to run, or run somewhere without saying so, which
   * is why every fallback is recorded in `placementFallbacks` and reported as
   * the plugin's status detail.
   *
   * The cost is that the factory may run twice — once out there and once here.
   * That is survivable only because a factory has always had to be
   * re-runnable: `patcher plugin reload` re-runs it on every reload.
   */
  async function loadOutOfProcess(
    row: InstalledPluginRow,
    manifest: PluginManifest,
    capabilities: Parameters<typeof createPluginHostCallServer>[0],
  ): Promise<{ handle: PluginApiHandle; instanceId: string } | null> {
    // One id per load, not per plugin: a reload starts its successor while the
    // predecessor is still running, and the supervisor has to keep them apart.
    remoteLoadSequence += 1;
    const instanceId = `${row.id}#${remoteLoadSequence}`;
    remoteCapabilities.set(instanceId, capabilities);
    const abandon = new AbortController();
    const attempt = pluginSupervisor().start(
      {
        instanceId,
        pluginId: row.id,
        permissions: manifest.permissions,
        sites: manifest.sites,
        serverEntry: await resolveServerEntry(row, manifest),
        apiKey: apiIdentities.keyFor(row.id),
      },
      { signal: abandon.signal },
    );
    let started;
    try {
      // The same time box the in-process factory gets. Without it the most
      // likely way a plugin process fails — a factory that never returns —
      // does not fall back, it wedges the loader: nothing else here has a
      // deadline, because in-process the factory call was the only place
      // plugin code could hang.
      started = await withLoadTimeout(attempt);
    } catch (error) {
      // Whatever went wrong, this plugin must not end up running in two
      // places. The abort reaches a start still in flight; the handler covers
      // one that lands anyway, and drops the capabilities either way.
      abandon.abort();
      const cleanUp = (): void => {
        void stopRemoteInstance(row.id, instanceId);
      };
      attempt.then(cleanUp, cleanUp);
      return fallBackToServer(
        row.id,
        `plugin process failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      instanceId,
      handle: createRemotePluginApiHandle({
        // By instance, not the channel object in hand: this one dies with the
        // process, and the plugin is meant to survive that.
        channel: liveRemoteChannel(row.id, instanceId),
        pluginId: row.id,
        snapshot: started.snapshot,
      }),
    };
  }

  function bindSdk(args: { baseUrl: string }): void {
    boundLoopbackBaseUrl = args.baseUrl;
    // Any clients built before the bind pointed nowhere useful; drop them so
    // the next `patcher.sdk` read builds one against the URL that is now real.
    pluginSdks.clear();
    // Plugin processes hold their own bind-gate, so they are told too. A
    // plugin loaded before the server was listening is the case this exists
    // for, and it is the normal one at startup.
    for (const state of supervisor?.states() ?? []) {
      state.channel.notify({
        method: "host.loopbackBaseUrl" as never,
        payload: args.baseUrl,
      });
    }
  }

  return {
    REGISTRATION_MUTATION_KEY,
    agentToolProblems,
    apiIdentities,
    appBundles,
    forgetPluginApiClient,
    bindSdk,
    buildThreadDto,
    builtinSourceWatchers,
    checkEngineRange,
    checkPluginSdkRange,
    clearPlacementQuarantine,
    clearRuntimeState,
    disposeAll,
    disposeOne,
    emitThreadEvent,
    handlerStats,
    hungServices,
    invokeCallback,
    isBuiltinPluginId,
    identities,
    isPackagedBuiltinAppEntry,
    loadAll,
    loaded,
    loadOne,
    brandingAssets,
    needsConfiguration,
    setDevBuildProblem,
    setStatus,
    sourceKind,
    stabilizingPluginIds,
    statuses,
    statusListeners,
    wireLookup,
    withArtifactLock,
    withLifecycleLock,
    withPluginOperationLock,
  };
}
