import { timingSafeEqual } from "node:crypto";
import {
  PATCHER_APP_KEY_HEADER,
  PATCHER_APP_KEY_QUERY_PARAM,
} from "@patcher/config/app-key";

/**
 * Who is calling `/api/v1` when it is not a plugin.
 *
 * `plugin-api-identity.ts` answers the other half: a request presenting a
 * plugin's header pair is that plugin, and the path→permission map applies to
 * it. It ended at "no identity is the app, the CLI, or anything else local",
 * and `anything else local` was the hole — a plugin holds
 * `patcher.server.loopbackBaseUrl` and reaches the port with plain `fetch`, so
 * omitting the headers skipped the whole map instead of failing.
 *
 * The server cannot tell a plugin's socket from the app's by inspection, so
 * the only way to refuse the anonymous case is for everyone else to stop being
 * anonymous. Every non-plugin client presents this key; a request with neither
 * a plugin identity nor this key is refused.
 *
 * **What this is and is not.** It closes the anonymous route, which makes the
 * permission map the only way a plugin reaches the API *through Patcher*, and
 * it is the shape a sandbox will need. It is not a defence against a plugin
 * that goes looking: a plugin process is a plain `fork` with `node:fs` running
 * as the user, so the key file the CLI reads is a file a plugin can read. That
 * last step needs the sandbox, not another gate — see docs/security.md.
 *
 * The key lives in the data dir beside `auth-secret`, written 0600 by
 * `readOrCreateSecretFile`, and is stable across restarts. Per-run would be
 * marginally better hygiene and much worse behaviour: the desktop shell reads
 * it once at launch, and every dev restart would leave it holding a key the
 * server no longer knows.
 */

export interface AppApiIdentity {
  /**
   * Whether this request carries the key, by header or by query.
   *
   * A wrong key is simply not a known client, the same way a bad plugin header
   * pair is simply not a plugin: the caller is refused by the middleware
   * rather than by a throw from here.
   */
  verify(request: AppApiKeyCarrier): boolean;
}

/** The part of a request this reads. Narrow so tests need no Hono context. */
export interface AppApiKeyCarrier {
  header(name: string): string | undefined;
  url: string;
}

/**
 * The key as this request presents it.
 *
 * Header first, because that is what every programmatic client uses and it
 * keeps the key out of URLs wherever a header is possible at all. The query is
 * for the three callers that cannot set one: `<img src>`, a download link, and
 * a browser `WebSocket` upgrade.
 */
function presentedKey(request: AppApiKeyCarrier): string | undefined {
  const header = request.header(PATCHER_APP_KEY_HEADER);
  if (header !== undefined && header.length > 0) return header;
  try {
    return (
      new URL(request.url).searchParams.get(PATCHER_APP_KEY_QUERY_PARAM) ??
      undefined
    );
  } catch {
    // A request whose URL does not parse cannot be carrying a key in it.
    return undefined;
  }
}

export function createAppApiIdentity(key: string): AppApiIdentity {
  if (key.length === 0) {
    throw new Error("the app API key must not be empty");
  }
  const known = Buffer.from(key, "utf8");
  return {
    verify(request) {
      const presented = presentedKey(request);
      if (presented === undefined) return false;
      const offered = Buffer.from(presented, "utf8");
      // Length first: `timingSafeEqual` throws on a mismatch, and the length
      // is not the part worth hiding.
      if (offered.length !== known.length) return false;
      return timingSafeEqual(offered, known);
    },
  };
}
