import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
  DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH,
  DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE,
} from "@patcher/host-daemon-contract";
import { resolveHostDaemonLocalApiConfig } from "./local-api-config.js";

describe("host daemon local API config", () => {
  it("uses persistent defaults for persistent hosts", () => {
    expect(
      resolveHostDaemonLocalApiConfig({
        hostDaemonPort: 3999,
        hostType: "persistent",
        localApi: undefined,
      }),
    ).toEqual({
      bindHost: DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
      healthPath: DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH,
      healthValue: DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE,
      mode: "full",
      port: 3999,
    });
  });

  it("allows explicit overrides on top of the host-type preset", () => {
    expect(
      resolveHostDaemonLocalApiConfig({
        hostDaemonPort: 3999,
        hostType: "persistent",
        localApi: {
          bindHost: "127.0.0.1",
          healthPath: "/ready",
          healthValue: "healthy",
          mode: "health-only",
          port: 9123,
        },
      }),
    ).toEqual({
      bindHost: "127.0.0.1",
      healthPath: "/ready",
      healthValue: "healthy",
      mode: "health-only",
      port: 9123,
    });
  });
});
