import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserCommandIssuer } from "@patcher/server-contract";
import {
  BROWSER_DRIVING_LINGER_MS,
  createBrowserDrivingTracker,
  type BrowserDrivingState,
} from "./driving";

/**
 * What the chrome is told about who is driving.
 *
 * The cases here are the ones a real `patcher browser` session produces and a
 * single command does not: a burst of commands with gaps, a command still in
 * the air when the next arrives, a second caller starting while the first one's
 * answer is on its way back — and one caller with a command in this window and
 * another in a different one, which is the state two review rounds found the
 * per-caller version of this getting wrong.
 */

const GRANT: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "bag_1",
  label: "Claude Code",
  level: "read",
};
const OTHER_GRANT: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "bag_2",
  label: "Codex",
  level: "full",
};

function track() {
  const states: Array<BrowserDrivingState | null> = [];
  const tracker = createBrowserDrivingTracker({
    set: (state) => {
      states.push(state);
    },
  });
  let commands = 0;
  return {
    tracker,
    states,
    /**
     * Start a command and hand back the id it was recorded under, so a test can
     * end *that* command rather than "one of this caller's".
     */
    start(
      issuer: BrowserCommandIssuer | undefined,
      options: { elsewhere?: boolean } = {},
    ): string {
      commands += 1;
      const requestId = `r${commands}`;
      tracker.started({ requestId, issuer, ...options });
      return requestId;
    },
    get last() {
      return states.at(-1);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the browser driving tracker", () => {
  it("says nothing about the app's own browsing", () => {
    const driving = track();

    driving.tracker.settled(driving.start(undefined));

    // The common case — a click, a page script, a plugin's toolbar handler —
    // and an indicator that came on for it would be on all the time.
    expect(driving.states).toEqual([]);
  });

  it("stays up between one agent's commands, and goes away after the last", () => {
    vi.useFakeTimers();
    const driving = track();

    driving.tracker.settled(driving.start(GRANT));
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS - 1);
    // A session is a burst of short commands; blinking out between them would
    // read as "it stopped" once a second.
    expect(driving.last?.issuer).toEqual(GRANT);

    driving.tracker.settled(driving.start(GRANT));
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS - 1);
    expect(driving.last?.issuer).toEqual(GRANT);

    vi.advanceTimersByTime(2);
    expect(driving.last).toBeNull();
  });

  it("stays up while a slow command is still in the air", () => {
    vi.useFakeTimers();
    const driving = track();

    // `patcher browser wait --network-idle` can take half a minute, and it is
    // exactly when an agent is doing something slow that a person wants to know
    // it is happening.
    driving.start(GRANT);
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS * 10);

    expect(driving.last).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: false,
    });
  });

  it("counts overlapping commands rather than the last one to answer", () => {
    vi.useFakeTimers();
    const driving = track();

    const first = driving.start(GRANT);
    driving.start(GRANT);
    driving.tracker.settled(first);
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS * 2);

    expect(driving.last).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: false,
    });
  });

  it("does not blink between one caller's overlapping commands", () => {
    vi.useFakeTimers();
    const driving = track();
    const third: BrowserCommandIssuer = { kind: "outside" };

    // Three in the air, two of them one caller's. Sabotaging the "this caller
    // still has something running" branch left every other assertion here
    // green, because the general handover happens to pick the same name — so
    // what this pins is what that branch is *for*.
    const first = driving.start(GRANT);
    driving.start(third);
    const last = driving.start(GRANT);
    const before = driving.states.length;

    driving.tracker.settled(last);

    // One write, and it is active. Falling through to the general handover
    // writes `active: false` first, which is the pulse in the chrome stopping
    // and starting again for an agent that never stopped — and it hands the row
    // to whoever started most recently *of the others*, so the name changes
    // while the agent it named is still working.
    expect(driving.states.slice(before)).toEqual([
      { issuer: GRANT, active: true, elsewhere: false },
    ]);
    driving.tracker.settled(first);
    // And now it does hand over, because this caller has nothing left.
    expect(driving.last?.issuer).toEqual(third);
  });

  it("ignores the end of a command it never saw start", () => {
    vi.useFakeTimers();
    const driving = track();

    // What a window gets when it registers — or reconnects — part-way through
    // somebody's command: the end of one whose beginning went to a socket that
    // did not exist yet. Meanwhile the same caller has another command running
    // that this window *did* see.
    driving.start(GRANT);
    driving.tracker.settled("a-command-this-window-never-saw");

    // Counting it would take that one's row down while it is still driving,
    // which is the one thing this must never do.
    expect(driving.last).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: false,
    });
  });

  it("shows whoever is driving now, not whoever answered last", () => {
    vi.useFakeTimers();
    const driving = track();

    const first = driving.start(GRANT);
    driving.start(OTHER_GRANT);
    // The first agent's answer arrives after the second one started. Its
    // settle must not put the first name back in the chrome.
    driving.tracker.settled(first);

    expect(driving.last?.issuer).toEqual(OTHER_GRANT);
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS * 2);
    // …and must not take the second one's indicator down either.
    expect(driving.last?.issuer).toEqual(OTHER_GRANT);
  });

  it("hands over to whoever started most recently", () => {
    vi.useFakeTimers();
    const driving = track();
    const third: BrowserCommandIssuer = { kind: "outside" };

    driving.start(GRANT);
    driving.start(OTHER_GRANT);
    driving.tracker.settled(driving.start(third));

    // Not the oldest survivor: "who moved last" is the rule the rest of this
    // follows, and a three-way overlap is where taking the first map entry
    // quietly stops obeying it.
    expect(driving.last?.issuer).toEqual(OTHER_GRANT);
  });

  it("hands over rather than saying nobody is driving", () => {
    vi.useFakeTimers();
    const driving = track();

    // Both are mid-command; the second one answers first. Letting the linger
    // timer run out here would take the indicator down while the first agent is
    // still working — the one thing this component must never do.
    const first = driving.start(GRANT);
    driving.tracker.settled(driving.start(OTHER_GRANT));

    expect(driving.last).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: false,
    });
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS * 2);
    expect(driving.last).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: false,
    });

    driving.tracker.settled(first);
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS + 1);
    expect(driving.last).toBeNull();
  });

  it("keeps saying which window a command was in, including as it settles", () => {
    vi.useFakeTimers();
    const driving = track();

    // What a window that is not serving the commands gets: the server's
    // `browser-driving` signal, whose whole content is who, which phase, and
    // which command.
    const mirrored = driving.start(GRANT, { elsewhere: true });
    expect(driving.last).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: true,
    });

    // The settle carries no news about *where* — so it is read from what the
    // start recorded. Getting this wrong would have the row flip to "this
    // browser" for the four seconds it lingers, which is the moment a person is
    // most likely to read it.
    driving.tracker.settled(mirrored);

    expect(driving.last).toEqual({
      issuer: GRANT,
      active: false,
      elsewhere: true,
    });
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS + 1);
    expect(driving.last).toBeNull();
  });

  it("hands over between windows without carrying the wrong one's place", () => {
    vi.useFakeTimers();
    const driving = track();

    // A window can be both in one moment of its life: it serves the commands
    // while it is the primary host, and hears about the other window's for as
    // long as it is not. A handover between the two must not hand over the
    // place along with the name.
    driving.start(GRANT, { elsewhere: true });
    driving.tracker.settled(driving.start(OTHER_GRANT));

    expect(driving.last).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: true,
    });
  });

  it("tells one caller's two windows apart as they settle", () => {
    vi.useFakeTimers();
    const driving = track();

    // The state per-caller bookkeeping could not hold, and the reason this is
    // keyed by command: *one* grant with a command in this window and another
    // in the window that was promoted while this one's socket blipped.
    driving.start(GRANT);
    const mirrored = driving.start(GRANT, { elsewhere: true });

    driving.tracker.settled(mirrored);

    // The row goes back to naming a command that is running here. One place
    // shared between the two left it saying "in another window" about a tab in
    // this one.
    expect(driving.last).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: false,
    });
  });

  it("keeps one caller's local command when its mirrored one is dropped", () => {
    vi.useFakeTimers();
    const driving = track();

    // The same state, ended the other way: the reconnect comes first. One entry
    // for both commands meant this deleted the local one too, and the row went
    // down while a tab in this window was still being driven.
    driving.start(GRANT);
    driving.start(GRANT, { elsewhere: true });

    driving.tracker.forgetOtherWindows();

    expect(driving.last).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: false,
    });
  });

  it("forgets another window's driver without forgetting this window's own", () => {
    vi.useFakeTimers();
    const driving = track();

    // Two callers this time, one per window: this window's own most recently,
    // so that is what is shown.
    driving.start(GRANT, { elsewhere: true });
    const own = driving.start(OTHER_GRANT);

    driving.tracker.forgetOtherWindows();

    // The local one survives — it settles when its command answers, whatever
    // the socket did — and the mirrored one is gone rather than waiting to be
    // handed the row back by a settle that will never arrive.
    expect(driving.last).toEqual({
      issuer: OTHER_GRANT,
      active: true,
      elsewhere: false,
    });
    driving.tracker.settled(own);
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS + 1);
    expect(driving.last).toBeNull();
  });

  it("hands the row back to this window when the mirrored one is dropped", () => {
    vi.useFakeTimers();
    const driving = track();

    // The other order: this window's command started first, so the row is
    // showing the other window's when the reconnect happens.
    driving.start(OTHER_GRANT);
    driving.start(GRANT, { elsewhere: true });
    expect(driving.last?.issuer).toEqual(GRANT);

    driving.tracker.forgetOtherWindows();

    // Not cleared: something is still driving, and it is this window doing it.
    expect(driving.last).toEqual({
      issuer: OTHER_GRANT,
      active: true,
      elsewhere: false,
    });
  });

  it("clears when the window goes away, timer and all", () => {
    vi.useFakeTimers();
    const driving = track();

    // Settled, not just started: only a settle arms the linger timer, so a
    // teardown after `started` alone would find nothing to clear and this would
    // pass with `dispose` doing nothing at all.
    driving.tracker.settled(driving.start(GRANT));
    expect(vi.getTimerCount()).toBe(1);

    driving.tracker.dispose();

    expect(driving.last).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    // And nothing writes to a store the window no longer has.
    const writes = driving.states.length;
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS * 2);
    expect(driving.states.length).toBe(writes);
  });
});
