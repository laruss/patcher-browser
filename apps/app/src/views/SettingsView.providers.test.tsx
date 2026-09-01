// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderSettingsSection } from "./SettingsView";

afterEach(cleanup);

describe("ProvidersSettingsSection", () => {
  it.each([
    ["codex" as const, "Codex", "Codex memory"],
    ["claude-code" as const, "Claude Code", "Claude Code memory"],
  ])("renders a separate %s provider page", (providerId, title, label) => {
    const onMemoryEnabledChange = vi.fn();
    const onSubagentsDisabledChange = vi.fn();
    const onWorkflowsDisabledChange = vi.fn();
    const onNetworkDisabledChange = vi.fn();
    const view = render(
      <ProviderSettingsSection
        providerId={providerId}
        memoryEnabled={false}
        subagentsDisabled={false}
        workflowsDisabled={false}
        networkDisabled={false}
        disabled={false}
        onMemoryEnabledChange={onMemoryEnabledChange}
        onSubagentsDisabledChange={onSubagentsDisabledChange}
        onWorkflowsDisabledChange={onWorkflowsDisabledChange}
        onNetworkDisabledChange={onNetworkDisabledChange}
      />,
    );

    expect(screen.getByText(title)).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: label }).getAttribute("data-state"),
    ).toBe("unchecked");
    fireEvent.click(screen.getByRole("switch", { name: label }));

    expect(onMemoryEnabledChange).toHaveBeenCalledWith(true);
    fireEvent.click(
      screen.getByRole("switch", { name: "Disable provider subagents" }),
    );
    expect(onSubagentsDisabledChange).toHaveBeenCalledWith(true);
    const NETWORK_SWITCH = "Take the network from sandboxed turns";
    if (providerId === "claude-code") {
      fireEvent.click(
        screen.getByRole("switch", { name: "Disable Workflow tool" }),
      );
      expect(onWorkflowsDisabledChange).toHaveBeenCalledWith(true);
      // Claude Code's sandbox gates the network with prompts of its own, so
      // there is nothing here for this switch to set.
      expect(screen.queryByRole("switch", { name: NETWORK_SWITCH })).toBeNull();
    } else {
      expect(
        screen.queryByRole("switch", { name: "Disable Workflow tool" }),
      ).toBeNull();
      const networkSwitch = screen.getByRole("switch", {
        name: NETWORK_SWITCH,
      });
      expect(networkSwitch.getAttribute("data-state")).toBe("unchecked");
      fireEvent.click(networkSwitch);
      expect(onNetworkDisabledChange).toHaveBeenCalledWith(true);
      // The cost is the decision, so the switch says it rather than leaving a
      // person to find out on the next turn.
      expect(
        screen.getByText(/asks before every outbound connection/),
      ).toBeTruthy();
      expect(screen.getByText(/patcher CLI keeps working/)).toBeTruthy();
    }
    view.unmount();
  });
});
