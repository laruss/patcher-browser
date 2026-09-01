// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProjectSetupScriptConsentResponse } from "@patcher/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSetupScriptRow } from "./ProjectSetupScriptRow";

function consent(
  overrides: Partial<ProjectSetupScriptConsentResponse> = {},
): ProjectSetupScriptConsentResponse {
  return {
    id: "escon_test",
    hostId: "host_test",
    sourcePath: "/repos/thing",
    scriptPath: "/repos/thing-wt/.patcher-env-setup.sh",
    scriptSha256: "abc123def4567890".padEnd(64, "0"),
    scriptByteLength: 240,
    status: "asked",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("ProjectSetupScriptRow", () => {
  afterEach(cleanup);

  it("offers to answer a question nobody was there for", () => {
    const onAllow = vi.fn();
    render(
      <ProjectSetupScriptRow
        consent={consent()}
        machineName="Mac Studio"
        isPending={false}
        onAllow={onAllow}
        onForget={vi.fn()}
      />,
    );

    // The machine and the checkout are the scope of the answer, so they are what
    // the row leads with.
    expect(screen.getByText("Mac Studio")).toBeDefined();
    expect(screen.getByText("/repos/thing")).toBeDefined();
    expect(screen.getByText("Waiting for you")).toBeDefined();
    expect(
      screen.getByText(
        /\.patcher-env-setup\.sh — 240 bytes, sha256 abc123def456/,
      ),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onAllow).toHaveBeenCalledWith("escon_test");
  });

  it("offers only to take back an answer already given", () => {
    const onForget = vi.fn();
    render(
      <ProjectSetupScriptRow
        consent={consent({ status: "allowed" })}
        machineName="Mac Studio"
        isPending={false}
        onAllow={vi.fn()}
        onForget={onForget}
      />,
    );

    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(screen.queryByText("Waiting for you")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(onForget).toHaveBeenCalledWith("escon_test");
  });
});
