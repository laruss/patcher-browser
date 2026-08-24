// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import {
  PageOverlayRequestsProvider,
  usePageOverlayRequested,
  useRequestPageOverlay,
} from "./PageOverlayRequests";

/**
 * The counting is the whole point: the surface has one page to freeze, so two
 * menus sharing it must not have the first to close thaw the page under the
 * second.
 */

function Probe() {
  return (
    <span data-testid="probe">
      {usePageOverlayRequested() ? "frozen" : "live"}
    </span>
  );
}

function Holder({ id }: { id: string }) {
  const [isOpen, setIsOpen] = useState(false);
  useRequestPageOverlay(isOpen);
  return (
    <button type="button" onClick={() => setIsOpen((open) => !open)}>
      toggle {id}
    </button>
  );
}

function state(): string {
  return screen.getByTestId("probe").textContent ?? "";
}

describe("page overlay requests", () => {
  afterEach(cleanup);

  it("freezes while at least one holder is open", () => {
    render(
      <PageOverlayRequestsProvider>
        <Probe />
        <Holder id="a" />
        <Holder id="b" />
      </PageOverlayRequestsProvider>,
    );

    expect(state()).toBe("live");

    fireEvent.click(screen.getByText("toggle a"));
    expect(state()).toBe("frozen");

    fireEvent.click(screen.getByText("toggle b"));
    expect(state()).toBe("frozen");

    // The first to close must not thaw the page under the second.
    fireEvent.click(screen.getByText("toggle a"));
    expect(state()).toBe("frozen");

    fireEvent.click(screen.getByText("toggle b"));
    expect(state()).toBe("live");
  });

  it("releases a holder that unmounts while still open", () => {
    function Stage({ mounted }: { mounted: boolean }) {
      return (
        <PageOverlayRequestsProvider>
          <Probe />
          {mounted ? <Holder id="a" /> : null}
        </PageOverlayRequestsProvider>
      );
    }

    const { rerender } = render(<Stage mounted />);
    fireEvent.click(screen.getByText("toggle a"));
    expect(state()).toBe("frozen");

    rerender(<Stage mounted={false} />);
    expect(state()).toBe("live");
  });

  it("is inert outside the provider, so a menu can be mounted alone", () => {
    render(
      <>
        <Probe />
        <Holder id="a" />
      </>,
    );

    fireEvent.click(screen.getByText("toggle a"));
    expect(state()).toBe("live");
  });
});
