// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowserRuntimeSiteAccess, PluginSiteAccess } from "./PluginSiteAccess";

const reload = vi.fn();
vi.mock("@/lib/patcher-desktop", () => ({
  getDesktopBrowserApi: () => ({ reload }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function fixture({
  allowed = false,
  available = true,
  enabled = true,
  pending = false,
  cancel = false,
} = {}) {
  const plugin = {
    pluginId: "plugin",
    name: "Plugin",
    available,
    enabled,
    origins: allowed ? ["https://a.example.com"] : [],
    permissions: ["page.read"],
    sites: ["https://*.example.com/**"],
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (cancel) return new Response("{}", { status: 403 });
      plugin.origins = url.endsWith("confirm") ? ["https://a.example.com"] : [];
      return new Response("{}", { status: 200 });
    }
    return new Response(
      JSON.stringify({
        plugins: [plugin],
        contributions: { scripts: [], styles: [] },
        cleanup: pending ? [{ pluginId: "plugin", tabId: "tab" }] : [],
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const { wrapper } = createQueryClientTestHarness();
  return { fetchMock, wrapper };
}
describe("runtime site access UI", () => {
  it("requests native confirmation for the actual tab and displays exact-origin revoke", async () => {
    const f = fixture();
    render(
      <BrowserRuntimeSiteAccess tabId="tab" url="https://a.example.com/page" />,
      { wrapper: f.wrapper },
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Allow here: https://a.example.com",
      }),
    );
    await screen.findByRole("button", { name: "Revoke https://a.example.com" });
    const request = f.fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    )!;
    expect(request[0]).toBe("/api/v1/plugins/site-access/confirm");
    expect(JSON.parse(request[1]!.body as string)).toEqual({
      pluginId: "plugin",
      tabId: "tab",
    });
    expect(reload).not.toHaveBeenCalled();
  });
  it("reports cancellation without granting access or reloading a filled page", async () => {
    const f = fixture({ cancel: true });
    render(
      <BrowserRuntimeSiteAccess tabId="tab" url="https://a.example.com/" />,
      { wrapper: f.wrapper },
    );
    fireEvent.click(await screen.findByRole("button", { name: /Allow here/ }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "refused or cancelled",
    );
    expect(screen.queryByRole("button", { name: /Revoke/ })).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
  it("keeps cleanup visible until an explicit reload and lets disabled plugins revoke", async () => {
    const f = fixture({ allowed: true, enabled: false, pending: true });
    render(
      <BrowserRuntimeSiteAccess tabId="tab" url="https://a.example.com/" />,
      { wrapper: f.wrapper },
    );
    const revoke = await screen.findByRole("button", { name: /Revoke/ });
    expect((revoke as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(revoke);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: /Allow here/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
    expect(
      screen.getByText(/Previously injected scripts may remain/),
    ).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledWith("tab");
  });
  it("shows permissions/ceiling/grants in plugin detail and refuses a disconnected host", async () => {
    const f = fixture({ allowed: true, available: false });
    render(<PluginSiteAccess pluginId="plugin" />, { wrapper: f.wrapper });
    await screen.findByText("Permissions: page.read");
    expect(
      screen.getByText("Declared sites: https://*.example.com/**"),
    ).not.toBeNull();
    expect(screen.getByText("https://a.example.com")).not.toBeNull();
    expect(
      screen.getByText(/requires the connected desktop app/),
    ).not.toBeNull();
  });
  it("does not offer grants for a URL outside the declared ceiling", async () => {
    const f = fixture();
    render(<BrowserRuntimeSiteAccess tabId="tab" url="https://other.test/" />, {
      wrapper: f.wrapper,
    });
    await waitFor(() => expect(f.fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Allow here/ })).toBeNull();
  });
});
