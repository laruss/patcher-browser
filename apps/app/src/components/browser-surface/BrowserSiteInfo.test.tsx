// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { resolveBrowserPageSecurity } from "@/lib/browser-page-security";
import { BrowserSiteInfo } from "./BrowserSiteInfo";

const TAB_ID = "tab-active";

function mockSiteInfo(sections: unknown) {
  const fetchMock = vi.fn(
    async (input: string) =>
      new Response(
        JSON.stringify(
          input === "/api/v1/plugins/site-access"
            ? {
                plugins: [],
                cleanup: [],
                contributions: { scripts: [], styles: [] },
              }
            : { ok: true, sections },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSiteInfo({
  certificateTrustedByUser = false,
  open = true,
  url = "https://example.test/page",
}: {
  certificateTrustedByUser?: boolean;
  open?: boolean;
  url?: string;
} = {}) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  render(
    <Wrapper>
      <BrowserSiteInfo
        onOpenChange={() => {}}
        open={open}
        security={resolveBrowserPageSecurity({
          certificateTrustedByUser,
          url,
        })}
        tabId={TAB_ID}
        url={url}
      />
    </Wrapper>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("browser site info", () => {
  it("says what it knows about an encrypted connection, and names the host", () => {
    mockSiteInfo([]);
    renderSiteInfo();

    expect(screen.getByText("Connection is encrypted")).not.toBeNull();
    expect(screen.getByText("example.test")).not.toBeNull();
  });

  // The whole point of the panel: the padlock and the panel agree, and neither
  // calls an unverified certificate secure.
  it("calls out a certificate the user waved through", () => {
    mockSiteInfo([]);
    renderSiteInfo({ certificateTrustedByUser: true });

    expect(screen.getByText("Certificate is not trusted")).not.toBeNull();
    expect(screen.getByLabelText("Certificate is not trusted")).not.toBeNull();
    expect(screen.queryByText("Connection is encrypted")).toBeNull();
  });

  it("does not warn about a page served from this machine", () => {
    mockSiteInfo([]);
    renderSiteInfo({ url: "http://localhost:5173/" });

    expect(screen.getByText("Page from this machine")).not.toBeNull();
  });

  it("shows a plugin's rows under its own heading", async () => {
    mockSiteInfo([
      {
        pluginId: "passwords",
        providerId: "logins",
        label: "Passwords",
        rows: [{ label: "Saved logins", value: "2" }],
      },
    ]);
    renderSiteInfo();

    await waitFor(() => {
      expect(screen.getByText("Passwords")).not.toBeNull();
    });
    expect(screen.getByText("Saved logins")).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
  });

  // A provider may do real work to answer, so nothing is asked until the panel
  // is actually open — which is why the request lives inside the popover's own
  // content rather than behind a flag.
  it("asks nobody while it is closed", () => {
    const fetchMock = mockSiteInfo([]);
    renderSiteInfo({ open: false });

    expect(screen.queryByText("Connection is encrypted")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
