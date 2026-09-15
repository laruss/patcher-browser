// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useCliSkillsStatus } from "./system-queries";

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { cliSkillsStatus: vi.fn() } },
}));

function machineStatus(status: "missing" | "unknown") {
  return { machines: [{ hostId: "host-1", hostName: "Laptop", status }] };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

/**
 * `unknown` is a daemon that did not answer in time. The launch-time question
 * (#141) is decided on this read, so holding an `unknown` until the window
 * regains focus would hold the question back with it.
 */
describe("useCliSkillsStatus", () => {
  it("asks again while a machine answers unknown, and stops once it answers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(sdk.system.cliSkillsStatus)
      .mockResolvedValueOnce(machineStatus("unknown"))
      .mockResolvedValue(machineStatus("missing"));
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useCliSkillsStatus({ hostIds: ["host-1"], retryUnknown: true }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.data?.machines[0]?.status).toBe("unknown"),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() =>
      expect(result.current.data?.machines[0]?.status).toBe("missing"),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(sdk.system.cliSkillsStatus).toHaveBeenCalledTimes(2);
  });

  it("holds an unknown answer when not asked to retry it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(sdk.system.cliSkillsStatus).mockResolvedValue(
      machineStatus("unknown"),
    );
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useCliSkillsStatus(), { wrapper });
    await waitFor(() =>
      expect(result.current.data?.machines[0]?.status).toBe("unknown"),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(sdk.system.cliSkillsStatus).toHaveBeenCalledTimes(1);
  });
});
