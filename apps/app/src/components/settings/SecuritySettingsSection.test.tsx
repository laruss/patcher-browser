// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopSecretStorageStatus,
  PatcherDesktopApi,
} from "@patcher/desktop-contract";
import { SecuritySettingsSection } from "./SecuritySettingsSection";

const original = window.patcherDesktop;
afterEach(() => {
  cleanup();
  window.patcherDesktop = original;
});
const plaintext: DesktopSecretStorageStatus = {
  mode: "plaintext",
  available: true,
  migrationPending: false,
  unprocessedEntries: 0,
  error: null,
};
function setup(status: DesktopSecretStorageStatus) {
  const api = {
    status: vi.fn(async () => status),
    activate: vi.fn(async () => ({ ...plaintext, mode: "encrypted" as const })),
    unlock: vi.fn(async () => ({ ...plaintext, mode: "encrypted" as const })),
  };
  window.patcherDesktop = {
    secretStorage: api,
  } as unknown as PatcherDesktopApi;
  render(<SecuritySettingsSection />);
  return api;
}
describe("plugin storage settings", () => {
  it("permits retry after cancellation instead of disabling the recovery action", async () => {
    const api = setup({
      ...plaintext,
      mode: "encrypted",
      available: false,
      error: "cancelled",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Unlock and retry" }),
    );
    await waitFor(() => expect(api.unlock).toHaveBeenCalledOnce());
  });
  it("checks status without activating storage and only activates after a click", async () => {
    const api = setup(plaintext);
    const button = await screen.findByRole("button", {
      name: "Encrypt plugin secrets",
    });
    expect(api.activate).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(api.activate).toHaveBeenCalledOnce());
    await screen.findByText("Encrypted with this Mac’s Keychain.");
    expect(
      screen.queryByRole("button", { name: "Resume migration" }),
    ).toBeNull();
  });
  it("shows a locked encrypted store and allows retry without downgrading it", async () => {
    const api = setup({
      ...plaintext,
      mode: "encrypted",
      available: false,
      error: "locked",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Unlock and retry" }),
    );
    await waitFor(() => expect(api.unlock).toHaveBeenCalledOnce());
    expect(api.activate).not.toHaveBeenCalled();
  });
  it("explains unsupported web access and preserves the unknown-entry warning", async () => {
    window.patcherDesktop = undefined;
    const view = render(<SecuritySettingsSection />);
    expect(screen.queryByRole("button")).toBeNull();
    view.unmount();
    setup({
      ...plaintext,
      mode: "encrypted",
      migrationPending: true,
      unprocessedEntries: 2,
    });
    await screen.findByText(/2 unrecognized entries were preserved/);
  });
});
