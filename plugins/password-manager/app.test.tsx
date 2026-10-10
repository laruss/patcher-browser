// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { loadPluginApp, renderSlot } from "@patcher/plugin-sdk/testing/app";
import type { ManagerView } from "./contracts.js";

const app = await loadPluginApp(() => import("./app.js"));
const panel = app.leadingPanels[0]!;
const props = {
  browserTabId: "tab",
  browserUrl: "https://example.test/login?token=private",
};
const accounts: ManagerView["accounts"] = ["personal", "work"].map(
  (accountId, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index}`,
    version: index + 1,
    origin: "https://example.test",
    accountId,
    username: `${accountId}@example.test`,
    protection: "require-touch-id",
    createdAt: 1,
    updatedAt: 2,
  }),
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("password manager panel", () => {
  it("shows two accounts without passwords/query strings and fills only the account the person chose", async () => {
    const request = vi.fn(() => ({ status: "filled" }));
    const slot = renderSlot(panel, props, {
      rpc: { view: () => ({ status: "ready", accounts }), request },
    });
    await slot.findByText("work@example.test");
    expect(slot.container.textContent).not.toContain("token=private");
    expect(slot.container.querySelector('input[type="password"]')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Fill work" }));
    await slot.findByText("Login filled. Submit the form yourself.");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "fill",
        tabId: "tab",
        origin: "https://example.test",
        reference: { id: accounts[1]!.id, version: 2 },
      }),
    );
  });
  it("saves a named new login and updates/deletes an explicitly chosen current version", async () => {
    const request = vi.fn((input: unknown) => {
      const { operation } = input as { operation: string };
      return {
        status:
          operation === "save"
            ? "saved"
            : operation === "update"
              ? "updated"
              : "deleted",
      };
    });
    const slot = renderSlot(panel, props, {
      rpc: { view: () => ({ status: "ready", accounts }), request },
    });
    fireEvent.change(await slot.findByLabelText("New account label"), {
      target: { value: "travel" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Save new login" }));
    await slot.findByText("Login saved.");
    fireEvent.click(slot.getByRole("button", { name: "Update personal" }));
    await slot.findByText("Login updated.");
    fireEvent.click(slot.getByRole("button", { name: "Delete work" }));
    await slot.findByText("Login deleted.");
    expect(
      request.mock.calls.map(
        ([input]) => (input as { operation: string }).operation,
      ),
    ).toEqual(["save", "update", "delete"]);
  });
  it("accepts hints only as expiring text and never turns a forged submit into a proposal or a refresh", async () => {
    const view = vi.fn(() => ({ status: "ready", accounts: [] }));
    const request = vi.fn();
    const slot = renderSlot(panel, props, { rpc: { view, request } });
    await slot.findByText("No saved logins for this origin.");
    await slot.emitRealtime("form-hint", {
      origin: "https://other.test",
      kind: "submit",
      present: true,
    });
    expect(slot.queryByText(/success is unknown/)).toBeNull();
    await slot.emitRealtime("form-hint", {
      origin: "https://example.test",
      kind: "submit",
      present: true,
    });
    expect(slot.getByText(/success is unknown/)).toBeTruthy();
    expect(view).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });
  it("requests site access only on Use here and only for this fixed plugin and tab", async () => {
    let ready = false;
    const fetchMock = vi.fn(async () => {
      ready = true;
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const slot = renderSlot(panel, props, {
      rpc: {
        view: () => ({ status: ready ? "ready" : "denied", accounts: [] }),
      },
    });
    const button = await slot.findByRole("button", { name: "Use here" });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(button);
    await slot.findByRole("button", { name: "Save new login" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/site-access/confirm",
      expect.objectContaining({
        body: JSON.stringify({ pluginId: "password-manager", tabId: "tab" }),
      }),
    );
  });
  it("ignores an older list response and never retries a denied operation", async () => {
    let finish!: (value: ManagerView) => void;
    const view = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ status: "ready", accounts });
    const request = vi.fn(() => ({ status: "denied" }));
    const slot = renderSlot(panel, props, { rpc: { view, request } });
    await waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    await slot.emitRealtime("refresh", {
      tabId: "tab",
      origin: "https://example.test",
    });
    await slot.findByText("work@example.test");
    finish({ status: "ready", accounts: [] });
    await waitFor(() =>
      expect(slot.getByText("work@example.test")).toBeTruthy(),
    );
    fireEvent.click(slot.getByRole("button", { name: "Fill work" }));
    await slot.findByText(/Action refused/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("fails closed on old hosts and shows unavailable instead of plaintext input", async () => {
    const old = renderSlot(
      panel,
      { browserUrl: props.browserUrl },
      { rpc: {} },
    );
    expect(old.getByText(/current desktop host/)).toBeTruthy();
    old.unmount();
    const slot = renderSlot(panel, props, {
      rpc: { view: () => ({ status: "unavailable", accounts: [] }) },
    });
    await slot.findByText("The connected desktop vault is unavailable.");
    expect(
      (slot.getByRole("button", { name: "Use here" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(slot.queryByRole("button", { name: "Save new login" })).toBeNull();
  });
  it.each([
    { browserTabId: "other-tab", browserUrl: props.browserUrl },
    { browserTabId: "tab", browserUrl: "https://example.test/other" },
  ])(
    "cancels a pending request and ignores its reply after changing target to %j",
    async (nextProps) => {
      let finish!: (value: { status: string }) => void;
      const request = vi.fn(
        (_input: unknown) =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const cancel = vi.fn(() => ({ cancelled: true }));
      const slot = renderSlot(panel, props, {
        rpc: { view: () => ({ status: "ready", accounts }), request, cancel },
      });
      fireEvent.change(await slot.findByLabelText("New account label"), {
        target: { value: "draft" },
      });
      await slot.emitRealtime("form-hint", {
        origin: "https://example.test",
        kind: "submit",
        present: true,
      });
      fireEvent.click(slot.getByRole("button", { name: "Fill work" }));
      await slot.findByRole("button", { name: "Cancel request" });
      slot.rerender(createElement(panel.component, nextProps));
      await slot.findByText("work@example.test");
      expect(cancel).toHaveBeenCalledWith({
        requestId: (request.mock.calls[0]![0] as { requestId: string })
          .requestId,
      });
      expect(
        (slot.getByLabelText("New account label") as HTMLInputElement).value,
      ).toBe("");
      expect(slot.queryByText(/success is unknown/)).toBeNull();
      finish({ status: "filled" });
      await waitFor(() =>
        expect(
          slot.queryByText("Login filled. Submit the form yourself."),
        ).toBeNull(),
      );
      expect(request).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );
});
