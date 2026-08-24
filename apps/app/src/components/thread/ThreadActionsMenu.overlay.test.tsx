// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@patcher/domain";
import { useIsBrowserFreezingOverlayOpen } from "@/hooks/useBrowserFreezingOverlay";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "./ThreadActionsMenu";

/**
 * Over a live browser page this menu is portalled to the body, where the native
 * view paints straight over it: it opened invisible and unclickable. What puts
 * it back is the page freeze, which the surface owns.
 *
 * The menu asks for nothing itself — the shared-ui menu primitives register it,
 * so this also guards the env seam for them: the shared-ui import must resolve
 * to the app's real jotai-backed flavor and not shared-ui's no-op leaf, the way
 * `dialog.browser-dimming.test.tsx` guards the modal half.
 *
 * The actions themselves are stubbed. Which entries the menu carries is the
 * concern of its own tests; this is about the freeze.
 */

vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    archiveThreadAndChildren: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

const thread = makeThreadListEntry() as unknown as Thread;

function Probe() {
  return (
    <span data-testid="page">
      {useIsBrowserFreezingOverlayOpen() ? "frozen" : "live"}
    </span>
  );
}

function page(): string {
  return screen.getByTestId("page").textContent ?? "";
}

describe("the thread actions menu over a browser page", () => {
  afterEach(cleanup);

  it("asks for the page freeze while the dropdown is open", () => {
    render(
      <>
        <Probe />
        <ThreadActionsMenu thread={thread} />
      </>,
    );

    expect(page()).toBe("live");

    // Radix opens on pointerdown, not click.
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0, ctrlKey: false },
    );
    expect(page()).toBe("frozen");

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(page()).toBe("live");
  });

  it("asks for it from the context menu too", () => {
    render(
      <>
        <Probe />
        <ThreadActionsContextMenu thread={thread}>
          <span>row</span>
        </ThreadActionsContextMenu>
      </>,
    );

    expect(page()).toBe("live");

    fireEvent.contextMenu(screen.getByText("row"));
    expect(page()).toBe("frozen");
  });
});
