import {
  SUBPROCESS_HEAVY_MAX_WORKERS,
  defineWorkspaceTestConfig,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // `patcher-process.test.ts` spawns a node process and waits for it to print
    // `ready`; this package contends with itself badly enough that the wait
    // fails even when nothing else is running. See SUBPROCESS_HEAVY_MAX_WORKERS.
    maxWorkers: SUBPROCESS_HEAVY_MAX_WORKERS,
    name: "@patcher/desktop",
  },
});
