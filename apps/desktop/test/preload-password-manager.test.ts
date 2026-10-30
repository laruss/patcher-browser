// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PASSWORD_MANAGER_CHANNELS } from "@patcher/desktop-contract";
import { preloadPasswordManager } from "../src/preload-password-manager.js";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("electron", () => ({ ipcRenderer: ipc }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  ipc.invoke.mockReset();
});

it("waits for focus to return after successful system authentication", async () => {
  ipc.invoke.mockResolvedValue({ status: "revealed", password: "test-secret" });
  let delivered = false;
  const reply = preloadPasswordManager
    .request({
      operation: "reveal",
      id: "00000000-0000-4000-8000-000000000001",
      version: 1,
    })
    .then((result) => {
      delivered = true;
      return result;
    });
  await vi.advanceTimersByTimeAsync(100);
  expect(delivered).toBe(false);
  vi.mocked(document.hasFocus).mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  await expect(reply).resolves.toEqual({
    status: "revealed",
    password: "test-secret",
  });
  expect(vi.getTimerCount()).toBe(0);
});

it("discards a sensitive reply and revokes edit access if the manager stays in the background", async () => {
  const editToken = "00000000-0000-4000-8000-000000000002";
  ipc.invoke
    .mockResolvedValueOnce({
      status: "editing",
      password: "test-secret",
      editToken,
    })
    .mockResolvedValue({ status: "done" });
  const reply = preloadPasswordManager.request({
    operation: "edit",
    id: "00000000-0000-4000-8000-000000000001",
    version: 1,
  });
  await vi.advanceTimersByTimeAsync(1000);
  await expect(reply).resolves.toEqual({ status: "cancelled" });
  expect(ipc.invoke).toHaveBeenLastCalledWith(
    PASSWORD_MANAGER_CHANNELS.request,
    {
      operation: "cancel-edit",
      editToken,
    },
  );
});

it("returns a cancelled system authentication without waiting for focus", async () => {
  ipc.invoke.mockResolvedValue({ status: "cancelled" });
  await expect(
    preloadPasswordManager.request({
      operation: "reveal",
      id: "00000000-0000-4000-8000-000000000001",
      version: 1,
    }),
  ).resolves.toEqual({ status: "cancelled" });
  expect(vi.getTimerCount()).toBe(0);
});
