/**
 * One limit on how long a source file may be, as an error rather than a
 * warning.
 *
 * The reason it is a rule and not a review habit: `desktop-browser-view.ts` was
 * 819 lines at Phase 0 and is 5 742 now, and nothing in a passing build, a
 * typecheck or a diff review says when a file crossed from "long" to "nobody
 * reads this whole thing any more". Every line of that growth was a reasonable
 * change to an already-too-long file, which is exactly the shape of drift a
 * threshold catches and a person does not.
 *
 * **Lines are counted raw** — blanks and comments included, so the number the
 * rule reports is the number `wc -l` reports and the one an issue quotes. This
 * repository comments heavily on purpose, and that is not what the limit is
 * aimed at; it is aimed at how much of one file a reader has to hold at once,
 * and a doc comment is part of that.
 *
 * **The pinned files below are the debt, not an exemption.** Each one is already
 * over the limit and is held at the size it had when this rule landed, so it can
 * shrink and cannot grow: a change that needs more code in one of them puts that
 * code in a new module instead. Shrink one below its pin and tighten the pin in
 * the same commit; take a file under {@link MAX_LINES} and delete its entry.
 *
 * Two entry points share this list so there is only one of it:
 * `eslint.config.mjs`, which is what `@patcher/app`'s own lint task reads, and
 * `eslint.max-lines.config.mjs`, which CI runs over the whole tree — the rest of
 * the root config cannot be turned on repository-wide yet (79 pre-existing
 * errors in 46 files, measured 2026-09-03), and file size should not wait for
 * that.
 */
export const MAX_LINES = 3000;

/**
 * Not source: build output, generated code, and the packaged-plugin build
 * directories the CLI leaves behind (60 000 lines of bundled plugin each).
 *
 * Exported because the repository-wide entry point uses the same list as its
 * *global* ignores, where it also saves the run from parsing a 300 000-line
 * bundle to ask how long it is.
 */
export const NOT_SOURCE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.packaged-plugin-build-*/**",
  "**/routeTree.gen.ts",
  "packages/core/src/generated/**",
  "packages/plugin-sdk/bundled-types/**",
  "packages/templates/src/generated/**",
];

/**
 * `mts`/`cts` are in here because the tree has them — `generate-version-feed.mts`
 * and two `.d.mts` — and a guard with a hole in its glob is a guard that reports
 * clean on the file it was meant to catch.
 */
const SOURCE_FILES = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];

/**
 * Files over the limit when the rule landed, at the size they were then.
 *
 * Ten of the seventeen are tests, and they are held to the same limit for the
 * same reason: `desktop-browser-view-manager.test.ts` is the longest file in the
 * repository, and a test nobody can navigate is where a duplicate case hides.
 *
 * This list is the debt itself, so it is also the tracking list: issue #80 has
 * the measured seam for each entry, and an entry leaves here when its file goes
 * under the limit.
 */
const PINNED_OVER_LIMIT = {
  "apps/desktop/test/desktop-browser-view-manager.test.ts": 8360,
  "packages/agent-runtime/src/codex/adapter.test.ts": 6088,
  "packages/agent-runtime/src/claude-code/adapter.test.ts": 5795,
  "apps/desktop/src/desktop-browser-view.ts": 5531,
  "apps/server/test/public/public-thread-data.test.ts": 5128,
  "packages/db/test/migrate.test.ts": 4679,
  "packages/db/test/data/events.test.ts": 4455,
  "packages/agent-runtime/src/claude-code/bridge/__tests__/bridge.test.ts": 4324,
  "packages/host-daemon-contract/test/contract.test.ts": 3847,
  "packages/plugin-sdk/src/testing/fake-plugin-host.ts": 3568,
  "packages/patcher-app/src/launcher.ts": 3499,
  "apps/server/src/services/plugins/plugin-service.ts": 3472,
  "apps/app/src/views/RootComposeView.tsx": 3457,
  "packages/db/src/data/events.ts": 3418,
  "apps/server/src/services/plugins/plugin-api.ts": 3413,
  "apps/app/src/components/promptbox/PromptBoxInternal.tsx": 3299,
  "apps/app/src/components/promptbox/PromptBoxInternal.test.tsx": 3282,
};

function maxLinesRule(max) {
  return {
    "max-lines": ["error", { max, skipBlankLines: false, skipComments: false }],
  };
}

/** Spread into a flat config. Later entries win, so the pins come last. */
export const fileSizeConfigs = [
  {
    files: SOURCE_FILES,
    ignores: NOT_SOURCE,
    rules: maxLinesRule(MAX_LINES),
  },
  ...Object.entries(PINNED_OVER_LIMIT).map(([file, max]) => ({
    files: [file],
    rules: maxLinesRule(max),
  })),
];
