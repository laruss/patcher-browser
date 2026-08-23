import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "@patcher/config/server";
import { isLoopbackHostname } from "@patcher/config/loopback";
import { toOptionalString } from "@patcher/config/strings";
import { createLogger } from "@patcher/logger";
import { initDb } from "./db.js";
import { createApp } from "./server.js";
import { PendingInteractionLifecycle } from "./services/interactions/pending-interactions.js";
import { createMachineAuthService } from "./services/machine-auth.js";
import { pluginProcessPolicy } from "./services/plugins/plugin-placement.js";
import { resolveBuiltinSkillsRootPath } from "./services/skills/builtin-skills-copy.js";
import { SkillTreeRegistry } from "./services/skills/injected-skills.js";
import { createAppVersionService } from "./services/system/app-version.js";
import { createPatcherAppManagedConfigReloader } from "./services/system/patcher-app-managed-config.js";
import { startEventLoopStallMonitor } from "./services/system/event-loop-stall-monitor.js";
import {
  runPeriodicSweeps,
  runStartupRecoverySweep,
} from "./services/system/periodic-sweeps.js";
import { createTelemetryService } from "./services/system/telemetry.js";
import { TerminalSessionLifecycle } from "./services/terminals/terminal-session-lifecycle.js";
import { resolveThreadStorageRootPath } from "./services/threads/thread-storage.js";
import { createLifecycleDedupers } from "./lifecycle-dedupers.js";
import { MANAGED_ENVIRONMENT_RETIRE_GRACE_MS } from "./constants.js";
import type { ServerRuntimeConfig } from "./types.js";
import { NotificationHub } from "./ws/hub.js";
import { WatchInterestCoordinator } from "./ws/watch-interests.js";

interface StartHttpListenerArgs {
  fetch: Parameters<typeof serve>[0]["fetch"];
  serverConfig: Pick<
    ServerConfig,
    "PATCHER_SERVER_BIND_HOST" | "PATCHER_SERVER_PORT"
  >;
}

export function startHttpListener(args: StartHttpListenerArgs) {
  return serve({
    hostname: args.serverConfig.PATCHER_SERVER_BIND_HOST,
    port: args.serverConfig.PATCHER_SERVER_PORT,
    fetch: args.fetch,
  });
}

