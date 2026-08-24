// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  useBrowserFreezingOverlay,
  useIsBrowserFreezingOverlayOpen,
} from "./useBrowserFreezingOverlay";

/**
 * The counting is the point. There is one page to freeze and several things that
 * can be drawn over it, so the first to close must not thaw the page under the
 * second — the same reason the modal half counts rather than latching.
 */

function Probe() {
  return (
    <span data-testid="page">
      {useIsBrowserFreezingOverlayOpen() ? "frozen" : "live"}
    </span>
  );
}

function Menu({ id }: { id: string }) {
  const [isOpen, setIsOpen] = useState(false);
  useBrowserFreezingOverlay(isOpen);
  return (
    <button type="button" onClick={() => setIsOpen((open) => !open)}>
      toggle {id}
    </button>
  );
}

function page(): string {
  return screen.getByTestId("page").textContent ?? "";
}

describe("the browser page freeze", () => {
  afterEach(cleanup);

  it("holds while at least one menu is open", () => {
    render(
      <>
        <Probe />
        <Menu id="a" />
        <Menu id="b" />
      </>,
    );

    expect(page()).toBe("live");

    fireEvent.click(screen.getByText("toggle a"));
    expect(page()).toBe("frozen");

    fireEvent.click(screen.getByText("toggle b"));
    expect(page()).toBe("frozen");

    // The first to close must not thaw the page under the second.
    fireEvent.click(screen.getByText("toggle a"));
    expect(page()).toBe("frozen");

    fireEvent.click(screen.getByText("toggle b"));
    expect(page()).toBe("live");
  });

  it("releases a menu that unmounts while still open", () => {
    function Stage({ mounted }: { mounted: boolean }) {
      return (
        <>
          <Probe />
          {mounted ? <Menu id="a" /> : null}
        </>
      );
    }

    const { rerender } = render(<Stage mounted />);
    fireEvent.click(screen.getByText("toggle a"));
    expect(page()).toBe("frozen");

    rerender(<Stage mounted={false} />);
    expect(page()).toBe("live");
  });
});
