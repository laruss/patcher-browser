import { atom } from "jotai";
import type {
  BrowserCommandIssuer,
  BrowserDrivingCommand,
} from "@patcher/server-contract";
import { browserIssuerKey } from "./issuer";

/**
 * Whether something other than the person is driving Patcher's browser.
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
 *
 * **Two windows, one browser.** Only one window serves the agent's commands —
 * the server addresses the host that claimed the role first — so in every other
 * window this is fed by the server's `browser-driving` signal instead of by the
 * commands themselves, and says so: the tabs being driven are not the ones that
 * window is showing.
 */

export interface BrowserDrivingState {
  issuer: BrowserCommandIssuer;
  /** True while one of this issuer's commands has not answered yet. */
  active: boolean;
  /**
   * True when the driving is happening in another window of this app.
   *
   * The difference is what the person can do about it: in this window they can
   * watch the tab, and in the other one they cannot see it at all — so an
   * indicator that said the same thing in both would be telling one of them to
   * look at something that is not there.
   */
  elsewhere: boolean;
  /**
   * The command being performed, as a name and a rendered line.
   *
   * "Who" without "what" is the difference between an indicator a person
   * watches and one they can act on: a name and a level say something is
   * driving, and the line says it is filling in the form they are looking at.
   * Null when the frame carried none — a window loaded from a server that
   * predates the field — and the row then says what it always said.
   */
  command: BrowserDrivingCommand | null;
}

export const browserDrivingAtom = atom<BrowserDrivingState | null>(null);

/** How long the indicator stays after the last command settles. */
export const BROWSER_DRIVING_LINGER_MS = 4_000;

export interface BrowserDrivingTracker {
  /**
   * A command has arrived. Undefined issuers — the app's own work — do nothing.
   *
   * `requestId` is the server's own id for the command, and it is what this is
   * keyed on: a window can be told about *two* commands from one caller at
   * once, one it is performing and one another window is, and they end
   * separately. `elsewhere` is the window the command is being performed in,
   * not the window it is being reported in — a `browser-driving` signal is only
   * ever sent to windows that are not doing it.
   */
  started(command: {
    requestId: string;
    issuer: BrowserCommandIssuer | undefined;
    elsewhere?: boolean;
    command?: BrowserDrivingCommand | null;
  }): void;
  /**
   * That command has answered, one way or the other.
   *
   * An id this window never saw start is ignored, which is what it means for a
   * window to register — or reconnect — part-way through somebody's command:
   * it hears the end of one whose beginning went to a socket that did not
   * exist yet.
   */
  settled(requestId: string): void;
  /**
   * Forget what another window told us, and keep what this window is doing.
   *
   * For a reconnect: a `settled` sent while the socket was down is not resent,
   * so an indicator this window was only mirroring can be held up by a command
   * that ended minutes ago. What must not go with it is a command *this* window
   * is still performing — that settles locally whatever the socket did, and
   * taking its row down would say nobody is driving while somebody is.
   */
  forgetOtherWindows(): void;
  /** The window is going away: drop the timer and the indicator. */
  dispose(): void;
}

export interface CreateBrowserDrivingTrackerArgs {
  set(state: BrowserDrivingState | null): void;
}

interface InFlightCommand {
  command: BrowserDrivingCommand | null;
  elsewhere: boolean;
  issuer: BrowserCommandIssuer;
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
  /**
   * The commands in flight, by the server's id for each, in the order they
   * started.
   *
   * By command rather than by caller, which is the correction of two review
   * rounds: one caller can have a command in *this* window and another in a
   * different one at the same time — this window was the primary, its socket
   * blipped, the next command went to the window that got promoted while the
   * first command carried on here — and per-caller bookkeeping collapses those
   * two into one entry with one place. Then the mirrored one ends and the row
   * says "in another window" about a command running here, or a reconnect drops
   * the entry and the row goes down while a tab is visibly being driven.
   */
  const inFlight = new Map<string, InFlightCommand>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Whose row is up, and whether the command it names is in another window. */
  let shown: { elsewhere: boolean; key: string } | null = null;

  function clearTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  /**
   * The command that started most recently, of a caller's or of anybody's.
   *
   * "Who moved last" is the rule the whole of this follows, and insertion order
   * is what `started` keeps the map in, so the last match is the answer. Taking
   * the first would hand a three-way overlap back to the oldest driver.
   */
  function latest(forKey?: string): InFlightCommand | undefined {
    let found: InFlightCommand | undefined;
    for (const command of inFlight.values()) {
      if (forKey === undefined || browserIssuerKey(command.issuer) === forKey) {
        found = command;
      }
    }
    return found;
  }

  function show(command: InFlightCommand): void {
    shown = {
      elsewhere: command.elsewhere,
      key: browserIssuerKey(command.issuer),
    };
    clearTimer();
    args.set({
      issuer: command.issuer,
      active: true,
      elsewhere: command.elsewhere,
      command: command.command,
    });
  }

  /**
   * The caller whose row is up has nothing left in flight.
   *
   * Say it stopped, then either hand the row to whoever is still driving — two
   * at once is not supported (see the atom's docstring), and this is about not
   * lying when it happens anyway — or start the linger. Never clear it while
   * somebody is still driving.
   */
  function finish(command: InFlightCommand): void {
    const key = browserIssuerKey(command.issuer);
    args.set({
      issuer: command.issuer,
      active: false,
      elsewhere: command.elsewhere,
      // The command it just finished, kept for the linger: the row is saying
      // what happened a second ago, and dropping the line there would leave a
      // name with nothing beside it for the four seconds a person is most
      // likely to read it.
      command: command.command,
    });
    const other = latest();
    if (other !== undefined) {
      show(other);
      return;
    }
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (shown?.key !== key || latest(key) !== undefined) return;
      shown = null;
      args.set(null);
    }, BROWSER_DRIVING_LINGER_MS);
  }

  return {
    started({ requestId, issuer, elsewhere = false, command = null }) {
      if (issuer === undefined) return;
      // Deleted before it is set, so the map stays in the order commands
      // started: `Map.set` on an existing key keeps its old position.
      inFlight.delete(requestId);
      inFlight.set(requestId, { command, elsewhere, issuer });
      show({ command, elsewhere, issuer });
    },
    settled(requestId) {
      const finished = inFlight.get(requestId);
      // Nothing was recorded under this id: the app's own browsing, or a
      // command that began before this window was listening. Either way there
      // is nothing to end, and counting it would end somebody else's.
      if (finished === undefined) return;
      inFlight.delete(requestId);
      const key = browserIssuerKey(finished.issuer);
      // Somebody else started driving while this command was in the air. Their
      // row is the current one and this answer must not replace it.
      if (shown?.key !== key) return;
      // Another of this caller's commands is still in the air — including one
      // in a different window than this one was.
      const mine = latest(key);
      if (mine !== undefined) {
        show(mine);
        return;
      }
      finish(finished);
    },
    forgetOtherWindows() {
      for (const [requestId, command] of [...inFlight]) {
        if (command.elsewhere) inFlight.delete(requestId);
      }
      // Nothing shown, or what is shown is a command this window is performing:
      // nothing to correct, and the commands above are gone so a later handover
      // cannot bring one of them back.
      if (shown?.elsewhere !== true) return;
      clearTimer();
      const other = latest();
      if (other === undefined) {
        shown = null;
        args.set(null);
        return;
      }
      show(other);
    },
    dispose() {
      clearTimer();
      inFlight.clear();
      shown = null;
      args.set(null);
    },
  };
}
