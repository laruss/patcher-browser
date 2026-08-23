/**
 * Who spawns plugin processes, and what happens when one dies.
 *
 * The topology question the transport deliberately left open is answered here,
 * and by a measurement rather than a preference. A bundled plugin-host process
 * costs **~67MB resident before it loads a single plugin**, against ~50MB for a
 * bare Node process — down from ~204MB once everything a given plugin does not
 * use stopped being imported at startup. Thirteen at one process each is
 * ~870MB.
 *
 * So: **plugins share a process by default**, and `placement` decides which.
 * That keeps the expensive decision a one-line policy instead of a shape the
 * rest of the code is built around — and it stays worth revisiting, because
 * process-per-plugin is the better failure model and only cost rules it out.
 *
 * Which plugins get a process at all is `plugin-placement.ts`; this file only
 * asks where to put the ones it is handed.
 *
 * What sharing costs is honest and bounded: plugins in one process die
 * together. The channel already makes that survivable — every in-flight
 * request rejects when the pipe closes — and this file makes it recoverable by
 * restarting the process and re-bootstrapping everyone who was in it.
 */

import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginPermission } from "@patcher/domain";
import {
  createPluginChannel,
  type PluginChannel,
  type PluginNotifyHandler,
  type PluginPort,
  type PluginRequestHandler,
} from "./plugin-channel.js";
import {
  BOOTSTRAP_METHOD,
  type PluginHostConfig,
  type PluginRegistrationSnapshot,
} from "./plugin-child-runtime.js";
import type { PluginCallbackKind } from "./plugin-callbacks.js";
import type { PluginHostCallPath } from "./plugin-host-calls.js";
import {
  createPortMultiplexer,
  type PortMultiplexer,
} from "./plugin-port-multiplexer.js";
import { createChildProcessPort } from "./plugin-ports.js";

/** What the supervisor needs to start one plugin. */
export interface SupervisedPlugin {
  /**
   * This *start*, not this plugin — and the difference is the whole reason
   * this field exists.
   *
   * The loader builds a reload's new instance before disposing the previous
   * one; that ordering is what makes a failed reload keep the old plugin
   * serving. So for the moment a swap takes, one plugin has two instances
   * alive, and anything keyed by plugin id refuses the second.
   *
   * Minted by the caller and stable across a restart: a crashed process is
   * revived by re-starting the same `SupervisedPlugin`, so whoever holds the
   * id can still stop what came back.
   */
  instanceId: string;
  pluginId: string;
  permissions: readonly PluginPermission[] | undefined;
  /** What `patcher.sites` declared; per-plugin, like the permissions beside it. */
  sites: readonly string[] | undefined;
  serverEntry: string;
  /** Identifies this plugin's SDK client; per-plugin, never shared. */
  apiKey: string;
}

export type PluginProcessKey = string;

/**
 * Which process a plugin belongs in. Same key, same process.
 *
 * The default puts everything in one, for the reason at the top of this file.
 * Returning the plugin's own id isolates it — which is what a plugin that has
 * earned distrust, or a plugin under development, should get.
 */
export type PluginPlacement = (plugin: SupervisedPlugin) => PluginProcessKey;

export const SHARED_PLACEMENT: PluginPlacement = () => "shared";
export const ISOLATED_PLACEMENT: PluginPlacement = (plugin) => plugin.pluginId;

export interface SupervisorHostHandlers {
  /**
   * Serves what a plugin asks of the host (`PluginHostCallPath`). Handed the
   * instance rather than the id: during a reload swap the two instances of one
   * plugin have different host state behind them, and the server picks which
   * by `instanceId`.
   */
  onRequest: (plugin: SupervisedPlugin) => PluginRequestHandler;
  onNotify: (plugin: SupervisedPlugin) => PluginNotifyHandler;
}

export interface PluginProcessSpawner {
  (key: PluginProcessKey): ChildProcess;
}

