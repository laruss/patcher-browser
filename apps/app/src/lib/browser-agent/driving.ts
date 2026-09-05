import { atom } from "jotai";
import type { BrowserCommandIssuer } from "@patcher/server-contract";

/**
 * Whether something other than the person is driving this window's browser.
 *
 * Electron draws no "a program is controlling this browser" banner and a native
 * `WebContentsView` cannot be decorated from the page side, so what the app puts
 * in its own chrome is the whole of the signal. The server names the caller on
 * each command (`browser-command-request`'s `issuer`); this is the window's
 * memory of it, which the chrome reads.
 *
 * **One issuer, the most recent.** Two agents driving at once is not something
 * this product supports yet — commands from two callers interleave on the same
 * tab, which is a bigger problem than the indicator — so the honest thing to
 * show is who moved last rather than a list that implies the rest is handled.
 *
 * **Why it lingers.** A `patcher browser` session is a burst of short commands
 * with gaps between them, and an indicator that blinked out between each one
 * would read as "it stopped" every second. It stays for a few seconds after the
 * last command settles, which also covers the gap between a command finishing
 * and the agent's next one arriving.
 */

export interface BrowserDrivingState {
  issuer: BrowserCommandIssuer;
  /** True while one of this issuer's commands has not answered yet. */
  active: boolean;
}

export const browserDrivingAtom = atom<BrowserDrivingState | null>(null);

/** How long the indicator stays after the last command settles. */
export const BROWSER_DRIVING_LINGER_MS = 4_000;

/**
 * What makes two commands "the same driver".
 *
 * The kind and its id, never the label: a grant renamed mid-session is the same
 * agent, and two grants that a person gave the same name are not.
 */
export function browserDrivingIssuerKey(issuer: BrowserCommandIssuer): string {
  switch (issuer.kind) {
    case "thread":
      return `thread:${issuer.threadId}`;
    case "grant":
      return `grant:${issuer.grantId}`;
    case "outside":
      return "outside";
  }
}

export interface BrowserDrivingTracker {
  /** A command has arrived. Undefined issuers — the app's own work — do nothing. */
  started(issuer: BrowserCommandIssuer | undefined): void;
  /** That command has answered, one way or the other. */
  settled(issuer: BrowserCommandIssuer | undefined): void;
  /** The window is going away: drop the timer and the indicator. */
  dispose(): void;
}

export interface CreateBrowserDrivingTrackerArgs {
  set(state: BrowserDrivingState | null): void;
}

/**
 * Tracks who is driving, outside React.
 *
 * The timer lives here rather than in a hook because the alternative is a
 * component that re-renders on an interval to ask whether the last command is
 * old yet — and in this app that component would be doing it inside a window
 * whose renderer is throttled whenever it is not on screen. A timer that fires
 * late is fine: nobody is looking.
 */
export function createBrowserDrivingTracker(
  args: CreateBrowserDrivingTrackerArgs,
): BrowserDrivingTracker {
  const inFlight = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: string | null = null;

  function clearTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  return {
    started(issuer) {
      if (issuer === undefined) return;
      const key = browserDrivingIssuerKey(issuer);
      inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
      current = key;
      clearTimer();
      args.set({ issuer, active: true });
    },
    settled(issuer) {
      if (issuer === undefined) return;
      const key = browserDrivingIssuerKey(issuer);
      const left = Math.max((inFlight.get(key) ?? 0) - 1, 0);
      if (left === 0) inFlight.delete(key);
      else inFlight.set(key, left);
      // Somebody else started driving while this command was in the air. Their
      // indicator is the current one and this answer must not replace it.
      if (current !== key) return;
      args.set({ issuer, active: left > 0 });
      if (left > 0) return;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (current !== key || (inFlight.get(key) ?? 0) > 0) return;
        current = null;
        args.set(null);
      }, BROWSER_DRIVING_LINGER_MS);
    },
    dispose() {
      clearTimer();
      inFlight.clear();
      current = null;
      args.set(null);
    },
  };
}
