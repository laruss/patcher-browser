// @vitest-environment jsdom

import type { TerminalSession } from "@patcher/server-contract";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadTerminalContent } from "./ThreadTerminalContent";
import type { ThreadTerminalController } from "./useThreadTerminalController";

const threadTerminalView = vi.hoisted(() =>
  vi.fn((_props: { autoFocus: boolean; isPanelOpen: boolean }) => null),
);

vi.mock("./ThreadTerminalView", () => ({
  ThreadTerminalView: threadTerminalView,
}));

const session: TerminalSession = {
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
};

function controller(
  isPanelOpen: boolean,
  activeSession: TerminalSession = session,
): ThreadTerminalController {
  return {
    activeSession,
    activeTerminalId: session.id,
    canCreateTerminal: true,
    closingTerminalId: null,
    emptyTerminalMessage: "No terminals",
    handleActiveTerminalSessionChange: () => undefined,
    handleActiveTerminalTitleChange: () => undefined,
    handleActiveTerminalUserInput: () => undefined,
    handleClosePanel: () => undefined,
    handleCloseTerminal: () => undefined,
    handleCreateTerminal: () => undefined,
    handleSelectTerminal: () => undefined,
    hasTerminalQueryError: false,
    isCreateTerminalPending: false,
    isPanelOpen,
    isTerminalQueryLoading: false,
    showTerminalPlaceholders: false,
    shouldRetainActiveTerminalView: false,
    terminalBodyMessage: "No terminals",
    visibleSessions: [activeSession],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadTerminalContent", () => {
  it("says a confined terminal is confined, and what that means", () => {
    // The refusal a person meets is `operation not permitted` from the shell
    // itself, which the app cannot intercept — so the fact has to stand where
    // they are typing rather than be attached to the error.
    const rendered = render(
      <ThreadTerminalContent
        autoFocus={false}
        controller={controller(true, { ...session, sandboxed: true })}
      />,
    );

    // The word is its own element, so read the sentence it sits in.
    const notice = rendered.getByText(/Sandboxed/).closest("p");
    expect(notice?.textContent).toContain("outside the workspace are refused");
    expect(notice?.textContent).toContain("credential files");
    // Named because the confinement is the filesystem's on purpose: without
    // this sentence the notice invites the opposite reading.
    expect(notice?.textContent).toContain("network is not restricted");
    // And the terminal still mounts under it.
    expect(threadTerminalView).toHaveBeenCalledTimes(1);
  });

  it("says nothing about a terminal a person opened themselves", () => {
    const rendered = render(
      <ThreadTerminalContent autoFocus={false} controller={controller(true)} />,
    );

    expect(rendered.queryByText(/Sandboxed/)).toBeNull();
    expect(threadTerminalView).toHaveBeenCalledTimes(1);
  });

  it("does not mount the terminal view until the panel opens", () => {
    const rendered = render(
      <ThreadTerminalContent
        autoFocus={false}
        controller={controller(false)}
      />,
    );

    expect(threadTerminalView).not.toHaveBeenCalled();
    expect(rendered.container.firstChild).toBeNull();

    rendered.rerender(
      <ThreadTerminalContent autoFocus controller={controller(true)} />,
    );

    expect(threadTerminalView).toHaveBeenCalledOnce();
    expect(threadTerminalView.mock.calls[0]?.[0]).toMatchObject({
      autoFocus: true,
      isPanelOpen: true,
    });
  });
});
