// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutsideAgentSetupDialog } from "./OutsideAgentSetupDialog";

function renderDialog(
  overrides: { pending?: boolean; showsCliCommand?: boolean } = {},
) {
  const props = {
    hostName: "Laptop",
    onAccept: vi.fn(),
    onDecline: vi.fn(),
    pending: overrides.pending ?? false,
    showsCliCommand: overrides.showsCliCommand ?? true,
  };
  render(<OutsideAgentSetupDialog open {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

describe("OutsideAgentSetupDialog", () => {
  it("says what goes where, and on which machine", () => {
    renderDialog();

    expect(
      screen.getByText(
        "Patcher can install its skills, patcher-cli and patcher-browser, into ~/.agents/skills and ~/.claude/skills on Laptop, and put its patcher command on your PATH.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("You can do this later in Settings → Skills."),
    ).toBeTruthy();
  });

  it("promises no command where this yes will not place one", () => {
    // Windows, or a source checkout: the server answers `unsupported`, so the
    // sentence would be an offer nothing acts on.
    renderDialog({ showsCliCommand: false });

    expect(
      screen.getByText(
        "Patcher can install its skills, patcher-cli and patcher-browser, into ~/.agents/skills and ~/.claude/skills on Laptop.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/link in ~\/\.local\/bin/u)).toBeNull();
  });

  it("answers yes with Set up and no with Not now", () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(props.onAccept).toHaveBeenCalledTimes(1);
    expect(props.onDecline).toHaveBeenCalledTimes(1);
  });

  it("answers nothing when the person clicks outside it", async () => {
    const props = renderDialog();
    // Radix arms its outside-pointer listener a tick after it opens.
    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(props.onDecline).not.toHaveBeenCalled();
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it("takes Escape as not now, so closing it is an answer", () => {
    const props = renderDialog();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    expect(props.onDecline).toHaveBeenCalledTimes(1);
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it("on a narrow window, answers nothing to a tap outside or Escape — only the buttons answer", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    try {
      const props = renderDialog();
      // The drawer, not the centred dialog: the path that strips
      // `onInteractOutside`.
      expect(document.querySelector("[data-vaul-drawer]")).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 0));

      fireEvent.pointerDown(document.body);
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
      expect(props.onDecline).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(props.onDecline).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it("answers nothing while the install is running", () => {
    const props = renderDialog({ pending: true });

    expect(
      (screen.getByRole("button", { name: "Setting up…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Not now" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    expect(props.onDecline).not.toHaveBeenCalled();
  });
});
