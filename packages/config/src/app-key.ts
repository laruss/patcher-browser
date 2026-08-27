/**
 * The names the key that identifies a client to `/api/v1` and `/ws` travels
 * under — and nothing else, on purpose: this module is imported by the SPA, so
 * it must stay free of Node. Finding the key on disk is `app-key-file.ts`.
 *
 * The server writes this file (0600) at startup and refuses a request that is
 * neither a plugin nor a holder of the key — see `app-identity.ts` in the
 * server and the header's own note in @patcher/server-contract. Everything
 * local that is meant to reach the API reads it from here: the CLI, the
 * desktop shell, the launcher, the QA harnesses.
 *
 * `PATCHER_APP_KEY` wins over the file, and that is what makes the key
 * reachable from places that cannot read the data dir — a host daemon on
 * another machine from the server, a container, a `curl` in the runbook.
 *
 * **A turn's processes are not among them.** An agent's shell used to carry
 * this key and now carries one derived for its thread instead; see
 * `thread-api-key.ts` beside this file for what that buys and what it does not.
 *
 * **This is not a secret from a plugin.** A plugin process is a plain `fork`
 * with `node:fs`, running as the user, so it can read this file exactly as the
 * CLI does. What the key buys is that the anonymous case is refused, which is
 * what makes the path→permission map the only way in *through Patcher*, and it
 * is the shape a sandbox will need. See docs/security.md.
 */

/**
 * Says a local request came from a client this install handed the key to.
 *
 * The counterpart of the plugin header pair in `plugin-api-identity.ts`. The
 * API used to treat a request with no plugin identity as the app; a plugin
 * holds the loopback URL and reaches the port with plain `fetch`, so "no
 * identity" was a way past the permission map rather than a statement about
 * who was calling.
 *
 * Here rather than in @patcher/server-contract, next to the file it is read
 * from and in the one package every client of the API already depends on —
 * including the published `patcher-app` launcher, which does not carry the
 * contract package.
 */
export const PATCHER_APP_KEY_HEADER = "x-patcher-app-key";

/**
 * The same key, in the query string, for the callers that cannot set a header.
 *
 * A browser sets none on `<img src>`, on a download link, or on a `WebSocket`
 * upgrade, and the app uses all three. Same shape as the per-plugin
 * `.http-token`, which takes `?token=` for the same reason.
 */
export const PATCHER_APP_KEY_QUERY_PARAM = "appKey";

/**
 * The key as a header pair, or nothing when there is none to present.
 *
 * One spelling of "absent means send no header" rather than one per client:
 * the desktop shell, the launcher, the CLI and the QA harnesses all resolve
 * the key differently and then all have to say the same thing about it.
 */
export function appApiKeyHeaders(
  key: string | undefined,
): Record<string, string> {
  return key === undefined ? {} : { [PATCHER_APP_KEY_HEADER]: key };
}

/** The file the server writes under the data dir. */
export const PATCHER_APP_KEY_FILE_NAME = "app-api-key";
