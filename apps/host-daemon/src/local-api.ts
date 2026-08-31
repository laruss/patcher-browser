import { Buffer } from "node:buffer";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import { serve } from "@hono/node-server";
import {
  buildLocalAppOrigins,
  type BuildLocalAppOriginsArgs,
} from "@patcher/config/local-app-origins";
import {
  formatClientConfigPath,
  normalizeClientServerOrigin,
  parseClientConfig,
  resolveClientSshAuthority,
  type ClientConfig,
} from "@patcher/config/client-config";
import { assignIfDefined } from "@patcher/config/objects";
import {
  healthResponseSchema,
  HOST_DAEMON_PROTOCOL_VERSION,
  PATCHER_HOST_DAEMON_KEY_HEADER,
  openInTargetRequestSchema,
  typedRoutes,
  workspaceOpenTargetsQuerySchema,
  type HostDaemonLocalSchema,
  type OpenInTargetRequest,
  type WorkspaceOpenTarget,
  type WorkspaceOpenTargetsQuery,
} from "@patcher/host-daemon-contract";
import {
  listWorkspaceOpenTargets,
  openPathInTarget,
  type OpenPathInTargetArgs,
  WorkspaceOpenTargetError,
} from "@patcher/local-open-targets";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { isFsErrorWithCode } from "./fs-errors.js";
import type { HostDaemonLocalApiConfig } from "./local-api-config.js";
import { resolveHostPlatform } from "./host-platform.js";

/**
 * A credential for this daemon process, good until it exits.
 *
 * 32 bytes of `randomBytes`, hex — the same shape as a plugin's `.http-token`,
 * and deliberately not persisted anywhere: what makes it worth a protocol
 * change is that there is no file for a turn to read. A daemon that restarts
 * mints a new one and hands it to the server with its next session, and the app
 * refetches it after a 401.
 */
export function mintHostDaemonLocalApiKey(): string {
  return randomBytes(32).toString("hex");
}

export type WorkspaceOpenTargetListHandler = (
  query: WorkspaceOpenTargetsQuery,
) => Promise<WorkspaceOpenTarget[]>;
export type OpenInTargetHandler = (
  request: OpenPathInTargetArgs,
) => Promise<void>;

/**
 * Browser-reachable local HTTP API for colocated setups.
 *
 * Route ownership is documented in `@patcher/host-daemon-contract/src/local.ts`.
 * Some routes describe the UI/client machine, while others describe the
 * work-host machine. Remote-client support should route work-host operations
 * through the server and connected work host daemon instead of adding them to a
 * client.
 */
export interface StartLocalApiServerOptions {
  dataDir?: string;
  hostId: string;
  /**
   * What the app must present for the one route here that runs something.
   * Minted by the daemon process — see `mintHostDaemonLocalApiKey` — and handed
   * to the server at session open, which is where the app reads it from.
   */
  localApiKey: string;
  localApiConfig: HostDaemonLocalApiConfig;
  serverUrl: string;
  /** Port the Patcher server binds on (parsed from `serverUrl` upstream so the
   * daemon doesn't need to depend on server config). Used to build the CORS
   * allowlist. */
  serverPort: number;
  /** Vite dev port for the Patcher app frontend; allowed origin for CORS when set. */
  devAppPort?: number;
  /** Optional public app origin (e.g. `https://app.example.com`); allowed
   * origin for CORS when the frontend is served from a non-localhost domain. */
  appUrl?: string;
  getConnected: () => boolean;
  listWorkspaceOpenTargets?: WorkspaceOpenTargetListHandler;
  openInTarget?: OpenInTargetHandler;
}

export interface LocalApiServer {
  bindHost: string;
  port: number;
  close(): Promise<void>;
}

interface ClientConfigLoader {
  load(): Promise<ClientConfig>;
}

interface ResolveOpenPathInTargetArgs {
  configLoader: ClientConfigLoader;
  request: OpenInTargetRequest;
}

const CLIENT_CONFIG_CACHE_TTL_MS = 1_000;
const EMPTY_CLIENT_CONFIG: ClientConfig = { servers: {} };

function isNoEntryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function createClientConfigLoader(
  dataDir: string | undefined,
  nowMs: () => number = Date.now,
): ClientConfigLoader {
  let cache: {
    expiresAtMs: number;
    promise: Promise<ClientConfig>;
  } | null = null;

  return {
    async load(): Promise<ClientConfig> {
      if (dataDir === undefined) {
        return EMPTY_CLIENT_CONFIG;
      }
      const now = nowMs();
      if (cache !== null && cache.expiresAtMs > now) {
        return cache.promise;
      }
      cache = {
        expiresAtMs: now + CLIENT_CONFIG_CACHE_TTL_MS,
        promise: readClientConfig(dataDir),
      };
      return cache.promise;
    },
  };
}

async function readClientConfig(dataDir: string): Promise<ClientConfig> {
  try {
    return parseClientConfig(
      JSON.parse(await fs.readFile(formatClientConfigPath(dataDir), "utf8")),
    );
  } catch (error) {
    if (!isNoEntryError(error)) {
      throw error;
    }
    return EMPTY_CLIENT_CONFIG;
  }
}

async function isConfiguredClientOrigin(
  origin: string,
  configLoader: ClientConfigLoader,
): Promise<boolean> {
  try {
    const serverOrigin = normalizeClientServerOrigin(origin);
    const config = await configLoader.load();
    return config.servers[serverOrigin] !== undefined;
  } catch {
    return false;
  }
}

async function resolveOpenPathInTargetArgs({
  configLoader,
  request,
}: ResolveOpenPathInTargetArgs): Promise<OpenPathInTargetArgs> {
  if (request.context.kind === "local") {
    return {
      columnNumber: request.columnNumber,
      context: { kind: "local" },
      lineNumber: request.lineNumber,
      path: request.path,
      targetId: request.targetId,
    };
  }

  const serverOrigin = normalizeClientServerOrigin(
    request.context.serverOrigin,
  );
  const config = await configLoader.load();
  const sshAuthority = resolveClientSshAuthority(config, {
    serverOrigin,
    hostId: request.context.hostId,
  });
  if (sshAuthority === null) {
    throw new WorkspaceOpenTargetError({
      code: "remote_mapping_missing",
      message: `No SSH target configured for host ${request.context.hostId} on ${serverOrigin}. Run: patcher-app client ssh-target set ${serverOrigin} <ssh-target>`,
    });
  }

  return {
    columnNumber: request.columnNumber,
    context: {
      kind: "remote-ssh",
      serverOrigin,
      hostId: request.context.hostId,
      sshAuthority,
    },
    lineNumber: request.lineNumber,
    path: request.path,
    targetId: request.targetId,
  };
}

