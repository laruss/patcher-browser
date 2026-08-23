import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDevWebSocketUrl } from "./dev-websocket-url";

function installWindowLocation(url: string): void {
  const location = new URL(url);
  vi.stubGlobal("window", {
    location: {
      host: location.host,
      hostname: location.hostname,
      port: location.port,
      protocol: location.protocol,
    },
  });
}

describe("buildDevWebSocketUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects directly to the backend for HTTP source dev", () => {
    vi.stubGlobal("__PATCHER_DEV_WS_BROWSER_HOST_PORT__", 23_802);
    vi.stubGlobal("__PATCHER_DEV_APP_BROWSER_HOST_PORT__", 15_802);
    installWindowLocation("http://devbox.local:15802/threads/thr_1");

    expect(buildDevWebSocketUrl({ path: "/ws" })).toBe(
      "ws://devbox.local:23802/ws",
    );
  });

  it("uses the proxied app origin for an HTTPS reverse proxy", () => {
    vi.stubGlobal("__PATCHER_DEV_WS_BROWSER_HOST_PORT__", 23_802);
    vi.stubGlobal("__PATCHER_DEV_APP_BROWSER_HOST_PORT__", 15_802);
    installWindowLocation(
      "https://laptop.tail-scale.ts.net/threads/thr_jew2ruik89",
    );

    expect(buildDevWebSocketUrl({ path: "/ws" })).toBe(
      "wss://laptop.tail-scale.ts.net/ws",
    );
  });

  it("uses the proxied app origin for an HTTP proxy on another port", () => {
    vi.stubGlobal("__PATCHER_DEV_WS_BROWSER_HOST_PORT__", 23_802);
    vi.stubGlobal("__PATCHER_DEV_APP_BROWSER_HOST_PORT__", 15_802);
    installWindowLocation("http://sawyer.localhost:35802/threads/thr_1");

    expect(buildDevWebSocketUrl({ path: "/ws" })).toBe(
      "ws://sawyer.localhost:35802/ws",
    );
  });

  it("preserves terminal websocket paths on the proxied app origin", () => {
    vi.stubGlobal("__PATCHER_DEV_WS_BROWSER_HOST_PORT__", 23_802);
    vi.stubGlobal("__PATCHER_DEV_APP_BROWSER_HOST_PORT__", 15_802);
    installWindowLocation("https://dev.example.test:15802/threads/thr_1");

    expect(buildDevWebSocketUrl({ path: "/ws/terminals/term_1" })).toBe(
      "wss://dev.example.test:15802/ws/terminals/term_1",
    );
  });

  it("returns undefined outside the dev build", () => {
    installWindowLocation("https://app.example.test/threads/thr_1");

    expect(buildDevWebSocketUrl({ path: "/ws" })).toBeUndefined();
  });
});
