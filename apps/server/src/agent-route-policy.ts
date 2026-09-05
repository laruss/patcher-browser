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
 * - **A machine's permission ceiling, machine enrolment, and provider-CLI
 *   installs.** Raising the ceiling is how a sandboxed turn would arrange to
 *   stop being one; an install runs an installer on the host outside the
 *   sandbox. All three were already meant to be app-only — deliberately absent
 *   from the SDK and the CLI — and this is what makes that true of an agent
 *   that calls the route directly.
 * - **The app's own settings.** `PUT /settings/general` takes the whole
 *   settings object, and three of its fields are the boundary the turn is
 *   running inside: whether a sandboxed turn's traffic is confined to a list
 *   of hosts, which hosts that list holds, and whether Codex's own commands
 *   get the network at all. `thread-commands.ts` reads them when it builds the
 *   next turn, so a turn that could write them would choose its own network
 *   and then send itself a message. The `/settings` prefix rather than that one
 *   route, because naming the route is how this was missed in the first place:
 *   a setting added next to it would be open until somebody remembered to come
 *   back here, and the two exceptions below say which of them are not.
 *
 * Terminals were on this list, for the same reason and just as truly: a PTY on
 * the host, outside any sandbox, running as the user — the shortest way out
 * that existed. They came off it when the terminal changed rather than the
 * judgement. One an agent opens now runs inside the boundary its turn runs in,
 * and `agent-terminal-scope.ts` keeps a turn to the terminals of its own thread
 * and of the ones it spawned.
 *
 * Answering a setup-script question is on the list as well, and it is the same
 * judgement seen from the other side: the prompt itself is refused inside a turn
 * in `routes/threads/interactions.ts`, and the settings route that answers one
 * later would have been the way around that.
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
 * **One read is denied, though**, and it is the exception that says what the
 * judgement above rests on: a read whose *answer* is a credential is not
 * information about the machine, it is the machine. `/host-daemon-keys/:hostId`
 * returns what the app presents to a daemon's own loopback API, whose one
 * executing route runs a command on the host outside this turn's sandbox. The
 * reason that credential is minted in memory instead of read from the app key
 * file is precisely that a turn cannot go and find it — answering a GET with it
 * would put it straight back.
 *
 * **Which thread, as well as which route.** The resolved thread id is compared
 * with the `:id` a request acts on, one layer out in `agent-thread-scope.ts`:
 * that check needs the database and this one does not, and a turn may act on
 * its own thread and on the ones it spawned. Reads stay open there.
 *
 * **What a turn may ask for the next one.** `permissionMode` is bounded by the
 * asking turn's own mode as well as by the machine's ceiling, in
 * `permission-ceiling.ts`. `workspace: { type: "unmanaged", path }` is not
 * bounded: a turn can still choose where the next one's workspace points, which
 * is a decision recorded in docs/security.md rather than an oversight.
 *
 * `/plugins/:id/cli` and `/plugins/:id/rpc/:method` execute plugin code with no
 * consent prompt because the grant happens at install and enable, which are
 * gated; invoking is using what was granted. See docs/security.md.
 *
 * **A deny list, still, and the cost is why.** Inverting this into an allow-list
 * for turn callers would close a policy route nobody classified, which is the
 * failure this list has already had once. It would also mean naming every route
 * a turn legitimately mutates — its thread and the ones it spawned, queued
 * messages, interactions, terminals, environments, projects, plugin calls — and
 * there one forgotten entry is a 403 in front of somebody mid-task rather than
 * a hole. The two mistakes are not the same size, and they do not point the
 * same way. What the family that actually carries policy gets instead is the
 * prefix above, so the next setting is closed on arrival, with the exceptions
 * named rather than the rule left open.
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
  {
    // The prompt is refused from inside a turn in `routes/threads/interactions.ts`;
    // these are the same answer given out of band, and a turn that could give it
    // would be allowing its own committed script to run on the host, outside the
    // sandbox, as the user. A GET stays open: a turn may read what is allowed.
    path: "/projects/:id/setup-script-consents",
    reason:
      "whether a repository's setup script may run on the machine, outside this turn's sandbox, is the owner's to answer",
  },
  {
    // A credential, not a setting, and that is the whole distinction. The
    // browser *level* one route over is a question a turn may raise, because
    // the answer is about other agents and the prompt says so. This answers
    // with a grant credential, which is accepted until a person revokes it —
    // so a turn that could call it would have minted itself a browser key that
    // outlives the turn its own key dies with. A GET stays open: a list of
    // grants carries labels and dates, never a credential.
    path: "/browser/access-grants",
    reason:
      "it answers with a credential that keeps working after this turn ends, and handing one out is the person's act — they can run `patcher agent-access grant` themselves, or you can ask for the install-wide level with `patcher settings browser-access`, which raises a prompt in this thread",
  },
  {
    // The prefix, not `/settings/general`: the route that carries the egress
    // switch, its host list and `codexNetworkDisabled` is the boundary the next
    // turn is built from, and naming only that route is how it stayed open. A
    // GET stays open — a turn may read what it is running under.
    path: "/settings",
    reason:
      "it writes the app-wide settings the next turn is built from, including whether a sandboxed turn's traffic is confined to a list of hosts and whether Codex's own commands get the network at all",
  },
];

