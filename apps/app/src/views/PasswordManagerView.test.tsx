// @vitest-environment jsdom
import {
  cleanup,
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
} from "@patcher/desktop-contract";
import { PasswordManagerView } from "./PasswordManagerView";

const bridge = vi.hoisted(() => ({
  request: vi.fn(),
  onOpen: vi.fn(() => () => {}),
  onChange: vi.fn(() => () => {}),
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
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
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
    <MemoryRouter>
      <PasswordManagerView />
    </MemoryRouter>,
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
