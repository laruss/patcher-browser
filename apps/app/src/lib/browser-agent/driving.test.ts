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
 * the air when the next arrives, and a second caller starting while the first
 * one's answer is on its way back.
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
  return {
    tracker,
    states,
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

    driving.tracker.started(undefined);
    driving.tracker.settled(undefined);

    // The common case — a click, a page script, a plugin's toolbar handler —
    // and an indicator that came on for it would be on all the time.
    expect(driving.states).toEqual([]);
  });

  it("stays up between one agent's commands, and goes away after the last", () => {
    vi.useFakeTimers();
    const driving = track();

    driving.tracker.started(GRANT);
    driving.tracker.settled(GRANT);
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS - 1);
    // A session is a burst of short commands; blinking out between them would
    // read as "it stopped" once a second.
    expect(driving.last?.issuer).toEqual(GRANT);

    driving.tracker.started(GRANT);
    driving.tracker.settled(GRANT);
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
    driving.tracker.started(GRANT);
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS * 10);

    expect(driving.last).toEqual({ issuer: GRANT, active: true });
  });

  it("counts overlapping commands rather than the last one to answer", () => {
    vi.useFakeTimers();
    const driving = track();

    driving.tracker.started(GRANT);
    driving.tracker.started(GRANT);
    driving.tracker.settled(GRANT);
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS * 2);

    expect(driving.last).toEqual({ issuer: GRANT, active: true });
  });

  it("shows whoever is driving now, not whoever answered last", () => {
    vi.useFakeTimers();
    const driving = track();

    driving.tracker.started(GRANT);
    driving.tracker.started(OTHER_GRANT);
    // The first agent's answer arrives after the second one started. Its
    // settle must not put the first name back in the chrome.
    driving.tracker.settled(GRANT);

    expect(driving.last?.issuer).toEqual(OTHER_GRANT);
    vi.advanceTimersByTime(BROWSER_DRIVING_LINGER_MS * 2);
    // …and must not take the second one's indicator down either.
    expect(driving.last?.issuer).toEqual(OTHER_GRANT);
  });

  it("clears when the window goes away", () => {
    vi.useFakeTimers();
    const driving = track();

    driving.tracker.started(GRANT);
    driving.tracker.dispose();

    expect(driving.last).toBeNull();
    // The timer went with it: a fired timer after teardown would write to a
    // store the window no longer has.
    expect(vi.getTimerCount()).toBe(0);
  });
});
