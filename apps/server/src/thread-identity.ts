import { verifyThreadApiKey } from "@patcher/config/thread-api-key";
import {
  getTerminalSession,
  getThread,
  type DbConnection,
} from "@patcher/db";
import { isActiveTerminalSessionStatus, type ThreadStatus } from "@patcher/domain";
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
 * **Genuine is not the same as accepted.** A key used to be good for as long as
 * the app key was, so an agent that kept the one handed to its shell could
 * present it after its turn ended and go on acting as that thread. There are
 * now two credentials with two lifetimes, and this is where each is held to its
 * own — against state the server already keeps, so nothing here needs a store
 * of live keys or a refresh path:
 *
 * - A **turn** key is accepted while the thread has a turn running. `stopping`
 *   counts, because a turn being wound down is still a turn; `idle` and `error`
 *   do not, which is exactly the window an agent used to keep.
 * - A **terminal** key is accepted while that terminal is open, belongs to the
 *   thread presenting it, and is a terminal that thread may hold. That is the
 *   lifetime which legitimately outlives a turn, and unlike a saved string it
 *   is something a person can see and close.
 *
 * What that costs, said plainly: a process an agent leaves running from its
 * turn's own shell — `nohup something &` — loses the API when the turn ends.
 * The supported way to keep something running past a turn is a terminal, which
 * is what has the lifetime for it.
 *
 * Like both of its neighbours, a presented-but-wrong pair resolves to null
 * rather than throwing: an unverified caller is simply not an agent, and the
 * middleware refuses it once, in one place.
 */

export interface ThreadApiIdentity {
  /**
   * The thread this request is the agent of, or null when it presents no
   * verifiable thread identity — or one whose lifetime is over.
   */
  resolve(request: ThreadApiKeyCarrier): string | null;
}

/** The part of a request this reads. Narrow so tests need no Hono context. */
export interface ThreadApiKeyCarrier {
  header(name: string): string | undefined;
}

/**
 * Statuses that mean a turn is running.
 *
 * Read from the thread row the server already maintains rather than from a
 * deadline: the question "is this credential still good" is the same question
 * as "is the turn it was issued for still going".
 */
const LIVE_TURN_THREAD_STATUSES: readonly ThreadStatus[] = [
  "starting",
  "active",
  "stopping",
];

export interface CreateThreadApiIdentityArgs {
  appApiKey: string;
  db: DbConnection;
}

export function createThreadApiIdentity(
  args: CreateThreadApiIdentityArgs,
): ThreadApiIdentity {
  if (args.appApiKey.length === 0) {
    throw new Error("the app API key must not be empty");
  }
  return {
    resolve(request) {
      const threadId = request.header(PATCHER_THREAD_ID_HEADER)?.trim();
      const presented = request.header(PATCHER_THREAD_KEY_HEADER)?.trim();
      if (!threadId || !presented) return null;
      const claim = verifyThreadApiKey({
        appApiKey: args.appApiKey,
        threadId,
        presented,
      });
      if (claim === undefined) return null;

      if (claim.kind === "turn") {
        const thread = getThread(args.db, threadId);
        if (!thread || thread.deletedAt !== null) return null;
        return LIVE_TURN_THREAD_STATUSES.includes(thread.status)
          ? threadId
          : null;
      }

      const terminal = getTerminalSession(args.db, {
        kind: "terminal",
        terminalId: claim.terminalId,
      });
      // The terminal has to still be this thread's: a terminal that moved, or
      // whose row is gone with the thread, is not a lifetime to borrow.
      if (!terminal || terminal.threadId !== threadId) return null;
      return isActiveTerminalSessionStatus(terminal.status) ? threadId : null;
    },
  };
}
