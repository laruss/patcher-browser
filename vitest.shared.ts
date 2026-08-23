import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig, type ViteUserConfig } from "vitest/config";

/**
 * Runs before every package's own setup. See the file for what it repairs; it
 * is here rather than in each package because it is a property of the runtime.
 * `mergeConfig` concatenates arrays, so a package's own `setupFiles` are kept
 * and run after this one.
 */
const JSDOM_STORAGE_SETUP_FILE = fileURLToPath(
  new URL("./vitest.jsdom-storage.setup.ts", import.meta.url),
);

/**
 * Wraps a package's Vitest config so workspace imports (`@patcher/*`) resolve to
 * package sources instead of built `dist/` output.
 *
 * Every workspace package's export map carries a `source` condition pointing
 * at `src/` — the same condition used by `node --conditions=source` in dev,
 * esbuild bundling (`scripts/build-utils.mjs`), and tsc (`customConditions`
 * in `packages/tsconfig/typecheck-overrides.json`). Vitest resolves test
 * imports through Vite's server environment, which only honors conditions
 * under `ssr.resolve`, so a plain `resolve.conditions` entry has no effect on
 * tests. Only `source` is listed here: Vitest contributes its own default
 * conditions through a config plugin, and Vite concatenates these arrays
 * with them during config merge.
 */
/**
 * Vitest APIs that mutate worker-global state (the module registry, globals,
 * or `process.env`). Files calling any of these need their own isolated
 * worker; running them with `isolate: false` makes mocks bleed across files
 * or silently fail to apply when the target module is already loaded.
 */
const ISOLATION_REQUIRING_API =
  /\bvi\.(mock|doMock|unmock|doUnmock|resetModules|stubGlobal|stubEnv)\(/;

/**
 * Worker cap for packages whose tests drive real subsystems — git, filesystem
 * watchers, spawned daemons — rather than only CPU.
 *
 * Vitest defaults to roughly one worker per core, and `turbo run test` runs
 * several packages at once, so the untuned total is a multiple of the machine.
 * A worker that is only computing degrades gracefully under that; a worker
 * waiting on `git commit`, an FSEvents callback or a daemon's first HTTP
 * response does not — it waits out its deadline and fails. Measured on a
 * 12-core machine: a full `turbo run test` failed 30 tests in
 * `@patcher/integration-tests`, 15 in `@patcher/host-workspace`, 2 in `@patcher/server` and 1
 * in `@patcher/host-daemon`, every one of them a timeout; the same suites pass
 * whole at this cap.
 *
 * Raising deadlines instead was tried first and did not hold —
 * `packages/host-workspace/vitest.config.ts` carries a `testTimeout: 15_000`
 * put there for exactly this, and those tests still timed out. Past some
 * oversubscription no deadline is both large enough to survive and small
 * enough to mean anything.
 *
 * The cost is bounded and worth naming: these packages are already dominated
 * by their subprocesses, so capping them is close to free (`host-workspace`
 * 157s → 166s), while the whole suite stops being a lottery.
 */
export const SUBPROCESS_HEAVY_MAX_WORKERS = 2;

const TEST_FILE = /\.test\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist"]);

/**
 * Finds test files under `roots` (relative to `pkgDir`) that use
 * worker-global vitest APIs and therefore must keep the default isolated
 * worker. Everything else can run in a shared worker context
 * (`isolate: false`), which skips re-importing the module graph for every
 * file — by far the dominant cost of the big suites in CI.
 *
 * Returns package-relative posix paths, usable directly as vitest
 * `include`/`exclude` entries.
 */
export function findIsolationRequiringTests(
  pkgDir: string,
  roots: string[],
): string[] {
  const matches: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(fullPath);
      } else if (
        TEST_FILE.test(entry.name) &&
        ISOLATION_REQUIRING_API.test(readFileSync(fullPath, "utf8"))
      ) {
        matches.push(
          path.relative(pkgDir, fullPath).split(path.sep).join("/"),
        );
      }
    }
  };
  for (const root of roots) walk(path.join(pkgDir, root));
  return matches.sort();
}

/**
 * Every package's share of the machine, so that the parallelism actually adds
 * up to one machine.
 *
 * Vitest defaults each package to all available parallelism, and the root
 * `test` script runs two packages at a time — so the untuned total is twice
 * the machine before any test spawns a single `git`. Capping only the packages
 * that wait on subsystems does not fix that: they are still starved by
 * whichever large CPU-bound package happens to be running beside them.
 * Measured, that left seven timeouts across four packages even with those caps
 * in place.
 *
 * The share is deliberately under half rather than exactly half. Half each,
 * two at a time, would be one machine only if a worker were the whole cost of
 * itself — and here it is not: a worker running these suites spends most of
 * its time waiting on a `git`, a `node` or a daemon it spawned, and those
 * children need cores of their own. Sizing the pools to fill the machine
 * therefore leaves nothing for the processes the tests exist to drive, which
 * is how a run at exactly half each still timed out five tests spread over
 * three packages. The headroom is the point.
 *
 * Packages that need even less say so with
 * {@link SUBPROCESS_HEAVY_MAX_WORKERS}; a package that overrides this wins,
 * since its own config merges over these defaults.
 */
export const PACKAGE_MAX_WORKERS = "35%";

export function defineWorkspaceTestConfig(
  config: ViteUserConfig,
): ViteUserConfig {
  return mergeConfig(
    {
      resolve: {
        conditions: ["source"],
      },
      ssr: {
        resolve: {
          conditions: ["source"],
          externalConditions: ["source"],
        },
      },
      test: {
        maxWorkers: PACKAGE_MAX_WORKERS,
        setupFiles: [JSDOM_STORAGE_SETUP_FILE],
      },
    },
    config,
  );
}
