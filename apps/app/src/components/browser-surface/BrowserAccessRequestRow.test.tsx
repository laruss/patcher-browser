// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemBrowserAccessRequest } from "@patcher/server-contract";
import { BrowserAccessRequestRow } from "./BrowserAccessRequestRow";

/**
 * The question a program outside Patcher puts to the person (#135).
 *
 * What is checked is that the row says only what is known — the name is the
 * program's own claim, the reason its own words — and that each button answers
 * what it says, including the one that answers with less.
 */

const REQUEST: SystemBrowserAccessRequest = {
  id: "bar_1",
  label: "Claude Code",
  level: "interact",
  reason: "fill in the form you opened",
  createdAt: 0,
  expiresAt: 600_000,
};

function renderRow(request: SystemBrowserAccessRequest = REQUEST) {
  const onDecide = vi.fn();
  render(
    <BrowserAccessRequestRow
      request={request}
      waitingBehind={2}
      disabled={false}
      onDecide={onDecide}
    />,
  );
  return { onDecide };
}

describe("BrowserAccessRequestRow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("names the program as it names itself, the level, and its reason as its own words", () => {
    renderRow();

    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("calls itself “Claude Code”");
    expect(text).toContain("Read and act");
    expect(text).toContain("“fill in the form you opened”");
    expect(text).toContain("2 more waiting");
  });

  it("will not take a click in the moment it appears", () => {
    const { onDecide } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onDecide).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onDecide).toHaveBeenCalledWith({ decision: "allow" });
  });

  it("answers with less, or with no", () => {
    const { onDecide } = renderRow();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    fireEvent.click(screen.getByRole("button", { name: "Read pages only" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(onDecide.mock.calls).toEqual([
      [{ decision: "allow", level: "read" }],
      [{ decision: "deny" }],
    ]);
  });

  it("offers no lower answer to a request that is already the lowest", () => {
    renderRow({ ...REQUEST, level: "read" });

    expect(
      screen.queryByRole("button", { name: "Read pages only" }),
    ).toBeNull();
  });
});
