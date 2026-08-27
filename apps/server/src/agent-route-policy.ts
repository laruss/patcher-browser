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
 * - **A machine's permission ceiling, machine enrolment, and provider-CLI
 *   installs.** Raising the ceiling is how a sandboxed turn would arrange to
 *   stop being one; an install runs an installer on the host outside the
 *   sandbox. All three were already meant to be app-only — deliberately absent
 *   from the SDK and the CLI — and this is what makes that true of an agent
 *   that calls the route directly.
 *
 * Approving a thread's prompts from inside the turn that raised them is refused
 * too — a turn that can resolve its own approval interaction can approve its own
 * unsandboxed retry, and the timeline then records the user as having allowed it.
 * That one lives in `routes/threads/interactions.ts` rather than here, because
 * only the handler can tell an approval *decision* from an answer to a question:
 * `patcher thread interactions approve --self` and its siblings are an agent
 * affordance, and a route-level denial would take the harmless ones with it.
 *
 * Generic reads are not here, and that is a judgement rather than a proof: an
 * agent reads files through its own tools anyway, so `files/read` under this
 * policy would gate the polite path only. What *is* closed is the one read that
 * mattered — the daemon refuses to serve Patcher's own credential files over the
 * host file RPC at all (`command-handlers/daemon-credential-paths.ts`), for
 * every caller, because that read happens outside the sandbox and so the
 * sandbox's `credentials.files` deny could not see it.
 *
 * **Known gaps, deliberately left rather than papered over.** The resolved
 * thread id is not compared with the `:id` a request acts on, so an agent can
 * still drive another thread (`/threads/:id/send` and friends) — narrowing that
 * would take away `patcher thread spawn`, which agents are meant to have.
 * `permissionMode` on thread create/send/fork is bounded only by the machine
 * ceiling, and `workspace: { type: "unmanaged", path }` lets a caller choose
 * where the next turn's sandbox points. `/plugins/:id/cli` and
 * `/plugins/:id/rpc/:method` execute plugin code with no consent prompt, unlike
 * the install/enable/settings routes beside them. See docs/security.md.
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
  /**
   * Matches this `/api/v1`-relative path, or anything under it. A `:name`
   * segment matches one path segment, the same way the route table spells it,
   * so a denial can name a sub-route with an id in the middle.
   */
  path: string;
  reason: string;
}

const MUTATION_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

const FILE_MUTATION_REASON =
  "it writes to any path on the machine, which would step around the workspace sandbox this turn runs in";

const DENIED_AGENT_ROUTES: readonly DeniedAgentRoute[] = [
  { path: "/files/write", reason: FILE_MUTATION_REASON },
  { path: "/files/mkdir", reason: FILE_MUTATION_REASON },
  { path: "/files/move", reason: FILE_MUTATION_REASON },
  { path: "/files/remove", reason: FILE_MUTATION_REASON },
  {
    path: "/terminals",
    reason:
      "it opens a shell on the host outside this turn's sandbox, running as the user",
  },
  {
    path: "/hosts/:id/permission-ceiling",
    reason:
      "a machine's permission ceiling is the limit this turn runs under, and is the owner's to change",
  },
  {
    path: "/hosts/:id/provider-clis/install",
    reason:
      "it runs an installer on the host outside this turn's sandbox, as the user",
  },
  {
    path: "/hosts/join-codes",
    reason: "enrolling a machine into this install is the owner's to do",
  },
];

/** One `:name` segment, or a literal, matched segment by segment. */
function pathMatches(requestPath: string, route: DeniedAgentRoute): boolean {
  const routeSegments = route.path.split("/");
  const requestSegments = requestPath.split("/");
  if (requestSegments.length < routeSegments.length) return false;
  return routeSegments.every((segment, index) => {
    const requested = requestSegments[index];
    if (requested === undefined) return false;
    if (segment.startsWith(":")) return requested.length > 0;
    return segment === requested;
  });
}

export interface AgentRoutePolicyRequest {
  /** Request path, with or without the `/api/v1` prefix. */
  path: string;
  method: string;
}

const TRAILING_SLASHES = /\/+$/;

/** Same normalization `permissionsForApiPath` applies, for the same reason. */
function normalizePath(path: string): string {
  return (
    path.startsWith("/api/v1") ? path.slice("/api/v1".length) : path
  ).replace(TRAILING_SLASHES, "");
}

/**
 * Why this request is refused for an agent, or null when it may proceed.
 */
export function agentRoutePolicyDenial(
  request: AgentRoutePolicyRequest,
): AgentRoutePolicyDenial | null {
  const method = request.method.toUpperCase();
  // A GET on any of these paths stays readable; only the mutations are denied.
  if (!MUTATION_METHODS.some((mutation) => mutation === method)) return null;
  const path = normalizePath(request.path);
  for (const route of DENIED_AGENT_ROUTES) {
    if (!pathMatches(path, route)) continue;
    return {
      route: route.path,
      message: `An agent mid-turn cannot call ${method} ${path}: ${route.reason}. Ask the person in the thread to do it, or work inside the workspace.`,
    };
  }
  return null;
}
