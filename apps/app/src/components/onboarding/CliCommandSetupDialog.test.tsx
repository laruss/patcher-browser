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

describe("CliCommandSetupDialog", () => {
  it("says where the link goes, and on which machine", () => {
    renderDialog();

    expect(
      screen.getByText(
        "Patcher can put its patcher command on your PATH on Laptop, as a link at /Users/k/.local/bin/patcher.",
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

  it("offers no answer while the link is being placed", () => {
    renderDialog({ pending: true });

    for (const name of ["Setting up…", "Not now"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
  });
});
