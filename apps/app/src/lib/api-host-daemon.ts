import {
  createHostDaemonLocalClient,
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
  workspaceOpenTargetsResponseSchema,
  type OpenInTargetRequest,
  type StatusResponse,
  type WorkspaceOpenTarget,
} from "@patcher/host-daemon-contract";
import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import { z } from "zod";
import { appKey } from "./app-key";

let client: ReturnType<typeof createHostDaemonLocalClient> | null = null;
let clientPort: number | null = null;

export interface HostDaemonStatusSnapshot extends StatusResponse {}

const hostDaemonErrorResponseSchema = z.object({
  message: z.string().min(1),
});

/**
 * Signs a daemon request as this install's app client.
 *
 * The daemon's local API refuses an unidentified caller, for the reason its own
 * middleware gives: an agent mid-turn is handed the daemon's port and can reach
 * loopback, and `POST /open-in-target` ends in an `execFile` on the host outside
 * the turn's sandbox. The global key wrapper in `app-key-fetch.ts` covers
 * same-origin `/api/v1` only, on purpose, so this attaches the header explicitly
 * for the one other surface that takes it.
 */
function hostDaemonFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const key = appKey();
  if (key === undefined) return fetch(input, init);
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (!headers.has(PATCHER_APP_KEY_HEADER)) {
    headers.set(PATCHER_APP_KEY_HEADER, key);
  }
  return fetch(input, { ...init, headers });
}

/**
 * Get or create the host daemon client.
 * Recreates the client if the port changes.
 */
export function getHostDaemonClient(port: number) {
  if (!client || clientPort !== port) {
    client = createHostDaemonLocalClient(
      `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${port}`,
      { fetch: hostDaemonFetch },
    );
    clientPort = port;
  }
  return client;
}

/**
 * Fetch local daemon status.
 * Returns null if the daemon is unreachable.
 */
export async function fetchHostStatus(
  port: number,
): Promise<HostDaemonStatusSnapshot | null> {
  try {
    const daemon = getHostDaemonClient(port);
    const res = await daemon.status.$get();
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Fetch the local connected server-session host ID from the daemon. */
export async function fetchHostId(port: number): Promise<string | null> {
  const status = await fetchHostStatus(port);
  if (!status?.connected) {
    return null;
  }
  return status.hostId;
}

export async function fetchWorkspaceOpenTargets(
  port: number,
  options: { path?: string } = {},
): Promise<WorkspaceOpenTarget[]> {
  const daemon = getHostDaemonClient(port);
  const res = await daemon["workspace-open-targets"].$get({
    query: options.path === undefined ? {} : { path: options.path },
  });
  const status = Number(res.status);
  if (status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`Workspace open target discovery failed: HTTP ${status}`);
  }
  const body = await res.json();
  return workspaceOpenTargetsResponseSchema.parse(body).targets;
}

export async function openInTarget(
  port: number,
  request: OpenInTargetRequest,
): Promise<void> {
  const daemon = getHostDaemonClient(port);
  const res = await daemon["open-in-target"].$post({
    json: request,
  });
  if (!res.ok) {
    const status = Number(res.status);
    throw new Error(
      await readHostDaemonErrorMessage(
        res,
        `Failed to open target: HTTP ${status}`,
      ),
    );
  }
}

async function readHostDaemonErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const text = await response.text().catch(() => "");
  const trimmedText = text.trim();
  if (trimmedText === "") {
    return fallbackMessage;
  }

  try {
    const parsed = hostDaemonErrorResponseSchema.safeParse(
      JSON.parse(trimmedText),
    );
    if (parsed.success) {
      return parsed.data.message;
    }
  } catch {
    return trimmedText;
  }

  return trimmedText;
}
