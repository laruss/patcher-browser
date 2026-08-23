import {
  SUBPROCESS_HEAVY_MAX_WORKERS,
  defineWorkspaceTestConfig,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@patcher/host-daemon",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    env: {
      PATCHER_DATA_DIR: "/tmp/patcher-host-daemon-test",
      PATCHER_SERVER_URL: "http://127.0.0.1:49161",
      PATCHER_HOST_DAEMON_PORT: "49162",
    },
    testTimeout: 15_000,
    // Builds real git repositories a process at a time, and starts a real
    // local API server. See SUBPROCESS_HEAVY_MAX_WORKERS.
    maxWorkers: SUBPROCESS_HEAVY_MAX_WORKERS,
  },
});