/**
 * Routes under a denied prefix that a turn may write anyway, checked first.
 *
 * The prefix above is what makes the next settings route closed on arrival, and
 * the cost of a prefix is that it also closes what nobody meant to close. These
 * two are that: how the app looks to the person watching, not how the turn runs.
 *
 * `/settings/appearance` is the end of a workflow this product documents for an
 * agent — `references/theming.md` in the built-in CLI skill is a theme-authoring
 * guide that has a turn write `theme.css` and then run `patcher theme set`, and
 * denying the route would have left that workflow one command short of working.
 * `/settings/keyboard` is the same kind of thing seen smaller: a shortcut the
 * person asked for. Neither is read when a turn is built, and neither is a way
 * out of one.
 *
 * The bar for adding to this list is that last sentence, and it is meant to be
 * hard to clear: an entry here is a hole in a rule that exists because holes in
 * it are how this policy has already failed once.
 */
const ALLOWED_AGENT_ROUTES: readonly DeniedAgentRoute[] = [
  {
    path: "/settings/appearance",
    reason: "the theme is the person's to see and a turn's to apply for them",
  },
  {
    path: "/settings/keyboard",
    reason: "a shortcut binding is a preference, not a boundary",
  },
];

/**
 * Routes an agent may not reach with any method, reads included.
 *
 * Separate from the list above because the reason is different in kind: those
 * are things a turn must not *do*, and this is a thing a turn must not *learn*.
 * A GET is normally left open here on purpose — see the docstring — so anything
 * added to this list has to be a credential, not merely sensitive.
 */
const DENIED_AGENT_ROUTES_INCLUDING_READS: readonly DeniedAgentRoute[] = [
  {
    path: "/host-daemon-keys/:hostId",
    reason:
      "it answers with the credential for that machine's own daemon API, whose one executing route runs a command on the host outside this turn's sandbox",
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
  const path = normalizePath(request.path);
  const isMutation = MUTATION_METHODS.some((mutation) => mutation === method);
  // An exception is only ever to a mutation deny — nothing on the reads list has
  // one, and a route that answers with a credential could not have one.
  if (
    isMutation &&
    ALLOWED_AGENT_ROUTES.some((route) => pathMatches(path, route))
  ) {
    return null;
  }
  const denied = [
    ...DENIED_AGENT_ROUTES_INCLUDING_READS,
    // A GET on any of these paths stays readable; only the mutations are denied.
    ...(isMutation ? DENIED_AGENT_ROUTES : []),
  ];
  for (const route of denied) {
    if (!pathMatches(path, route)) continue;
    return {
      route: route.path,
      message: `An agent mid-turn cannot call ${method} ${path}: ${route.reason}. Ask the person in the thread to do it, or work inside the workspace.`,
    };
  }
  return null;
}