export interface PluginSupervisorOptions {
  /**
   * Everything a plugin needs that is the same for all of them, read fresh at
   * every start — `loopbackBaseUrl` is null until the server is listening, and
   * a plugin started after that must get the real one.
   */
  shared: () => Omit<
    PluginHostConfig,
    "pluginId" | "permissions" | "sites" | "serverEntry" | "apiKey"
  >;
  handlers: SupervisorHostHandlers;
  placement?: PluginPlacement;
  spawn?: PluginProcessSpawner;
  logger?: {
    warn(message: string): void;
    info(message: string): void;
  };
  /**
   * Restart backoff, capped. A plugin process that crashes on load would
   * otherwise be respawned as fast as the machine allows.
   */
  restart?: {
    /** Give up after this many crashes in a row. Default 5. */
    maxAttempts?: number;
    /** First delay; doubles each attempt. Default 250ms. */
    baseDelayMs?: number;
    maxDelayMs?: number;
    /**
     * How long a process must stay up before its crash budget resets.
     *
     * Not "has it served a plugin" — the first version used that and the
     * escalation test caught it: a process that bootstraps fine and dies a
     * moment later resets the counter every time, which is a crashloop with
     * the backoff switched off. Living is the evidence, not starting.
     * Default 10s.
     */
    stabilityWindowMs?: number;
    /** Injected so tests do not wait. */
    schedule?: (delayMs: number, run: () => void) => () => void;
  };
  /**
   * A process crashed past its budget and will not be restarted. Its plugins
   * are still registered with the loader and are now unreachable, which is the
   * one failure this file cannot fix by itself.
   */
  onGaveUp?: (plugins: readonly SupervisedPlugin[], problem: string) => void;
  /** Injected so a test can decide how long a process "lived". */
  now?: () => number;
}

export interface SupervisedPluginState {
  plugin: SupervisedPlugin;
  key: PluginProcessKey;
  channel: PluginChannel<PluginCallbackKind, PluginHostCallPath>;
  snapshot: PluginRegistrationSnapshot;
}

export interface PluginSupervisor {
  /**
   * @param options.signal Abandons a start that has not finished. The plugin
   *   process is told, so a factory still running out there is dropped rather
   *   than left live with no owner.
   */
  start(
    plugin: SupervisedPlugin,
    options?: { signal?: AbortSignal },
  ): Promise<SupervisedPluginState>;
  /** Dispose, close the channel, and stop the process if it was the last one. */
  stop(instanceId: string): Promise<void>;
  stopAll(): Promise<void>;
  get(instanceId: string): SupervisedPluginState | undefined;
  /** Every live instance, in start order. */
  states(): SupervisedPluginState[];
  /**
   * Live processes, for tests and for `patcher plugin list`. A plugin appears twice
   * for as long as a reload swap has two of its instances alive.
   */
  processes(): { key: PluginProcessKey; pluginIds: string[]; pid?: number }[];
}

interface HostProcess {
  key: PluginProcessKey;
  child: ChildProcess;
  multiplexer: PortMultiplexer;
  /** Instances currently placed here, so a crash knows who to bring back. */
  members: Map<string, SupervisedPlugin>;
  startedAt: number;
  crashes: number;
  stopping: boolean;
}

const DEFAULT_RESTART = {
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 10_000,
  stabilityWindowMs: 10_000,
};

