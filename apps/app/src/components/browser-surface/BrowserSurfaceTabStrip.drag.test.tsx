// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { BrowserSurfaceTabStrip } from "./BrowserSurfaceTabStrip";

/**
 * A file of its own because a drag cannot be taken back.
 *
 * Starting one arms a `click` listener on the document that stops propagation —
 * how the drag layer keeps a drop from also selecting the tab it landed on. A
 * real pointer sends the click that consumes it; nothing in jsdom does, and
 * nothing disarms it on unmount, so every later click in the same document is
 * swallowed. Measured: mid-drag, Escape-cancelled and dropped all leave it
 * armed, so there is no way to end a drag that gives the document back.
 *
 * The environment is per test file, so the damage stops at this one — which is
 * why the strip's other tests stayed where they are, and why anything added
 * here has to be a drag too.
 */

function browserTab(id: string, title: string): BrowserFixedPanelTab {
  return {
    environmentId: null,
    id,
    kind: "browser",
    title,
    url: "https://example.test/",
  };
}

function renderStrip() {
  render(
    <BrowserSurfaceTabStrip
      activeTabId="tab-1"
      favicons={{}}
      loadingTabIds={new Set()}
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onDuplicate={vi.fn()}
      onMove={vi.fn()}
      onOpen={() => {}}
      onRunTabAction={vi.fn()}
      onSetMuted={vi.fn()}
      onSetPinned={vi.fn()}
      onTakeBack={vi.fn()}
      tabs={[
        browserTab("tab-1", "One"),
        browserTab("tab-2", "Two"),
        browserTab("tab-3", "Three"),
      ]}
    />,
  );
  const tabs = screen.getByRole("tablist");
  return {
    tabs,
    // The drag context renders no element of its own, so the row is the parent.
    strip: tabs.parentElement,
  };
}

function clips(element: Element | null): boolean {
  return element?.className.split(" ").includes("overflow-hidden") ?? false;
}

describe("browser surface tab strip drag", () => {
  // The new-tab button sits immediately after the last tab, and the tabs have a
  // box of their own that ends where it begins. Clipping to that box made the
  // button a wall: a tab carried towards it was cut off at the button's edge,
  // so it could not be seen crossing the space it is allowed to land in.
  // Chromium anchors that button to the trailing edge of the last tab and lets
  // the carried tab pass over it, which is what this gives back.
  it("lets a carried tab out of the box the new-tab button ends", () => {
    const { strip, tabs } = renderStrip();

    // At rest the tabs clip, which is what keeps a squeezed strip from spilling
    // over the new-tab button.
    expect(clips(tabs)).toBe(true);
    expect(clips(strip)).toBe(false);

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Two/ }), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    // Past the sensor's few pixels of travel, so the press is a carry.
    fireEvent.mouseMove(document, { clientX: 40, clientY: 0 });

    // Carried: the tab row lets go and the strip catches what leaves it, so the
    // tab travels the whole row and still nothing escapes the strip.
    expect(clips(tabs)).toBe(false);
    expect(clips(strip)).toBe(true);

    fireEvent.mouseUp(document, { clientX: 40, clientY: 0 });

    expect(clips(tabs)).toBe(true);
    expect(clips(strip)).toBe(false);
  });
});
