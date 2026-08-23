import { describe, expect, it } from "vitest";
import {
  listClientServerOrigins,
  normalizeClientServerOrigin,
  parseClientConfig,
  resolveClientSshAuthority,
} from "../src/client-config.js";

describe("client config", () => {
  it("normalizes server URLs to origins", () => {
    const config = parseClientConfig({
      servers: {
        "https://patcher.example.test/projects/proj_1": {
          hosts: {
            host_1: {
              sshAuthority: "devbox",
            },
          },
        },
      },
    });

    expect(listClientServerOrigins(config)).toEqual([
      "https://patcher.example.test",
    ]);
    expect(
      resolveClientSshAuthority(config, {
        serverOrigin: "https://patcher.example.test/thread/thr_1",
        hostId: "host_1",
      }),
    ).toBe("devbox");
  });

  it("returns null when no SSH target is configured for a host", () => {
    const config = parseClientConfig({
      servers: {
        "https://patcher.example.test": {
          hosts: {
            host_1: {
              sshAuthority: "devbox",
            },
          },
        },
      },
    });

    expect(
      resolveClientSshAuthority(config, {
        serverOrigin: "https://patcher.example.test",
        hostId: "host_2",
      }),
    ).toBeNull();
  });

  it("rejects duplicate server origins after normalization", () => {
    expect(() =>
      parseClientConfig({
        servers: {
          "https://patcher.example.test/a": {
            hosts: {},
          },
          "https://patcher.example.test/b": {
            hosts: {},
          },
        },
      }),
    ).toThrow(/Duplicate server origin/u);
  });

  it("rejects invalid server origins and SSH authorities", () => {
    expect(() => normalizeClientServerOrigin("not a url")).toThrow(
      /Invalid server origin/u,
    );
    expect(() =>
      parseClientConfig({
        servers: {
          "https://patcher.example.test": {
            hosts: {
              host_1: {
                sshAuthority: "bad authority",
              },
            },
          },
        },
      }),
    ).toThrow();
  });
});
