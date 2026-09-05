// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemBrowserAccessGrant } from "@patcher/server-contract";
import { BrowserAccessGrantsSettingsControl } from "./SettingsView";

/**
 * The list a person comes to when an agent's browser credential is not doing
 * what they expect.
 *
 * A grant has three states and they are not interchangeable: live, paused —
 * stopped now, resumable — and revoked, which has no undo. What is checked here
 * is that each renders as itself and offers only what is true of it, because a
 * row that offered "Resume" on a revoked grant would be promising something the
 * server refuses.
 */

const BASE: SystemBrowserAccessGrant = {
  id: "bag_3k9wq2mnpx",
  label: "Claude Code",
  level: "read",
  createdAt: Date.parse("2026-09-01T10:00:00Z"),
  lastUsedAt: Date.parse("2026-09-05T08:30:00Z"),
  pausedAt: null,
  revokedAt: null,
};

function renderControl(
  grants: readonly SystemBrowserAccessGrant[] | undefined,
) {
  const onRevoke = vi.fn();
  const onSetPaused = vi.fn();
  render(
    <BrowserAccessGrantsSettingsControl
      grants={grants}
      revokingGrantId={null}
      onRevoke={onRevoke}
      pausingGrantId={null}
      onSetPaused={onSetPaused}
    />,
  );
  return { onRevoke, onSetPaused };
}

afterEach(cleanup);

describe("the browser access grants list", () => {
  it("does not report an unanswered read as no grants", () => {
    // "No grants have been issued" is a claim about the install; a pending or
    // failed read has not established it.
    renderControl(undefined);

    expect(screen.getByText("Loading grants…")).toBeTruthy();
  });

  it("offers a live grant both ways to stop it", () => {
    const { onSetPaused } = renderControl([BASE]);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(onSetPaused).toHaveBeenCalledWith(BASE.id, true);
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
  });

  it("says a paused grant is paused, and offers to resume it", () => {
    const { onSetPaused } = renderControl([
      { ...BASE, pausedAt: Date.parse("2026-09-05T09:00:00Z") },
    ]);

    // The answer to the question this list gets opened with — why has it
    // stopped working — before any date.
    expect(screen.getByText(/paused/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(onSetPaused).toHaveBeenCalledWith(BASE.id, false);
  });

  it("offers nothing on a revoked grant", () => {
    renderControl([{ ...BASE, revokedAt: Date.parse("2026-09-04T09:00:00Z") }]);

    // Still listed — what was taken back and when is why somebody is reading —
    // but revoking has no undo, so neither button would do anything.
    expect(screen.getByText(BASE.label)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
