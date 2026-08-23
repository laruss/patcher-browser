// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsCompactViewport } from "@patcher/shared-ui/hooks/use-compact-viewport";
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
});
