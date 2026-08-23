import {
  SUBPROCESS_HEAVY_MAX_WORKERS,
  defineWorkspaceTestConfig,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@patcher/host-watcher",
    include: ["test/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // These wait on real FSEvents callbacks, which arrive when the OS says so.
    // Under a loaded machine 19 of the 39 timed out. See
    // SUBPROCESS_HEAVY_MAX_WORKERS.
    maxWorkers: SUBPROCESS_HEAVY_MAX_WORKERS,
    // And the deadline has to match what is being waited on: a filesystem
    // notification is the OS's to schedule, not ours. 5s is vitest's generic
    // default and was never chosen for that; 15s is what the other packages
    // driving real subsystems use.
    testTimeout: 15_000,
  },
});
