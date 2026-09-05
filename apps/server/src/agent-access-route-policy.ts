import { BROWSER_TOOLS_PLUGIN_ID } from "./services/browser/browser-external-access.js";

/**
 * What a browser access grant reaches, which is a list of what it *may* rather
 * than of what it may not.
 *
 * The opposite choice from `agent-route-policy.ts`, one module over, and the
 * reason is the same argument that module makes for its own shape read from the
 * other end. There, a forgotten entry is a 403 in front of a person mid-task,
 * and the caller is a turn the user started and is watching, so the list names
 * the few things it must not do. Here the caller is a program on the machine
 * that the user allowed to touch *the browser*, and nothing else was ever part
 * of the offer — so a route added tomorrow is closed to a grant until somebody
 * decides otherwise, and the cost of a mistake is a grant holder being told to
 * use the app key it can already read.
 *
 * The list is short because driving the browser is short: find out that the
 * command exists, and run it.
 *
 * - **`GET /plugins/contributions`** is how `patcher browser` becomes a
 *   command at all: the CLI reads the plugin CLI table from it before it can
 *   route the argv. Metadata, no plugin code, and a grant holder that could not
 *   read it would get `unknown command 'browser'`.
 * - **`POST /plugins/browser-tools/cli`** is the command. Named with the plugin
 *   id in it rather than as `/plugins/:id/cli`, because that route runs plugin
 *   code, and every *other* plugin's CLI is a surface a browser grant was never
 *   about — a plugin with `shell` or `files` and a command of its own would
 *   otherwise be reachable with a credential the user issued for the browser.
 *
 * `GET /plugins` is deliberately not here, though the CLI does ask for it when a
 * command is unknown. It answers with every installed plugin's metadata, which
 * is a broader read than this credential is for, and the case it serves cannot
 * arise for a grant holder: a grant is issued with `browser-tools` on, so
 * `patcher browser` resolves. The cost is that a grant holder who somehow does
 * hit an unknown command gets commander's plain message instead of the list of
 * disabled plugins, which is the smaller of the two mistakes.
 *
 * `/ws` is not here and could not be: it is not under `/api/v1` at all, and it
 * takes the app key or a plugin's header pair. A grant presents neither, so the
 * socket refuses it where it refuses any unidentified caller — the "I am the
 * browser" role on that hub is not a grant's to claim. There is a test.
 */

interface AllowedAgentAccessRoute {
  method: "GET" | "POST";
  /** An exact `/api/v1`-relative path, with no parameter segments. */
  path: string;
  /** What it is for, so a refusal can list the offer rather than a rule. */
  purpose: string;
}

const ALLOWED_AGENT_ACCESS_ROUTES: readonly AllowedAgentAccessRoute[] = [
  {
    method: "GET",
    path: "/plugins/contributions",
    purpose: "look up the `patcher browser` command",
  },
  {
    method: "POST",
    path: `/plugins/${BROWSER_TOOLS_PLUGIN_ID}/cli`,
    purpose: "run a `patcher browser` command",
  },
];

const TRAILING_SLASHES = /\/+$/;

/** Same normalization the other two policies apply, for the same reason. */
function normalizePath(path: string): string {
  return (
    path.startsWith("/api/v1") ? path.slice("/api/v1".length) : path
  ).replace(TRAILING_SLASHES, "");
}

export interface AgentAccessRoutePolicyRequest {
  /** Request path, with or without the `/api/v1` prefix. */
  path: string;
  method: string;
}

/**
 * Why this request is refused for a grant holder, or null when it may proceed.
 *
 * The message lists the whole offer rather than naming the rule, because the
 * reader is usually a model that will otherwise try a neighbouring route: the
 * useful thing to say is not "that one is closed" but "these two are open, and
 * the rest of Patcher is not what you were given".
 */
export function agentAccessRoutePolicyDenial(
  request: AgentAccessRoutePolicyRequest,
): string | null {
  const method = request.method.toUpperCase();
  const path = normalizePath(request.path);
  if (
    ALLOWED_AGENT_ACCESS_ROUTES.some(
      (route) => route.method === method && route.path === path,
    )
  ) {
    return null;
  }
  const offer = ALLOWED_AGENT_ACCESS_ROUTES.map(
    (route) => `${route.method} ${route.path} (${route.purpose})`,
  ).join(", ");
  return (
    `A browser access grant cannot call ${method} ${path}. It reaches ${offer} — and no other part of this API. ` +
    `The rest of this API is the app's, and a grant is deliberately not the app. If you need it, ask the person at this machine rather than going looking for another credential.`
  );
}
