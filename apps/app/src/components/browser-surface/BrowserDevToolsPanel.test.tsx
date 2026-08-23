// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPatcherDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/patcher-desktop-test-utils";
import { BrowserDevToolsPanel } from "./BrowserDevToolsPanel";

afterEach(() => {
  cleanup();
  delete window.patcherDesktop;
});

describe("BrowserDevToolsPanel", () => {
  // DevTools are opened detached, because the host view is ours, and a detached
  // DevTools expects a window frame to carry its close control — so it draws
  // none. Without this button the panel closes only by keyboard.
  it("offers the close control DevTools cannot draw itself", () => {
    const onClose = vi.fn();
    render(<BrowserDevToolsPanel onClose={onClose} tabId="browser:a" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Close developer tools" }),
    );

    expect(onClose).toHaveBeenCalled();
  });

  // The shell hides native views with the page they belong to, and the page
  // goes away for reasons that leave this panel where it is — a failed load,
  // where the app draws "page unavailable" in the page's rect. Only the app can
  // tell the shell the difference, and being mounted is how it says so.
  it("reports itself on screen for as long as it is mounted", () => {
    const setDevToolsVisible = vi.fn();
    window.patcherDesktop = createPatcherDesktopApi(
      {
        lastCheckedAt: null,
        latestVersion: null,
        pendingVersion: null,
        platform: "macos",
        updateAvailable: false,
        updateDownloaded: false,
        version: "0.0.0-test",
      },
      { ...createNoopDesktopBrowserApi(), setDevToolsVisible },
    );

    const { unmount } = render(
      <BrowserDevToolsPanel onClose={vi.fn()} tabId="browser:a" />,
    );
    expect(setDevToolsVisible).toHaveBeenLastCalledWith({
      tabId: "browser:a",
      visible: true,
    });

    unmount();

    expect(setDevToolsVisible).toHaveBeenLastCalledWith({
      tabId: "browser:a",
      visible: false,
    });
  });

  // Everything below the strip belongs to Chromium: the app measures that area
  // and draws nothing in it.
  it("leaves the measured area empty", () => {
    render(<BrowserDevToolsPanel onClose={vi.fn()} tabId="browser:a" />);

    expect(
      screen.getByTestId("browser-dev-tools-panel").childNodes,
    ).toHaveLength(0);
  });
});
