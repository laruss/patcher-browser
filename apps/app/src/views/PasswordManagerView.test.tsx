// @vitest-environment jsdom
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  PasswordEntry,
  PasswordManagerRequest,
  PasswordManagerResponse,
  DesktopPasswordManagerSessionApi,
  PasswordManagerSessionRequest,
} from "@patcher/desktop-contract";
import { PasswordManagerView } from "./PasswordManagerView";
import { TooltipProvider } from "@patcher/shared-ui/tooltip";

const bridge = vi.hoisted(() => ({
  request: vi.fn(),
  onOpen: vi.fn(() => () => {}),
  onChange: vi.fn(() => () => {}),
  session: undefined as DesktopPasswordManagerSessionApi | undefined,
}));
vi.mock("@/lib/patcher-desktop", () => ({
  getPatcherDesktopInfo: () => ({ passwordManager: bridge }),
}));
const entry: PasswordEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  version: 1,
  origin: "https://example.com",
  username: "alice",
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  bridge.session = undefined;
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

it("unlocks a site card before entry and copies username/password without revealing the password", async () => {
  let allowed = false;
  const request = vi.fn(async () => ({
    status: (allowed ? "done" : "cancelled") as "done" | "cancelled",
  }));
  bridge.session = { request, onLock: () => () => {} };
  setup();
  fireEvent.click(await screen.findByText("example.com"));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({
      operation: "open",
      origin: entry.origin,
    }),
  );
  expect(screen.queryByRole("button", { name: "Show password" })).toBeNull();
  allowed = true;
  fireEvent.click(screen.getByText("example.com"));
  fireEvent.click(await screen.findByRole("button", { name: "Copy username" }));
  await screen.findByRole("status");
  expect(request).toHaveBeenLastCalledWith({
    operation: "copy",
    id: entry.id,
    version: entry.version,
    field: "username",
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Copy password" }),
    ).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
  await waitFor(() =>
    expect(request).toHaveBeenLastCalledWith({
      operation: "copy",
      id: entry.id,
      version: entry.version,
      field: "password",
    }),
  );
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "type",
    "password",
  );
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "value",
    "••••••••",
  );
  expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();
});

it("masks on session lock and rejects a password response that arrives after locking", async () => {
  let lock!: () => void;
  let reveal!: (value: PasswordManagerResponse) => void;
  const request = vi.fn(async (input: PasswordManagerSessionRequest) =>
    input.operation === "reveal"
      ? new Promise<PasswordManagerResponse>((resolve) => {
          reveal = resolve;
        })
      : { status: "done" as const },
  );
  bridge.session = {
    request,
    onLock: (listener) => {
      lock = listener;
      return () => {};
    },
  };
  setup();
  fireEvent.click(await screen.findByText("example.com"));
  fireEvent.click(await screen.findByRole("button", { name: "Show password" }));
  await waitFor(() => expect(reveal).toBeTypeOf("function"));
  act(() => lock());
  await act(async () =>
    reveal({ status: "revealed", password: "must-not-be-rendered" }),
  );
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "type",
    "password",
  );
  expect(document.body.textContent).not.toContain("must-not-be-rendered");
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "value",
    "••••••••",
  );
});

