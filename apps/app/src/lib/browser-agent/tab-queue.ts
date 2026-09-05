/**
 * One command at a time per tab.
 *
 * Ownership answered *where* a command lands (`tab-owners.ts`); this answers
 * what happens when two of them land on the same tab anyway — the person and
 * the agent they handed a tab to, a turn and the person's own clicking, or two
 * callers between a handover and a take-back. Nothing sequenced them: the
 * bridge fired every command into `executeBrowserCommand` and the hub is happy
 * to have any number in flight, so a snapshot and the action that follows it
 * could be split by somebody else's navigation, and the second half acted on a
 * page the first half never saw.
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
 * of the socket (`BrowserCommandTimeoutError`), and abandoning the wait there
 * does not abandon the command.
 */

export interface BrowserTabQueue {
  /**
   * Runs `task` after everything already queued for `tabId`. A null tab means
   * "nothing to serialize against" and runs immediately.
   */
  run<T>(tabId: string | null, task: () => Promise<T>): Promise<T>;
  /** The window is going away; forget the chains. */
  dispose(): void;
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
  };
}
