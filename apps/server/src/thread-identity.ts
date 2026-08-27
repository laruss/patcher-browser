import { verifyThreadApiKey } from "@patcher/config/thread-api-key";
import {
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";

/**
 * Who is calling `/api/v1` from inside a turn.
 *
 * The third answer beside `plugin-api-identity.ts` (a plugin) and
 * `app-identity.ts` (the app, the CLI, the launcher — anything this install
 * handed the app key to). A turn's processes now carry a key derived for their
 * thread instead of the app key, so an agent is a caller the server can name,
 * and `agent-route-policy.ts` is what it costs.
 *
 * The thread id and the key are checked together, because the key is only
 * meaningful for one id — a caller cannot present another thread's key under
 * its own id, and cannot drop the id to become anonymous, since there is then
 * nothing to verify the key against.
 *
 * Like both of its neighbours, a presented-but-wrong pair resolves to null
 * rather than throwing: an unverified caller is simply not an agent, and the
 * middleware refuses it once, in one place.
 */

export interface ThreadApiIdentity {
  /**
   * The thread this request is the agent of, or null when it presents no
   * verifiable thread identity.
   */
  resolve(request: ThreadApiKeyCarrier): string | null;
}

/** The part of a request this reads. Narrow so tests need no Hono context. */
export interface ThreadApiKeyCarrier {
  header(name: string): string | undefined;
}

export function createThreadApiIdentity(appApiKey: string): ThreadApiIdentity {
  if (appApiKey.length === 0) {
    throw new Error("the app API key must not be empty");
  }
  return {
    resolve(request) {
      const threadId = request.header(PATCHER_THREAD_ID_HEADER)?.trim();
      const presented = request.header(PATCHER_THREAD_KEY_HEADER)?.trim();
      if (!threadId || !presented) return null;
      return verifyThreadApiKey({ appApiKey, threadId, presented })
        ? threadId
        : null;
    },
  };
}
