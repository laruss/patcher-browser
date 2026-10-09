// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PatcherDesktopBrowserApi } from "@patcher/desktop-contract";
import { BrowserCredentialRequests } from "./BrowserCredentialRequests";
afterEach(cleanup);
const pending = {
  id: "d612435c-ac97-47b9-9417-010aa0b44ce3",
  tabId: "tab",
  pluginId: "plugin",
  pluginName: "Plugin",
  origin: "https://example.com",
  accountId: "primary",
  operation: "fill",
  protection: "require-touch-id",
  reviewing: false,
};
function fixture(value: unknown = [pending]) {
  const review = vi.fn(async () => ({ status: "cancelled" })),
    dismiss = vi.fn(async () => true);
  let changed = () => {};
  const browser = {
    getCredentialRequests: vi.fn(async () => value),
    onCredentialRequestsChanged: vi.fn((listener: () => void) => {
      changed = listener;
      return () => {};
    }),
    reviewCredentialRequest: review,
    dismissCredentialRequest: dismiss,
  } as unknown as PatcherDesktopBrowserApi;
  return { browser, review, dismiss, changed: () => changed() };
}
it("renders inert metadata and only calls Review on a click", async () => {
  const f = fixture();
  render(<BrowserCredentialRequests tabId="tab" browser={f.browser} />);
  await screen.findByRole("button", { name: "Review" });
  expect(screen.getByText(/example.com/)).toBeTruthy();
  expect(f.review).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(f.review).toHaveBeenCalledWith(pending.id);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(f.dismiss).toHaveBeenCalledWith(pending.id);
});
it("filters other tabs and rejects metadata with private/secret fields", async () => {
  const f = fixture([{ ...pending, ciphertext: "must-not-render" }]);
  const result = render(
    <BrowserCredentialRequests tabId="tab" browser={f.browser} />,
  );
  await waitFor(() =>
    expect(f.browser.getCredentialRequests).toHaveBeenCalled(),
  );
  expect(result.container.textContent).toBe("");
  result.rerender(
    <BrowserCredentialRequests tabId="other" browser={fixture().browser} />,
  );
  await waitFor(() => expect(result.container.textContent).toBe(""));
});
it("feature-detects old shells and disables repeated Review while native authorization runs", async () => {
  const old = render(
    <BrowserCredentialRequests
      tabId="tab"
      browser={{} as PatcherDesktopBrowserApi}
    />,
  );
  expect(old.container.textContent).toBe("");
  old.unmount();
  const f = fixture([{ ...pending, reviewing: true }]);
  render(<BrowserCredentialRequests tabId="tab" browser={f.browser} />);
  const review = await screen.findByRole("button", { name: "Review" });
  expect((review as HTMLButtonElement).disabled).toBe(true);
});
