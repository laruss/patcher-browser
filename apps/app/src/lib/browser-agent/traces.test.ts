import { describe, expect, it } from "vitest";
import type { BrowserCommandIssuer } from "@patcher/server-contract";
import { createBrowserTraceRegistry } from "./traces";

/**
 * Whose trace a command lands in.
 *
 * With one recorder per window the answer was "whoever's, whichever" — and the
 * three ways that went wrong (a refusal to start, another agent's steps in your
 * log, another agent's log in your `tracing-stop`) all look like a working
 * trace to the caller that ends up with it.
 */

const GRANT: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "grant_1",
  label: "Claude Code",
  level: "full",
};
const RENAMED: BrowserCommandIssuer = { ...GRANT, label: "Claude, at work" };
const OTHER: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "grant_2",
  label: "Codex",
  level: "full",
};
const TURN: BrowserCommandIssuer = { kind: "thread", threadId: "thread_1" };

describe("the browser trace registry", () => {
  it("gives one caller the same recorder every time", () => {
    const traces = createBrowserTraceRegistry();

    expect(traces.for(GRANT)).toBe(traces.for(GRANT));
    // Same credential, new name: a trace does not restart because a person
    // renamed the grant halfway through it.
    expect(traces.for(RENAMED)).toBe(traces.for(GRANT));
  });

  it("keeps callers apart, so one can trace while another does", () => {
    const traces = createBrowserTraceRegistry();
    const mine = traces.for(GRANT);
    mine.start(0, false);

    expect(traces.for(OTHER)).not.toBe(mine);
    expect(traces.for(TURN)).not.toBe(mine);
    // The refusal that used to follow is gone: starting one trace no longer
    // uses up the window's only recorder.
    expect(traces.for(OTHER).start(0, false)).toBe(true);
    // And the caller that is recording still gets its own log back, with two
    // other callers' commands having gone through the registry in between.
    expect(traces.for(GRANT)).toBe(mine);
  });

  it("keeps a running trace and forgets a finished one", () => {
    const traces = createBrowserTraceRegistry();
    const recording = traces.for(GRANT);
    recording.start(0, false);
    traces.for(OTHER);
    traces.for(TURN);

    // Every command that arrives sweeps: a window that served a hundred threads
    // would otherwise hold a slot for each, most of them for a caller it will
    // never see again. The one still recording is the one that stays.
    expect(traces.size).toBe(2);
    expect(traces.for(GRANT)).toBe(recording);

    recording.stop(1);
    traces.for(OTHER);

    expect(traces.size).toBe(1);
  });

  it("treats commands nobody is named on as one caller", () => {
    const traces = createBrowserTraceRegistry();

    // The app's own work and a plugin in its own process arrive the same way,
    // which is the same "they are one caller" said elsewhere about them.
    expect(traces.for(undefined)).toBe(traces.for(undefined));
    expect(traces.for(undefined)).not.toBe(traces.for(GRANT));
  });

  it("drops everything when the window goes", () => {
    const traces = createBrowserTraceRegistry();
    const before = traces.for(GRANT);
    before.start(0, false);

    traces.dispose();

    const after = traces.for(GRANT);
    expect(after).not.toBe(before);
    // A trace held in memory does not survive its window, and pretending it
    // does would hand the next caller somebody else's steps.
    expect(after.active).toBe(false);
  });
});
