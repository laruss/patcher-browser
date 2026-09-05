/**
 * One command at a time per tab.
 *
 * Ownership answered *where* a command lands (`tab-owners.ts`); this answers
 * what happens when two of them land on the same tab anyway — a caller
 * pipelining its own work, or two callers either side of a handover. Nothing
 * sequenced them: the bridge fired every command into `executeBrowserCommand`
 * and the hub is happy to have any number in flight, so a snapshot and the
 * action that follows it could be split by somebody else's navigation, and the
 * second half acted on a page the first half never saw.
 *
 * **Browser commands only.** The person's own clicking, their omnibox and every
 * other thing the surface does reach the page by their own paths, and none of
 * them come through here — so a person can still act in the middle of an
 * agent's command, which is the one overlap this does not close and cannot,
 * short of queueing the browser's own UI behind an agent.
 *
 * **A chain, not a lock.** Each tab keeps a promise that resolves when the last
 * command on it finished; the next one waits on that and becomes the new tail.
 * A failed command does not poison the chain — the tab is still there and the
 * next caller has done nothing wrong — and a command with no tab of its own to
 * act on (`tabs.list`, opening one) is not serialized at all, because the thing
 * it would be waiting for is unrelated to it.
 *
 * **Nothing here has a timeout.** A queue that gave up after n seconds would
 * turn "your command waited" into "your command ran out of order", which is the
 * failure it exists to prevent; the caller's own deadline is on the other side
 * of the socket (`BROWSER_COMMAND_DEFAULT_TIMEOUT_MS`, ten seconds, sixty at
 * most), and abandoning the wait there does not abandon the command.
 *
 * What that costs, said rather than discovered: a command queued behind a slow
 * one can outlive its caller's wait, so the caller is told the browser did not
 * answer in time and the command then runs. That is the answer
 * `BrowserCommandTimeoutError` already gives — "it may still be running, so
 * check the page rather than assuming nothing happened" — and it was already
 * reachable with one slow command and no queue at all. Waiting is the only
 * behaviour that keeps a sequence a sequence.
 *
 * **And it assumes commands settle, which not all of them do.** Several shell
 * paths have no deadline of their own (a snapshot, an evaluation, the input
 * dispatch inside a click), so a page holding a `confirm()` open can leave a
 * command unanswered for as long as the dialog stands — and everything queued
 * behind it on that tab waits. The two commands that get a tab out of that
 * state, answering the dialog and closing the tab, are therefore never queued
 * (`actsOnItsTab` in `execute.ts`); the deadline those paths are missing is in
 * docs/TODO.md. Found by review before it shipped, not in the field.
 */

export interface BrowserTabQueue {
  /**
   * Runs `task` after everything already queued for `tabId`. A null tab means
   * "nothing to serialize against" and runs immediately.
   */
  run<T>(tabId: string | null, task: () => Promise<T>): Promise<T>;
  /** The window is going away; forget the chains. */
  dispose(): void;
  /**
   * How many tabs have something queued.
   *
   * Here so the chain-cleanup is observable: without it a queue that never
   * forgot a settled tab would pass every behavioural test in this file — the
   * commands still run, in order, and only the map grows.
   */
  readonly size: number;
}

export function createBrowserTabQueue(): BrowserTabQueue {
  /** Tab id → when the last command queued for it settles. */
  const tails = new Map<string, Promise<void>>();

  return {
    run(tabId, task) {
      if (tabId === null) {
        return task();
      }
      const previous = tails.get(tabId);
      const result =
        previous === undefined ? task() : previous.then(() => task());
      // The chain follows the *settling* of this command rather than its value:
      // the next caller waits for the page to be left alone, and a refusal
      // leaves it alone just as surely as a success.
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(tabId, tail);
      void tail.then(() => {
        // Only if nothing queued behind it, or this would drop a live chain and
        // let the command after it start early.
        if (tails.get(tabId) === tail) {
          tails.delete(tabId);
        }
      });
      return result;
    },
    dispose() {
      tails.clear();
    },
    get size() {
      return tails.size;
    },
  };
}
