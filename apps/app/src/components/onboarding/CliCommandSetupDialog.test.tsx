// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliCommandSetupDialog } from "./CliCommandSetupDialog";

function renderDialog(overrides: { pending?: boolean } = {}) {
  const props = {
    hostName: "Laptop",
    linkPath: "/Users/k/.local/bin/patcher",
    onAccept: vi.fn(),
    onDecline: vi.fn(),
    pending: overrides.pending ?? false,
  };
  render(<CliCommandSetupDialog open {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

/**
 * How it closes is the shell's, and is tested once on #141's question; what is
 * this question's own is what it says and which button answers what.
 */
describe("CliCommandSetupDialog", () => {
  it("says where the link goes, and on which machine", () => {
    renderDialog();

    expect(
      screen.getByText(
        "Patcher can link its patcher command into /Users/k/.local/bin/patcher on Laptop.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("You can do this later in Settings → Skills."),
    ).toBeTruthy();
  });

  it("answers yes with Set up and no with Not now", () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(props.onAccept).toHaveBeenCalledTimes(1);
    expect(props.onDecline).toHaveBeenCalledTimes(1);
  });

  it("answers nothing while the link is being placed", () => {
    const props = renderDialog({ pending: true });

    expect(
      (screen.getByRole("button", { name: "Setting up…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    expect(props.onDecline).not.toHaveBeenCalled();
  });
});
