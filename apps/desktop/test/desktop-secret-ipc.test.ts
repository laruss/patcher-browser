import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { DESKTOP_SECRET_STORAGE_CHANNELS } from "@patcher/desktop-contract";
const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  dialog: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isReady: () => true },
  safeStorage: { isEncryptionAvailable: () => true },
  dialog: { showMessageBox: mocks.dialog },
  ipcMain: { handle: mocks.handle },
  powerMonitor: { on: mocks.on },
}));
import {
  registerDesktopSecretIpc,
  desktopKeyBackend,
} from "../src/desktop-secret-ipc.js";
const status = {
  mode: "plaintext" as const,
  available: true,
  migrationPending: false,
  unprocessedEntries: 0,
  error: null,
};
const event = {} as IpcMainInvokeEvent;
beforeEach(() => vi.clearAllMocks());
function setup(authorized = true) {
  const broker = {
    action: vi.fn(async () => status),
    availability: vi.fn(),
    close: vi.fn(),
  };
  registerDesktopSecretIpc({
    current: () => broker,
    authorize: () => authorized,
  });
  const handler = mocks.handle.mock.calls.find(
    ([channel]) => channel === DESKTOP_SECRET_STORAGE_CHANNELS.activate,
  )?.[1] as (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;
  return { broker, handler };
}
describe("host-owned secret activation", () => {
  it("keeps the backend locked across resume and refuses renderer unlock until the screen unlocks", async () => {
    const { broker } = setup();
    const emit = (name: string) =>
      (
        mocks.on.mock.calls.find(([event]) => event === name)?.[1] as () => void
      )();
    emit("lock-screen");
    emit("suspend");
    emit("resume");
    expect(desktopKeyBackend.available()).toBe(false);
    const unlock = mocks.handle.mock.calls.find(
      ([name]) => name === DESKTOP_SECRET_STORAGE_CHANNELS.unlock,
    )?.[1] as (event: IpcMainInvokeEvent) => Promise<unknown>;
    await unlock(event);
    expect(broker.action).toHaveBeenCalledWith("status");
    expect(broker.availability).toHaveBeenLastCalledWith(false);
    emit("unlock-screen");
    expect(broker.availability).toHaveBeenLastCalledWith(true);
  });
  it("rejects untrusted senders and arbitrary payloads before showing a dialog", async () => {
    const untrusted = setup(false);
    await expect(untrusted.handler(event)).rejects.toThrow();
    const trusted = setup();
    await expect(
      trusted.handler(event, { userApproved: true, path: "/tmp" }),
    ).rejects.toThrow();
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(trusted.broker.action).not.toHaveBeenCalled();
  });
  it("requires native confirmation, with cancellation as the default", async () => {
    const { broker, handler } = setup();
    mocks.dialog.mockResolvedValue({ response: 0 });
    expect(await handler(event)).toMatchObject({ error: "cancelled" });
    expect(broker.action).toHaveBeenCalledWith("status");
    expect(mocks.dialog.mock.calls[0]?.[0]).toMatchObject({
      defaultId: 0,
      cancelId: 0,
    });
    mocks.dialog.mockResolvedValue({ response: 1 });
    await handler(event);
    expect(broker.action).toHaveBeenLastCalledWith("activate");
  });
});
