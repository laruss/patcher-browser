// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  browserActivityAtom,
  type BrowserActivityEntry,
} from "@/lib/browser-agent/activity";
import { BrowserActivitySettingsControl } from "./BrowserActivitySettingsControl";

/**
 * The answer to "what did it do", once the indicator is gone.
 *
 * What these are for: the list is read to decide whether to pause or revoke a
 * grant, so the two things it must not get wrong are the order — newest first,
 * because the question is about what just happened — and the difference
 * between a command that failed and one nobody ever answered.
 */

const GRANT = {
  kind: "grant",
  grantId: "bag_1",
  label: "Claude Code",
  level: "read",
} as const;

function entry(
  overrides: Partial<BrowserActivityEntry> & { requestId: string },
): BrowserActivityEntry {
  return {
    at: 1_700_000_000_000,
    issuer: GRANT,
    command: { name: "page.interact", detail: "click e42" },
    status: { kind: "ok" },
    elsewhere: false,
    ...overrides,
  };
}

function renderControl(entries: readonly BrowserActivityEntry[]) {
  const store = createStore();
  store.set(browserActivityAtom, entries);
  render(<BrowserActivitySettingsControl />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>{children}</JotaiProvider>
    ),
  });
}

afterEach(() => {
  cleanup();
});

describe("the recent browser commands control", () => {
  it("says nothing has driven the browser rather than showing an empty box", () => {
    renderControl([]);

    expect(
      screen.getByText("Nothing outside Patcher has driven this browser."),
    ).not.toBeNull();
  });

  it("puts the newest command first, whatever order they were recorded in", () => {
    renderControl([
      entry({ requestId: "r1", command: { name: "tabs.open", detail: "https://first.test/" } }),
      entry({ requestId: "r2", command: { name: "tabs.open", detail: "https://last.test/" } }),
    ]);

    // The log is kept oldest-first, which is what makes its cap drop the
    // oldest; a list read to answer "what just happened" is read from the top.
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("https://last.test/");
    expect(rows[1]?.textContent).toContain("https://first.test/");
  });

  it("names the caller, the command and its line", () => {
    renderControl([
      entry({
        requestId: "r1",
        command: { name: "page.interact", detail: 'fill e2 "hello"' },
      }),
    ]);

    const row = screen.getAllByRole("listitem")[0];
    // The label the person themselves typed, and the same words the caller's
    // own trace uses for the command — including what was filled in, which is
    // the point of keeping a record at all.
    expect(row?.textContent).toContain("Claude Code");
    expect(row?.textContent).toContain("page.interact");
    expect(row?.textContent).toContain('fill e2 "hello"');
    expect(row?.textContent).toContain(
      new Date(1_700_000_000_000).toLocaleTimeString(),
    );
  });

  it("tells a refusal apart from a command nobody answered", () => {
    renderControl([
      entry({ requestId: "r1", status: { kind: "failed", code: "unknown_tab" } }),
      entry({ requestId: "r2", status: { kind: "unanswered" } }),
      entry({ requestId: "r3", status: { kind: "running" } }),
    ]);

    const rows = screen.getAllByRole("listitem");
    // Newest first, so the running one is at the top.
    expect(rows[0]?.textContent).toContain("running");
    // Not "failed": the command timed out or the window performing it went
    // away, and whether the browser did it is not known.
    expect(rows[1]?.textContent).toContain("no answer");
    expect(rows[2]?.textContent).toContain("failed · unknown_tab");
  });

  it("still shows a command the frame did not describe", () => {
    // A window loaded from a server that predates the field. Who and when are
    // still worth a row.
    renderControl([entry({ requestId: "r1", command: null })]);

    const row = screen.getAllByRole("listitem")[0];
    expect(row?.textContent).toContain("Claude Code");
    expect(row?.textContent).toContain("a browser command");
  });
});
