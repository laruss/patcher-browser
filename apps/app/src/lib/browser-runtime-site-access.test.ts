import { afterEach, describe, expect, it, vi } from "vitest";
import { respondWithRuntimePluginAuth } from "./browser-runtime-site-access";

const native = vi.hoisted(() => ({
  respond: vi.fn(async () => true),
  supported: true,
}));
vi.mock("./patcher-desktop", () => ({
  getDesktopBrowserApi: () =>
    native.supported ? { respondToScopedAuth: native.respond } : {},
}));
const challenge = {
  tabId: "tab",
  id: "prompt",
  host: "example.com",
  insecure: false,
};
const token = "b576ecbb-bc53-4e12-bbf5-dc1b20b74540";
afterEach(() => {
  vi.unstubAllGlobals();
  native.respond.mockClear();
  native.respond.mockResolvedValue(true);
  native.supported = true;
});
describe("runtime auth native delivery", () => {
  it("does not request runtime credentials from an old shell", async () => {
    native.supported = false;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await respondWithRuntimePluginAuth(challenge)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the dedicated route and sends the capability to the native consumer", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            credentials: { token, username: "user", password: "sentinel" },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await respondWithRuntimePluginAuth(challenge)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/plugins/site-access/auth",
      expect.objectContaining({ body: JSON.stringify(challenge) }),
    );
    expect(native.respond).toHaveBeenCalledWith({
      tabId: "tab",
      id: "prompt",
      token,
      answer: { kind: "credentials", username: "user", password: "sentinel" },
    });
  });
  it("preserves a native refusal after revoke instead of using a legacy prompt response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              credentials: { token, username: "user", password: "sentinel" },
            }),
          ),
      ),
    );
    native.respond.mockResolvedValue(false);
    expect(await respondWithRuntimePluginAuth(challenge)).toBe(false);
    expect(native.respond).toHaveBeenCalledOnce();
  });
  it("refuses a credential reply with no capability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              credentials: { username: "user", password: "sentinel" },
            }),
          ),
      ),
    );
    expect(await respondWithRuntimePluginAuth(challenge)).toBe(false);
    expect(native.respond).not.toHaveBeenCalled();
  });
});
