import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  BrowserWindow,
  Session,
  SelectWebauthnAccountDetails,
} from "electron";
const mocks = vi.hoisted(() => ({
  app: { on: vi.fn() },
  show: vi.fn(),
  fromFrame: vi.fn(),
  fromToken: vi.fn(),
}));
vi.mock("electron", () => ({
  app: mocks.app,
  dialog: { showMessageBox: mocks.show },
  webContents: { fromFrame: mocks.fromFrame },
  webFrameMain: { fromFrameToken: mocks.fromToken },
}));
import { registerWebAuthnAccountChooser } from "../src/webauthn-account-chooser.js";
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  for (const [, listener] of mocks.app.on.mock.calls) listener();
  vi.useRealTimers();
});
function fixture() {
  const session = new EventEmitter();
  const frame = {
    detached: false,
    frameToken: "token",
    processId: 20,
    url: "https://login.example.com/",
    origin: "https://login.example.com",
  };
  const contents = Object.assign(new EventEmitter(), {
    id: 10,
    session,
    isDestroyed: () => false,
  });
  const window = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: (): boolean => true,
  });
  const target = {
    window: window as unknown as BrowserWindow,
    current: vi.fn(() => true),
  };
  mocks.fromFrame.mockReturnValue(contents);
  mocks.fromToken.mockReturnValue(frame);
  let respond!: (value: { response: number }) => void;
  let reject!: (error: Error) => void;
  mocks.show.mockImplementation(
    () =>
      new Promise((resolve, rejectResult) => {
        respond = resolve;
        reject = rejectResult;
      }),
  );
  registerWebAuthnAccountChooser(session as unknown as Session, () => target);
  const details = {
    frame,
    relyingPartyId: "example.com",
    accounts: [
      { credentialId: "a1", displayName: "Alice\n\u202e &approve" },
      { credentialId: "b2", name: "Bob" },
    ],
  };
  const request = (value = details) => {
    const callback = vi.fn();
    session.emit(
      "select-webauthn-account",
      {},
      value as unknown as SelectWebauthnAccountDetails,
      callback,
    );
    return callback;
  };
  return {
    session,
    frame,
    contents,
    window,
    target,
    details,
    request,
    respond: (value: number) => respond({ response: value }),
    reject: () => reject(new Error("closed")),
  };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
