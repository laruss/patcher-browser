import { atom } from "jotai";
import { BROWSER_COMMAND_MAX_TRACE_STEPS } from "@patcher/domain";
import type {
  BrowserCommandIssuer,
  BrowserDrivingCommand,
  BrowserDrivingOutcome,
} from "@patcher/server-contract";

/**
 * What drove this browser, kept so a person can ask afterwards.
 *
 * The indicator answers "is something happening" and is gone four seconds
 * after it stops ([driving.ts](./driving.ts)); this answers "what did it do",
 * which is a question people ask once the thing has finished. So the two are
 * separate: same two feeders, different lifetimes.
 *
 * **The record nobody has to ask for.** `patcher browser trace-start` already
 * produces a better log than this — with screenshots, and complete — but a
 * caller has to start it, and the caller is the party whose behaviour is in
 * question. This one runs by itself, for every command with an issuer, which is
 * every command that is not the person's own browsing.
 *
 * **What it is not.** It is what *this window* heard: a window that was closed,
 * or whose socket was down, has a hole there, and the entries are in memory —
 * a reload starts an empty list. It keeps no screenshots (a picture per command
 * is megabytes held forever in a renderer, and the caller's own trace is where
 * that belongs) and no read sizes, so "it read the page" does not say how much
 * came back. For a complete, sharable record there is still the trace.
 */

/** Where a command got to, which is three outcomes and not two. */
export type BrowserActivityStatus =
  | { kind: "running" }
  | { kind: "ok" }
  /** The browser refused it or the page did — `code` is the command's own. */
  | { kind: "failed"; code: string | null }
  /**
   * It ended without an answer: it timed out, or the window performing it went
   * away. Distinct from a failure, because nobody knows whether the browser did
   * it — the page may well have been navigated by a command whose answer never
   * came back.
   */
  | { kind: "unanswered" };

export interface BrowserActivityEntry {
  /** The server's id for the command, which is what a settle is paired by. */
  requestId: string;
  /** Wall clock: a row in Settings is read minutes or hours later. */
  at: number;
  issuer: BrowserCommandIssuer;
  /**
   * Null when the frame carried no command — a window loaded from a server that
   * predates the field. The row still says who and when.
   */
  command: BrowserDrivingCommand | null;
  status: BrowserActivityStatus;
  /**
   * Whether another window performed it. Not shown: two windows drive one
   * browser, so *where the command was typed* is not what a record of the
   * browser is about. It is here because a reconnect has to end exactly the
   * commands that can no longer answer this window, and those are these.
   */
  elsewhere: boolean;
}

export const browserActivityAtom = atom<readonly BrowserActivityEntry[]>([]);

/**
 * How many commands are kept, oldest dropped first.
 *
 * The trace's own step budget, deliberately: it is the same question — how much
 * of a session a record holds — and a second number for it would be two answers
 * to one question, each of them right somewhere.
 */
export const BROWSER_ACTIVITY_MAX_ENTRIES = BROWSER_COMMAND_MAX_TRACE_STEPS;

export interface BrowserActivityLog {
  /** A command has started. Undefined issuers — the app's own work — are not recorded. */
  started(command: {
    requestId: string;
    issuer: BrowserCommandIssuer | undefined;
    command?: BrowserDrivingCommand | null;
    elsewhere?: boolean;
  }): void;
  /**
   * That command ended. A null outcome is "no answer", not a success.
   *
   * An id this window never saw start is ignored, the same way the indicator
   * ignores one: a window that connected mid-command hears the end of
   * something whose beginning went to a socket that did not exist yet, and
   * inventing a row for it would put a command in the record with no time and
   * no name.
   */
  settled(requestId: string, outcome: BrowserDrivingOutcome | null): void;
  /**
   * A reconnect: whatever another window was performing can no longer reach
   * this one, so anything still open from there ended without an answer — which
   * is the truth, rather than a row that says "running" for the rest of the
   * session. What this window performs itself is untouched; that settles
   * locally whatever the socket did.
   */
  forgetOtherWindows(): void;
  /** The window is going away. */
  dispose(): void;
}

export interface CreateBrowserActivityLogArgs {
  set(entries: readonly BrowserActivityEntry[]): void;
  /** Seam so a test can pin the times it renders. */
  now?: () => number;
}

export function createBrowserActivityLog(
  args: CreateBrowserActivityLogArgs,
): BrowserActivityLog {
  const now = args.now ?? Date.now;
  /** Oldest first, like a trace's steps, so the cap drops the oldest. */
  let entries: readonly BrowserActivityEntry[] = [];

  function publish(next: readonly BrowserActivityEntry[]): void {
    entries = next;
    args.set(entries);
  }

  /**
   * Replace one entry, by id, with what it becomes.
   *
   * A new object rather than a mutated one: the list is React state, and a row
   * that changed in place is a row that does not re-render.
   */
  function update(
    requestId: string,
    change: (entry: BrowserActivityEntry) => BrowserActivityEntry,
  ): void {
    let found = false;
    const next = entries.map((entry) => {
      if (entry.requestId !== requestId) return entry;
      found = true;
      return change(entry);
    });
    if (!found) return;
    publish(next);
  }

  return {
    started({ requestId, issuer, command = null, elsewhere = false }) {
      if (issuer === undefined) return;
      const entry: BrowserActivityEntry = {
        requestId,
        at: now(),
        issuer,
        command,
        status: { kind: "running" },
        elsewhere,
      };
      // Keyed by the id, so the same id is never two rows: two of them would
      // settle as one and read as a command that ran twice.
      const next = [
        ...entries.filter((held) => held.requestId !== requestId),
        entry,
      ];
      publish(
        next.length > BROWSER_ACTIVITY_MAX_ENTRIES
          ? next.slice(next.length - BROWSER_ACTIVITY_MAX_ENTRIES)
          : next,
      );
    },
    settled(requestId, outcome) {
      update(requestId, (entry) => ({
        ...entry,
        status:
          outcome === null
            ? { kind: "unanswered" }
            : outcome.ok
              ? { kind: "ok" }
              : { kind: "failed", code: outcome.error },
      }));
    },
    forgetOtherWindows() {
      let changed = false;
      const next = entries.map((entry) => {
        if (!entry.elsewhere || entry.status.kind !== "running") return entry;
        changed = true;
        return { ...entry, status: { kind: "unanswered" as const } };
      });
      if (!changed) return;
      publish(next);
    },
    dispose() {
      publish([]);
    },
  };
}