export function createPluginSupervisor(
  options: PluginSupervisorOptions,
): PluginSupervisor {
  const placement = options.placement ?? SHARED_PLACEMENT;
  const spawn = options.spawn ?? defaultSpawn;
  const logger = options.logger ?? { warn: () => {}, info: () => {} };
  const restart = { ...DEFAULT_RESTART, ...options.restart };
  const now = options.now ?? Date.now;
  const schedule =
    options.restart?.schedule ??
    ((delayMs: number, run: () => void) => {
      const timer = setTimeout(run, delayMs);
      // A restart timer must not be the reason a server refuses to exit.
      timer.unref?.();
      return () => clearTimeout(timer);
    });

  const processes = new Map<PluginProcessKey, HostProcess>();
  /** Keyed by instance id; see `SupervisedPlugin.instanceId`. */
  const started = new Map<string, SupervisedPluginState>();
  /**
   * Restarts waiting to fire, by process key.
   *
   * Not on the `HostProcess`: the crashed host is removed from `processes` the
   * moment it dies, so a cancel stored on it is a cancel nobody can reach —
   * and a shutdown would then be followed by the timer spawning a fresh
   * plugin process with no owner.
   */
  const pendingRestarts = new Map<PluginProcessKey, () => void>();

  function cancelPendingRestart(key: PluginProcessKey): void {
    const cancel = pendingRestarts.get(key);
    if (cancel === undefined) return;
    pendingRestarts.delete(key);
    cancel();
  }

  function ensureProcess(key: PluginProcessKey): HostProcess {
    const existing = processes.get(key);
    if (existing !== undefined) return existing;

    const child = spawn(key);
    const host: HostProcess = {
      key,
      child,
      members: new Map(),
      startedAt: now(),
      crashes: 0,
      stopping: false,
      multiplexer: createPortMultiplexer({
        port: createChildProcessPort(child),
        onUnroutable: (problem) =>
          logger.warn(`plugin process ${key}: ${problem}`),
      }),
    };
    processes.set(key, host);

    child.stderr?.on("data", (chunk: Buffer) => {
      // The child writes protocol problems and unhandled rejections here, and
      // this is the only path by which a dying process explains itself.
      logger.warn(`plugin process ${key}: ${String(chunk).trimEnd()}`);
    });
    child.once("exit", (code, signal) => {
      onProcessGone(host, code, signal);
    });
    return host;
  }

  function onProcessGone(
    host: HostProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (processes.get(host.key) !== host) return;
    processes.delete(host.key);
    // Every channel in it is already closing — the multiplexer propagates the
    // pipe's close to each virtual port, which is what rejects their in-flight
    // requests. Nothing here has to notify callers; it only has to decide
    // whether to bring the plugins back.
    const lost = [...host.members.values()];
    for (const plugin of lost) started.delete(plugin.instanceId);
    if (host.stopping || lost.length === 0) return;

    // A process that stayed up is not part of the same crashloop as one that
    // died on startup, so it gets a fresh budget.
    if (now() - host.startedAt >= restart.stabilityWindowMs) host.crashes = 0;
    host.crashes += 1;
    const how = signal === null ? `exit code ${code}` : `signal ${signal}`;
    if (host.crashes > restart.maxAttempts) {
      const problem =
        `plugin process died (${how}) and has crashed ` +
        `${host.crashes} times`;
      logger.warn(
        `plugin process ${host.key} ${problem}; giving up on ${lost
          .map((one) => one.pluginId)
          .join(", ")}`,
      );
      // Giving up is not the end of the story for these plugins, it is the
      // start of someone else's: they are registered, their channels are shut,
      // and every call into them now rejects. Only the loader can decide what
      // that should look like, so it has to be told rather than left to read
      // a log line.
      options.onGaveUp?.(lost, problem);
      return;
    }
    const delayMs = Math.min(
      restart.maxDelayMs,
      restart.baseDelayMs * 2 ** (host.crashes - 1),
    );
    logger.warn(
      `plugin process ${host.key} died (${how}); restarting ` +
        `${lost.map((one) => one.pluginId).join(", ")} in ${delayMs}ms`,
    );
    const cancel = schedule(delayMs, () => {
      void (async () => {
        pendingRestarts.delete(host.key);
        const revived = ensureProcess(host.key);
        // Carry the crash count across, or a plugin that dies every third
        // start would be restarted forever.
        revived.crashes = host.crashes;
        for (const plugin of lost) {
          try {
            await start(plugin);
          } catch (error) {
            logger.warn(
              `plugin ${plugin.pluginId} failed to restart: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      })();
    });
    pendingRestarts.set(host.key, cancel);
  }

  async function start(
    plugin: SupervisedPlugin,
    options_?: { signal?: AbortSignal },
  ): Promise<SupervisedPluginState> {
    if (started.has(plugin.instanceId)) {
      throw new Error(
        `plugin instance "${plugin.instanceId}" is already started`,
      );
    }
    const key = placement(plugin);
    const host = ensureProcess(key);
    const port: PluginPort = host.multiplexer.open(plugin.instanceId);
    const channel = createPluginChannel<PluginCallbackKind, PluginHostCallPath>(
      {
        port,
        name: `plugin:${plugin.instanceId}`,
        onRequest: options.handlers.onRequest(plugin),
        onNotify: options.handlers.onNotify(plugin),
        onProtocolError: (problem) =>
          logger.warn(`plugin ${plugin.instanceId}: ${problem}`),
      },
    );

    // Giving up on a start has to reach the plugin process, not just the
    // caller: a factory that is merely slow would otherwise finish into a
    // fully live instance nobody is holding, while the same plugin loads in
    // the server. Closing the channel rejects the bootstrap below, and the
    // catch does the rest.
    const abandon = (): void => channel.close("start abandoned");
    // A signal that is already aborted fires no listener, and the request
    // below would then wait on a plugin nobody is waiting for.
    if (options_?.signal?.aborted === true) abandon();
    options_?.signal?.addEventListener("abort", abandon, { once: true });

    let snapshot: PluginRegistrationSnapshot;
    try {
      snapshot = (await channel.request({
        method: BOOTSTRAP_METHOD as PluginCallbackKind,
        payload: {
          ...options.shared(),
          pluginId: plugin.pluginId,
          permissions: plugin.permissions ?? null,
          sites: plugin.sites ?? null,
          serverEntry: plugin.serverEntry,
          apiKey: plugin.apiKey,
        } as never,
      })) as unknown as PluginRegistrationSnapshot;
    } catch (error) {
      // A plugin whose factory throws must not leave a channel and a
      // multiplexer slot behind — the next attempt to start it would be
      // refused for a name that is already open.
      channel.close("bootstrap failed");
      host.multiplexer.close(plugin.instanceId);
      throw error;
    } finally {
      options_?.signal?.removeEventListener("abort", abandon);
    }

    host.members.set(plugin.instanceId, plugin);
    const state: SupervisedPluginState = { plugin, key, channel, snapshot };
    started.set(plugin.instanceId, state);
    return state;
  }

  async function stop(instanceId: string): Promise<void> {
    const state = started.get(instanceId);
    if (state === undefined) return;
    started.delete(instanceId);
    const host = processes.get(state.key);
    host?.members.delete(instanceId);

    // Ask the plugin to dispose before dropping it. A failure here is the
    // plugin's, not a reason to leave the channel open.
    try {
      await state.channel.request({ method: "dispose", payload: null });
    } catch (error) {
      logger.warn(
        `plugin ${state.plugin.pluginId} failed to dispose: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    state.channel.close("stopped");
    host?.multiplexer.close(instanceId);

    if (host !== undefined && host.members.size === 0) {
      host.stopping = true;
      cancelPendingRestart(host.key);
      processes.delete(host.key);
      host.child.kill();
    }
  }

  // There is deliberately no `reload` here. Reloading is start-then-stop, in
  // that order, and the loader owns it: it builds the new instance, commits it
  // over the old one, and only then disposes the old. A `reload` on this side
  // could only be stop-then-start, which is the ordering that loses a plugin's
  // registrations when the new load turns out to fail.
  return {
    start,
    stop,
    async stopAll() {
      // Before anything is stopped: a restart still on the clock would spawn a
      // process into a supervisor that is shutting down.
      for (const key of [...pendingRestarts.keys()]) cancelPendingRestart(key);
      for (const instanceId of [...started.keys()]) await stop(instanceId);
      // Anything left is a process with no members, which stop() already
      // killed; this only catches a process that never got one.
      for (const host of [...processes.values()]) {
        host.stopping = true;
        processes.delete(host.key);
        host.child.kill();
      }
    },
    get: (instanceId) => started.get(instanceId),
    states: () => [...started.values()],
    processes: () =>
      [...processes.values()].map((host) => ({
        key: host.key,
        pluginIds: [...host.members.values()].map((one) => one.pluginId),
        ...(host.child.pid === undefined ? {} : { pid: host.child.pid }),
      })),
  };
}

/**
 * How the server forks a plugin host.
 *
 * A packaged server has a built `plugin-host-entry.js` next to this module and
 * forks it directly. A source checkout has only the TypeScript, which Node
 * cannot run on its own — so it takes the same two flags the agent-runtime
 * bridge uses for exactly this case (`shared/bridge-path.ts`):
 * `--conditions=source` so workspace packages resolve to their TS entries, and
 * tsx to compile them.
 *
 * Getting this wrong is invisible until it is not: the child exits before it
 * can say anything, and all the server sees is a channel that closed.
 */
function defaultSpawn(): ChildProcess {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, "plugin-host-entry.js");
  const stdio: ["ignore", "ignore", "pipe", "ipc"] = [
    "ignore",
    "ignore",
    "pipe",
    "ipc",
  ];
  if (existsSync(built)) return fork(built, [], { stdio });
  return fork(join(here, "plugin-host-entry.ts"), [], {
    stdio,
    execArgv: ["--conditions=source", "--import", import.meta.resolve("tsx")],
  });
}
