import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import type { DbConnection } from "@patcher/db";
import { defaultFeatureFlags, type HostType } from "@patcher/domain";
import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import type { Hono } from "hono";
import { initDb } from "../../src/db.js";
import { createApp } from "../../src/server.js";
import { PendingInteractionLifecycle } from "../../src/services/interactions/pending-interactions.js";
import { createMachineAuthService } from "../../src/services/machine-auth.js";
import type { PluginPlacementInput } from "../../src/services/plugins/plugin-placement.js";
import { SkillTreeRegistry } from "../../src/services/skills/injected-skills.js";
import {
  createAppVersionService,
  type AppVersionService,
} from "../../src/services/system/app-version.js";
import { createPatcherAppManagedConfigReloader } from "../../src/services/system/patcher-app-managed-config.js";
import { createNoopTelemetryService } from "../../src/services/system/telemetry.js";
import { TerminalSessionLifecycle } from "../../src/services/terminals/terminal-session-lifecycle.js";
import { resolveThreadStorageRootPath } from "../../src/services/threads/thread-storage.js";
import { createLifecycleDedupers } from "../../src/lifecycle-dedupers.js";
import type { ServerAppDeps, ServerRuntimeConfig } from "../../src/types.js";
import { MANAGED_ENVIRONMENT_RETIRE_GRACE_MS } from "../../src/constants.js";
import type { NotificationHub } from "../../src/ws/hub.js";
import { NotificationHub as NotificationHubImpl } from "../../src/ws/hub.js";
import { WatchInterestCoordinator } from "../../src/ws/watch-interests.js";

const TEST_MACHINE_KEY_PREFIX = "test-daemon-key";
const TEST_SERVER_HOST = "127.0.0.1";

/**
 * What this harness's clients present to `/api/v1` and `/ws`.
 *
 * Fixed rather than random so a test can write the header itself when it is
 * testing the gate rather than passing through it. Everything else gets it
 * added for free by `withAppKey` below.
 */
export const TEST_APP_API_KEY = "test-app-api-key";

/** The header a raw `fetch` or a websocket in a test has to send. */
export function testAppKeyHeaders(): Record<string, string> {
  return { [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY };
}

/**
 * `fetch`, as a client this install knows. For tests that go over a real
 * socket to `startTestServer`'s `baseUrl` rather than through `app.request`.
 */
export function appFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has(PATCHER_APP_KEY_HEADER)) {
    headers.set(PATCHER_APP_KEY_HEADER, TEST_APP_API_KEY);
  }
  return fetch(input, { ...init, headers });
}

/**
 * `app.request(...)`, with this harness's app key on it.
 *
 * Wrapped centrally because the alternative is the same header on ~700 call
 * sites. A test that sets the header itself wins, which is what lets the
 * app-identity tests send a wrong key or none at all.
 */
