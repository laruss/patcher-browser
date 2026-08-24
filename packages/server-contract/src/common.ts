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
 * A declaration rather than a credential: anything with a shell can omit it.
 * It buys attribution and a default, not a boundary.
 */
export const PATCHER_THREAD_ID_HEADER = "x-patcher-thread-id";

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
