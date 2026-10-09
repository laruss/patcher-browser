import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { CREDENTIAL_CHANNELS } from "@patcher/desktop-contract";
import { CREDENTIAL_RELEASE_CHANNEL } from "../src/credential-release-ipc.js";
const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  quit: vi.fn(),
  windows: vi.fn(() => [] as unknown[]),
}));
vi.mock("electron", () => ({
  app: { on: mocks.quit },
  ipcMain: { handle: mocks.handle, on: mocks.on },
  BrowserWindow: { getAllWindows: mocks.windows },
  dialog: {},
  systemPreferences: {},
}));
import { registerCredentialIpc } from "../src/desktop-credential-ipc.js";
import type { CredentialVault } from "../src/desktop-credential-vault.js";
let host = 100;
beforeEach(() => {
  mocks.quit.mock.calls.forEach(([, clear]) => clear());
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
function setup() {
  const frame = { url: "http://localhost/app" };
  const sender = Object.assign(new EventEmitter(), {
    id: ++host,
    mainFrame: frame,
    getURL: () => frame.url,
  });
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const vault = {
    list: vi.fn(() => []),
    review: vi.fn(() => ({ status: "filled" })),
    dismiss: vi.fn(() => true),
    cancelHost: vi.fn(),
    take: vi.fn(() => true),
  };
  mocks.windows.mockReturnValue([
    { isDestroyed: () => false, webContents: sender },
  ]);
  registerCredentialIpc({
    current: () => vault as unknown as CredentialVault,
    authorize: (one) =>
      one.sender === event.sender && one.senderFrame === event.sender.mainFrame,
  });
  const handler = (channel: string) =>
    mocks.handle.mock.calls.find(([name]) => name === channel)![1];
  return {
    event,
    sender,
    frame,
    vault,
    pending: handler(CREDENTIAL_CHANNELS.pending),
    review: handler(CREDENTIAL_CHANNELS.review),
  };
}
it("rejects extra/forged payloads and requires a fresh, one-use native gesture before Review", () => {
  const f = setup(),
    id = randomUUID();
  expect(f.pending(f.event, { approved: true })).toEqual([]);
  expect(f.review(f.event, id)).toEqual({ status: "denied" });
  f.pending(f.event);
  expect(f.review(f.event, id)).toEqual({ status: "denied" });
  f.sender.emit("before-mouse-event", {}, { type: "mouseUp", button: "left" });
  expect(f.review(f.event, id, { approved: true })).toEqual({
    status: "denied",
  });
  expect(f.review(f.event, id)).toEqual({ status: "filled" });
  expect(f.review(f.event, id)).toEqual({ status: "denied" });
  expect(f.vault.review).toHaveBeenCalledExactlyOnceWith(id, f.sender.id);
});
it("expires gestures and rejects repeated keyboard input, foreign frames and navigation", () => {
  const f = setup(),
    id = randomUUID(),
    now = vi.spyOn(Date, "now").mockReturnValue(1_000);
  f.pending(f.event);
  f.sender.emit(
    "before-input-event",
    {},
    { type: "keyDown", key: "Enter", isAutoRepeat: true },
  );
  expect(f.review(f.event, id)).toEqual({ status: "denied" });
  f.sender.emit(
    "before-input-event",
    {},
    { type: "keyDown", key: "Enter", isAutoRepeat: false },
  );
  now.mockReturnValue(3_001);
  expect(f.review(f.event, id)).toEqual({ status: "denied" });
  const subframe = { ...f.event, senderFrame: { url: f.frame.url } };
  expect(f.pending(subframe)).toEqual([]);
  expect(f.review(subframe, id)).toEqual({ status: "denied" });
  f.sender.emit("before-mouse-event", {}, { type: "mouseUp", button: "left" });
  f.sender.emit("did-start-navigation", {}, f.frame.url, false, true);
  expect(f.vault.cancelHost).toHaveBeenCalledWith(f.sender.id);
  expect(f.review(f.event, id)).toEqual({ status: "denied" });
  f.pending(f.event);
  f.sender.emit(
    "before-input-event",
    {},
    { type: "keyDown", key: " ", isAutoRepeat: false },
  );
  expect(f.review(f.event, id)).toEqual({ status: "filled" });
});
it("accepts release only from the actual main frame and passes native identity to the token consumer", () => {
  const f = setup();
  const consume = mocks.on.mock.calls.find(
    ([name]) => name === CREDENTIAL_RELEASE_CHANNEL,
  )![1];
  const message = { token: randomUUID(), operation: "fill" };
  const subframe = {
    ...f.event,
    senderFrame: { url: f.frame.url },
    returnValue: undefined,
  };
  consume(subframe, message);
  expect(subframe.returnValue).toBeNull();
  const event = { ...f.event, returnValue: undefined };
  consume(event, { ...message, webContentsId: 1 });
  expect(event.returnValue).toBeNull();
  expect(f.vault.take).not.toHaveBeenCalled();
  consume(event, message);
  expect(event.returnValue).toBe(true);
  expect(f.vault.take).toHaveBeenCalledExactlyOnceWith(
    message.token,
    "fill",
    f.sender.id,
    f.frame.url,
  );
});
