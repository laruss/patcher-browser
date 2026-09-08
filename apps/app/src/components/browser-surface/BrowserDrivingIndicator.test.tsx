// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserCommandIssuer,
  BrowserDrivingCommand,
} from "@patcher/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { browserDrivingAtom } from "@/lib/browser-agent/driving";
import { BrowserDrivingIndicator } from "./BrowserDrivingIndicator";

/**
 * The one thing on screen that says an agent is driving this browser.
 *
 * What these are for: the name a person reads has to be the one *they* gave the
 * agent, and the button has to be the one that actually stops it. Both are easy
 * to get subtly wrong — a grant id instead of a label, a revoke instead of a
 * pause — and neither is visible from a type.
 */

const setPaused = vi.fn();

/** What most rows say: a command with something to name. */
const CLICK: BrowserDrivingCommand = {
  name: "page.interact",
  detail: "click e42",
};

vi.mock("@/lib/sdk", () => ({
  sdk: {
    system: {
      setBrowserAccessGrantPaused: (grantId: string, paused: boolean) =>
        setPaused(grantId, paused),
    },
  },
}));

afterEach(() => {
  cleanup();
  setPaused.mockReset();
});

function renderIndicator(
  issuer: BrowserCommandIssuer | null,
  options: { elsewhere?: boolean; command?: BrowserDrivingCommand | null } = {},
) {
  const store = createStore();
  if (issuer !== null) {
    store.set(browserDrivingAtom, {
      issuer,
      active: true,
      elsewhere: options.elsewhere === true,
      command: options.command ?? CLICK,
    });
  }
  const { queryClient } = createQueryClientTestHarness();
  const onOpenAppRoute = vi.fn();
  render(<BrowserDrivingIndicator onOpenAppRoute={onOpenAppRoute} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <JotaiProvider store={store}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </JotaiProvider>
    ),
  });
  return { onOpenAppRoute, store };
}

describe("the browser driving indicator", () => {
  it("shows nothing while the person is the only one driving", () => {
    renderIndicator(null);

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names a grant the way its person named it, and how far it reaches", () => {
    renderIndicator({
      kind: "grant",
      grantId: "bag_3k9wq2mnpx",
      label: "Claude Code",
      level: "read",
    });

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Claude Code");
    // The level in the words the settings screen uses, not the enum: "read" is
    // a value, "read pages" is what it does.
    expect(status.textContent).toContain("read pages");
    // The id is not shown: it means nothing to the person, and the label is
    // what they typed.
    expect(status.textContent).not.toContain("bag_3k9wq2mnpx");
  });

  it("says what it is doing, in the words the trace uses", () => {
    renderIndicator(
      { kind: "grant", grantId: "bag_1", label: "Claude Code", level: "read" },
      { command: { name: "navigation.open", detail: "https://bank.test/pay" } },
    );

    // The difference between an indicator a person watches and one they act on.
    // Same rendering as the caller's own trace, so the two cannot disagree
    // about what happened.
    expect(screen.getByRole("status").textContent).toContain(
      "https://bank.test/pay",
    );
  });

  it("names the command itself when there is nothing else to say", () => {
    renderIndicator(
      { kind: "grant", grantId: "bag_1", label: "Claude Code", level: "read" },
      // A read of the whole page renders as an empty line — the command *is*
      // the whole of what happened.
      { command: { name: "page.snapshot", detail: "" } },
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("page.snapshot");
    // And not a trailing separator with nothing after it, which reads as a bug
    // in the indicator rather than as a command with no detail.
    expect(status.textContent?.trimEnd().endsWith("\u00b7")).toBe(false);
  });

  it("says who even when the frame carried no command", () => {
    // A window loaded from a server that predates the field. Who is driving is
    // the whole point of the row, and dropping it over the half that is
    // missing would trade a working indicator for none.
    renderIndicator(
      { kind: "grant", grantId: "bag_1", label: "Claude Code", level: "read" },
      { command: null },
    );

    expect(screen.getByRole("status").textContent).toContain("Claude Code");
  });

  it("pauses that grant rather than revoking it", async () => {
    renderIndicator({
      kind: "grant",
      grantId: "bag_3k9wq2mnpx",
      label: "Claude Code",
      level: "read",
    });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    // Pausing, because this button is pressed mid-session: the agent holding
    // the credential needs no reconfiguring when the person changes their mind.
    await waitFor(() => {
      expect(setPaused).toHaveBeenCalledWith("bag_3k9wq2mnpx", true);
    });
    // And the offer goes away once it is done: a Pause button still sitting
    // there reads as "it did not work".
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    });
    expect(screen.getByRole("status").textContent).toContain("Paused");
  });

  it("sends a caller outside Patcher to the only lever there is", () => {
    // Nothing narrower exists: a terminal holding the app key cannot be told
    // apart from any other holder of it, so the install-wide setting is the
    // honest answer rather than a button that pretends otherwise.
    const { onOpenAppRoute } = renderIndicator({ kind: "outside" });

    expect(screen.getByRole("status").textContent).toContain(
      "Something outside Patcher",
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpenAppRoute).toHaveBeenCalledWith("/settings");
  });

  it("says when the tab being driven is in another window", () => {
    // Only one window is sent the agent's commands, so the others hear about it
    // from the server and have no tab to show. Saying "this browser" there
    // would send the person looking for a tab that is not in front of them.
    renderIndicator(
      {
        kind: "grant",
        grantId: "bag_3k9wq2mnpx",
        label: "Claude Code",
        level: "read",
      },
      { elsewhere: true },
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("in another window");
    expect(status.textContent).not.toContain("this browser");
    // The lever still works from here: pausing a grant is a call to the server,
    // not something the window doing the driving has to be asked for — which is
    // the whole reason it is worth showing this in a window that cannot see the
    // tab.
    expect(screen.getByRole("button", { name: "Pause" })).not.toBeNull();
  });

  it("names a turn inside Patcher and offers no button", () => {
    // A turn is stopped in the thread it belongs to, and a "Pause" here would
    // be a second, worse way to do that.
    renderIndicator({ kind: "thread", threadId: "thread-7" });

    expect(screen.getByRole("status").textContent).toContain(
      "An agent in Patcher",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
