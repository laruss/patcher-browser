# bb → Patcher: Migration Map

Phase 0 deliverable of [`docs/PROJECT_PLAN.md`](../PROJECT_PLAN.md) §18.

Purpose: record what this fork inherits from `get-bb/bb`, what each inherited
system is worth to a browser-first product, and which invariants must survive
the transformation. Written before implementation so later phases can argue with
a written baseline instead of rediscovering the codebase.

## How this map was produced

Direct reading of the tree at `aefe3ea49`, plus two overview documents this fork
deleted but git still holds:

```bash
git show aefe3ea49:docs/system-overview.md
git show aefe3ea49:docs/repository-overview.md
```

Those two are the authoritative description of Patcher's runtime shape and are quoted
below rather than paraphrased from memory. Several other deleted documents remain
useful reference (`docs/configuration.md`, 812 lines; `docs/platform-support.md`,
159 lines) and are recoverable the same way.

## Inherited runtime shape

Four processes, from the recovered `system-overview.md`:

| Component                            | Role                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server** (`apps/server`)           | Central hub. All state in SQLite, HTTP API, WebSocket change notifications. Stateless itself; the DB is the source of truth. Owns product policy. |
| **Host daemon** (`apps/host-daemon`) | Runs on each enrolled execution machine. Provisions workspaces, runs agent provider processes, posts events back. Owns host-local primitives.     |
| **App** (`apps/app`)                 | React SPA served by the server.                                                                                                                   |
| **CLI** (`apps/cli`)                 | Scriptable `patcher`, same capabilities as the app.                                                                                               |

Two contract packages define the boundaries: `@patcher/server-contract`
(clients ↔ server) and `@patcher/host-daemon-contract` (server ↔ daemons).
Implementation packages never import across these boundaries.

The Electron shell (`apps/desktop`) supervises the packaged runtime and loads the
SPA the server serves. It attaches to any already-running Patcher server that passes
its health probe, with **no version handshake** (`apps/desktop/src/server-probe.ts`),
so renderer and shell routinely come from different builds. This is why the
browser IPC schemas are wire-frozen — see Invariants.

## What the browser project actually inherits

The headline finding of Phase 0: **Patcher already contains a working embedded
browser.** Plan §18 Phase 1 is largely satisfied by existing code.

### Electron browser layer — keep as-is

`apps/desktop/src/desktop-browser-view.ts` (819 lines) manages one
`WebContentsView` per browser tab:

- dedicated persistent partition (`PATCHER_BROWSER_PARTITION`), so page cookies and
  storage never touch the Patcher app session or the user's real browser;
- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`;
- `setWindowOpenHandler` denies every native popup and routes
  `window.open` / `target=_blank` to a new in-panel tab instead;
- navigation state pushed main → renderer on every relevant `webContents` event;
- transient bitmap snapshots during native resize bursts, because an
  independently composited overlay cannot stay glued to the React chrome
  mid-resize;
- session permission policy in `desktop-browser-policy.ts` (491 lines) — exactly
  one permission allowed, `clipboard-sanitized-write`.

`packages/desktop-contract/src/browser.ts` (274 lines) is the typed IPC contract:
attach / detach / navigate / goBack / goForward / reload / stop / setBounds /
setVisible, plus state, open-tab and snapshot event channels, with hard caps on
attacker-influenced strings (URL 4096, title 1024, snapshot data URL 8 MiB).

### Browser chrome in the renderer — adapt

`apps/app/src/components/secondary-panel/` holds `BrowserTabContent.tsx`
(851 lines) and `BrowserTabDeck.tsx`: address input, navigation buttons, load
error screens, favicon and title handling.
`apps/app/src/lib/browser-url.ts` (222 lines) is a pure, unit-tested
URL-vs-search-query heuristic (`looksLikeUrl`, `resolveBrowserAddressInput`)
with Google as the search engine.

Two structural gaps:

1. **The browser is subordinate to a thread.** Browser tabs live in
   `secondaryPanelTabState.ts` (430 lines) alongside `workspace-file-preview`,
   `thread-storage-file-preview` and `thread-info` tabs, and carry a `threadId`
   that pruning logic keys on. A browser-first product inverts this.
2. **There is no omnibox.** The address bar is a plain `<input>` with a submit
   handler. No provider aggregation, no suggestions, no ranking.

### Plugin platform — adapt, and it is stronger than the plan assumes

Plugin manifest is the `patcher` field of a plugin's own `package.json` (name,
description, `branding.icon`, `server` entry, `app` entry). 13 bundled plugins
under `plugins/` serve as live examples.

`@patcher/plugin-sdk` already exposes, verified in
`packages/plugin-sdk/src/app-contract.ts` (1412 lines) and
`backend-contract.ts` (715 lines):

- **Frontend contributions**: nav panels, thread panels, new-thread panels,
  homepage sections, settings sections, sidebar footer actions, thread-header
  actions, thread lists, file openers, message actions, message directives,
  pending-interaction views, composer customization, content scripts.
- **Backend API**: scoped settings with change subscriptions, KV storage, a
  plugin-owned SQLite database with migrations, thread event hooks, HTTP routes
  (auth modes `local` / `token` / `none`), typed RPC, realtime publish,
  background services and cron schedules, `patcher` CLI subcommands, **agent tools**,
  agent configuration and instruction contribution, mention providers, and
  `ui.requestInput` for user interaction.

What is missing for this project:

- **No browser contribution points** — nothing for omnibox, tabs, toolbar or
  browser context menus.
- **No isolation.** Plugin `server.ts` modules execute in-process inside the Patcher
  server (`apps/server/src/services/plugins/`). Plan §9 requires the opposite
  for agent-generated plugins, so plan Phase 7 (Bun plugin host) is genuinely new
  work, not a refactor.

  A permission model has since landed on top of this — `patcher.permissions`,
  declared per plugin and denied by default, described in
  [plugin-permissions.md](plugin-permissions.md). It gates the Patcher API rather
  than the process, so it does not change the sentence above: it specifies the
  boundary Phase 7 has to build, and is not a substitute for it.

Note that `packages/plugin-build/src/toolchain.ts` installs Patcher's own pinned build
packages (esbuild 0.28.1 and friends) with **npm**, into a private staging
directory promoted by atomic rename, cross-process safe against a server/CLI
race. This is product behaviour for building plugins and is independent of
whichever package manager the repository itself uses.

## Keep / Adapt / Replace / Add

**Keep** — no browser-driven reason to touch:
`apps/server` core, `apps/host-daemon`, `packages/agent-runtime`,
`packages/agent-providers`, `packages/db`, `packages/sdk`, `apps/cli`,
both contract packages, `apps/desktop/src/desktop-browser-view.ts` and
`packages/desktop-contract/src/browser.ts`.

**Adapt**:
`@patcher/plugin-sdk` (add browser contribution points and a permission model),
`apps/server/src/services/plugins/` (registration and lifecycle for the new
points), the renderer browser chrome (promote out of the thread panel),
`apps/desktop` window/menu wiring once a dedicated browser window is wanted.

**Replace** — eventually, not now:
project-centric primary navigation, the workspace-shaped desktop layout,
thread-scoped browser tab ownership.

**Add**:
top-level browser surface, browser tab model independent of threads,
`OmniboxController` with a provider interface, browser plugin contribution
points, plugin permissions, plugin host process, browser tools for agents.

**Out of product scope, removed in the Patcher rename** (see
[rename-to-patcher.md](rename-to-patcher.md)): `apps/web` — per the recovered
overview, the getbb.app marketing site plus bb connect auth/dashboard on
Cloudflare Workers — and `apps/connect`. Plan §17 forbade removing them before
their dependencies were understood; the rename's phase 1 did that audit and
removed both, along with `plugins/connect`, `packages/connect-db`,
`packages/connect-client` and the tunnel packages.

## Invariants that must not break

1. **`HOST_DAEMON_PROTOCOL_VERSION`** (`packages/host-daemon-contract/src/commands.ts`,
   currently `109`) must be incremented whenever anything on the server ↔ daemon
   wire can change. A passing TypeScript build is not evidence of wire
   compatibility: enrolled machines may still run an older daemon, and the
   version mismatch is what triggers their update. Without a bump an old daemon
   connects and then enters an `invalid-message` reconnect loop.
2. **Browser IPC schemas are wire-frozen.** The desktop shell attaches to any
   healthy server with no version handshake, so renderer and main process come
   from different builds. Adding a required field to a `.strict()` browser
   request breaks old SPAs against a new shell; adding any field breaks new SPAs
   against an old shell's strict parser. Change only alongside explicit
   capability negotiation in the preload bridge. The sanctioned shape, used twice
   now — scoped popup requests and tab favicons — is a **new channel** plus an
   **optional** method on `PatcherDesktopBrowserApi`: the old parser never sees the new
   payload, and feature-detecting the method is the negotiation.
3. **Server / host-daemon ownership.** The server owns product policy — defaults,
   instructions, manager behaviour, tool lists, thread behaviour. The daemon owns
   host-local primitives, provider translation, runtime/session management,
   workspace execution. If the server needs host-local data, the daemon returns
   raw data and the server assembles behaviour.
4. **Resolution-sensitive dependency pins.** `@opentelemetry/api` is pinned to
   exactly `1.9.1` in `apps/server` because Pi AI and Drizzle each pull it in and,
   without the pin, _the resolver can end up with two copies_ — TypeScript then sees two
   distinct type identities and the server typecheck fails. Pi packages are
   pinned to `0.84.0` because the packaged bridge keeps that exact package tree
   on disk so extensions share one runtime. Both rationales are written against a
   specific resolver layout and must be re-verified whenever the package manager
   or its layout changes.
5. **Native module ABI.** `better-sqlite3` 12.10.0 appears in 7 packages, plus
   `node-pty` 1.1.0 and `sharp`. `electron-builder.config.json` sets
   `npmRebuild: false` and fetches the Electron prebuild in the `afterPack` hook
   `scripts/prepare-native-modules.cjs`, because rebuilding in place flips
   `better-sqlite3` to Electron's ABI and breaks every plain-Node consumer
   including the server test suite. `scripts/ensure-native-modules.mjs` rebuilds
   it for plain Node, resolving from `packages/db/package.json`.
6. **Electron's main process cannot run on Bun.** Electron embeds its own Node
   build. `apps/desktop` stays on Node regardless of toolchain decisions
   elsewhere. Neither can anything that loads `better-sqlite3` or `node-pty`:
   both were measured against Bun 1.3.14 and both fail — see
   [Bun as a runtime](#bun-as-a-runtime-measured-against-the-two-native-modules).

## Verification baseline

Recorded on macOS 25.5.0, Node 22.20.0, pnpm 9.15.0, cold caches, before any
toolchain change. These are the numbers a package-manager migration must
reproduce:

| Check                            | Result                                       |
| -------------------------------- | -------------------------------------------- |
| `pnpm install`                   | clean, 1m 44s                                |
| `pnpm run typecheck`             | 58/58 turbo tasks, 26.4s                     |
| `pnpm run ensure-native-modules` | clean                                        |
| `pnpm run test`                  | green once the two caveats below are handled |

Two caveats, both environmental rather than defects in this fork, and both able
to masquerade as migration regressions:

1. **`CLAUDE_CONFIG_DIR` leaks into skill/command discovery.**
   `apps/host-daemon/src/command-handlers/list-commands.ts:245` reads
   `process.env.CLAUDE_CONFIG_DIR`. `apps/host-daemon/src/command-discovery.test.ts`
   injects a temp `homeDir` and stubs that variable in exactly one case
   (line 1356), so any ambient value leaks into every other case: real installed
   skills and plugins appear in assertions, and the entry-count cap test sees
   1012 entries instead of 1000. This bites whenever the suite is run from a
   shell that exports it — notably from inside a Claude Code session. With the
   variable unset, `@patcher/host-daemon` is 46/46 files and 542/542 tests green.
   **Run host-daemon checks as `env -u CLAUDE_CONFIG_DIR ...`.**
2. **The pinned Node version is load-bearing, and `.nvmrc` is the only thing
   that says so.** Node 25 ships Web Storage globals enabled by default, and
   that global `localStorage` shadows jsdom's inside vitest — as a plain empty
   object, with a `--localstorage-file was provided without a valid path`
   warning as the only clue. Every test touching `window.localStorage` then
   fails with `clear is not a function`: on 25.6.1 that is 46 tests in
   `patcher-plugin-tasks` alone, plus `@patcher/host-watcher` and `@patcher/qa`. On the pinned
   22.20.0 the same files pass. **Run the suite on the `.nvmrc` version**, and
   distrust any failure list gathered without checking `node --version` first.
3. **Test parallelism is bounded on purpose, at two levels.** Vitest sizes its
   worker pool to the machine and `turbo run test` runs several packages at
   once, so the untuned total is a multiple of the cores available. A worker
   that is only computing degrades gracefully under that; one waiting on
   `git commit`, an FSEvents callback or a daemon's first HTTP response does
   not — it waits out its deadline and fails. So the root `test` script pins
   `--concurrency=2`, and the packages whose tests drive real subsystems cap
   their own workers (`SUBPROCESS_HEAVY_MAX_WORKERS` in `vitest.shared.ts`).
   **Both are needed**: capping a package protects it from its own greed, not
   from the ten uncapped packages queued alongside it — measured, a full run at
   turbo's default concurrency failed eight packages even with the per-package
   caps in place, including `@patcher/process-utils`, whose entire job is spawning
   processes. Lowering the outer number costs little: 8m16s at `--concurrency=2`
   against 7m26s at the default, because the long pole is the two largest
   packages either way.
4. **Subprocess-spawning tests are load-sensitive, in either toolchain.**
   `apps/host-daemon/test/command/host-branches-dispatch.test.ts` builds a real
   git repository per test — `init`, `config` ×2, `add`, `commit`, `branch` ×2 as
   separate processes — against the hard `testTimeout: 15_000` in
   `apps/host-daemon/vitest.config.ts`. `apps/desktop/test/patcher-process.test.ts`
   waits on a spawned bridge to log `ready`. Under a full parallel
   `turbo run test` (observed at 630% CPU) those spawns starve and time out;
   run alone they pass in well under a second. This reproduced on pnpm before
   the migration and on bun after it, so it is a property of the suite, not of
   either package manager.

   `apps/desktop` failed even when it was the only package running, because the
   contention is _inside_ it: vitest ran its files concurrently while
   `patcher-process.test.ts` allows the node process it spawns just `timeoutMs: 1_000`
   to print `ready`, and a Node cold start alone can exceed that. The test
   writes a temp script and spawns `process.execPath`, so no package manager or
   `node_modules` layout is involved. That workaround used to be a
   `--maxWorkers=2` you had to remember; it now lives in
   `apps/desktop/vitest.config.ts`, with the other four packages in the same
   position, under caveat 3.

Also note that a pipeline like `bun run test | tail` reports the exit code of
`tail`, not of the run — read turbo's `Tasks: N successful, M total` line
instead of trusting `$?`.

## pnpm → Bun: what the swap actually required

Bun 1.3.14 replaced pnpm as package manager and script runner. Node stays the
runtime. Four things had to be understood before the swap held.

### 1. A Bun resolution defect around nested `npm:` aliases

Every package declared `"typescript": "npm:@typescript/typescript6@^6.0.2"`, and
that wrapper package is one line — `module.exports = require("@typescript/old")`
— with `"@typescript/old": "npm:typescript@^6"` as its own dependency. pnpm
resolved that nested alias correctly to `typescript@6.0.3`. Bun instead applied
the _project's_ `typescript` alias to it and linked `@typescript/old` →
`@typescript/typescript6`, i.e. the package to itself. The resulting circular
`require` returned a half-initialised module with no `ts.sys`.

Two consequences, the second far worse than the first:

- `rollup-plugin-dts` does a bare `import ts from "typescript"` and crashed, so
  `@patcher/plugin-sdk` and `packages/patcher-app` could not build.
- The wrapper's `lib/tsc.js` is `require("@typescript/old/lib/tsc.js")`, so the
  wrapper's `tsc` **exited 0 having done nothing**. Typechecks only stayed real
  because `typescript-7` won the `tsc` bin-name collision in `node_modules/.bin`.
  Had the wrapper won instead, all 58 packages would have reported a passing
  typecheck without checking anything.

`overrides` does not fix it (bun never fetches the real package). Pinning
`rollup-plugin-dts` does not fix it either — 6.4.1 fails identically. The fix was
to drop the alias in all 59 `package.json` files: `"typescript": "^6.0.2"`
resolves to the real `typescript@6.0.3`, which is precisely what the wrapper
wrapped. `tsc` now reports 6.0.3, matching the repo's intent.

### 2. Regenerating the lockfile is a dependency upgrade

Bun cannot import `pnpm-lock.yaml`. A fresh resolution moved **513
consumer→dependency pairs** across ~100 package names — all forward, no majors,
no downgrades, but enough to break two things and silently change a third:

- `@anthropic-ai/claude-agent-sdk` 0.3.197 → 0.3.228 changed `canUseTool` and
  `PermissionResult`, giving 17 type errors in the Claude Code bridge test.
- `hono` 4.11.9 → 4.13.1 while `packages/plugin-sdk` pins `hono` at exactly
  4.11.9, putting **two copies in the tree** — the same two-type-identities
  failure the `@opentelemetry/api` pin exists to prevent (invariant 4).
- `react` 19.2.4 → 19.2.8 and `@pierre/diffs` 1.2.9 → 1.3.5 changed the
  generated `packages/plugin-build/src/runtime-export-manifest.ts`, widening the
  plugin runtime contract by 16 exports as a side effect of a toolchain change.

- `@tailwindcss/node`, `@tailwindcss/oxide` and `tailwindcss` 4.3.0 → 4.3.3,
  which no longer equalled `PLUGIN_TOOLCHAIN_PINS` in
  `packages/plugin-build/src/toolchain.ts`. That comparison is exact on purpose,
  so Patcher decided the local toolchain was unusable and tried to _download_ one —
  caught by the test asserting a resolvable toolchain is never fetched.

Note the pattern in the last two: **an exact version pin held in one place only
agrees with the tree while the resolver keeps choosing that same version for
everyone else's open range.** `@opentelemetry/api` (invariant 4) documented this
hazard for pnpm; `hono` in `packages/plugin-sdk` and `PLUGIN_TOOLCHAIN_PINS` in
source are two more instances of it, and a resolver change is exactly what
exposes them.

The chosen strategy was to keep the swap a swap: pin the packages that either
broke or carry contract meaning, and treat upgrading dependencies as separate,
deliberate work. Root `overrides` now pin `@anthropic-ai/claude-agent-sdk`,
`hono`, `@pierre/diffs`, `react`, `react-dom`, `esbuild`, the three
`@tailwindcss/*` packages plus `tailwindcss`, `prettier`, `tsx` and `turbo` to
their baseline resolutions. With those pins the generated manifest is
byte-identical to the committed baseline again.

Only packages that resolved to a _single_ version across all consumers in the
baseline were pinned. `vitest` and `@types/node` were deliberately left alone:
the baseline has two versions of each, and a tree-wide override would drag the
older consumers forward instead of holding them still.

### 3. Bun's isolated linker preserves workspace isolation

`pnpm-workspace.yaml` carried a comment that plugins are workspace members so
their dependencies install into each plugin's own `node_modules` — plugins bring
their own dependencies. Bun 1.3 uses an isolated linker: a content-addressed
store at `node_modules/.bun` plus per-package `node_modules` (61 directories,
matching pnpm's count). The isolation property survives; the comment's intent
still holds even though its home file is gone.

`trustedDependencies` is required, though — Bun runs no lifecycle scripts by
default. The ten packages in this tree that have install scripts are
`better-sqlite3`, `core-js`, `electron`, `electron-winstaller`, `esbuild`,
`msw`, `node-pty`, `protobufjs`, `sharp` and `workerd`.

### 4. `pnpm.supportedArchitectures` needs no replacement

The setting fetched optional dependencies for both macOS arches. CI builds
arm64 only (`build-desktop.yml` asserts `uname -m`), and the desktop package
deliberately ships no per-arch plugin-build binaries, so its real purpose was
keeping one lockfile installable on both Intel and Apple Silicon. Bun's lockfile
is platform-agnostic by construction — it records more cross-arch variants than
pnpm's did (61 vs 46 `darwin-x64` entries) and each machine extracts only its
own. The desktop test that asserted the pnpm field now asserts the lockfile
names both arches instead.

### 5. Bun's isolation exposes undeclared dependencies

pnpm keeps a hidden hoisted directory (`node_modules/.pnpm/node_modules`) from
which _any_ installed package resolves, whether or not the importing package
declared it. Bun's isolated linker has no such fallback: only declared
dependencies resolve. That is stricter and better, and it surfaced a real
latent bug.

`packages/templates/test/plugin-scaffold-external.test.ts` resolves a
161-entry `EXTERNAL_DEPENDENCIES` list through
`createRequire(join(pluginSdkRoot, "package.json"))` in order to pack workspace
copies into a scaffolded external plugin. Nine of them were declared by nobody
in `packages/plugin-sdk`: `@hugeicons/core-free-icons`, `@hugeicons/react`,
`@radix-ui/react-dialog`, `@radix-ui/react-slot`, `@types/react-dom`,
`class-variance-authority`, `clsx`, `tailwind-merge` and `vaul`. They are now
declared as `plugin-sdk` devDependencies at the same ranges the scaffold itself
generates (`PLUGIN_STARTER_DEPENDENCIES` and
`PLUGIN_STARTER_TYPE_DEPENDENCIES`), which restores `@patcher/templates` to its
baseline 23/23.

Expect more of these wherever a package imports something it never declared.

### 6. Two places where a stale pnpm reference fails silently

Worth calling out because neither produces an error — they just quietly stop
working:

- **`turbo.json` named `pnpm-lock.yaml` and `pnpm-workspace.yaml` as task
  `inputs`** in eight task definitions. Those files no longer exist, so a
  dependency change would no longer invalidate the Turbo cache — builds would be
  served from a cache that ignored the lockfile. Replaced with `bun.lock`, and
  root `package.json` was added to the inputs of the blocks that previously
  relied on `pnpm-workspace.yaml`, since the workspace definition moved there.
- **`scripts/patcher-dev-app`** (a shell script, so it escaped the first sweep over
  `*.ts`/`*.mjs`/`*.json`) probed `node_modules/.pnpm` to decide whether Electron
  needed installing, and launched dev sessions under `screen` with `pnpm run dev`.
  The store path is now `node_modules/.bun`.

The general lesson for the sweep: grep the whole tree, not just the extensions
you expect. `pnpm` also survived in the `packageManager`-refusal path — pnpm now
declines to run at all ("This project is configured to use bun"), which is what
surfaced a test that spawned `pnpm run --silent patcher` directly.

### Translation table

| pnpm                          | bun                                              |
| ----------------------------- | ------------------------------------------------ |
| `pnpm exec turbo …`           | `bunx turbo …` (or bare `turbo` inside a script) |
| `pnpm run --silent X`         | `bun run --silent X`                             |
| `pnpm --filter P run S`       | `bun run --filter P --elide-lines=0 S`           |
| `pnpm --filter P exec C`      | `bunx C` with `cwd` set to P's directory         |
| `pnpm --dir D run S`          | no flag equivalent — `cd D && bun run S`         |
| `pnpm-workspace.yaml`         | `workspaces` in root `package.json`              |
| `pnpm.overrides`              | `overrides`                                      |
| `pnpm.supportedArchitectures` | not needed (see above)                           |
| implicit lifecycle scripts    | `trustedDependencies` allowlist                  |

`--elide-lines=0` matters: `bun run --filter` truncates child output to 10 lines
by default, which would swallow a dev server's logs.

Two things stayed on other tools deliberately. `packages/plugin-build/src/toolchain.ts`
still installs Patcher's pinned plugin-build packages with **npm** into a private
staging directory — that is product behaviour for building plugins, not
repository tooling. And `patcher-app-artifact.ts` still packs with `npm pack`, whose
stdout contract the caller parses.

### Result against the baseline

| Check                                      | pnpm baseline                     | bun                         |
| ------------------------------------------ | --------------------------------- | --------------------------- |
| install, cold                              | 1m 44s                            | 48.6s                       |
| `turbo run typecheck`                      | 58/58 tasks, 0 errors             | 58/58 tasks, 0 errors       |
| `@patcher/host-daemon` tests alone         | 46/46 files, 542/542              | 46/46 files, 542/542        |
| `@patcher/server` tests alone              | 161/161 files                     | 161/161 files               |
| `@patcher/templates` tests alone           | 23/23                             | 23/23                       |
| `@patcher/cli` tests alone                 | —                                 | 407/407                     |
| `@patcher/host-watcher` tests alone        | —                                 | 39/39                       |
| `@patcher/desktop` tests, `--maxWorkers=2` | not reached (run aborted earlier) | 32/32 files, 232/232        |
| generated plugin runtime manifest          | —                                 | byte-identical to committed |
| full suite, max parallelism                | spawn-heavy timeouts              | same timeouts               |

Packages that need bounded parallelism to pass — every one spawns processes or
boots whole stacks against a per-test timeout:

| Package                   | bun, `--maxWorkers=2`               |
| ------------------------- | ----------------------------------- |
| `@patcher/host-workspace` | 8/8 files                           |
| `tests/integration`       | 25/25 files                         |
| `@patcher/desktop`        | 32/32 files, 232/232                |
| `@patcher/agent-runtime`  | 906/907 (the macOS pipe test below) |

Inside `@patcher/server` the same sensitivity is concentrated in
`test/app/install-machine-script.test.ts`, which spawns real shells against a
5s per-test timeout: running the package's 162 files together, one of its 14
tests times out (not always the same one), and the file is 14/14 alone. Re-run
the file before treating a failure there as real.

The full-parallel suite is therefore not reliably green on this machine in either
toolchain: seven packages (`agent-runtime`, `desktop`, `host-daemon`,
`host-watcher`, `host-workspace`, `integration-tests`, `server`) time out under
it. Judge results package by package, and prefer `--maxWorkers=2` for the four
above. Every package is green that way except the single environment-dependent
test noted below.

Reproduce with:

```bash
bun install
bunx turbo run typecheck
env -u CLAUDE_CONFIG_DIR bunx turbo run test --concurrency=4 \
  --filter='!@patcher/desktop'
env -u CLAUDE_CONFIG_DIR bun run --filter @patcher/desktop --elide-lines=0 \
  test -- --maxWorkers=2
```

Not verified here, and worth doing before trusting a release: a real
`desktop:package` run through electron-builder (the `afterPack` native-module
hook is the risk), and `scripts/bb-cloud-dev.mjs`, which needs Cloudflare access.

### The plugin loader depended on pnpm's hoisted store

This was the migration's one deep finding, and it is a product bug rather than a
test artifact.

A plugin root lives anywhere on disk — a `path:` install, a git clone in the data
dir, a scaffold in a temp directory. Its `server.ts` imports `@patcher/plugin-sdk`,
and nothing along that directory's own chain resolves the specifier. A packaged
server handles this by shipping `plugin-sdk-runtime.js` next to the server bundle
and aliasing to it. A source checkout had no such branch: the old comment said it
"resolves the workspace package naturally".

It did not. Instrumenting the loader in a pnpm worktree showed Node finding the
package in `node_modules/.pnpm/node_modules` — pnpm's hidden hoisted directory,
which holds every installed package and sits at a path the resolver probes from
anywhere. That is a package-manager side effect, not a resolution guarantee.
Under bun's isolated linker it does not exist, so every plugin loaded from
outside the repo failed with `Cannot find module '@patcher/plugin-sdk'`, which
surfaced as 24 failures across four `@patcher/server` test files.

Two things were needed:

1. **`plugin-runtime.ts` now aliases `PLUGIN_SERVER_EXTERNALS` explicitly** in a
   source checkout, resolved from the server's own location. Two subtleties cost
   a round each: the alias must point at the _runtime_ entry, not the entry the
   `source` export condition yields (vitest enables that condition, and an
   aliased `src/index.ts` still has to resolve _its own_ imports from the
   plugin's directory — it cannot), and the manifest behind a resolved file must
   be found by walking up rather than by resolving `<specifier>/package.json`,
   which throws whenever an `exports` map omits that subpath.
2. **Fixtures that load a plugin from source now link the server's
   `node_modules` into the plugin root.** Non-external imports (`zod`) are the
   plugin's own dependency by design — `PLUGIN_SERVER_EXTERNALS` deliberately
   holds only `@patcher/plugin-sdk` and `better-sqlite3` — so a fixture that skips a
   dependency install has to provide them. Linking makes that explicit instead of
   depending on the resolver's layout. The link is idempotent: several fixtures
   are rewritten in place to simulate a new tip.

Worth knowing for the browser work ahead: this is exactly the class of bug the
plugin platform will keep producing, because a plugin's module graph is resolved
against a directory nobody controls. `@patcher/server` is now 161/161 files green.

Separately, `@patcher/app`'s `vite.config.ts` needed an explicit `UserConfig`
annotation on the exported `sharedViteConfig`: its inferred type named a `Plugin`
type from whichever `rolldown` copy a transitive vite pulled in, which TypeScript
rejects as non-portable (TS2883). Annotating is version-robust; pinning `vite`
would have moved transitive consumers the baseline kept at 6.4.1.

### Finding 7: the root eslint config was resolving through the hoisted store too

`bun run lint` failed outright: the root `eslint.config.mjs` imports
`@typescript-eslint/parser` and `eslint-plugin-react-hooks`, which only
`apps/app` declares. Node resolves a config file's imports from the config file's
own directory, so under bun's isolated linker there is nothing to find. Same root
cause as finding 6, a different victim — and it went unnoticed because lint was
not in the first verification pass.

Both are now declared in the root `package.json`, where the config that imports
them lives. They resolve to the copies `apps/app` already had, so nothing is
duplicated.

With eslint running again it reported 20 errors in pre-existing files. Those came
from drift, not from the code: the baseline resolved
`eslint-plugin-react-hooks@7.0.1`, bun resolved `7.1.1`, and the newer minor adds
React-Compiler rules that fail as errors. Per the pinning decision, the three
eslint packages are pinned to the baseline's exact versions
(`eslint@9.39.3`, `@typescript-eslint/parser@8.63.0`,
`eslint-plugin-react-hooks@7.0.1`); the upgrade is separate work. `bun run lint`
is now 0 errors, 151 warnings — the warning count the baseline had.

### Finding 8: a global override cannot express "only this major"

Pinning the test toolchain the same way looked correct and was not. `overrides`
applies to every consumer, and at the time this workspace ran **two majors on
purpose**: most packages declared `vitest@^4.1.1`, but `packages/tunnel-client`
and `packages/tunnel-contract` declared `^3.0.0` (the baseline resolved both
3.2.6 and 4.1.1). A blanket `"vitest": "4.1.1"` dragged those two across a major
boundary and broke `packages/tunnel-contract`'s typecheck — `@types/node` had
reached it through vitest 3's graph, so `Buffer` stopped existing. `vite` has the
same shape (6.x transitively, 8.x declared).

The pins for `vitest` and `vite` were dropped. What they were meant to achieve
happened anyway: once installed, the lockfile records `vitest@4.1.1` and
`vite@8.0.12` for the `^4`/`^8` consumers while `tunnel-*` kept vitest 3, which
is exactly the baseline's shape. `jsdom` and `msw` stayed pinned — each has a
single declared major across the workspace, so there is no boundary to cross.

**Since the Patcher rename**, the two `tunnel-*` packages are gone with the
cloud and every one of the workspace's remaining `vitest` declarations is
`^4.1.1`, so the boundary this finding is about no longer exists. The rule below
is why it is still worth reading, not the vitest example.

Rule for later: check every declared range in the workspace before adding an
override, not just the one that drifted.

### Finding 9: any `bun install` invalidates the native module

`bun install` re-extracts `better-sqlite3` from its cache, which restores the
package's prebuilt binary and discards whatever ABI the local Node needs. Every
`better-sqlite3` consumer then fails at `new Database(...)` with
`NODE_MODULE_VERSION 127 … requires 141` — 124 of `@patcher/server`'s 161 test files at
once, which looks like a catastrophic regression and is not one.

The repo already ships the fix (`scripts/ensure-native-modules.mjs`, which the
`dev` script calls). It just has to run after any install on a machine whose Node
is not the `.nvmrc` version — this one runs Node 25 (ABI 141) against a 22.20.0
`.nvmrc`, so it always applies here. Not bun-specific; bun only makes installs
frequent enough to notice.

### Finding 10: the repair itself could leave the module unloadable, on macOS

Observed on macOS 26.5.1 (arm64): after the fix above had run,
`bun dev:desktop` died with

```
scripts/patcher-dev-app: line 318: 70660 Killed: 9   node .../ensure-native-modules.mjs
error: script "dev:desktop" exited with code 137
```

and every other `better-sqlite3` consumer died the same way — SIGKILL, no
JavaScript error, no stack, nothing on stderr. `codesign -v` reported the binary
**valid**, the architecture was right, and the ABI was right.

The kernel's crash report is what names it
(`~/Library/Logs/DiagnosticReports/node-*.ips`):

```
termination: { namespace: "CODESIGNING", indicator: "Invalid Page" }
exception:   { signal: "SIGKILL (Code Signature Invalid)" }
```

macOS caches a mach-o's code-signature page hashes against the **vnode**.
`prebuild-install` unpacks over the existing `build/Release/better_sqlite3.node`
**in place**, so the file keeps its inode while its contents change; the cached
hashes then describe the old bytes, and the next `dlopen` faults a page that no
longer matches one. `codesign -v` still passes because it reads the file from
disk, where the bytes are correct and self-consistent. Only the mapping is
poisoned.

Two things make this worse than it sounds, and both are why the script changed
rather than the machine:

- **It is not catchable.** The kill lands on whichever process loads the module,
  which was `ensure-native-modules.mjs` itself — the repair tool died to the
  thing it exists to repair, taking `patcher-dev-app` with it.
- **It survives reinstalls.** Re-running the install writes in place again.

`scripts/ensure-native-modules.mjs` now does its **first** verification in a
child process, so a kill is an exit code rather than the end of the script, and
rewrites each `.node` through a fresh inode (copy + rename) after anything
writes there. Recovering by hand, if it ever bites outside the script, is the
same one line:

```bash
F=node_modules/.bun/better-sqlite3@*/node_modules/better-sqlite3/build/Release/better_sqlite3.node
cp $F $F.new && mv $F.new $F
```

### Pre-existing conditions, not migration regressions

- `bun run format:check` fails on 441 files. The committed formatting matches
  neither prettier 3.8.3 (the baseline resolution) nor 3.9.6, no prettier config
  file exists, and no CI workflow runs the check — formatting is simply
  unenforced here and has drifted. Left alone.
- The scaffold-template digest still references `pnpm-lock.yaml` inside the
  _generated app scaffold_, which is a template for users' own projects and keeps
  its own package manager.
- `packages/agent-runtime/src/runtime.process-lifecycle.test.ts` >
  "bounds provider stderr while data arrives without a newline" fails
  deterministically on macOS. Its fixture writes 100 KB to stderr and calls
  `process.exit(42)` on the next line; the test then asserts the captured stderr
  still ends with `stderr-tail`. Reproduced with plain `node` — no Patcher code, no
  vitest, no package manager — the parent receives exactly 65536 bytes (the pipe
  buffer) and the tail is gone, 3/3. `process.exit` does not flush a pending
  async pipe write. The bounding assertion the test exists for still passes; only
  the tail assertion fails, and it fails for reasons no toolchain choice affects.

## Bun as a runtime: measured against the two native modules

Bun is the package manager and script runner here; the question this section
answers is the different one Phase 7 asks — can plugin code _execute_ on Bun.
Measured on macOS 25.5.0 arm64, Bun 1.3.14, Node 25.6.1, against the two native
modules named in invariant 5. Both answers are no, for unrelated reasons.

### better-sqlite3: Bun refuses it by name

Not an ABI mismatch — a hardcoded refusal:

```
Error: 'better-sqlite3' is not yet supported in Bun.
Track the status in https://github.com/oven-sh/bun/issues/4290
In the meantime, you could try bun:sqlite which has a similar API.
```

`require()` of the package succeeds; the throw lands on `new Database(...)`, and
also on a direct `process.dlopen` of `build/Release/better_sqlite3.node`, so
there is no path around it. The same script on Node passes all eleven steps
(WAL, prepared statements, a 500-row transaction, blob and UTF-8 round-trip,
iteration, `SqliteError` with its code, close).

The addon uses the raw V8 C++ API (`v8::Isolate` in `src/addon.cpp`), which
JavaScriptCore cannot serve; Bun's partial V8 shim does not cover it. A second
obstacle sits behind the first even if it lifts: Bun reports
`process.versions.modules === 137` against this machine's Node 141, so one
`scripts/ensure-native-modules.mjs` build cannot satisfy both runtimes.

This is not confined to the server. `packages/plugin-sdk` depends on
better-sqlite3 because `patcher.storage.database()` hands the plugin a live
`Database` — synchronous, with statement objects and iterators, so it is also
the one part of the plugin API that cannot be proxied over RPC. Two consequences
for Phase 7:

- A Bun plugin host has to drop `patcher.storage.database()` or re-point it at
  `bun:sqlite`, which changes a plugin-facing type
  (`backend-contract.ts` imports `Database` from better-sqlite3).
- `@patcher/plugin-sdk/testing` constructs the same handle, so a plugin author who
  runs their suite under `bun test` hits the refusal today, host process or not.

### node-pty: loads, then the master fd disappears

node-pty 1.1.0 ships N-API prebuilds (`prebuilds/darwin-arm64/pty.node`), so it
loads and `spawn` returns a pid. It is not usable after that. The functional
test — write `echo RAN > file; echo BACK-CHANNEL`, then check both that the
shell executed and that the output came back:

| Runtime | Passed |
| ------- | ------ |
| Node    | 5/5    |
| Bun     | 0/5    |

Under Bun the shell never runs the command. Watching the master fd and the child
on a timeline explains why: `fstat(term.fd)` is valid at spawn and `EBADF`
within 500 ms **with no write at all**, so something in Bun closes the
descriptor node-pty is holding. Afterwards `resize` throws `ioctl(2) failed,
EBADF`, further writes go nowhere, and `onExit` does not fire. The fd _number_
then reads valid again a moment later, because Bun reuses it for something else
— which is worse than staying closed, since node-pty's next `ioctl` would hit an
unrelated descriptor.

Beware two readings that look like success and are not:

- `onData` delivers bytes containing the text you just wrote. That is the tty
  echoing the typed characters, not the shell answering. Requiring a _second_
  occurrence of the marker is what separates them.
- Resizing immediately after `spawn` succeeds, before the descriptor goes.

The failure is not deterministic in its details — across runs the child was
sometimes `/bin/sh` that then died, sometimes still stuck as node-pty's
`spawn-helper` — but it never worked once in any shape.

### What this settles

Bun is not a candidate for a runtime that needs either module. It stays viable
only for a plugin host that reaches storage and terminals **over RPC**, and only
once `patcher.storage.database()` is redefined, since that call is a native handle by
contract. The narrower Phase 7 question — a Bun host for plugin code alone — is
not closed by this, but it now costs a plugin-facing contract change, so it is
no longer free.

`scripts/check-bun-native.mjs` reproduces all of it — run it under both
runtimes before trusting these answers against a newer Bun. Today it is 11/11
on Node and 3/8 on Bun. Bun issue 4290 is the one to watch.

## Decisions taken

- **Browser surface**: a new top-level route in the existing SPA, reusing the
  Electron browser layer and its IPC contract unchanged. A dedicated browser
  window comes later, once the surface has earned it.
- **Omnibox providers**: the SDK contract is defined so a provider can live in
  either a plugin's app module or its server module; the backend path is
  implemented first, because that is the path that proves
  plugin → host → browser API → UI and later moves into a plugin host process
  without a contract change.
- **Toolchain**: Bun replaces pnpm as package manager and script runner. The
  runtime stays Node — plan §6 Stage 1 and §20 both warn against migrating a
  runtime for consistency alone. Upstream `get-bb/bb` will not be merged, so
  replacing the lockfile costs nothing.
- **Plugin host (plan Phase 7)**: every plugin runs outside the server process,
  builtin and third-party alike, on **Node**. One runtime for all of them, with
  the trust tier deciding how much a plugin is sandboxed rather than which
  runtime it gets — two runtimes would be two implementations of the same host,
  and the fake-vs-real host taught this repo what that costs. Node is also what
  keeps `patcher.storage.database()` intact: the plugin's own process opens its
  SQLite file directly, which no transport could have carried and Bun could not
  have opened at all.
  Process topology: **plugins share one process by default**, settled by
  measurement rather than argument, and the measurement is reproducible —
  `apps/server/scripts/measure-plugin-host.mjs` builds the host the way the
  release does and reads resident memory of a real forked process.
  A bundled plugin host cost **~204MB** before it loaded any plugin, against
  ~48MB for a bare Node process; thirteen of those at one process each is
  ~2.7GB. It now costs **~84MB**, and almost all of the difference was two
  imports that nothing needed at startup: `@patcher/sdk` builds the entire public
  API client — every route, every zod schema — at import time (~100MB), and
  `@patcher/domain`'s index runs every schema in the package (~57MB) when three
  subpath imports cover what the plugin API actually uses. The SDK is deferred
  behind a literal `require`, which keeps `getSdk()` synchronous: the bundler
  folds the module in and initialises it on the first call, so a plugin that
  never touches `patcher.sdk` never pays for it.
  The protocol does not depend on the choice — it is one logical channel per
  plugin either way — so `placement` in `plugin-supervisor.ts` keeps it a
  one-line policy, and `ISOLATED_PLACEMENT` is there for a plugin that has
  earned its own process. Thirteen at ~67MB is ~870MB, which is a different
  conversation from ~2.7GB; the remaining ~17MB over bare Node is mostly V8
  parsing the bundle, so what stands between here and process-per-plugin is a
  place to keep a per-plugin decision rather than the memory.
  The two directions of that wire are catalogued before it exists:
  `plugin-callbacks.ts` (server→plugin) and `plugin-host-calls.ts`
  (plugin→host), each checked against the real objects by its own test.

## Open questions

- Where does browser tab state live once tabs outlive threads — server-side
  (syncs across devices, needs schema and contract work) or renderer-local
  (matches today's localStorage persistence, single device)?
- Do browser plugin contribution points reuse the existing plugin manifest and
  activation machinery, or does a browser plugin become a distinct manifest kind?
- What is the minimum permission model worth shipping with the first browser
  contribution point, given that plugins have none today?
