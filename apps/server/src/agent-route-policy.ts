/**
 * What a turn's agent may not reach through `/api/v1`.
 *
 * An agent runs inside a workspace sandbox, and until it held a credential of
 * its own it also held the app key — so the sandbox bounded what its own tools
 * could touch while the API next to it offered the same machine unbounded. The
 * routes below are the ones that handed it straight back:
 *
 * - **File mutation.** `rootPath` is optional on these, and without it the
 *   daemon writes wherever it is told. A sandbox that restricts writes to the
 *   workspace means nothing beside a write-anywhere RPC.
 * - **Terminals.** Creating one is a PTY on the host, outside any sandbox,
 *   running as the user. It is the shortest way out that exists.
 * - **A machine's permission ceiling.** Raising it is how a sandboxed turn
 *   would arrange to stop being one. It was already meant to be app-only —
 *   deliberately absent from the SDK and the CLI — and this is what makes that
 *   true of an agent that calls the route directly.
 *
 * Reads are not here. An agent reads files through its own tools anyway, and
 * `files/read` under the same policy would be a gate on the polite path only.
 *
 * Everything else stays reachable, including the plugin routes: those already
 * stop and ask the person in the thread, which is a better answer than a
 * refusal for the one thing an agent is expected to do.
 *
 * Both halves of a denial matter for how it reads to whoever hits it, so the
 * message names the route and the reason rather than saying "forbidden".
 */

export interface AgentRoutePolicyDenial {
  /** Path prefix that denied the request, for logs and tests. */
  route: string;
  /** What the caller is told, with the reason and the way to do it properly. */
  message: string;
}

interface DeniedAgentRoute {
  /** Matches this exact `/api/v1`-relative path, or anything under it. */
  path: string;
  /** Methods that mutate. A GET on the same path stays readable. */
  methods: readonly string[];
  reason: string;
}

const MUTATION_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

const DENIED_AGENT_ROUTES: readonly DeniedAgentRoute[] = [
  {
    path: "/files/write",
    methods: MUTATION_METHODS,
    reason:
      "it writes to any path on the machine, which would step around the workspace sandbox this turn runs in",
  },
  {
    path: "/files/mkdir",
    methods: MUTATION_METHODS,
    reason:
      "it creates directories at any path on the machine, which would step around the workspace sandbox this turn runs in",
  },
  {
    path: "/files/move",
    methods: MUTATION_METHODS,
    reason:
      "it moves files across any path on the machine, which would step around the workspace sandbox this turn runs in",
  },
  {
    path: "/files/remove",
    methods: MUTATION_METHODS,
    reason:
      "it removes files at any path on the machine, which would step around the workspace sandbox this turn runs in",
  },
  {
    path: "/terminals",
    methods: MUTATION_METHODS,
    reason:
      "it opens a shell on the host outside this turn's sandbox, running as the user",
  },
  {
    path: "/hosts",
    methods: MUTATION_METHODS,
    reason:
      "a machine's permission ceiling is the limit this turn runs under, and is the owner's to change",
  },
];

/**
 * `/hosts` covers more than the ceiling, so only the ceiling sub-route is
 * denied under it. Kept as a suffix test rather than a separate entry, because
 * the id in the middle makes an exact path impossible.
 */
const HOSTS_ROUTE_DENIED_SUFFIX = "/permission-ceiling";

function pathMatches(requestPath: string, route: DeniedAgentRoute): boolean {
  if (!requestPath.startsWith(route.path)) return false;
  const rest = requestPath.slice(route.path.length);
  if (rest.length > 0 && !rest.startsWith("/")) return false;
  if (route.path === "/hosts") return rest.endsWith(HOSTS_ROUTE_DENIED_SUFFIX);
  return true;
}

export interface AgentRoutePolicyRequest {
  /** Request path, with or without the `/api/v1` prefix. */
  path: string;
  method: string;
}

/** Same normalization `permissionsForApiPath` applies, for the same reason. */
function normalizePath(path: string): string {
  return (
    path.startsWith("/api/v1") ? path.slice("/api/v1".length) : path
  ).replace(/\/+$/, "");
}

/**
 * Why this request is refused for an agent, or null when it may proceed.
 */
export function agentRoutePolicyDenial(
  request: AgentRoutePolicyRequest,
): AgentRoutePolicyDenial | null {
  const method = request.method.toUpperCase();
  const path = normalizePath(request.path);
  for (const route of DENIED_AGENT_ROUTES) {
    if (!route.methods.includes(method)) continue;
    if (!pathMatches(path, route)) continue;
    return {
      route: route.path,
      message: `An agent mid-turn cannot call ${method} ${path}: ${route.reason}. Ask the person in the thread to do it, or work inside the workspace.`,
    };
  }
  return null;
}
