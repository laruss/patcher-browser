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
import type { BrowserCommandIssuer } from "@patcher/server-contract";
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

function renderIndicator(issuer: BrowserCommandIssuer | null) {
  const store = createStore();
  if (issuer !== null) {
    store.set(browserDrivingAtom, { issuer, active: true });
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
  });

  it("sends a caller outside Patcher to the only lever there is", () => {
    // Nothing narrower exists: a terminal holding the app key cannot be told
    // apart from any other holder of it, so the install-wide setting is the
    // honest answer rather than a button that pretends otherwise.
    const { onOpenAppRoute } = renderIndicator({ kind: "outside" });

    expect(screen.getByRole("status").textContent).toContain(
      "An agent outside Patcher",
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpenAppRoute).toHaveBeenCalledWith("/settings");
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
