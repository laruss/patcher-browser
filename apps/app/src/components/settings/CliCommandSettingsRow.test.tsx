// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CliCommandMachine } from "@patcher/server-contract";
import {
  CliCommandSettingsRowContent,
  cliCommandDescription,
} from "./CliCommandSettingsRow";

afterEach(() => {
  cleanup();
});

function machine(overrides: Partial<CliCommandMachine>): CliCommandMachine {
  return {
    hostId: "host-1",
    hostName: "This machine",
    state: "missing",
    linkPath: "/home/u/.local/bin/patcher",
    existingPath: null,
    existingTarget: null,
    shimDirectory: "/home/u/.patcher/bin",
    reason: null,
    message: null,
    changed: false,
    ...overrides,
  };
}

function installButton(): HTMLButtonElement {
  const button = screen.getByRole("button", {
    name: "Install The patcher command",
  });
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Install control is not a button");
  }
  return button;
}

describe("the patcher command row", () => {
  it("offers the install where there is somewhere to put it", () => {
    render(
      <CliCommandSettingsRowContent
        machine={machine({ state: "missing" })}
        onInstall={() => undefined}
        pending={false}
      />,
    );

    expect(installButton().disabled).toBe(false);
  });

  it("offers no button for a name somebody else holds", () => {
    render(
      <CliCommandSettingsRowContent
        machine={machine({
          state: "occupied",
          existingPath: "/home/u/.local/bin/patcher",
          existingTarget: "/opt/other/patcher",
        })}
        onInstall={() => undefined}
        pending={false}
      />,
    );

    // Pressing it again could not change the answer, and the row says whose
    // the name is instead.
    expect(installButton().disabled).toBe(true);
    expect(
      screen.getByText(/\/home\/u\/\.local\/bin\/patcher is already taken/u),
    ).toBeDefined();
  });

  it("offers no button when another patcher wins the lookup", () => {
    render(
      <CliCommandSettingsRowContent
        machine={machine({
          state: "shadowed",
          existingPath: "/opt/homebrew/bin/patcher",
        })}
        onInstall={() => undefined}
        pending={false}
      />,
    );

    expect(installButton().disabled).toBe(true);
    expect(
      screen.getByText(/\/opt\/homebrew\/bin\/patcher comes earlier/u),
    ).toBeDefined();
  });

  it("shows the line to add when no directory of theirs is on PATH", () => {
    render(
      <CliCommandSettingsRowContent
        machine={machine({ state: "not_on_path", linkPath: null })}
        onInstall={() => undefined}
        pending={false}
      />,
    );

    // The one thing that works with no link at all, so it has to be exact.
    expect(
      screen.getByText(/export PATH="\/home\/u\/\.patcher\/bin:\$PATH"/u),
    ).toBeDefined();
    expect(installButton().disabled).toBe(true);
  });

  it("says a checkout does not take the bare command", () => {
    expect(
      cliCommandDescription(
        machine({ state: "unsupported", reason: "dev-install" }),
      ),
    ).toContain("bun run patcher");
  });

  it("claims nothing about a machine whose PATH it could not read", () => {
    expect(cliCommandDescription(machine({ state: "unknown" }))).toContain(
      "nothing is claimed",
    );
  });

  it("names where the command runs from once it is there", () => {
    expect(
      cliCommandDescription(
        machine({
          state: "installed",
          existingPath: "/home/u/.local/bin/patcher",
        }),
      ),
    ).toContain("/home/u/.local/bin/patcher");
  });
});