export function withTestAppKey<T extends Hono>(app: T): T {
  const request = app.request.bind(app) as Hono["request"];
  const wrappedRequest: Hono["request"] = (
    input,
    requestInit,
    Env,
    executionCtx,
  ) => {
    const headers = new Headers(requestInit?.headers);
    if (!headers.has(PATCHER_APP_KEY_HEADER)) {
      headers.set(PATCHER_APP_KEY_HEADER, TEST_APP_API_KEY);
    }
    return request(
      input as never,
      { ...requestInit, headers },
      Env,
      executionCtx,
    );
  };
  // `fetch` as well as `request`: they are two entry points and tests use
  // both — `fetch` whenever a test builds the `Request` itself.
  const fetchApp = app.fetch.bind(app) as Hono["fetch"];
  const wrappedFetch: Hono["fetch"] = (input, Env, executionCtx) => {
    if (input.headers.has(PATCHER_APP_KEY_HEADER)) {
      return fetchApp(input, Env, executionCtx);
    }
    const headers = new Headers(input.headers);
    headers.set(PATCHER_APP_KEY_HEADER, TEST_APP_API_KEY);
    return fetchApp(new Request(input, { headers }), Env, executionCtx);
  };
  return new Proxy(app, {
    get(target, property, receiver) {
      if (property === "request") return wrappedRequest;
      if (property === "fetch") return wrappedFetch;
      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as T;
}

export interface TestAppHarness {
  app: ReturnType<typeof createApp>["app"];
  config: ServerRuntimeConfig;
  db: DbConnection;
  deps: ServerAppDeps;
  hub: NotificationHub;
  pluginService: ReturnType<typeof createApp>["pluginService"];
  pluginCatalogService: ReturnType<typeof createApp>["pluginCatalogService"];
  cleanup(): Promise<void>;
}

export interface RunningTestServer extends TestAppHarness {
  baseUrl: string;
  close(): Promise<void>;
}

export type TestAppHarnessConfigOverrides = Partial<ServerRuntimeConfig> & {
  appVersionService?: AppVersionService;
  runPluginOutOfProcess?: (plugin: PluginPlacementInput) => boolean;
  terminalCloseTimeoutMs?: number;
};

export const testLogger = {
  debug(): void {},
  error(): void {},
  info(): void {},
  warn(): void {},
};

interface TestDaemonKeyParts {
  hostId: string;
  hostType: HostType;
}

function encodeTestDaemonKey(args: TestDaemonKeyParts): string {
  return `${TEST_MACHINE_KEY_PREFIX}:${args.hostType}:${args.hostId}`;
}

function decodeTestDaemonKey(token: string): TestDaemonKeyParts | null {
  const parts = token.split(":");
  if (parts.length !== 3 || parts[0] !== TEST_MACHINE_KEY_PREFIX) {
    return null;
  }

  const hostType = parts[1];
  const hostId = parts[2];
  if (hostType !== "persistent" || hostId.length === 0) {
    return null;
  }

  return {
    hostId,
    hostType,
  };
}

export function createTestDaemonHostKey(
  args: Partial<TestDaemonKeyParts> = {},
): string {
  return encodeTestDaemonKey({
    hostId: args.hostId ?? "host-1",
    hostType: args.hostType ?? "persistent",
  });
}

export async function createTestAppHarness(
  overrides: TestAppHarnessConfigOverrides = {},
): Promise<TestAppHarness> {
  const {
    appVersionService,
    runPluginOutOfProcess,
    terminalCloseTimeoutMs,
    ...configOverrides
  } = overrides;
  const dataDir = await mkdtemp(join(tmpdir(), "patcher-server-test-"));
  const db = initDb(":memory:");
  const hub = new NotificationHubImpl();
  const watchInterests = new WatchInterestCoordinator({ db, hub });
  const lifecycleDedupers = createLifecycleDedupers();
  const machineAuth = await createMachineAuthService({
    dataDir,
    db,
    logger: testLogger,
  });
  await machineAuth.ensureReady();
  const testMachineAuth = {
    ...machineAuth,
    async verifyDaemonHostKey(token: string) {
      const testKey = decodeTestDaemonKey(token);
      if (testKey) {
        return {
          keyId: `test:${testKey.hostType}:${testKey.hostId}`,
          metadata: testKey,
        };
      }
      return machineAuth.verifyDaemonHostKey(token);
    },
  };
  const config: ServerRuntimeConfig = {
    appSurface: "web",
    appVersion: "0.0.0-test",
    builtinSkillsRootPath: join(dataDir, "builtin-skills"),
    customAcpAgents: [],
    customModels: [],
    dataDir,
    featureFlags: defaultFeatureFlags,
    hostDaemonPort: 3001,
    inheritedSkillsRootPaths: [],
    inferenceFallbackModel: "test/mock-fallback-model",
    inferenceModel: "test/mock-model",
    isDevelopment: true,
    managedEnvironmentRetireGraceMs: MANAGED_ENVIRONMENT_RETIRE_GRACE_MS,
    openAiApiKey: "test-openai-key",
    serverPort: 3334,
    sharedSkillRoots: { user: [], project: [] },
    threadStorageRootPath: resolveThreadStorageRootPath({
      dataDir,
      env: {},
    }),
    transcriptionModel: "test/mock-transcription",
    appUrl: "https://patcher.example.test",
    ...configOverrides,
  };
  const terminalSessions = new TerminalSessionLifecycle({
    attachTimeoutMs: 50,
    ...(terminalCloseTimeoutMs === undefined
      ? {}
      : { closeTimeoutMs: terminalCloseTimeoutMs }),
    config,
    db,
    hub,
    logger: testLogger,
    openTimeoutMs: 50,
  });
  const patcherAppManagedConfig = await createPatcherAppManagedConfigReloader({
    config,
    hub,
    logger: testLogger,
  });
  const telemetry = createNoopTelemetryService();
  const skillTreeRegistry = new SkillTreeRegistry();
  const pendingInteractions = new PendingInteractionLifecycle({
    config,
    db,
    hub,
    lifecycleDedupers,
    logger: testLogger,
    machineAuth: testMachineAuth,
    skillTreeRegistry,
    telemetry,
    terminalSessions,
  });
  pendingInteractions.start();
  const appVersion =
    appVersionService ??
    createAppVersionService({
      config,
      logger: testLogger,
    });
  const deps: ServerAppDeps = {
    appVersion,
    appApiKey: TEST_APP_API_KEY,
    patcherAppManagedConfig,
    config,
    db,
    hub,
    lifecycleDedupers,
    logger: testLogger,
    machineAuth: testMachineAuth,
    pendingInteractions,
    skillTreeRegistry,
    telemetry,
    terminalSessions,
    watchInterests,
  };
  const { app, pluginCatalogService, pluginService } = createApp(
    deps,
    runPluginOutOfProcess === undefined ? undefined : { runPluginOutOfProcess },
  );

  return {
    app: withTestAppKey(app),
    config,
    db,
    deps,
    hub,
    pluginService,
    pluginCatalogService,
    async cleanup(): Promise<void> {
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * `createApp`, with this harness's app key already on the returned app.
 *
 * For the tests that build their own app rather than taking the harness's —
 * they are testing the server's plumbing, not its front door, and should not
 * each have to remember the header.
 */
export function createTestApp(
  ...args: Parameters<typeof createApp>
): ReturnType<typeof createApp> {
  const created = createApp(...args);
  return { ...created, app: withTestAppKey(created.app) };
}

export async function withTestHarness<T>(
  run: (harness: TestAppHarness) => Promise<T>,
): Promise<T>;
export async function withTestHarness<T>(
  overrides: TestAppHarnessConfigOverrides,
  run: (harness: TestAppHarness) => Promise<T>,
): Promise<T>;
export async function withTestHarness<T>(
  overridesOrRun:
    | TestAppHarnessConfigOverrides
    | ((harness: TestAppHarness) => Promise<T>),
  maybeRun?: (harness: TestAppHarness) => Promise<T>,
): Promise<T> {
  const overrides: TestAppHarnessConfigOverrides =
    typeof overridesOrRun === "function" ? {} : overridesOrRun;
  const run = typeof overridesOrRun === "function" ? overridesOrRun : maybeRun;
  if (!run) {
    throw new Error("withTestHarness requires a run callback");
  }
  const harness = await createTestAppHarness(overrides);
  try {
    return await run(harness);
  } finally {
    await harness.cleanup();
  }
}

export async function startTestServer(
  overrides: TestAppHarnessConfigOverrides = {},
): Promise<RunningTestServer> {
  const harness = await createTestAppHarness(overrides);
  let addressInfo: AddressInfo | null = null;
  const { app, closeWebSockets, injectWebSocket, pluginService } = createApp(
    harness.deps,
  );
  const server = serve(
    {
      // The client always connects to 127.0.0.1, so bind the test server to
      // 127.0.0.1 too. If we leave the host unspecified, this server can end
      // up on ::1 while another local process owns 127.0.0.1 on the same
      // port, and the client will hit that other process instead.
      hostname: TEST_SERVER_HOST,
      port: 0,
      fetch: app.fetch,
    },
    (info) => {
      addressInfo = info;
    },
  );
  injectWebSocket(server);

  while (!addressInfo) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const resolvedAddress: AddressInfo = addressInfo;
  harness.config.serverPort = resolvedAddress.port;

  return {
    ...harness,
    app: withTestAppKey(app),
    pluginService,
    baseUrl: `http://${TEST_SERVER_HOST}:${resolvedAddress.port}`,
    async close(): Promise<void> {
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
      await harness.cleanup();
    },
  };
}
