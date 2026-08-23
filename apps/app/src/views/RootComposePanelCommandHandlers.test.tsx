// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PatcherDesktopCloseWindowRequestHandler } from "@patcher/desktop-contract";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { createPatcherDesktopApi } from "@/test/patcher-desktop-test-utils";
import { RootComposePanelCommandHandlers } from "./RootComposePanelCommandHandlers";

// The command provider reads plugin commands (`app.commands`); nothing here
// contributes one, and this keeps the test off a query client it has no use
// for.
vi.mock("@/hooks/queries/plugin-contribution-queries", () => ({
  usePluginContributions: () => ({ data: undefined }),
  runPluginCommand: async () => {},
}));

const commandFixture = vi.hoisted(() => ({
  keybindings: [
    {
      command: "panel.toggle" as const,
      desktopOnly: false,
      shortcut: {
        key: "p",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
    {
      command: "panel.close" as const,
      desktopOnly: false,
      shortcut: {
        key: "w",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
  ],
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: {
        showKeyboardHints: false,
      },
      keybindings: commandFixture.keybindings,
    },
  }),
}));

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function dispatchControlShortcut(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key,
  });
  fireEvent(window, event);
  return event;
}

afterEach(() => {
  cleanup();
  delete window.patcherDesktop;
});

describe("RootComposePanelCommandHandlers", () => {
  it("routes panel shortcuts and desktop close requests only to the focused New Thread pane", async () => {
    const firstToggle = vi.fn();
    const firstClose = vi.fn(() => true);
    const secondToggle = vi.fn();
    const secondClose = vi.fn(() => true);
    const desktopCloseHandlers =
      new Set<PatcherDesktopCloseWindowRequestHandler>();
    window.patcherDesktop = {
      ...createPatcherDesktopApi(desktopInfo),
      onCloseWindowRequest(listener) {
        desktopCloseHandlers.add(listener);
        return () => desktopCloseHandlers.delete(listener);
      },
    };

    const view = render(
      <AppCommandProvider>
        <RootComposePanelCommandHandlers
          isFocused
          onClose={firstClose}
          onToggle={firstToggle}
        />
        <RootComposePanelCommandHandlers
          isFocused={false}
          onClose={secondClose}
          onToggle={secondToggle}
        />
      </AppCommandProvider>,
    );

    await act(async () => undefined);
    expect(desktopCloseHandlers.size).toBe(1);
    expect(dispatchControlShortcut("p").defaultPrevented).toBe(true);
    expect(firstToggle).toHaveBeenCalledTimes(1);
    expect(secondToggle).not.toHaveBeenCalled();
    expect(dispatchControlShortcut("w").defaultPrevented).toBe(true);
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).not.toHaveBeenCalled();
    for (const handler of desktopCloseHandlers) {
      expect(handler()).toBe(true);
    }
    expect(firstClose).toHaveBeenCalledTimes(2);

    view.rerender(
      <AppCommandProvider>
        <RootComposePanelCommandHandlers
          isFocused={false}
          onClose={firstClose}
          onToggle={firstToggle}
        />
        <RootComposePanelCommandHandlers
          isFocused
          onClose={secondClose}
          onToggle={secondToggle}
        />
      </AppCommandProvider>,
    );
    await act(async () => undefined);

    expect(desktopCloseHandlers.size).toBe(1);
    dispatchControlShortcut("p");
    dispatchControlShortcut("w");
    expect(firstToggle).toHaveBeenCalledTimes(1);
    expect(firstClose).toHaveBeenCalledTimes(2);
    expect(secondToggle).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(1);
    for (const handler of desktopCloseHandlers) handler();
    expect(secondClose).toHaveBeenCalledTimes(2);
  });
});
