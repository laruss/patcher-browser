// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { CliSkillsUpdateNotice } from "@patcher/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCliSkillsUpdateToast } from "./useCliSkillsUpdateToast";

const mocks = vi.hoisted(() => ({ success: vi.fn() }));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { success: mocks.success },
}));

function notice(hostName: string, at: number): CliSkillsUpdateNotice {
  return { hostId: `host-${hostName}`, hostName, skills: ["patcher-cli"], at };
}

function toasts(): string[] {
  return mocks.success.mock.calls.map(([title]) => String(title));
}

type Props = Parameters<typeof useCliSkillsUpdateToast>[0];

function renderToast(initialProps: Props) {
  return renderHook((props: Props) => useCliSkillsUpdateToast(props), {
    initialProps,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.success.mockReset();
});

describe("the note that the skills for agents outside Patcher were updated", () => {
  it("names the machine once, however often the config is read again", () => {
    const view = renderToast({
      notices: [notice("Laptop", 10)],
      paused: false,
    });
    view.rerender({ notices: [notice("Laptop", 10)], paused: false });

    expect(toasts()).toEqual([
      "Updated the Patcher skills for agents outside Patcher on Laptop",
    ]);
  });

  it("is not repeated by a window that reloads", () => {
    renderToast({ notices: [notice("Laptop", 10)], paused: false }).unmount();
    renderToast({ notices: [notice("Laptop", 10)], paused: false });

    expect(toasts()).toHaveLength(1);
  });

  it("waits while onboarding or the question is on screen, then says it", () => {
    const view = renderToast({
      notices: [notice("Laptop", 10)],
      paused: true,
    });
    expect(toasts()).toEqual([]);

    view.rerender({ notices: [notice("Laptop", 10)], paused: false });
    expect(toasts()).toHaveLength(1);
  });

  it("says nothing when nothing was updated", () => {
    const view = renderToast({ notices: undefined, paused: false });
    view.rerender({ notices: [], paused: false });

    expect(toasts()).toEqual([]);
  });

  it("names a second machine updated later, and only that one", () => {
    const view = renderToast({
      notices: [notice("Laptop", 10)],
      paused: false,
    });
    view.rerender({
      notices: [notice("Studio", 20), notice("Laptop", 10)],
      paused: false,
    });

    expect(toasts()).toEqual([
      "Updated the Patcher skills for agents outside Patcher on Laptop",
      "Updated the Patcher skills for agents outside Patcher on Studio",
    ]);
  });

  it("still says it only once in a window that cannot use storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });

    const view = renderToast({
      notices: [notice("Laptop", 10)],
      paused: false,
    });
    view.rerender({ notices: [notice("Laptop", 10)], paused: false });

    expect(toasts()).toHaveLength(1);
  });
});
