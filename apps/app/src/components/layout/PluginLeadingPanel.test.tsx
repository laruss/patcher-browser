// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginLeadingPanelSlot } from "@/lib/plugin-slots";

const slotState = vi.hoisted(() => ({
  panels: [] as PluginLeadingPanelSlot[],
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({ leadingPanels: slotState.panels }),
}));

// The mount scopes a plugin's stylesheet and contains its crashes; neither is
// what these tests are about.
vi.mock("@/components/plugin/PluginSlotMount", () => ({
  PluginSlotMount: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const { Provider, createStore } = await import("jotai");
const { browserSurfaceTabsAtom } = await import("@/lib/browser-surface-tabs");
const {
  PluginLeadingPanel,
  resolveActiveLeadingPanel,
  resolveLeadingPanelResizeWidth,
} = await import("./PluginLeadingPanel");

/** Render the panel with the strip's active tab on `url` (null: no page). */
function renderWithActivePage(url: string | null) {
  const store = createStore();
  store.set(
    browserSurfaceTabsAtom,
    url === null
      ? { activeTabId: null, tabs: [] }
      : {
          activeTabId: "browser:a",
          tabs: [
            {
              environmentId: null,
              id: "browser:a",
              kind: "browser" as const,
              title: null,
              url,
            },
          ],
        },
  );
  return render(
    <Provider store={store}>
      <PluginLeadingPanel />
    </Provider>,
  );
}

function panel(pluginId: string, id: string): PluginLeadingPanelSlot {
  return {
    component: () => (
      <div data-testid={`body-${pluginId}`}>{pluginId} body</div>
    ),
    generation: 1,
    icon: "Puzzle",
    id,
    pluginId,
    title: `${pluginId} panel`,
  };
}

beforeEach(() => {
  slotState.panels = [];
  window.localStorage.clear();
});

afterEach(cleanup);

/**
 * The edge belongs to plugins, and what it looks like follows from how many
 * asked for it rather than from configuration.
 */
describe("PluginLeadingPanel", () => {
  it("is absent entirely when no plugin claims the edge", () => {
    render(<PluginLeadingPanel />);

    expect(screen.queryByTestId("plugin-leading-panel")).toBeNull();
  });

  // A rail to switch between one thing is a control that does nothing.
  it("gives a single plugin the panel, with no rail", () => {
    slotState.panels = [panel("notes", "notes")];
    render(<PluginLeadingPanel />);

    expect(screen.getByTestId("plugin-leading-panel")).toBeTruthy();
    expect(screen.queryByTestId("plugin-leading-panel-rail")).toBeNull();
    expect(screen.getByTestId("body-notes")).toBeTruthy();
  });

  it("draws a rail once there is a choice to make", () => {
    slotState.panels = [panel("notes", "notes"), panel("files", "files")];
    render(<PluginLeadingPanel />);

    expect(screen.getByTestId("plugin-leading-panel-rail")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // The first registration shows until the user picks otherwise.
    expect(screen.getByTestId("body-notes")).toBeTruthy();
    expect(screen.queryByTestId("body-files")).toBeNull();
  });
});

describe("resolveActiveLeadingPanel", () => {
  it("shows the first registration when nothing was chosen", () => {
    const panels = [panel("notes", "notes"), panel("files", "files")];

    expect(resolveActiveLeadingPanel({ panels, storedId: null })).toBe(
      panels[0],
    );
  });

  it("shows the one the user chose", () => {
    const panels = [panel("notes", "notes"), panel("files", "files")];

    expect(resolveActiveLeadingPanel({ panels, storedId: "files/files" })).toBe(
      panels[1],
    );
  });

  // A stored choice naming a plugin that is gone is a plugin that was disabled,
  // not an error — the panel falls back rather than going blank.
  it("falls back when the chosen plugin is no longer installed", () => {
    const panels = [panel("notes", "notes")];

    expect(
      resolveActiveLeadingPanel({ panels, storedId: "removed/gone" }),
    ).toBe(panels[0]);
  });

  it("has nothing to show when nothing is registered", () => {
    expect(
      resolveActiveLeadingPanel({ panels: [], storedId: "notes/notes" }),
    ).toBeNull();
  });
});

// This panel is on the leading edge and its handle is on its trailing one, so
// the drag runs the opposite way to the sidebar's. That sign is the whole
// content of the helper: get it wrong and resizing still works, backwards.
describe("resolveLeadingPanelResizeWidth", () => {
  it("widens when the handle is dragged toward the content", () => {
    expect(
      resolveLeadingPanelResizeWidth({ deltaX: 40, startWidth: 280 }),
    ).toBe(320);
  });

  it("narrows when dragged back toward the window edge", () => {
    expect(
      resolveLeadingPanelResizeWidth({ deltaX: -40, startWidth: 280 }),
    ).toBe(240);
  });

  it("clamps rather than following the pointer out of the window", () => {
    expect(
      resolveLeadingPanelResizeWidth({ deltaX: 9000, startWidth: 280 }),
    ).toBe(640);
    expect(
      resolveLeadingPanelResizeWidth({ deltaX: -9000, startWidth: 280 }),
    ).toBe(200);
  });
});

/**
 * A panel can say which pages it is for, and then the *column* comes and goes
 * with them — not just its contents. An empty edge that still reserves width,
 * and on macOS still owns the traffic lights, is the thing this prevents.
 */
describe("PluginLeadingPanel scoped to a site", () => {
  function scopedPanel(matches: string[]): PluginLeadingPanelSlot {
    return { ...panel("prs", "pulls"), matches };
  }

  it("draws nothing while the active tab is on another site", () => {
    slotState.panels = [scopedPanel(["https://github.com/**"])];

    renderWithActivePage("https://example.test/");

    expect(screen.queryByTestId("plugin-leading-panel")).toBeNull();
  });

  it("draws the panel once the active tab is on a matching page", () => {
    slotState.panels = [scopedPanel(["https://github.com/**"])];

    renderWithActivePage("https://github.com/patcher/pulls");

    expect(screen.getByTestId("body-prs")).toBeTruthy();
  });

  it("draws nothing when there is no page at all", () => {
    slotState.panels = [scopedPanel(["https://github.com/**"])];

    renderWithActivePage(null);

    expect(screen.queryByTestId("plugin-leading-panel")).toBeNull();
  });

  // The unscoped panel is the one every plugin wrote before this existed: it
  // must keep claiming the edge whatever the browser is showing.
  it("leaves an unscoped panel alone", () => {
    slotState.panels = [panel("notes", "notes")];

    renderWithActivePage("https://example.test/");

    expect(screen.getByTestId("body-notes")).toBeTruthy();
  });

  // With one of two panels out of scope there is no choice left to offer, so the
  // rail goes too — the same rule as one registration, applied to what applies.
  it("counts only the panels that apply when deciding on a rail", () => {
    slotState.panels = [
      panel("notes", "notes"),
      scopedPanel(["https://github.com/**"]),
    ];

    renderWithActivePage("https://example.test/");

    expect(screen.getByTestId("body-notes")).toBeTruthy();
    expect(screen.queryByTestId("plugin-leading-panel-rail")).toBeNull();
  });

  it("tells the panel which page the tab is on", () => {
    slotState.panels = [
      {
        ...scopedPanel(["https://github.com/**"]),
        component: ({ browserUrl }) => <div>at {browserUrl}</div>,
      },
    ];

    renderWithActivePage("https://github.com/patcher/pulls");

    expect(
      screen.getByText("at https://github.com/patcher/pulls"),
    ).toBeTruthy();
  });
});
