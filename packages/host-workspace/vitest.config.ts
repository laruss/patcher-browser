import {
  SUBPROCESS_HEAVY_MAX_WORKERS,
  defineWorkspaceTestConfig,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@patcher/host-workspace",
    include: ["test/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // Several tests drive real git subprocesses (concurrent reset/checkout,
    // stash) that run fast in isolation but can exceed the 5s default under
    // full-suite CPU contention. 15s — the value other subprocess-heavy
    // packages use — still lost `keeps real concurrent reset and checkout
    // mutations coherent`, which is several git processes racing on purpose.
    testTimeout: 30_000,
    // The 15s above was not enough on its own — a full `turbo run test` still
    // timed out 15 of these. See SUBPROCESS_HEAVY_MAX_WORKERS.
    maxWorkers: SUBPROCESS_HEAVY_MAX_WORKERS,
  },
});
