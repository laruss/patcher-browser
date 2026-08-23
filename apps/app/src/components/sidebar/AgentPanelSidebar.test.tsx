// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useIsCompactViewport,
  useIsCompactWindow,
} from "@patcher/shared-ui/hooks/use-compact-viewport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@patcher/shared-ui/dropdown-menu";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import { AgentPanelSidebar } from "./AgentPanelSidebar";

afterEach(cleanup);

function CompactProbe({ testId }: { testId: string }) {
  return (
    <span data-testid={testId}>
      {useIsCompactViewport() ? "compact" : "wide"}
    </span>
  );
}

function WindowProbe({ testId }: { testId: string }) {
  return (
    <span data-testid={testId}>
      {useIsCompactWindow() ? "compact" : "wide"}
    </span>
  );
}

function renderPanelWithMenu() {
  render(
    <MemoryRouter>
      <SidebarProvider>
        <AgentPanelSidebar
          backLabel="Threads"
          backTo="/browser"
          isResizing={false}
          onResizeMouseDown={vi.fn()}
        >
          <DropdownMenu open>
            <DropdownMenuTrigger>Thread actions</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Rename</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </AgentPanelSidebar>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

function renderPanelWithWindowProbe() {
  render(
    <MemoryRouter>
      <SidebarProvider>
        <AgentPanelSidebar
          backLabel="Threads"
          backTo="/browser"
          isResizing={false}
          onResizeMouseDown={vi.fn()}
        >
          <WindowProbe testId="window-inside" />
        </AgentPanelSidebar>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

function renderPanel() {
  render(
    <MemoryRouter>
      <SidebarProvider>
        {/* Outside the panel: the main area beside it is as wide as the window,
            and the browser there is not a narrow column. */}
        <CompactProbe testId="outside" />
        <AgentPanelSidebar
          backLabel="Threads"
          backTo="/browser"
          isResizing={false}
          onResizeMouseDown={vi.fn()}
        >
          <CompactProbe testId="inside" />
        </AgentPanelSidebar>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/**
 * The screens this panel hosts were laid out for a full-width main area: a
 * split workspace with pane chrome, and a secondary panel that splits the
 * column again. None of that fits one narrow column — and the app already has a
 * single-page-surface form for exactly that width, reached through this hook.
 * So the panel states what it is instead of leaving its contents to measure.
 */
describe("AgentPanelSidebar", () => {
  it("tells the screens it hosts that they are in a narrow column", () => {
    renderPanel();

    expect(screen.getByTestId("inside").textContent).toBe("compact");
  });

  it("says it only of its own contents", () => {
    renderPanel();

    expect(screen.getByTestId("outside").textContent).toBe("wide");
  });

  // What the panel overrides is how wide the *column* is. An overlay is not in
  // the column: it portals to document.body and covers the window. Say compact
  // to one of those and a 1440px window answers a menu with a sheet dragged up
  // over the whole app.
  it("does not claim the window is narrow as well", () => {
    renderPanelWithWindowProbe();

    expect(screen.getByTestId("window-inside").textContent).toBe("wide");
  });

  it("leaves a menu it hosts anchored to its trigger", () => {
    renderPanelWithMenu();

    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(
      document.querySelector("[data-radix-popper-content-wrapper]"),
    ).not.toBeNull();
  });

  // The screens hosted here are full-bleed: they cancel the page's own
  // `p-4 md:p-5` with matching negative margins. Padding is what those margins
  // resolve against — without it the bleed left the panel, 20px over each edge
  // and up across the back row above.
  it("gives those screens the page padding their bleed cancels", () => {
    renderPanel();

    const content = screen.getByTestId("agent-panel-sidebar-content");

    expect(content.className).toContain("p-4");
    expect(content.className).toContain("md:p-5");
  });
});