export async function startLocalApiServer(
  options: StartLocalApiServerOptions,
): Promise<LocalApiServer> {
  const app = new Hono();
  const clientConfigLoader = createClientConfigLoader(options.dataDir);
  const originArgs: BuildLocalAppOriginsArgs = {
    serverPort: options.serverPort,
  };
  assignIfDefined({
    key: "appUrl",
    target: originArgs,
    value: options.appUrl,
  });
  assignIfDefined({
    key: "devAppPort",
    target: originArgs,
    value: options.devAppPort,
  });
  const allowedCorsOrigins = new Set<string>(buildLocalAppOrigins(originArgs));
  app.use(
    "*",
    cors({
      origin: async (origin, context) => {
        const requestOrigin = new URL(context.req.url).origin;
        if (
          origin === requestOrigin ||
          allowedCorsOrigins.has(origin) ||
          (await isConfiguredClientOrigin(origin, clientConfigLoader))
        ) {
          return origin;
        }
        return null;
      },
      // The daemon's key is not a safelisted request header, so every call
      // from the app is preflighted — and without this, at a ~5s browser
      // default, that is two round trips per call rather than one. What the
      // preflight answers does not change for the life of the process.
      maxAge: 600,
    }),
  );

  app.get(options.localApiConfig.healthPath, (c) =>
    c.text(healthResponseSchema.parse(options.localApiConfig.healthValue)),
  );
  app.use("*", async (c, next) => {
    if (options.localApiConfig.mode === "health-only") {
      return c.notFound();
    }
    await next();
  });

  /**
   * Who is calling the one route on this API that does something.
   *
   * `POST /open-in-target` ends in an `execFile` on the host — outside the
   * sandbox of whatever turn is running, as the user — and an agent mid-turn is
   * handed `PATCHER_HOST_DAEMON_PORT` in its environment while its sandbox
   * permits loopback. CORS did not stand in the way of that: it is a browser
   * control and does nothing to a `curl`.
   *
   * **Only that route.** The first version of this gate covered the whole API
   * and broke three supported topologies, because it asked for a credential the
   * caller cannot always have. `/status` is what every readiness probe reads —
   * the launcher, `install-machine.sh`, the SDK's local-host lookup, the app's
   * reachability check, the dev restart — and gating a side-effect-free read
   * bought nothing and cost enrolment. Listing editors is a read too, and the
   * menu it fills is the same shape.
   *
   * **And not the app key any more.** It was the wrong credential in both
   * directions. A machine enrolled from another one has no app key file at all
   * — nothing writes one into its data dir — so the app was refused on exactly
   * the machine it was running on; and the key *is* a file, so a turn that
   * builds no sandbox, or one whose provider leaves reads open, could read it
   * and present it. What this takes instead exists only in this process's
   * memory and reaches the app through the server, which is a credential the
   * daemon can have and a turn cannot go and find.
   */
  const expectedLocalApiKey = Buffer.from(options.localApiKey, "utf8");
  /**
   * Takes the presented header rather than a context: a narrower input, and the
   * typed route's context is not hono's own.
   */
  const requireLocalApiKey = (presented: string | undefined): void => {
    const offered =
      presented === undefined ? undefined : Buffer.from(presented, "utf8");
    if (
      offered === undefined ||
      // Byte length, not string length: `timingSafeEqual` throws on a mismatch,
      // and a header of the same character count in multi-byte characters is
      // not the same number of bytes — comparing the strings turned a refusal
      // into a 500. Same shape as `createAppApiIdentity` in the server.
      offered.length !== expectedLocalApiKey.length ||
      !timingSafeEqual(offered, expectedLocalApiKey)
    ) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
  };

  const { get, post } = typedRoutes<HostDaemonLocalSchema>(app);
  const platform = resolveHostPlatform();

  get("/status", (c) =>
    c.json({
      hostId: options.hostId,
      connected: options.getConnected(),
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      serverUrl: options.serverUrl,
      supportsNativeFolderPicker: platform === "darwin",
      platform,
    }),
  );

  get(
    "/workspace-open-targets",
    workspaceOpenTargetsQuerySchema,
    async (c, query) =>
      c.json({
        targets: await (
          options.listWorkspaceOpenTargets ?? listWorkspaceOpenTargets
        )(query),
      }),
  );

  post("/open-in-target", openInTargetRequestSchema, async (c, payload) => {
    requireLocalApiKey(c.req.header(PATCHER_HOST_DAEMON_KEY_HEADER));
    try {
      await (options.openInTarget ?? openPathInTarget)(
        await resolveOpenPathInTargetArgs({
          configLoader: clientConfigLoader,
          request: payload,
        }),
      );
    } catch (error) {
      if (error instanceof WorkspaceOpenTargetError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }

    return c.json({});
  });

  let boundServer: {
    server: ReturnType<typeof serve>;
    port: number;
  };
  try {
    boundServer = await new Promise<{
      server: ReturnType<typeof serve>;
      port: number;
    }>((resolve, reject) => {
      const s = serve(
        {
          fetch: app.fetch,
          port: options.localApiConfig.port,
          hostname: options.localApiConfig.bindHost,
        },
        (info) => resolve({ server: s, port: info.port }),
      );
      s.on("error", reject);
    });
  } catch (error) {
    if (isFsErrorWithCode(error, "EADDRINUSE")) {
      throw new Error(
        `Host daemon local API port ${options.localApiConfig.port} is already in use on ${options.localApiConfig.bindHost}. Choose another port with --host-daemon-port <port>.`,
        { cause: error },
      );
    }
    throw error;
  }

  const { server, port: boundPort } = boundServer;

  return {
    bindHost: options.localApiConfig.bindHost,
    port: boundPort,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
