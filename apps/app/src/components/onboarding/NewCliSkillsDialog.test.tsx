// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewCliSkillsDialog } from "./NewCliSkillsDialog";

afterEach(() => {
  cleanup();
});

function renderContent(
  props: Partial<Parameters<typeof NewCliSkillsDialog>[0]> = {},
) {
  render(
    <NewCliSkillsDialog
      open
      offer={{
        skills: ["patcher-notes"],
        machines: [
          { hostId: "host-1", hostName: "Laptop", skills: ["patcher-notes"] },
        ],
      }}
      onAccept={() => undefined}
      onDecline={() => undefined}
      pending={false}
      {...props}
    />,
  );
}

describe("NewCliSkillsDialog", () => {
  it("names the skill, where it goes and on which machine", () => {
    renderContent();

    expect(
      screen.getByText(
        "Patcher can install patcher-notes into ~/.agents/skills and ~/.claude/skills on Laptop.",
      ),
    ).toBeDefined();
  });

  it("names every skill and machine when there are several", () => {
    renderContent({
      offer: {
        skills: ["patcher-notes", "patcher-tasks"],
        machines: [
          {
            hostId: "host-1",
            hostName: "Laptop",
            skills: ["patcher-notes", "patcher-tasks"],
          },
          {
            hostId: "host-2",
            hostName: "Studio",
            skills: ["patcher-notes", "patcher-tasks"],
          },
        ],
      },
    });

    expect(
      screen.getByText(
        "Patcher can install patcher-notes and patcher-tasks into ~/.agents/skills and ~/.claude/skills on Laptop and Studio.",
      ),
    ).toBeDefined();
  });

  it("answers with either button", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    renderContent({ onAccept, onDecline });

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect([onAccept.mock.calls.length, onDecline.mock.calls.length]).toEqual([
      1, 1,
    ]);
  });

  it("answers nothing while the install is running", () => {
    const onAccept = vi.fn();
    renderContent({ onAccept, pending: true });

    const installing = screen.getByRole("button", { name: "Installing…" });
    fireEvent.click(installing);

    expect(onAccept).not.toHaveBeenCalled();
    expect(installing).toHaveProperty("disabled", true);
  });
});
