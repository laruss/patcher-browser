import {
  createHostDaemonLocalClient,
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
  PATCHER_HOST_DAEMON_KEY_HEADER,
  workspaceOpenTargetsResponseSchema,
  type OpenInTargetRequest,
  type StatusResponse,
  type WorkspaceOpenTarget,
} from "@patcher/host-daemon-contract";
import { z } from "zod";
import { hostDaemonKeyResponseSchema } from "@patcher/server-contract";
import { apiClient } from "./api-server";

let client: ReturnType<typeof createHostDaemonLocalClient> | null = null;
let clientPort: number | null = null;

export interface HostDaemonStatusSnapshot extends StatusResponse {}

const hostDaemonErrorResponseSchema = z.object({
  message: z.string().min(1),
});

/**
 * Get or create the host daemon client.
 * Recreates the client if the port changes.
 *
 * Unsigned: everything this client reads — health, status, the editor list — is
 * open to any caller on loopback on purpose, because every readiness probe reads
 * the first two and a machine enrolled from another one can present nothing at
 * all. The one route that runs something takes a credential of its own, through
 * `signedHostDaemonClient` below.
 */
export function getHostDaemonClient(port: number) {
  if (!client || clientPort !== port) {
    client = createHostDaemonLocalClient(
      `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${port}`,
    );
    clientPort = port;
  }
  return client;
}

function signedHostDaemonClient(port: number, daemonKey: string) {
  return createHostDaemonLocalClient(
    `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${port}`,
    {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set(PATCHER_HOST_DAEMON_KEY_HEADER, daemonKey);
        return fetch(input, { ...init, headers });
      },
    },
  );
}

/**
 * What the daemon on this machine expects for its one executing route.
 *
 * Not the app key. That key is a file on disk, absent on a machine enrolled from
 * another one — which is how the app ended up refused on the very machine it was
 * running on — and readable by a turn that builds no sandbox. The daemon mints
 * its own per process, keeps it in memory, and hands it to the server when it
 * opens its session; this reads it back from the server, which is the only party
 * that has it. See `docs/security.md`.
 *
 * Cached per machine because it does not change while that daemon runs. A
 * restarted daemon mints a new one, so a 401 refetches once rather than asking
 * the person to reload the app.
 */
const hostDaemonKeysByHostId = new Map<string, string>();

async function fetchHostDaemonKey(
  hostId: string,
  options: { refresh?: boolean } = {},
): Promise<string | undefined> {
  if (options.refresh !== true) {
    const cached = hostDaemonKeysByHostId.get(hostId);
    if (cached !== undefined) return cached;
  }
  hostDaemonKeysByHostId.delete(hostId);
  const res = await apiClient["host-daemon-keys"][":hostId"].$get({
    param: { hostId },
  });
  if (!res.ok) return undefined;
  const { key } = hostDaemonKeyResponseSchema.parse(await res.json());
  hostDaemonKeysByHostId.set(hostId, key);
  return key;
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
  // Which machine's daemon this is, before asking the server what it expects:
  // the port is the same number everywhere, so the answer has to come from the
  // daemon that actually answered on it.
  const daemonStatus = await fetchHostStatus(port);
  if (daemonStatus === null) {
    throw new Error("The Patcher daemon on this machine is not reachable.");
  }
  const attempt = async (refresh: boolean) => {
    const daemonKey = await fetchHostDaemonKey(daemonStatus.hostId, {
      refresh,
    });
    if (daemonKey === undefined) {
      throw new Error(
        "This machine's daemon has no session open with the server, so the server has no key for its local API. Reconnect the machine and try again.",
      );
    }
    return signedHostDaemonClient(port, daemonKey)["open-in-target"].$post({
      json: request,
    });
  };
  // A daemon that restarted since the key was cached expects a new one, and the
  // only way to tell is to be refused: refetch once, then take the answer.
  let res = await attempt(false);
  if (Number(res.status) === 401) {
    res = await attempt(true);
  }
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
