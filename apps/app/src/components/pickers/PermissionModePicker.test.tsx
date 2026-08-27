// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionModePicker } from "./PermissionModePicker";

const permissionOptions = [
  { value: "accept-edits", label: "Accept Edits" },
  { value: "auto", label: "Approve for me" },
  { value: "full", label: "Full Access", tone: "warning" },
] as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PermissionModePicker", () => {
  it("can show an effective display override without changing the selected value", () => {
    const onChange = vi.fn();
    render(
      <PermissionModePicker
        value="full"
        options={permissionOptions}
        onChange={onChange}
        supported
        displayOverride={{
          label: "Plan Mode",
          compactLabel: "Plan",
          description:
            "Claude Code will plan without normal full-access execution.",
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Permission mode" });
    expect(trigger.textContent).toContain("Plan Mode");
    expect(trigger.textContent).not.toContain("Full Access");
  });

  /** `defaultOpen` skips driving Radix's trigger; the menu item is the subject. */
  function renderOpenPicker(onChange: (value: string) => void) {
    render(
      <PermissionModePicker
        value="auto"
        options={permissionOptions}
        onChange={onChange as (value: "accept-edits" | "auto" | "full") => void}
        supported
        defaultOpen
        modal={false}
      />,
    );
  }

  function pick(label: string) {
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(label) }));
  }

  it("does not leave the sandbox on a single click", () => {
    const onChange = vi.fn();
    renderOpenPicker(onChange);

    pick("Full Access");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Run without a sandbox?")).toBeTruthy();
  });

  it("applies Full Access once it is confirmed", () => {
    const onChange = vi.fn();
    renderOpenPicker(onChange);

    pick("Full Access");
    fireEvent.click(screen.getByRole("button", { name: "Use Full Access" }));

    expect(onChange).toHaveBeenCalledWith("full");
  });

  it("keeps the sandbox when the confirmation is declined", () => {
    const onChange = vi.fn();
    renderOpenPicker(onChange);

    pick("Full Access");
    fireEvent.click(screen.getByRole("button", { name: "Keep the sandbox" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("asks nothing when moving between sandboxed modes", () => {
    const onChange = vi.fn();
    renderOpenPicker(onChange);

    pick("Accept Edits");

    expect(onChange).toHaveBeenCalledWith("accept-edits");
  });
});
