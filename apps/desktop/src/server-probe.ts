import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import { z } from "zod";

const healthResponseSchema = z
  .object({
    ok: z.boolean(),
  })
  .passthrough();

const systemConfigResponseSchema = z
  .object({
    // Optional on purpose: the probed server can be an older Patcher that predates
    // this field, and it is still compatible enough to attach to.
    dataDir: z.string().min(1).optional(),
    hostDaemonPort: z.number().int().min(1).max(65_535),
    voiceTranscriptionEnabled: z.boolean(),
  })
  .passthrough();

export type ServerProbeResult =
  | CompatibleServerProbeResult
  | IncompatibleServerProbeResult
  | UnavailableServerProbeResult;

export type ServerProbeFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface CompatibleServerProbeResult {
  /** Data directory the probed server reports, or null on an older Patcher. */
  dataDir: string | null;
  kind: "compatible";
  serverUrl: string;
}

export interface IncompatibleServerProbeResult {
  kind: "incompatible";
  reason: string;
  serverUrl: string;
}

export interface UnavailableServerProbeResult {
  kind: "unavailable";
  reason: string;
  serverUrl: string;
}

export interface ProbePatcherServerArgs {
  /**
   * Identifies this shell to `/api/v1`, which refuses a request that
   * identifies itself as nothing. `/health` stays anonymous — a launcher polls
   * it before anything exists — so a probe with no key still finds the server
   * and then says plainly that it cannot read its config.
   *
   * Absent for a server whose data dir this machine cannot read, which is what
   * a custom remote target is. `PATCHER_APP_KEY` is how that one is supplied.
   */
  appApiKey?: string;
  fetchImpl?: ServerProbeFetch;
  serverUrl: string;
  timeoutMs: number;
}

export interface WaitForCompatibleServerArgs {
  /**
   * Resolved per attempt rather than taken as a value: this waits for a server
   * that is still starting, and the key file appears when it does. A key read
   * once, before the first poll, would be the `undefined` from before the
   * server existed — for every attempt after it.
   */
  appApiKey?: () => string | undefined;
  intervalMs: number;
  serverUrl: string;
  timeoutMs: number;
}

interface FetchJsonArgs<TValue> {
  fetchImpl: ServerProbeFetch;
  headers?: Record<string, string>;
  schema: z.ZodType<TValue>;
  timeoutMs: number;
  url: string;
}

type FetchJsonResult<TValue> =
  | FetchJsonHttpErrorResult
  | FetchJsonNetworkErrorResult
  | FetchJsonSchemaErrorResult
  | FetchJsonSuccessResult<TValue>;

type FetchJsonFailureResult =
  | FetchJsonHttpErrorResult
  | FetchJsonNetworkErrorResult
  | FetchJsonSchemaErrorResult;

interface FetchJsonSuccessResult<TValue> {
  kind: "success";
  value: TValue;
}

interface FetchJsonHttpErrorResult {
  kind: "http-error";
  status: number;
}

interface FetchJsonSchemaErrorResult {
  kind: "schema-error";
  message: string;
}

interface FetchJsonNetworkErrorResult {
  kind: "network-error";
  message: string;
}

interface SleepArgs {
  delayMs: number;
}

async function sleep(args: SleepArgs): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, args.delayMs);
  });
}

function endpointUrl(serverUrl: string, path: string): string {
  return new URL(path, serverUrl).toString();
}

async function fetchJson<TValue>(
  args: FetchJsonArgs<TValue>,
): Promise<FetchJsonResult<TValue>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, args.timeoutMs);

  try {
    const response = await args.fetchImpl(args.url, {
      ...(args.headers === undefined ? {} : { headers: args.headers }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        kind: "http-error",
        status: response.status,
      };
    }

    const parsed = args.schema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        kind: "schema-error",
        message: parsed.error.message,
      };
    }

    return {
      kind: "success",
      value: parsed.data,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: "network-error",
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function formatFetchFailure(result: FetchJsonFailureResult): string {
  if (result.kind === "http-error") {
    return `HTTP ${result.status}`;
  }
  return result.message;
}

export async function probePatcherServer(
  args: ProbePatcherServerArgs,
): Promise<ServerProbeResult> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const healthResult = await fetchJson({
    fetchImpl,
    schema: healthResponseSchema,
    timeoutMs: args.timeoutMs,
    url: endpointUrl(args.serverUrl, "/health"),
  });

  if (healthResult.kind === "network-error") {
    return {
      kind: "unavailable",
      reason: healthResult.message,
      serverUrl: args.serverUrl,
    };
  }

  if (healthResult.kind !== "success") {
    return {
      kind: "incompatible",
      reason: `/health returned ${formatFetchFailure(healthResult)}`,
      serverUrl: args.serverUrl,
    };
  }

  if (!healthResult.value.ok) {
    return {
      kind: "incompatible",
      reason: "/health did not report ok=true",
      serverUrl: args.serverUrl,
    };
  }

  const configResult = await fetchJson({
    fetchImpl,
    ...(args.appApiKey === undefined
      ? {}
      : { headers: { [PATCHER_APP_KEY_HEADER]: args.appApiKey } }),
    schema: systemConfigResponseSchema,
    timeoutMs: args.timeoutMs,
    url: endpointUrl(args.serverUrl, "/api/v1/system/config"),
  });

  if (configResult.kind === "http-error" && configResult.status === 401) {
    // Named on its own, because it is the one failure a user can act on: the
    // server is there and healthy and this shell has not been given its key.
    return {
      kind: "incompatible",
      reason:
        "/api/v1/system/config refused this app: no valid app key. Set " +
        "PATCHER_APP_KEY to the contents of `app-api-key` in that server's " +
        "data directory.",
      serverUrl: args.serverUrl,
    };
  }

  if (configResult.kind !== "success") {
    return {
      kind: "incompatible",
      reason: `/api/v1/system/config returned ${formatFetchFailure(configResult)}`,
      serverUrl: args.serverUrl,
    };
  }

  return {
    dataDir: configResult.value.dataDir ?? null,
    kind: "compatible",
    serverUrl: args.serverUrl,
  };
}

export async function waitForCompatibleServer(
  args: WaitForCompatibleServerArgs,
): Promise<ServerProbeResult> {
  const deadline = Date.now() + args.timeoutMs;
  let lastResult: ServerProbeResult = {
    kind: "unavailable",
    reason: "Probe has not started",
    serverUrl: args.serverUrl,
  };

  while (Date.now() <= deadline) {
    const appApiKey = args.appApiKey?.();
    lastResult = await probePatcherServer({
      ...(appApiKey === undefined ? {} : { appApiKey }),
      serverUrl: args.serverUrl,
      timeoutMs: Math.min(args.intervalMs, 1_000),
    });

    if (lastResult.kind === "compatible") {
      return lastResult;
    }

    if (lastResult.kind === "incompatible") {
      return lastResult;
    }

    await sleep({ delayMs: args.intervalMs });
  }

  return {
    kind: "unavailable",
    reason: `Timed out after ${args.timeoutMs}ms waiting for Patcher server. Last probe: ${lastResult.reason}`,
    serverUrl: args.serverUrl,
  };
}