it("hides an already revealed password when the native session locks", async () => {
  let lock!: () => void;
  bridge.session = {
    request: async (input) =>
      input.operation === "reveal"
        ? { status: "revealed", password: "synthetic-secret" }
        : { status: "done" },
    onLock: (listener) => {
      lock = listener;
      return () => {};
    },
  };
  setup();
  fireEvent.click(await screen.findByText("example.com"));
  fireEvent.click(await screen.findByRole("button", { name: "Show password" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Password for alice")).toHaveProperty(
      "value",
      "synthetic-secret",
    ),
  );
  act(() => lock());
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "type",
    "password",
  );
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "value",
    "••••••••",
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
function setup() {
  bridge.request.mockImplementation(async (input: PasswordManagerRequest) =>
    input.operation === "list"
      ? { status: "ready", entries: [entry], migrationNeeded: false }
      : { status: "cancelled" },
  );
  render(
    <TooltipProvider>
      <MemoryRouter>
        <PasswordManagerView />
      </MemoryRouter>
    </TooltipProvider>,
  );
}
it("searches across websites/usernames and opens details with the password hidden", async () => {
  setup();
  await screen.findByText("example.com");
  fireEvent.change(screen.getByRole("textbox", { name: "Search passwords" }), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No matching passwords")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Search passwords" }), {
    target: { value: "ALICE" },
  });
  fireEvent.click(screen.getByText("example.com"));
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "type",
    "password",
  );
  expect(bridge.request).toHaveBeenCalledTimes(1);
});
it("uses native authorization for reveal/edit/delete and keeps state after cancellation", async () => {
  setup();
  fireEvent.click(await screen.findByText("example.com"));
  for (const [label, operation] of [
    ["Show password", "reveal"],
    ["Edit", "edit"],
    ["Delete", "delete"],
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(bridge.request).toHaveBeenCalledWith({
        operation,
        id: entry.id,
        version: 1,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: label })).toHaveProperty(
        "disabled",
        false,
      ),
    );
  }
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "type",
    "password",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("adds manually without an account-label field and hides revealed passwords on blur", async () => {
  setup();
  fireEvent.click(await screen.findByText("example.com"));
  bridge.request.mockImplementation(async (input: PasswordManagerRequest) =>
    input.operation === "list"
      ? { status: "ready", entries: [entry], migrationNeeded: false }
      : input.operation === "reveal"
        ? { status: "revealed", password: "test-secret" }
        : { status: "done" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Password for alice")).toHaveProperty(
      "value",
      "test-secret",
    ),
  );
  fireEvent(window, new Event("blur"));
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "type",
    "password",
  );
  fireEvent.click(screen.getByRole("button", { name: "Add password" }));
  fireEvent.change(screen.getByLabelText("Website"), {
    target: { value: "new.example.com" },
  });
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "bob" },
  });
  fireEvent.change(screen.getByLabelText("Password", { selector: "input" }), {
    target: { value: "new-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
  await waitFor(() =>
    expect(bridge.request).toHaveBeenCalledWith({
      operation: "add",
      origin: "new.example.com",
      username: "bob",
      password: "new-secret",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("ignores late sensitive replies in the background and revokes stale edit access", async () => {
  setup();
  fireEvent.click(await screen.findByText("example.com"));
  let resolve!: (value: PasswordManagerResponse) => void;
  bridge.request.mockImplementation((input: PasswordManagerRequest) => {
    if (input.operation === "cancel-edit")
      return Promise.resolve({ status: "done" });
    return new Promise<PasswordManagerResponse>((done) => {
      resolve = done;
    });
  });
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  fireEvent(window, new Event("blur"));
  resolve({ status: "revealed", password: "late-secret" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Show password" }),
    ).toHaveProperty("disabled", false),
  );
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "type",
    "password",
  );
  expect(screen.getByLabelText("Password for alice")).not.toHaveProperty(
    "value",
    "late-secret",
  );
  fireEvent(window, new Event("focus"));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent(window, new Event("blur"));
  const editToken = "00000000-0000-4000-8000-000000000002";
  resolve({ status: "editing", password: "late-secret", editToken });
  await waitFor(() =>
    expect(bridge.request).toHaveBeenCalledWith({
      operation: "cancel-edit",
      editToken,
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("reveals the authenticated password after the system dialog returns focus", async () => {
  setup();
  fireEvent.click(await screen.findByText("example.com"));
  let confirm!: (value: PasswordManagerResponse) => void;
  bridge.request.mockImplementation(
    () =>
      new Promise<PasswordManagerResponse>((resolve) => {
        confirm = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  vi.mocked(document.hasFocus).mockReturnValue(false);
  fireEvent(window, new Event("blur"));
  vi.mocked(document.hasFocus).mockReturnValue(true);
  fireEvent(window, new Event("focus"));
  confirm({ status: "revealed", password: "test-secret" });
  await waitFor(() =>
    expect(screen.getByLabelText("Password for alice")).toHaveProperty(
      "type",
      "text",
    ),
  );
  expect(screen.getByLabelText("Password for alice")).toHaveProperty(
    "value",
    "test-secret",
  );
});
