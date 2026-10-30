import { beforeEach, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import {
  PASSWORD_MANAGER_CHANNELS,
  PASSWORD_MANAGER_SESSION_CHANNELS,
  passwordManagerRequestSchema,
} from "@patcher/desktop-contract";
import { PASSWORD_PAGE_SESSION } from "../src/password-manager-page-ipc.js";
import { registerPasswordManagerIpc } from "../src/password-manager-ipc.js";
import type { PasswordManager } from "../src/password-manager.js";

const ipc = vi.hoisted(() => ({
  handle: vi.fn(),
  focused: true,
  visible: true,
}));
vi.mock("electron", () => ({
  ipcMain: { handle: ipc.handle },
  BrowserWindow: {
    fromWebContents: () => ({
      isFocused: () => ipc.focused,
      isVisible: () => ipc.visible,
    }),
  },
}));

beforeEach(() => {
  ipc.handle.mockClear();
  ipc.focused = true;
  ipc.visible = true;
});

function fixture() {
  const manager = {
    request: vi.fn(
      async (_input: unknown, _host: number, _current: () => boolean) => ({
        status: "done",
      }),
    ),
    requestSession: vi.fn(
      async (_input: unknown, _host: number, _current: () => boolean) => ({
        status: "done",
      }),
    ),
  };
  const authorize = vi.fn(() => true);
  registerPasswordManagerIpc({
    manager: manager as unknown as PasswordManager,
    authorize,
  });
  const frame = { url: "http://127.0.0.1/password-manager" };
  const sender = {
    id: 42,
    mainFrame: frame,
    isDestroyed: () => false,
    isFocused: () => true,
  };
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const invoke = (channel: string, input: unknown) =>
    ipc.handle.mock.calls.find(([name]) => name === channel)![1](event, input);
  return { manager, frame, event, authorize, invoke };
}

it("negotiates session requests without changing the old strict parser or page channel", async () => {
  const f = fixture();
  const open = { operation: "open", origin: "https://example.com" };
  expect(passwordManagerRequestSchema.safeParse(open).success).toBe(false);
  expect(PASSWORD_MANAGER_SESSION_CHANNELS.request).not.toBe(
    PASSWORD_PAGE_SESSION,
  );
  expect(await f.invoke(PASSWORD_MANAGER_CHANNELS.request, open)).toEqual({
    status: "unavailable",
  });
  expect(f.manager.request).not.toHaveBeenCalled();
  expect(
    await f.invoke(PASSWORD_MANAGER_SESSION_CHANNELS.request, open),
  ).toEqual({ status: "done" });
  expect(f.manager.requestSession).toHaveBeenCalledWith(
    open,
    42,
    expect.any(Function),
  );
});

it("requires the visible foreground manager frame for native copy", async () => {
  const f = fixture();
  const copy = {
    operation: "copy",
    field: "password",
    id: "00000000-0000-4000-8000-000000000001",
    version: 1,
  };
  for (const reason of [
    "background",
    "hidden",
    "other-route",
    "untrusted",
  ] as const) {
    ipc.focused = reason !== "background";
    ipc.visible = reason !== "hidden";
    f.frame.url =
      reason === "other-route"
        ? "http://127.0.0.1/browser"
        : "http://127.0.0.1/password-manager";
    f.authorize.mockReturnValue(reason !== "untrusted");
    expect(
      await f.invoke(PASSWORD_MANAGER_SESSION_CHANNELS.request, copy),
    ).toEqual({ status: "unavailable" });
  }
  expect(f.manager.requestSession).not.toHaveBeenCalled();
});

it("rechecks focus and navigation when the native operation resumes", async () => {
  const f = fixture();
  await f.invoke(PASSWORD_MANAGER_SESSION_CHANNELS.request, {
    operation: "open",
    origin: "https://example.com",
  });
  const current = f.manager.requestSession.mock
    .calls[0]![2] as unknown as () => boolean;
  expect(current()).toBe(true);
  ipc.focused = false;
  expect(current()).toBe(false);
  ipc.focused = true;
  f.frame.url = "http://127.0.0.1/browser";
  expect(current()).toBe(false);
});