export async function runServer(serverConfig: ServerConfig): Promise<void> {
  const logger = createLogger({
    component: "server",
    dataDir: serverConfig.PATCHER_DATA_DIR,
  });
  const db = initDb(serverConfig.databasePath, {
    dataDir: serverConfig.PATCHER_DATA_DIR,
    logger,
  });
  const hub = new NotificationHub();
  const watchInterests = new WatchInterestCoordinator({ db, hub });
  const lifecycleDedupers = createLifecycleDedupers();
  const appUrl = toOptionalString(serverConfig.PATCHER_APP_URL);
  const threadStorageRootPath = resolveThreadStorageRootPath({
    dataDir: serverConfig.PATCHER_DATA_DIR,
  });

  const selfDir = dirname(fileURLToPath(import.meta.url));
  const appDir = resolve(selfDir, "../../app");
  const appDistDir = join(appDir, "dist");
  const isProduction = process.env.NODE_ENV === "production";
  const staticDir =
    isProduction && existsSync(appDistDir) ? appDistDir : undefined;
  const runtimeConfig: ServerRuntimeConfig = {
    appSurface: serverConfig.PATCHER_APP_SURFACE,
    appVersion: serverConfig.PATCHER_APP_VERSION,
    builtinSkillsRootPath: resolveBuiltinSkillsRootPath(),
    customAcpAgents: [],
    customModels: [],
    dataDir: serverConfig.PATCHER_DATA_DIR,
    featureFlags: serverConfig.featureFlags,
    hostDaemonPort: serverConfig.PATCHER_HOST_DAEMON_PORT,
    inheritedSkillsRootPaths: serverConfig.PATCHER_INHERITED_SKILLS_ROOTS,
    inferenceFallbackModel: serverConfig.PATCHER_INFERENCE_FALLBACK,
    inferenceModel: serverConfig.PATCHER_INFERENCE,
    isDevelopment: !isProduction,
    managedEnvironmentRetireGraceMs: MANAGED_ENVIRONMENT_RETIRE_GRACE_MS,
    openAiApiKey: serverConfig.OPENAI_API_KEY,
    serverPort: serverConfig.PATCHER_SERVER_PORT,
    sharedSkillRoots: { user: [], project: [] },
    threadStorageRootPath,
    transcriptionModel: serverConfig.PATCHER_TRANSCRIPTION,
  };

  if (appUrl !== undefined) {
    runtimeConfig.appUrl = appUrl;
  }
  if (serverConfig.PATCHER_DEV_APP_PORT !== undefined) {
    runtimeConfig.devAppPort = serverConfig.PATCHER_DEV_APP_PORT;
  }
  const terminalSessions = new TerminalSessionLifecycle({
    config: runtimeConfig,
    db,
    hub,
    logger,
  });
  const patcherAppManagedConfig = await createPatcherAppManagedConfigReloader({
    config: runtimeConfig,
    hub,
    logger,
  });

  // Telemetry only operates in production runs (the patcher-app launcher and the
  // desktop app both set NODE_ENV=production); dev/source runs never send.
  const telemetry = await createTelemetryService({
    apiKey: serverConfig.PATCHER_POSTHOG_API_KEY,
    appSurface: serverConfig.PATCHER_APP_SURFACE,
    appVersion: serverConfig.PATCHER_APP_VERSION,
    dataDir: serverConfig.PATCHER_DATA_DIR,
    enabled: serverConfig.PATCHER_TELEMETRY && isProduction,
    logger,
  });

  const machineAuth = await createMachineAuthService({
    dataDir: serverConfig.PATCHER_DATA_DIR,
    db,
    logger,
  });
  await machineAuth.ensureReady();
  const skillTreeRegistry = new SkillTreeRegistry();
  const pendingInteractions = new PendingInteractionLifecycle({
    config: runtimeConfig,
    db,
    hub,
    lifecycleDedupers,
    logger,
    machineAuth,
    skillTreeRegistry,
    telemetry,
    terminalSessions,
  });
  pendingInteractions.start();

  const appVersion = createAppVersionService({
    config: runtimeConfig,
    logger,
  });
  const { app, closeWebSockets, injectWebSocket, pluginService } = createApp(
    {
      appVersion,
      patcherAppManagedConfig,
      config: runtimeConfig,
      db,
      hub,
      lifecycleDedupers,
      logger,
      machineAuth,
      pendingInteractions,
      skillTreeRegistry,
      telemetry,
      terminalSessions,
      watchInterests,
    },
    {
      // Where installed plugins run. Without this the server loads every
      // plugin into itself, which is what it did until the policy existed.
      runPluginOutOfProcess: pluginProcessPolicy({
        enabled: serverConfig.PATCHER_PLUGIN_PROCESS,
      }),
      staticDir,
    },
  );
  const eventLoopStallMonitor = startEventLoopStallMonitor({ logger });

  const sweepDeps = {
    config: runtimeConfig,
    db,
    hub,
    lifecycleDedupers,
    logger,
    machineAuth,
    pendingInteractions,
    skillTreeRegistry,
    pluginSchedules: pluginService,
    pluginService,
    telemetry,
    terminalSessions,
  };
  await runStartupRecoverySweep(sweepDeps).catch((error) => {
    logger.error({ err: error }, "Startup recovery sweep failed");
  });

  if (!isLoopbackHostname(serverConfig.PATCHER_SERVER_BIND_HOST)) {
    logger.warn(
      { bindHost: serverConfig.PATCHER_SERVER_BIND_HOST },
      "SECURITY WARNING: The public API is unauthenticated and permits command execution and file reads. Wildcard server binding must only be used behind a trusted network boundary.",
    );
  }

  const server = startHttpListener({
    fetch: app.fetch,
    serverConfig,
  });
  injectWebSocket(server);

  logger.info(
    {
      bindHost: serverConfig.PATCHER_SERVER_BIND_HOST,
      port: serverConfig.PATCHER_SERVER_PORT,
      dataDir: serverConfig.PATCHER_DATA_DIR,
    },
    "Server listening",
  );
  telemetry.capture({ name: "app_started" });

  // Plugins load after the listener is up: they are additive, and a slow
  // plugin must not delay serving. Bind the loopback SDK first so patcher.sdk is
  // usable from the moment factories run.
  pluginService.bindSdk({
    baseUrl: `http://127.0.0.1:${serverConfig.PATCHER_SERVER_PORT}`,
  });
  void pluginService.start().catch((error: unknown) => {
    logger.error({ err: error }, "Plugin startup failed");
  });

  const sweepInterval = setInterval(() => {
    void runPeriodicSweeps(sweepDeps);
  }, 10_000);
  sweepInterval.unref();

  let shutdownPromise: Promise<void> | null = null;
  const runShutdown = (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownPromise = (async () => {
      eventLoopStallMonitor.stop();
      clearInterval(sweepInterval);
      await pluginService.stop().catch((error: unknown) => {
        logger.warn({ err: error }, "Plugin shutdown failed");
      });
      const closeServer = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await closeWebSockets();
      await closeServer;
    })();
    return shutdownPromise;
  };

  process.once("SIGINT", () => {
    void runShutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void runShutdown().finally(() => process.exit(0));
  });
}