it("shows a parented native RP/origin chooser and returns only a listed account once", async () => {
  const f = fixture(),
    callback = f.request();
  expect(mocks.show.mock.calls[0]![0]).toBe(f.window);
  const options = mocks.show.mock.calls[0]![1];
  expect(options).toMatchObject({
    defaultId: 0,
    cancelId: 0,
    message: "Sign in to example.com?",
  });
  expect(options.detail).toContain(f.frame.origin);
  expect(options.buttons[1]).toBe("1. Alice    approve");
  f.respond(2);
  await settle();
  expect(callback).toHaveBeenCalledExactlyOnceWith("b2");
  f.contents.emit("destroyed");
  expect(callback).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("accepts native base64url IDs without padding and preserves them exactly", async () => {
  const f = fixture();
  const id = Buffer.from([0xfb, 0xff, 0xee, 0x00, 0x7f, 0xf0]).toString(
    "base64url",
  );
  const callback = f.request({
    ...f.details,
    accounts: [{ credentialId: id, displayName: "Fixture account" }],
  });
  expect(id).toMatch(/[-_]/u);
  expect(mocks.show).toHaveBeenCalledOnce();
  f.respond(1);
  await settle();
  expect(callback).toHaveBeenCalledExactlyOnceWith(id);
});
it("accepts a native choice before focus has returned from the closing sheet", async () => {
  const f = fixture(),
    callback = f.request();
  f.window.isFocused = () => false;
  f.respond(1);
  await settle();
  expect(callback).toHaveBeenCalledExactlyOnceWith("a1");
});
it.each([0, -1, 999, 1.5])(
  "cancels an invalid/cancel response %s",
  async (response) => {
    const f = fixture(),
      callback = f.request();
    f.respond(response);
    await settle();
    expect(callback).toHaveBeenCalledExactlyOnceWith(undefined);
  },
);
it.each(["did-start-navigation", "render-process-gone", "destroyed"])(
  "cancels on %s and ignores a late approval while keeping the sheet slot",
  async (event) => {
    const f = fixture(),
      callback = f.request();
    const signal = mocks.show.mock.calls[0]![1].signal;
    f.contents.emit(event, { isMainFrame: true, frame: f.frame });
    expect(signal.aborted).toBe(true);
    expect(callback).toHaveBeenCalledExactlyOnceWith(undefined);
    const duplicate = f.request();
    expect(duplicate).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(mocks.show).toHaveBeenCalledOnce();
    f.respond(1);
    await settle();
    expect(callback).toHaveBeenCalledOnce();
    f.request();
    expect(mocks.show).toHaveBeenCalledTimes(2);
  },
);
it.each(["hide", "minimize", "closed"])(
  "cancels when the host emits %s",
  async (event) => {
    const f = fixture(),
      callback = f.request();
    f.window.emit(event);
    f.respond(1);
    await settle();
    expect(callback).toHaveBeenCalledExactlyOnceWith(undefined);
  },
);
it.each(["detached", "navigation", "frame-token", "hidden-tab"])(
  "rejects a stale %s request",
  async (kind) => {
    const f = fixture(),
      callback = f.request();
    if (kind === "detached") f.frame.detached = true;
    if (kind === "navigation") f.frame.url += "changed";
    if (kind === "frame-token") mocks.fromToken.mockReturnValue({ ...f.frame });
    if (kind === "hidden-tab") f.target.current.mockReturnValue(false);
    vi.advanceTimersByTime(250);
    f.respond(1);
    await settle();
    expect(callback).toHaveBeenCalledExactlyOnceWith(undefined);
  },
);
it("times out, closes its native sheet and never accepts a late choice", async () => {
  const f = fixture(),
    callback = f.request();
  vi.advanceTimersByTime(120_000);
  expect(callback).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(mocks.show.mock.calls[0]![1].signal.aborted).toBe(true);
  f.respond(1);
  await settle();
  expect(callback).toHaveBeenCalledOnce();
});
it("preserves a request across sibling iframe navigation, but cancels requesting/ancestor navigation", async () => {
  const f = fixture();
  const parent = { frameToken: "parent", parent: null };
  Object.assign(f.frame, { parent });
  const callback = f.request();
  f.contents.emit("did-start-navigation", {
    isMainFrame: false,
    frame: { frameToken: "sibling" },
  });
  expect(callback).not.toHaveBeenCalled();
  expect(mocks.show.mock.calls[0]![1].signal.aborted).toBe(false);
  f.respond(1);
  await settle();
  expect(callback).toHaveBeenCalledExactlyOnceWith("a1");
  for (const frame of [f.frame, parent]) {
    const next = f.request();
    f.contents.emit("did-start-navigation", { isMainFrame: false, frame });
    f.respond(2);
    await settle();
    expect(next).toHaveBeenCalledExactlyOnceWith(undefined);
  }
});
it("handles shutdown and a failed native prompt", async () => {
  const f = fixture(),
    callback = f.request();
  f.reject();
  await settle();
  expect(callback).toHaveBeenCalledExactlyOnceWith(undefined);
  const next = f.request();
  mocks.app.on.mock.calls[0]![1]();
  f.respond(1);
  await settle();
  expect(next).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(f.request()).toHaveBeenCalledExactlyOnceWith(undefined);
});
it("rejects dead/background/foreign requests and malformed account lists before UI", () => {
  const f = fixture();
  for (const details of [
    { ...f.details, frame: null },
    { ...f.details, relyingPartyId: "fake\nRP" },
    { ...f.details, accounts: [] },
    { ...f.details, accounts: [f.details.accounts[0], f.details.accounts[0]] },
    { ...f.details, accounts: [{ credentialId: "unlisted!" }] },
    {
      ...f.details,
      accounts: Array.from({ length: 9 }, (_, i) => ({
        credentialId: `id${i}`,
      })),
    },
  ])
    expect(
      f.request(details as typeof f.details),
    ).toHaveBeenCalledExactlyOnceWith(undefined);
  f.target.current.mockReturnValue(false);
  expect(f.request()).toHaveBeenCalledExactlyOnceWith(undefined);
  f.target.current.mockReturnValue(true);
  f.window.isFocused = () => false;
  expect(f.request()).toHaveBeenCalledExactlyOnceWith(undefined);
  f.window.isFocused = () => true;
  mocks.fromFrame.mockReturnValue({ ...f.contents, session: {} });
  expect(f.request()).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(mocks.show).not.toHaveBeenCalled();
});
