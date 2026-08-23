import {
  SUBPROCESS_HEAVY_MAX_WORKERS,
  defineWorkspaceTestConfig,
} from "../../vitest.shared.js";

const parsedTimeoutScale = Number(process.env.PATCHER_TEST_TIMEOUT_SCALE ?? 1);
const timeoutScale =
  Number.isFinite(parsedTimeoutScale) && parsedTimeoutScale > 0
    ? parsedTimeoutScale
    : 1;

export default defineWorkspaceTestConfig({
  test: {
    // Fake integration suites isolate temp roots, ports, and in-memory state,
    // so we can safely parallelize across files for a large runtime win.
    fileParallelism: true,
    // Bounded, though: every file here runs a real server and waits for real
    // threads to reach idle, and a full `turbo run test` timed out 30 of the
    // 55 tests. See SUBPROCESS_HEAVY_MAX_WORKERS.
    maxWorkers: SUBPROCESS_HEAVY_MAX_WORKERS,
    // No file here mocks modules or stubs globals/env (vitest.shared.ts's
    // findIsolationRequiringTests would flag it), so workers can reuse their
    // context across files instead of re-importing the server graph per file.
    isolate: false,
    globalSetup: ["./global-setup.ts"],
    hookTimeout: Math.ceil(60_000 * timeoutScale),
    include: ["fake/**/*.test.ts"],
    name: "@patcher/integration-tests",
    env: {
      PATCHER_DATA_DIR: "/tmp/patcher-integration-test",
      PATCHER_SERVER_PORT: "49161",
      PATCHER_SERVER_URL: "http://127.0.0.1:49161",
      PATCHER_HOST_DAEMON_PORT: "49162",
    },
    silent: "passed-only",
    testTimeout: Math.ceil(60_000 * timeoutScale),
  },
});
