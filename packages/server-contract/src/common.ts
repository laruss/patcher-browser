export type { EmptyInput, Endpoint, Untyped } from "@patcher/hono-typed-routes";

/**
 * The thread a request was made from inside, when it was made from inside one.
 *
 * The local API cannot otherwise tell a user's own `patcher` invocation from
 * one an agent made mid-turn: both reach the same loopback server with the same
 * credentials. Patcher sets `PATCHER_THREAD_ID` in the environment of the
 * processes a turn spawns, and the CLI forwards it here, which is what lets the
 * server ask the user before a plugin change an agent requested.
 *
 * On its own this is a declaration rather than a credential, and anything with
 * a shell can omit it. What makes it answerable for is the key beside it: a
 * turn's processes are handed a thread-scoped key, not the app key, and it
 * verifies for exactly the thread named here. An agent cannot drop the header
 * to look like the person at the terminal, because dropping it leaves nothing
 * that verifies at all.
 */
export const PATCHER_THREAD_ID_HEADER = "x-patcher-thread-id";

/**
 * Proves the request really is that thread's agent, mid-turn.
 *
 * Derived from the app key and the thread id, so it names one thread and
 * cannot be turned back into the app key — see `thread-api-key.ts` in
 * @patcher/config for the construction, and `agent-route-policy.ts` in the
 * server for what a caller holding one may and may not reach.
 */
export const PATCHER_THREAD_KEY_HEADER = "x-patcher-thread-key";

/**
 * Proves the request holds a browser access grant, and says which one.
 *
 * The fourth caller, beside a plugin, a turn and the app. A turn's credential
 * names a thread this install started and can watch; this one names a *grant* —
 * a row a person created deliberately for an agent that is not Patcher's, with
 * a level and a label they chose and can revoke. Derived from the app key and
 * the grant id, so it is not the app key and cannot be turned back into it, and
 * so nothing has to store it: see `agent-access-key.ts` in @patcher/config for
 * the construction, and `agent-access-route-policy.ts` in the server for the
 * two routes it reaches.
 *
 * No id header beside it, unlike the thread pair. A thread id is something the
 * caller already has and states for its own reasons; a grant id exists only to
 * address the grant, so it rides inside the credential where a caller cannot
 * move it onto another grant without breaking the MAC.
 */
export const PATCHER_AGENT_KEY_HEADER = "x-patcher-agent-key";

export type PathId = { param: { id: string } };
export type PathProjectId = { param: { id: string } };
export type PathThreadAndQueuedMessage = {
  param: { id: string; queuedMessageId: string };
};
/**
 * Thread routes that address a workspace-relative file as a path suffix
 * (`:filePath{.+}` matches across slashes). Clients must percent-encode each
 * path segment themselves — hono's `$url()` substitutes params verbatim.
 */
export type PathThreadAndFilePath = {
  param: { id: string; filePath: string };
};
export type PathPreviewAndFilePath = {
  param: { id: string; filePath: string };
};
export type PathThreadAndTerminal = {
  param: { id: string; terminalId: string };
};
export type PathEnvironmentAndTerminal = {
  param: { id: string; terminalId: string };
};
export type PathTerminal = {
  param: { terminalId: string };
};
