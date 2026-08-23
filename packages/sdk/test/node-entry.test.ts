import { afterEach, describe, expect, it, vi } from "vitest";

const NODE_ENTRY_IMPORT_TEST_TIMEOUT_MS = 15_000;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("@patcher/sdk/node entry", () => {
  it(
    "imports and builds explicit SDKs without Patcher server configuration",
    async () => {
      // `patcher --help` and other config-free CLI paths import this module before
      // any server URL exists, so the import itself must not load CLI config.
      vi.stubEnv("PATCHER_SERVER_URL", undefined);
      vi.stubEnv("PATCHER_HOST_DAEMON_PORT", undefined);

      const nodeEntry = await import("../src/node.js");
      const sdk = nodeEntry.createNodePatcherSdk({ baseUrl: "http://server" });

      expect(typeof sdk.threads.list).toBe("function");
    },
    NODE_ENTRY_IMPORT_TEST_TIMEOUT_MS,
  );
});
