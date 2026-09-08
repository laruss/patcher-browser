import { describe, expect, it } from "vitest";
import type { BrowserCommandIssuer } from "@patcher/server-contract";
import {
  BROWSER_ACTIVITY_MAX_ENTRIES,
  createBrowserActivityLog,
  type BrowserActivityEntry,
} from "./activity";

/**
 * The record behind "what did it do".
 *
 * Its rules are the indicator's, minus the linger and plus one: a row has to
 * end up saying something true about a command *forever*, not for the four
 * seconds a person is looking. So the cases here are the ones that leave a row
 * lying — a settle that never comes, an id nobody started, a reconnect after
 * which the other window's commands can no longer reach this one.
 */

const GRANT: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "bag_1",
  label: "Claude Code",
  level: "read",
};
const CLICK = { name: "page.interact", detail: "click e42" } as const;

function log(start = 1_000) {
  const published: Array<readonly BrowserActivityEntry[]> = [];
  let clock = start;
  const activity = createBrowserActivityLog({
    now: () => clock,
    set: (entries) => {
      published.push(entries);
    },
  });
  return {
    activity,
    published,
    /** Move the clock, so two rows do not claim the same instant. */
    tick(by = 1_000) {
      clock += by;
    },
    get entries(): readonly BrowserActivityEntry[] {
      return published.at(-1) ?? [];
    },
  };
}

describe("the browser activity log", () => {
  it("keeps nothing about the person's own browsing", () => {
    const record = log();

    record.activity.started({ requestId: "r1", issuer: undefined });
    record.activity.settled("r1", { ok: true, error: null });

    // A record of "what drove this browser" that also holds every click the
    // person made is not that record — and it is the same rule the indicator
    // follows about an absent issuer.
    expect(record.published).toEqual([]);
  });

  it("writes down who, when and what", () => {
    const record = log(1_700_000_000_000);

    record.activity.started({
      requestId: "r1",
      issuer: GRANT,
      command: CLICK,
    });

    expect(record.entries).toEqual([
      {
        requestId: "r1",
        at: 1_700_000_000_000,
        issuer: GRANT,
        command: CLICK,
        status: { kind: "running" },
        elsewhere: false,
      },
    ]);
  });

  it("pairs each settle with the command it belongs to", () => {
    const record = log();

    record.activity.started({ requestId: "r1", issuer: GRANT, command: CLICK });
    record.tick();
    record.activity.started({ requestId: "r2", issuer: GRANT, command: CLICK });
    record.activity.settled("r1", { ok: true, error: null });

    // Two of one caller's commands overlap all the time — this is a session,
    // not a request/response — and a settle applied to "the last one" would
    // close the wrong row and leave the finished one running.
    expect(record.entries.map((entry) => entry.status)).toEqual([
      { kind: "ok" },
      { kind: "running" },
    ]);
  });

  it("keeps a failure's own code, which is the reason to read this at all", () => {
    const record = log();

    record.activity.started({ requestId: "r1", issuer: GRANT, command: CLICK });
    record.activity.settled("r1", { ok: false, error: "unknown_tab" });

    expect(record.entries[0]?.status).toEqual({
      kind: "failed",
      code: "unknown_tab",
    });
  });

  it("says no answer rather than claiming an outcome nobody has", () => {
    const record = log();

    record.activity.started({ requestId: "r1", issuer: GRANT, command: CLICK });
    // The command timed out, or the window performing it went away. Whether
    // the browser did it is not known here and must not be implied.
    record.activity.settled("r1", null);

    expect(record.entries[0]?.status).toEqual({ kind: "unanswered" });
  });

  it("ignores the end of a command it never saw start", () => {
    const record = log();

    record.activity.started({ requestId: "r1", issuer: GRANT, command: CLICK });
    record.activity.settled("a-command-this-window-never-saw", {
      ok: true,
      error: null,
    });

    // What a window gets on the frame after it registers. Inventing a row for
    // it would put a command in the record with no time, no name and no
    // caller — and closing "the newest" instead would end r1, which is still
    // running.
    expect(record.entries.map((entry) => entry.status)).toEqual([
      { kind: "running" },
    ]);
  });

  it("keeps the newest commands and drops the oldest", () => {
    const record = log();

    for (let index = 0; index < BROWSER_ACTIVITY_MAX_ENTRIES + 5; index += 1) {
      record.activity.started({
        requestId: `r${index}`,
        issuer: GRANT,
        command: CLICK,
      });
      record.tick(1);
    }

    // A session an agent leaves running overnight is the case this bounds, and
    // the end of it a person needs is the recent end.
    expect(record.entries).toHaveLength(BROWSER_ACTIVITY_MAX_ENTRIES);
    expect(record.entries[0]?.requestId).toBe("r5");
    expect(record.entries.at(-1)?.requestId).toBe(
      `r${BROWSER_ACTIVITY_MAX_ENTRIES + 4}`,
    );
  });

  it("ends the other window's open commands on a reconnect, and only those", () => {
    const record = log();

    record.activity.started({
      requestId: "mirrored-open",
      issuer: GRANT,
      command: CLICK,
      elsewhere: true,
    });
    record.activity.started({
      requestId: "mirrored-done",
      issuer: GRANT,
      command: CLICK,
      elsewhere: true,
    });
    record.activity.settled("mirrored-done", { ok: true, error: null });
    record.activity.started({ requestId: "local", issuer: GRANT, command: CLICK });

    record.activity.forgetOtherWindows();

    expect(
      Object.fromEntries(
        record.entries.map((entry) => [entry.requestId, entry.status.kind]),
      ),
    ).toEqual({
      // Its settle was sent while this socket was down and nothing resends it.
      "mirrored-open": "unanswered",
      // Already answered: a reconnect is not news about it.
      "mirrored-done": "ok",
      // This window is performing it, and it answers to a promise rather than
      // to the socket.
      local: "running",
    });
  });

  it("writes nothing when a reconnect has nothing to correct", () => {
    const record = log();
    record.activity.started({ requestId: "local", issuer: GRANT, command: CLICK });
    const writes = record.published.length;

    record.activity.forgetOtherWindows();

    // Publishing an identical list on every reconnect is a re-render of the
    // whole list for no change, in a window whose renderer may be throttled.
    expect(record.published.length).toBe(writes);
  });

  it("replaces the row it changed and leaves the others alone", () => {
    const record = log();
    record.activity.started({ requestId: "r1", issuer: GRANT, command: CLICK });
    record.activity.started({ requestId: "r2", issuer: GRANT, command: CLICK });
    const before = record.entries;

    record.activity.settled("r1", { ok: true, error: null });

    // The list is React state: a row mutated in place is a row that does not
    // re-render, and copying every row instead would re-render the whole list
    // on every command an agent runs.
    expect(record.entries[0]).not.toBe(before[0]);
    expect(record.entries[1]).toBe(before[1]);
  });

  it("clears when the window goes away", () => {
    const record = log();
    record.activity.started({ requestId: "r1", issuer: GRANT, command: CLICK });

    record.activity.dispose();

    expect(record.entries).toEqual([]);
  });
});
