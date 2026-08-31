import type { TerminalSession } from "@patcher/server-contract";
import { describe, expect, it } from "vitest";
import {
  isVisibleTerminalSession,
  shouldAutoCloseCleanTerminalSession,
  shouldAutoCloseCleanTerminalSessionsForPanel,
  shouldCloseDisconnectedTerminalSession,
  terminalTabStatusLabel,
} from "./useThreadTerminalController";

function terminalSession(overrides: Partial<TerminalSession>): TerminalSession {
  return {
    id: "term_1",
    threadId: "thr_1",
    environmentId: "env_1",
    hostId: "host_1",
    title: "Terminal",
    initialCwd: "/workspace",
    cols: 100,
    rows: 30,
    status: "running",
    sandboxed: false,
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

describe("terminalTabStatusLabel", () => {
  it("says a running terminal is confined, and nothing when it is not", () => {
    // The tab is the only place a terminal is named while the panel is closed,
    // and the word matches the `Sandbox` column in `patcher terminal list`.
    expect(terminalTabStatusLabel(terminalSession({ sandboxed: true }))).toBe(
      "sandboxed",
    );
    expect(terminalTabStatusLabel(terminalSession({}))).toBeNull();
  });

  it("lets a status win over the confinement", () => {
    // A disconnected terminal is the more urgent fact about it; the panel still
    // carries the confinement while the terminal is up.
    expect(
      terminalTabStatusLabel(
        terminalSession({ sandboxed: true, status: "disconnected" }),
      ),
    ).toBe("disconnected");
    expect(
      terminalTabStatusLabel(
        terminalSession({ sandboxed: true, status: "exited" }),
      ),
    ).toBe("exited");
  });

  it("says nothing about a tab whose session has not loaded", () => {
    expect(terminalTabStatusLabel(undefined)).toBeNull();
  });
});

describe("terminal visibility", () => {
  it("shows disconnected sessions only while retaining a mounted terminal view", () => {
    const disconnected = terminalSession({
      id: "term_disconnected",
      status: "disconnected",
      sandboxed: false,
    });

    expect(
      isVisibleTerminalSession({
        retainedTerminalViewId: null,
        session: disconnected,
      }),
    ).toBe(false);
    expect(
      isVisibleTerminalSession({
        retainedTerminalViewId: "term_disconnected",
        session: disconnected,
      }),
    ).toBe(true);
    expect(
      isVisibleTerminalSession({
        retainedTerminalViewId: null,
        session: terminalSession({ status: "running" }),
      }),
    ).toBe(true);
  });

  it("cleans up only disconnected sessions without a retained terminal view", () => {
    const disconnected = terminalSession({
      id: "term_disconnected",
      status: "disconnected",
      sandboxed: false,
    });

    expect(
      shouldCloseDisconnectedTerminalSession({
        retainedTerminalViewId: null,
        session: disconnected,
      }),
    ).toBe(true);
    expect(
      shouldCloseDisconnectedTerminalSession({
        retainedTerminalViewId: "term_disconnected",
        session: disconnected,
      }),
    ).toBe(false);
    expect(
      shouldCloseDisconnectedTerminalSession({
        retainedTerminalViewId: null,
        session: terminalSession({ status: "running" }),
      }),
    ).toBe(false);
  });

  it("auto-closes only clean UI-created terminal sessions", () => {
    const cleanUiCreated = terminalSession({ id: "term_ui" });
    const external = terminalSession({ id: "term_external" });
    const dirty = terminalSession({ id: "term_dirty" });
    const userInput = terminalSession({
      id: "term_user_input",
      lastUserInputAt: 2,
    });

    expect(
      shouldAutoCloseCleanTerminalSession({
        dirtyTerminalIds: new Set(["term_dirty"]),
        session: cleanUiCreated,
        uiCreatedTerminalIds: new Set(["term_ui", "term_dirty"]),
      }),
    ).toBe(true);
    expect(
      shouldAutoCloseCleanTerminalSession({
        dirtyTerminalIds: new Set(),
        session: external,
        uiCreatedTerminalIds: new Set(["term_ui"]),
      }),
    ).toBe(false);
    expect(
      shouldAutoCloseCleanTerminalSession({
        dirtyTerminalIds: new Set(["term_dirty"]),
        session: dirty,
        uiCreatedTerminalIds: new Set(["term_dirty"]),
      }),
    ).toBe(false);
    expect(
      shouldAutoCloseCleanTerminalSession({
        dirtyTerminalIds: new Set(),
        session: userInput,
        uiCreatedTerminalIds: new Set(["term_user_input"]),
      }),
    ).toBe(false);
  });

  it("preserves clean terminals while a compact panel remains persisted", () => {
    expect(
      shouldAutoCloseCleanTerminalSessionsForPanel({
        isPanelOpen: false,
        isPanelPersistedOpen: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoCloseCleanTerminalSessionsForPanel({
        isPanelOpen: true,
        isPanelPersistedOpen: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoCloseCleanTerminalSessionsForPanel({
        isPanelOpen: false,
        isPanelPersistedOpen: false,
      }),
    ).toBe(true);
  });
});
