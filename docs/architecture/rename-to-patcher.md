# bb → Patcher: Rename Plan

How this fork of `get-bb/bb` became Patcher. Written before the work so each
phase could be executed and verified on its own, and so nothing that looks
mechanical got applied to something that is actually a contract.

**All eight phases are done**, and `bun run audit:rename` holds the line in CI.
What is left is listed under [Open items](#open-items); none of it is a rename.
The fork is not disowned — the READMEs say what Patcher is a fork of, the
GitHub repository was renamed in place so the fork edge survives, and the MIT
copyright is unchanged.

Companion to [bb-migration.md](bb-migration.md), which records what this fork
inherited and which invariants survive. Read its **Invariants** section before
touching a wire value; the six that were meant to keep their `bb`, and why all
six were renamed anyway, are under [Unfrozen](#unfrozen-the-six-values-that-were-going-to-keep-their-bb).

## Decisions this plan is built on

| Decision                           | Choice                                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compatibility with bb installs     | **Clean break, one exception.** No dual reads, no fallbacks. Old bb data stays where it is and is ignored — except browser storage, whose address is the origin as much as the key. |
| Naming style                       | **Full words**: `PATCHER_*` env, `@patcher/*` scope, `patcher` binary, `~/.patcher`.                                                                                                |
| Cloud (`apps/web`, `apps/connect`) | **Removed from the fork**, along with the tunnel/connect packages and the `connect` plugin. Done in phase 1.                                                                        |
| Wire strings                       | **Frozen — then not.** Six values were held back; all six were renamed once their reasons were checked. See [Unfrozen](#unfrozen-the-six-values-that-were-going-to-keep-their-bb).  |

**Browser storage is the exception, and why is worth stating.** Every other "how
do we migrate the user's X" question collapses into "pick the new name" because
Patcher owns a _path_ to the old state and can simply not read it: `~/.bb` is
left alone, a new install gets a new database. A browser key is not addressed by
name alone — the origin is half of it. On the loopback default the origin moved
with the port, so there is nothing to adopt and the clean break is literally
true. On an install reached over a stable origin (Tailscale Serve, a fixed
reverse proxy, the desktop shell pointed at a custom URL) the origin did not
move, and "ignore the old state" means abandoning the in-app browser's open tabs,
every collapsed sidebar section and every unsent composer draft in place, while
the user keeps visiting the same URL. `apps/app/src/lib/legacy-storage-adoption.ts`
renames those keys once at boot and deletes the originals — not a dual read,
because nothing goes on reading the old name.

The justification first recorded for deleting the old adoption path — "the rename
moved the prod origin, so no browser reaching this build has them" — was true
only of the default, and is left in place as the mistake it was.

Otherwise the clean break is what makes this plan tractable: every "how do we
migrate the user's X" question collapses into "pick the new name." The Frozen table was the
one deliberate exception, and it did not survive contact with the code: three of
its six reasons described a boundary that is not where they said it was, and a
fourth priced a cost the rename had already paid.

## Scale

Roughly **20 000 occurrences across ~2 580 tracked files** (of 4 143), but only a
few hundred distinct tokens.

| Token class                                    | Occurrences | Distinct |
| ---------------------------------------------- | ----------: | -------: |
| `@bb/*` (workspace scope + shadcn registry)    |       5 141 |       61 |
| `BB_*` environment variables                   |       2 856 |      297 |
| `bb.*` dotted keys (API, permissions, storage) |       2 599 |      299 |
| `Bb*` TypeScript identifiers                   |       1 940 |      173 |
| `bb-plugin-*` package names                    |         822 |        — |
| `bb-app`                                       |         610 |        — |
| `get-bb` / `getbb.app`                         |         472 |        — |
| `.bb` / `.bb-dev` (incl. CSS classes)          |        ~856 |        — |
| `"bb-desktop:*"` IPC channel strings           |           — |       74 |
| Prod ports 38886 / 38887                       |         186 |        2 |
| Files needing `git mv`                         |          56 |        — |

By tree: `apps` 9 630 / 1 599 files, `packages` 5 991 / 629, `plugins` 2 413 /
207, `examples` 554 / 71, `docs` 381 / 14, `qa` 295 / 3, `.github` 44 / 6.

Measured before phase 1. After it the tree is 3 961 tracked files and **19 333
occurrences across 2 488 files**: `@bb/*` 4 969, `BB_*` 2 807, `bb.*` 2 492,
`Bb*` 1 935. The one column that moved sharply is `get-bb` / `getbb.app`,
472 → **86**, and none of the 86 is cloud any more — they are repository and
npm URLs in `package.json` files (phase 7), test hostnames, and prose.

After phase 2 the `@bb/*` column is **0** everywhere except this file, and the
tree is at **14 227 occurrences across 1 263 files**: `BB_*` 2 807, `bb.*`
2 481, `Bb*` 1 935, `bb-plugin-*` 834, `bb-app` 610, `get-bb` / `getbb.app` 88.
By tree: `apps` 6 131 / 696 files, `packages` 4 882 / 344, `plugins` 1 886 /
122, `examples` 478 / 57, `docs` 328 / 13, `tests` 92 / 16, `scripts` 37 / 4,
`.github` 18 / 2.

After phase 3 the `Bb*` column is **0** and the tree is at **12 306
occurrences across 1 181 files**: `BB_*` 2 800, `bb.*` 2 461, `bb-plugin-*`
710, `bb-app` 595, `get-bb` / `getbb.app` 78. `apps` 5 118 / 630 files,
`packages` 4 170 / 330, `plugins` 1 721 / 121, `examples` 454 / 56, `docs`
321 / 13, `tests` 92 / 16, `scripts` 37 / 4, `.github` 18 / 2.

After phase 4 the `BB_*` column is **0** — the one hit left is a comment in
`contract.test.ts` that names the old prefix on purpose — and so are the prod
ports, `~/.bb`, `.bb-dev` and `bb.db`. Counted as literal `bb` substrings
outside this file, the tree went from 13 548 occurrences across 1 395 files to
**12 875 across 1 340**: `bb.*` 2 387, `bb-plugin-*` 831, `bb-app` 609,
`get-bb` / `getbb.app` 78, `.bb-` 167 (CSS classes and one plugin state file).
`apps` 5 486 / 739 files, `packages` 3 897 / 326, `plugins` 1 935 / 148,
`examples` 491 / 67, `docs` 349 / 13, `qa` 240 / 4, `tests` 57 / 16, `scripts`
25 / 8, `.github` 65 / 5. This counting rule is looser than the one used above
— it also catches `bubble`, `abbrev` and lockfile digests — so compare it only
against itself.

After phase 5 the plugin contract is gone from the tree: `bb-plugin*` **0**,
manifest key **0**, `bb.<member>` **0**, `_bb_migrations` **0**, `--bb-` and
`data-bb-` **0**. By the same literal-`bb` count the tree went from 12 875
occurrences across 1 340 files to **8 325 across 1 153** — the largest single
drop of the rename. What is left is `bb-app` 599, `bb-desktop` 169 (the frozen
channel values and their tests), `bb-cli` 101, `get-bb` / `getbb.app` 78, and
358 `bb.` that are test hostnames, the macOS bundle path, repository URLs and
the frozen `bb.ready`. `apps` 3 569 / 665 files, `packages` 3 016 / 298,
`plugins` 719 / 89, `examples` 182 / 42, `docs` 245 / 12, `qa` 240 / 4,
`tests` 56 / 16, `scripts` 25 / 8, `.github` 65 / 5.

After phase 6 the tree is at **4 410 occurrences across 746 files**, and 2 291
of those are the bare `bb` of a CLI invocation — `bb thread`, `bb plugin` and
friends, which phase 7 renames with the binary. The rest is `bb-app` 380,
`bb-cli` 86, the 78 frozen `bb-desktop:*` channel values, `bb_connect` 32,
`bb.ready` 15, `bb-migration.md` 14, `bbDesktop` 13, and a short tail of
release-artifact names and traps. `apps` 1 737 / 404 files, `packages`
1 460 / 200, `plugins` 574 / 68, `qa` 233 / 4 (all `bb thread` smoke scripts),
`docs` 107 / 12, `examples` 81 / 28, `tests` 15 / 7, `scripts` 11 / 6,
`.github` 49 / 5.

After phase 7 the binary is `patcher`, the package is `patcher-app`, and the
repository is `laruss/patcher-browser`. The tree is at **664 occurrences across
255 files**, and none of the large classes is a name any more: `bb-desktop` 78
and `bbDesktop` 77 (frozen IPC), `rollback_bb_version` 62 and `bb_connect` 37
(drizzle, deliberately kept), `bb-migration` 25, `qa/manual-pass-log.md` 25
(history), `BB-<n>` issue keys 19, `bb.ready` 15 (frozen page script),
`linked_bb_project_id` 9, and roughly 110 English words — `bubble`, `clobber`,
`stubbed`, `grabbing`, `tinyglobby`, `Abbreviate`. `apps` 331 / 120 files,
`packages` 221 / 97, `plugins` 49 / 21, `qa` 26 / 2, `docs` 22 / 7, `examples`
2 / 1, `scripts` 2 / 2, `.github` 2 / 2, five at the root. That is the number
phase 8's allow-list has to account for.

## Traps

These are the reasons this is a phased plan and not one `sed`.

1. **Never `s/bb/patcher/g`.** It destroys `getbb` (413), `bubble` /
   `BubbleChatIcon` (~70), `grabbing`, `clobber`, `stubbed`, `abbrev`,
   `tinyglobby`, `nbb`, hex digests (`e40bda56…`, the CSS class
   `.bb71-authored-decoration`), `bbedit.png`, and the migration filename
   `0063_broken_robbie_robertson.sql`. Every pass must be anchored to a token
   boundary and paired with an allow-list.
2. **"patcher" is a substring of "dispatcher".** The tree already holds ~190
   `CommandDispatchError` / `ExpectedCommandDispatchError` / `dispatcher`. Any
   reverse audit for the new name must use `(?<!dis)patcher`.
3. **CSS classes leak to plugins.** `.bb-sidebar-*`, `.bb-tasks-*`,
   `.bb-code-highlight` and friends ship to plugin authors through vendored
   `@bb/shared-ui` components, so they move with the plugin contract (phase 5),
   not with the cosmetic pass.
4. **`bun.lock` in its own commit.** Regenerating it is a dependency upgrade —
   see bb-migration.md invariant 4 and its §2. Watch `@opentelemetry/api`,
   `hono`, and `PLUGIN_TOOLCHAIN_PINS`.
5. **Test environment is load-bearing.** Node 22.20.0 from `.nvmrc`, and
   `env -u CLAUDE_CONFIG_DIR`. A failure list gathered without both is noise.
6. **Do not interleave with browser-gaps work.** A rename pass touching 1 599
   files under `apps/` conflicts with everything. Run each phase in a window
   between browser-gaps tasks, land it, then resume.

## Unfrozen: the six values that were going to keep their `bb`

This section used to be a Frozen table: six wire values renamed as identifiers
but not as values, each with a reason. All six were renamed in the end, and the
reason is worth more than the outcome — **three of the six justifications were
wrong, and each was wrong in the same way.** They named a boundary without
checking where the boundary actually is.

| What                                    | Where                                                               | The stated reason, and what was true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 74 × `"bb-desktop:*"` IPC channel names | `apps/desktop/src/desktop-browser-ipc.ts` etc.                      | **Wrong.** Said renaming a channel breaks old-SPA/new-shell. The renderer never names a channel — it calls a method on the bridge. Every occurrence of the literal, and every importer of the constants, is inside `apps/desktop`: the main process and the preloads, which `scripts/build.mjs` esbuilds into the same `dist/` as `main.js`. Preload and main are therefore always one build. The mixed-build boundary is the bridge's **method surface and payload schemas** — bb-migration.md invariant 2, which says exactly that and says nothing about channel names. |
| `exposeInMainWorld("bbDesktop")`        | `apps/desktop/src/preload.ts`                                       | **Right about the boundary, wrong about the cost.** This name really is read by a renderer that may come from another build — but no shipped Patcher build ever read it, because Patcher has not shipped. The alias would have been kept for a renderer that cannot exist.                                                                                                                                                                                                                                                                                                 |
| `exposeInIsolatedWorld(..., "bb", ...)` | `apps/desktop/src/page-script-preload.ts`                           | Same, plus the shipped docs already taught `patcher.ready`. The alias was an assignment queued after the expose, because a second `exposeInIsolatedWorld` for one world throws and aborts the preload — so dropping it also removed a step that could fail.                                                                                                                                                                                                                                                                                                                |
| `"bb-host-daemon.v1"`                   | `packages/host-daemon-contract/src/session.ts`                      | **Wrong, and backwards.** Said the subprotocol is negotiated _before_ the version handshake, so renaming it would turn "Needs update" into an unreadable socket error. The version handshake is `POST /internal/session/open` over HTTP and it comes **first**: `server-connection.ts` is the only caller of `connectWebSocket`, always passes a null session id, so the session must be opened before a socket URL exists. An out-of-date daemon is rejected where it can be told to update, and never reaches the subprotocol.                                           |
| `originator: "bb"`                      | `apps/host-daemon/src/codex-chatgpt-client.ts`, `provider-usage.ts` | **Still not verifiable from here** — `originator` is OpenAI's field. Renamed on the reading that an unregistered value is accepted, which is the only reading under which the inherited `bb` worked at all. If the backend does allowlist values, every ChatGPT request fails and the two `headers.set` lines are the revert. This is the one entry that wants a live check against a real account.                                                                                                                                                                        |
| `persist:bb-browser`                    | `apps/desktop/src/desktop-browser-view.ts`                          | **Wrong.** Said renaming wipes every site cookie. It does — and so does the rename that already happened: `productName` went from "bb" to "Patcher", which moves `userData` itself, so no install could reach its old partition under either name. The cost was paid before this table was written.                                                                                                                                                                                                                                                                        |

`HOST_DAEMON_PROTOCOL_VERSION` 108 → 109 for the subprotocol rename. Nothing on
the wire changed shape, which is precisely why the version has to say it: a 108
daemon would otherwise pass the version check and then be refused the socket
with a 400 it has no way to read.

**What replaced the allow-list entries.** Six ALLOW rules went away and no rule
took their place, because an allow-list is the wrong instrument here. The audit
cannot see a renamed wire value in either direction — replacing `bb` with
`patcher` inside a string removes the token the forward scan matches and adds
one the reverse scan ignores — and typecheck cannot either, because each value
has exactly one definition site. Only `bbDesktop` had a test. So each renamed
value is now pinned by a test that names it:

- `apps/desktop/test/wire-values.test.ts` — every `*_CHANNEL` export across the
  six IPC modules carries the `patcher-desktop:` prefix, the partition is
  `persist:patcher-browser`, and the page-script preload exposes `patcher` into
  a plugin's isolated world (asserted by importing it against a stubbed
  `electron`, so it is the behaviour and not the source text).
- `apps/desktop/test/preload-browser-api.test.ts` — the renderer-facing global
  is `patcherDesktop`; `preload-build.test.ts` proves it again from a packaged
  bundle under real Electron.
- `packages/host-daemon-contract/test/contract.test.ts` — the subprotocol value,
  what `buildHostDaemonWebSocketProtocols()` advertises, and that the old value
  is now refused.
- `apps/host-daemon/src/codex-chatgpt-client.test.ts` — the `originator` header.

The three ALLOW rules that remain are the mirror image: comments that name an
old value on purpose, because the old value is the argument for the new one.

## Name table

### Product and repository

| Old                      | New                                                         |
| ------------------------ | ----------------------------------------------------------- |
| `bb`                     | `Patcher` (long: Patcher Browser)                           |
| `bb Nightly`             | `Patcher Nightly`                                           |
| `laruss/bb-browser`      | `laruss/patcher-browser` — **renamed in place**, phase 7    |
| `get-bb/bb`, `getbb.app` | gone with the cloud removal; inherited links → the new repo |

### Packages, binaries, scope

| Old                                                | New                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| `@bb/<name>` (61)                                  | `@patcher/<name>`                                                 |
| `bb-app` (npm)                                     | `patcher-app`                                                     |
| `packages/bb-app`                                  | `packages/patcher-app`                                            |
| bins `bb`, `bb-app`, `bb-server`, `bb-host-daemon` | `patcher`, `patcher-app`, `patcher-server`, `patcher-host-daemon` |
| `apps/cli/bin/bb`                                  | `apps/cli/bin/patcher`                                            |
| shadcn registry `@bb/<name>`                       | `@patcher/<name>`                                                 |

### Code identifiers

| Old                                                   | New                                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Bb*` types (173)                                     | `Patcher*` — `BbPluginApi`→`PatcherPluginApi`, `BbSdk`→`PatcherSdk`, `BbHttpError`→`PatcherHttpError`, `BbDesktop*`→`PatcherDesktop*`, `BbRuntimeMode`→`PatcherRuntimeMode`, … |
| `__bbPluginRuntime`, `__bbPluginApp`, `__bbWorkflow*` | `__patcher*`                                                                                                                                                                   |
| `useBbContext`, `useBbNavigate`                       | `usePatcherContext`, `usePatcherNavigate`                                                                                                                                      |
| `BBSdk` (bb-app README/smoke)                         | `PatcherSdk`                                                                                                                                                                   |

### Runtime state — clean break, no migration

| Old                                                                                                                   | New                         | Defined in                                                     |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------- |
| `BB_*` (297)                                                                                                          | `PATCHER_*`                 | `packages/config/src/env-vars.ts`                              |
| `~/.bb`                                                                                                               | `~/.patcher`                | `runtime.ts` `BB_PROD_DATA_DIR_NAME`                           |
| `~/.bb-dev/<instance>`                                                                                                | `~/.patcher-dev/<instance>` | `runtime.ts` `BB_DEV_DATA_ROOT_DIR`                            |
| `bb.db`                                                                                                               | `patcher.db`                | `runtime.ts` `BB_SQLITE_DATABASE_FILE_NAME`                    |
| `~/.bb-machines`                                                                                                      | `~/.patcher-machines`       | server assets                                                  |
| `.bb-env-setup.sh`                                                                                                    | `.patcher-env-setup.sh`     | repo root                                                      |
| prod ports 38886 / 38887                                                                                              | **38986 / 38987**           | `runtime.ts` `BB_PROD_SERVER_PORT`, `BB_PROD_HOST_DAEMON_PORT` |
| localStorage `bb.theme`, `bb.faviconColor`, `bb.promptbox.*`, `bb.sidebar.*`, `bb.root-compose.*`, `bb.promptDraft.*` | `patcher.*`                 | `apps/app`                                                     |
| `_bb_migrations` (plugin SQLite)                                                                                      | `_patcher_migrations`       | `plugin-api.ts`, `fake-plugin-host.ts`                         |

New ports matter even under a clean break: they are what lets a bb install and a
Patcher install run side by side. `reservePackagedAppPorts()` in `runtime.ts`
special-cased both prod ports and had to move with them — it went with the cloud
in phase 1 instead (see below), because the only band it protected was the
cloud's. The property it enforced is now asserted directly in
`packages/scripts/test/run-dev.test.ts`.

Deliberately **not** renamed: the drizzle column `rollback_bb_version` (62), the
table `bb_connect` (37), and the tasks plugin's own column
`linked_bb_project_id` (9). A rename means a new migration plus regenerated
snapshots across ~10 files for zero user-visible gain. `bb_connect` disappears
with the cloud removal anyway; `linked_bb_project_id` is already mapped to
`linkedPatcherProjectId` in TypeScript, so the physical name is invisible above
`store.ts`.

### Desktop identity

| Old                                                    | New                                 |
| ------------------------------------------------------ | ----------------------------------- |
| appId `dev.bb.desktop` / `.nightly`                    | `app.patcher.desktop` / `.nightly`  |
| `productName: "bb"`                                    | `"Patcher"`                         |
| window `title: "bb"`                                   | `"Patcher"`                         |
| `assets/bb-logo*.{png,svg}` (5)                        | `assets/patcher-{icon,logo}.*` (5)  |
| `apps/desktop/assets/icon*.{png,icns}` (5)             | the new mark, one plate per channel |
| update feed `github.com/get-bb/bb/releases/download/…` | new repo                            |

A new appId is a new application: its own `userData`, no auto-update link to
the old one, and re-registration with Launch Services as the default browser.
That is the intended consequence of the clean break.

### Plugin contract

| Old                                                                                                                                  | New                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| manifest key `bb` in package.json                                                                                                    | `patcher`                                                          |
| `engines.bb`, `engines.bbPluginSdk`                                                                                                  | `engines.patcher`, `engines.patcherPluginSdk`                      |
| keyword `bb-plugin`                                                                                                                  | `patcher-plugin`                                                   |
| `bb-plugin-*` package names                                                                                                          | `patcher-plugin-*`                                                 |
| `@bb/plugin-sdk`, `@bb/plugin-sdk/app`                                                                                               | `@patcher/plugin-sdk`, `…/app`                                     |
| `bundled-types/bb-plugin-sdk*.d.ts` (6)                                                                                              | `patcher-plugin-sdk*.d.ts`                                         |
| `server.ts` parameter `bb: BbPluginApi`                                                                                              | `patcher: PatcherPluginApi` (local name; scaffold, examples, docs) |
| `bb.permissions`, `bb.sites`, `bb.browser.*`, `bb.storage.kv`, `bb.settings`, `bb.branding.*`, `bb.themes`, `bb.background.schedule` | `patcher.*`                                                        |
| plugin sources `"bb-builtin"`, `"bb-official"`                                                                                       | `"patcher-builtin"`, `"patcher-official"`                          |
| `PLUGIN_SDK_VERSION` `0.4.1`                                                                                                         | `1.0.0` — the break signal                                         |

`@patcher/plugin-sdk` never resolves from npm for external plugins: the scaffold
writes `types/patcher-plugin-sdk.d.ts` and a tsconfig `paths` entry, and
`plugin build` shims the specifier to the host runtime. So the rename is a
source-level break for plugin authors, not an install-level one.

## Phases

Each phase lands on its own and is verifiable on its own.

### Phase 1 — Remove the cloud — **done** (`1c40464b0`)

First, because it deleted 183 files and most of the 472 `getbb.app` references
before any rename pass had to walk over them.

Deleted whole: `apps/web`, `apps/connect`, `packages/connect-client`,
`packages/connect-db`, `packages/tunnel-client`, `packages/tunnel-contract`,
`plugins/connect`, the five desktop `connect-*.ts` modules,
`apps/host-daemon/src/connect-tunnel/`, `machine-auth-proxy.ts`, and
`apps/server/src/ws/host-shared-ports.ts`.

**Three things reached further than this plan estimated.** They are recorded
here because the same underestimate is available to the phases below.

1. **The wire, not just the apps.** `connect-tunnel.ensure-identity`,
   `connect-tunnel.identity`, `connect-shares.replace`, and the
   `connectMachineId` / `hasMachineCredential` session fields lived in
   `@bb/host-daemon-contract`. `HOST_DAEMON_PROTOCOL_VERSION` went
   **106 → 107**. The estimate had said `apps/server` held only an unused
   dependency declaration; it also held the shared-port coordinator, the
   daemon-protocol handler, and the enroll/session write paths.
2. **The plugin contract, which is phase 5 territory.** `bb.hosts`
   (`ensureSharedPortTunnel`, `declareSharedPorts`) existed only to mint and
   use gate labels, so it had to go now: removed from the SDK, both plugin
   runtimes, the host-call protocol, the fake host, and the authoring skill.
3. **Gate auth became a security hole the moment the gate left.**
   `x-bb-gate-auth` and `x-bb-gate-machine-id` were set by the Cloudflare
   worker alone. With no worker in front, honoring them from a direct client
   would let any caller claim machine auth, so they went with the checks that
   read them. The `bbcm_` machine credential is likewise unobtainable now that
   `/api/connect/redeem-machine` is gone — its path is out of the daemon,
   `install-machine.sh` (`--machine-code`), `BB_CONNECT_MACHINE_*`, the
   launcher, and managed config.

Also gone: the cloud dev ports (`cloudPort`, `cloudWorkerPort`,
`BB_DEV_CONNECT_BASE_URL`) and with them `reservePackagedAppPorts`, whose only
purpose was that the cloud port range overlapped 38886/38887.

Left deliberately, both to be picked up later:

- `hosts.connect_machine_id` and its drizzle history — dropping a column is a
  migration plus ~30 regenerated snapshots for no functional gain.
- The `app.getbb.host-daemon.*` launchd label in `install-machine.sh`. It is bb
  branding rather than cloud, so it renames with everything else in phase 6.

What went away with it: remote access via `<handle>.getbb.app`, connect-based
machine enrollment, desktop session sync, and plugin-declared shared ports.
Local machine enrollment through the host daemon is unaffected, and the desktop
shell keeps its custom-server-URL target.

**Verified** on Node 22.20.0: `typecheck` 54/54, `lint` clean,
`env -u CLAUDE_CONFIG_DIR bun run test` 54/54. Two failures that predate the
branch were fixed in passing: commit `985460da2` added `sites` to the plugin DTO
without updating the `@bb/sdk` and `@bb/cli` fixtures, and the committed
`plugin-sdk-dts.generated.ts` had drifted from its source. `@bb/server` also
failed once under full parallel load and passed alone and on rerun — the
load-sensitivity caveat in [bb-migration.md](bb-migration.md), not a defect.

### Phase 2 — `@bb/*` → `@patcher/*` — **done** (`6c5ab591a`, `4494d9152`)

All 34 workspace packages, every import and `workspace:*` dependency, the turbo
filters, tsconfig `paths`, vitest configs, `.github` filters,
`apps/app/components.json`, the plugin component registry, and the root private
package name. 2 037 files, 4 687 replacements.

`bun.lock` followed in its own commit on the assumption that regenerating it is
a dependency upgrade. It was not, this time: 298 lines changed, every one of
them naming the old or the new scope, and no line carrying a semver moved.

**This phase moved no files, though the bullet list it replaced promised 56.**
Phases 3–7 claim the same renames, more specifically, and a file renamed one
phase before the identifier inside it renames is simply touched twice. Every
overlap went to the later phase:

| Deferred                                                                  | To                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| npm name `bb-app`, the four bins, `packages/bb-app`, `publish-bb-app.yml` | 7 — one unit with the release pipeline and the artifact downloader |
| `bb-plugin-*` names, manifest key, `bundled-types/bb-plugin-sdk*.d.ts`    | 5                                                                  |
| `bb-guide-*.md`, `assets/bb-logo*`                                        | 6                                                                  |
| `.bb-env-setup.sh`, `reset-bb-data`, `archive-codex-tmp-bb-sessions`      | 4                                                                  |
| `bb-desktop.ts`, `bb-app-bridge.ts`, `bb-process.ts`                      | 3 — they travel with `BbDesktop*`                                  |

The one row that could **not** be deferred is `@bb/plugin-sdk`, which the
phase-5 table lists as part of the plugin contract. Here the plugin-author-facing
specifier and the workspace package name are the same string — all 24 bundled
and example plugins declare it as a real dependency — so leaving it behind would
have split the scope. It moved with the other 33. Its bundled `.d.ts`
_filenames_ did not; those stay with the rest of the plugin contract.

**Three things worth carrying into phases 3–5,** which are the same kind of
tree-wide token pass.

1. **Anchor on the following character, not on `\b`.** `@bb` was replaced only
   where the next character could not continue an identifier or a hostname.
   That spares `machine-auth@bb.internal` — a persisted system-user email, not
   a package — while still catching the escaped `@bb\/` inside regex literals,
   the bare `"@bb"` used as a path segment in `node_modules` joins, and the
   scaffold's registry alias key. Print the histogram of following characters
   before writing: over 4 687 hits it was `/`, `\`, `"`, and one backtick.
2. **Two source files carry literal NUL bytes** as composite-key separators
   (`PluginNewThreadComposer.tsx`, `packages/db/src/data/events.ts`), so a
   "skip binaries" guard skips them silently. Rewrite those byte-preserving
   (latin1 round-trip) and assert the NUL count is unchanged.
3. **`bun install` leaves the old scope directories behind.** 66
   `node_modules/@bb` directories survived with live symlinks; a missed `@bb/*`
   import would have kept resolving and the build would have stayed green.
   Delete them before trusting a verification run. The same command cleared
   seven orphaned `node_modules` trees left by phase 1's deletions.

**Exposed, not caused:** the scaffold's shadcn registry alias is now `@patcher`
while its URL still points at `raw.githubusercontent.com/get-bb/bb`. Phase 7
owns that URL; the alias had to move with the registry items it names.

**Verified** on Node 22.20.0: `bunx turbo run typecheck --force` 54/54, `lint`
clean, `bunx turbo run build` 13/13, `env -u CLAUDE_CONFIG_DIR bun run test`
54/54. `@patcher/host-workspace` failed twice under full parallel load and
passed alone at 8/8 files and 194/194 tests — the load-sensitivity caveat in
[bb-migration.md](bb-migration.md), as with `@bb/server` in phase 1.

Formatting: 365 of the 2 037 changed files fail prettier, but 275 of them
already failed at the parent commit — verified by extracting those exact paths
from `HEAD` and running the repo-pinned prettier 3.8.3 against them. The new
scope is five characters longer, so 90 import statements overflowed the print
width; those were formatted and the pre-existing 275 left alone.

### Phase 3 — `Bb*` identifiers and globals — **done** (`d745f8def`)

441 distinct tokens, 4 023 replacements across 438 files. More than the 173
the plan counted, because `Bb` also sits inside identifiers
(`createCliBbSdk`, `resolveBbAppVersion`, `linkedBbProjectId`) and the zod
schema constants pair one-for-one with the types they validate.

**The rule that decided scope:** an identifier moves; a name that is written
somewhere and read back by something built separately does not. Under it the
`Bb*` types, their schema constants, the `__bb*` globals, the two `useBb*`
hooks and every embedded form moved, while SQL columns
(`linked_bb_project_id`, `rollback_bb_version`), the plugin manifest keys, the
template keys and the frozen globals stayed. The rule is worth keeping for
phases 4–6: it is sharper than "identifiers vs strings", because plenty of
strings are internal to a single build and plenty of identifiers mirror
something persisted.

**Two things the inventory contradicted.**

1. **`bbLogViewer` was in the Frozen table and does not belong there.** (The
   first of four such entries; see [Unfrozen](#unfrozen-the-six-values-that-were-going-to-keep-their-bb).) The
   log viewer's HTML is a template literal built by the same main process
   that installs `log-viewer-preload.cjs`, handed to `loadURL` — one build on
   both sides, no server-served renderer, no mixed build. Renamed outright;
   the Frozen table above is corrected.
2. **`builtWith.bbVersion` is a serialized key, not an identifier.** It is
   written into a plugin's `dist/*.meta.json` and validated on read by
   `apps/server/src/services/plugins/app-bundle.ts`. It moved anyway, with
   the rest of the `bbVersion` token: the clean break already invalidates
   artifacts built before the rename, so rejecting them is intended. Phase 5
   owns the artifact format and the `PLUGIN_SDK_VERSION` 1.0.0 signal.

**The additive aliases,** and what they actually cost:

- `preload.ts` calls `exposeInMainWorld` twice. Renderer-side,
  `getPatcherDesktopInfo()` and `getAppSurface()` read
  `patcherDesktop ?? bbDesktop`, so a new SPA works against an older shell.
- The page-script preload **cannot** expose twice: a second
  `exposeInIsolatedWorld` for one world throws and aborts the rest of the
  preload. `patcher` is aliased with a one-line
  `executeJavaScriptInIsolatedWorld` queued ahead of the page scripts.
- **Two `exposeInMainWorld` calls with the same object give the renderer two
  distinct proxies.** They are not reference-equal. The packaged-Electron
  smoke test caught this and a unit test could not have; it now asserts both
  names resolve, expose `getInfo`, and report the same version. Identity was
  never the promise.

Deferred with their phases: `BBSdk*` and `createBBSdk` — the public class of
the `bb-app` npm package, which would otherwise collide with
`BbSdk` → `PatcherSdk` (7); `SCREAMING_CASE` `BB_*`, including the IPC
channel-_name_ constants, which travel with the environment pass (4);
`engines.bbPluginSdk` (5); `bbGuide*` (6).

Anchoring: an explicit 441-token allow-list matched at identifier boundaries,
not a pattern. A pattern catches `DAY_ABBREVIATION`, `ABBREV_OPTION_PATTERN`,
`BUBBLE_ACTIONS`, `BBEdit`, a `sha256/BBBB` test fingerprint, and two base64
blobs containing `Bb` followed by a capital. All are still in the tree.

**Verified** on Node 22.20.0: `typecheck --force` 54/54, `lint` clean,
`build` 13/13, `env -u CLAUDE_CONFIG_DIR bun run test` 54/54, generated set
regenerated with no drift. `@patcher/agent-runtime` failed twice under full
parallel load and passed alone at 45/45 files and 907/907 — the
load-sensitivity caveat again. Formatting: 133 of 442 changed files fail
prettier, 63 already at the parent commit; the 70 the rename broke were
formatted.

### Phase 4 — Environment, paths, ports, database — **done** (`8e00a054e`)

299 distinct `BB_*` tokens, 2 947 occurrences, plus the paths, ports, database
name and storage keys: 440 files changed (+3 991 / −3 679). By tree: `apps`
271, `packages` 118, `plugins` 19, `tests` 10, `scripts` 4, `examples` 4,
`docs` 4, `qa` 3, `.github` 1, six at the root.

The `BB_` pass is the one place in this rename where a bare prefix swap is
safe: over 2 947 hits no `BB_` is preceded by a letter or digit, so
`DEFAULT_BB_SERVER_URL` and `TEST_BB_VERSION` come along for free. Print that
histogram before trusting it — the preceding characters were space, `"`, `.`,
`(`, `_`, backtick, `$`, `{`, `/`, `[`, `'`, `-`, `>` and nothing else.

**`HOST_DAEMON_PROTOCOL_VERSION` 107 → 108, and the reason is not the wire.**
Nothing in `@patcher/host-daemon-contract` changed shape. The daemon builds
the agent shell itself: it injects the thread-context variables, strips
inherited ones by prefix, and puts the CLI shim on `PATH`. A 107 daemon
injects `BB_*` and a `bb` shim, so a thread the new server started would run
agents that cannot see their own thread id. The version is the only handshake
there is, so it has to carry a break the message schemas do not show.

**`<repo>/.bb` → `<repo>/.patcher`, which the table above did not list.** This
is a directory in the _user's_ repository — `.bb/AGENTS.md`, `.bb/skills/`,
`.bb/workflows/` — not app state, so renaming it makes every project that
adopted bb move a committed directory. That is the clean break working as
intended, and the alternative was leaving the old product's name inside the
user's own checkout, which is the most visible leftover available.

**`.bb` cannot be matched by a pattern.** The tree holds 62 distinct `.bb*`
literals and most of them must not move: property access (`host.bb`,
`pkg.bb`, `engines.bb`, `manifest.bb`, `PROJECT_IDS.bb`), CSS classes
(`.bb-sidebar-*`, `.bb-tasks-*`, `.bb-app-shell`, and the digest-derived
`.bb71-authored-decoration`), the frozen `globalThis.bb`, and `.bbedit`.
Fifteen explicit path forms moved — the quoted segment, `.bb/`, `/.bb` at a
path end, and the named scratch prefixes — and the leftovers were read one by
one. Two survived a first pass and were fixed by hand: a Windows path written
with escaped backslashes, and one built from `${path.sep}`.

**Two traps worth carrying into phases 5–7.**

1. **A rename moves a name's place in the alphabet.** `bb.db` sorted before
   `logs`; `patcher.db` sorts after it, which broke a `localeCompare`-sorted
   assertion in the dev-data migration test. Nothing else in the suite is
   order-dependent on a renamed name, but the failure looked like lost data
   until the diff was read.
2. **Regex literals escape the dot.** `/^bb\.db\./u` does not match a search
   anchored on the literal `bb.db`, so the migration matcher kept the old name
   while its `Set` of entry names moved. Phase 2 hit the same shape with
   `@bb\/`. Search the escaped forms as their own pass.

Deliberately left, with the reason: `bb.ready` is the frozen page-script
global, not a storage key; `bb.themes` is a plugin contribution point and was
spared by anchoring `bb.theme` against a following letter; the `http://bb.test`
hostnames in the fixtures are not product state, so only the three
`bb.test.promptbox.*` storage keys moved; `.bb-docs-state.json` is written by
the `docs` plugin into the user's repo and travels with that plugin in phase 5.

**Two gaps this phase exposed in the plan itself.**

1. **`x-bb-*` HTTP headers are in no phase.** `x-bb-plugin-token`,
   `x-bb-plugin-id` and `x-bb-plugin-key` are plugin contract → phase 5;
   `x-bb-content-encoding`, `x-bb-size-bytes` and `x-bb-app-surface` are
   server ↔ SDK → phase 7, and `x-bb-app-surface` needs the mixed-build
   question asked before it moves.
2. **Test fixture ids and scratch temp-dir prefixes are in no phase either** —
   `bb-thread-1`, `bb-user`, `bb-project`, `bb-workspace-`, `bb-browser-cli-`
   and ~40 more. Nothing reads them back, so they are not runtime state and
   they stayed; they belong with the cosmetic pass in phase 6. One coupling to
   remember: the four glob defaults in
   `packages/scripts/src/commands/archive-codex-tmp-patcher-sessions.ts`
   (`*/bb-standalone-*`, `*/bb-integration-*`, `*/bb-integ-*`,
   `*/bb-qa-smoke-*`) match those prefixes and must move in the same commit.

The private `bb-script-*` bins in `@patcher/scripts` moved too, though the
deferral table only promised the two command names. Leaving
`bb-script-reset-patcher-data` behind would have been an inconsistency this
change created itself. Six lines in `bun.lock` mirror those bins; unlike phase
2 that is workspace metadata rather than a dependency upgrade, so it rides in
the same commit and `bun install --frozen-lockfile` confirms it.

**Verified** on Node 22.20.0: `typecheck --force` 54/54, `lint` clean (0
errors, 152 pre-existing warnings), `build` 13/13,
`env -u CLAUDE_CONFIG_DIR bun run test` 54/54 with no load flakes this time,
and the generated set regenerated with no drift — twice, because formatting
`portal-scope.ts` invalidated the plugin registry that embeds its source.
Resolved values checked directly: `~/.patcher`,
`~/.patcher-dev/<instance>/patcher.db`, prod ports 38986/38987 (free, and in
the unassigned user-port range), and a dev env of `PATCHER_DATA_DIR`,
`PATCHER_DEV_APP_PORT`, `PATCHER_HOST_DAEMON_PORT`,
`PATCHER_INHERITED_SKILLS_ROOTS`, `PATCHER_SERVER_PORT`, `PATCHER_SERVER_URL`.
`bun run dev` was not run by hand: `@patcher/integration-tests` starts a real
server and daemon under the new names across 25 files and 55 tests, which
covers more.

Formatting: 480 files in the tree fail prettier and 418 of them already failed
at the parent commit — the repo has never been prettier-clean and no CI job
checks it. `PATCHER_` is five characters longer than `BB_`, so 62 files
overflowed the print width; those were formatted and the rest left alone.

### Phase 5 — Plugin contract — **done** (`adcd25909`)

468 files, +4 833 / −4 453. By tree: `apps` 196, `plugins` 118, `packages` 84,
`examples` 54, `docs` 13, plus `turbo.json`, one test and `bun.lock`. This is
the break plugin authors see, which is why `PLUGIN_SDK_VERSION` goes to 1.0.0
in the same commit.

**The method: two passes, then let the compiler find the rest.** Rename
`bb.<member>` wherever `<member>` is on an explicit 30-name allow-list. Every
function body that used the API then reads `patcher.x` while its parameter
still reads `bb`, so `tsc` reports `Cannot find name 'patcher'` at exactly the
declarations that have to follow. Five rounds converged. It works because the
API object is only ever reached through member access; the two bare uses that
never dereference (`__stalerApi = bb`, `const bb = pkg.patcher`) were the last
two errors, and nothing else was left over.

**Why an allow-list and not a `bb.` prefix.** There are 40 distinct first
segments and ten must not move: `bb.test` (103) and `bb.example` (65) are test
hostnames, `bb.ready` is the frozen page-script global, `/bb.app` (21) is the
macOS bundle path, `bb.git` (16) is a repository URL, `bb.zip` a fixture file,
`bb.internal` a persisted system-user email, and `bb.threads` / `bb.status`
inside `packages/bb-app` are the `BBSdk` instance, which is phase 7. The left
anchor also had to reject a preceding `/` — for `bb.app` alone, and for nothing
else in the tree.

**`PLUGIN_SDK_VERSION` 1.0.0 is a behaviour change, not a string.**
`PLUGIN_SDK_MAJOR` goes 0 → 1, which switches on the major-only artifact gate
that was deliberately vacuous for 0.x. Two things followed. The pre-1.0 branch
in `isPrebuiltServerSdkCompatible` — exact `sdkVersion` match within major 0 —
became unreachable and was removed with the paragraph that explained it. And
two tests that _encoded_ the pre-1.0 rule had to state the new one instead:
`version.test.ts` asserted `/^0\./`, and a loader test asserted that a
same-major, different-minor dist falls back to source, which is now precisely
what does not happen. A version bump that changes behaviour arrives as failing
tests that are correct to change.

**Four traps.**

1. **`0.4.1` is a version other packages also publish.** The bump corrupted
   `bun.lock`: `lru_map`, `levn`, `@eslint/plugin-kit` and `pe-library` all sit
   at 0.4.1, and the next `bun install` went looking for `lru_map@1.0.0` and
   got a 404. Restored the lockfile and regenerated it from the manifests; the
   diff is exactly the plugin renames plus the SDK version, and the
   transitive entries that look moved are the sort-order shuffle from `bb-` to
   `patcher-` — phase 4's `bb.db`/`logs` effect again. **A version bump needs
   the same allow-list discipline as a name.**
2. **Escaped forms need their own pass, and the fix has its own escaping.**
   `/bb\.name/` in a regex literal and ``new RegExp(`bb\\.${field}`)`` in a
   template are two more byte sequences for one name; phase 4 hit the first
   with `/^bb\.db\./`. Then the repair itself misfired: a JSON rule whose
   replacement read `patcher\\.` inserted two literal backslashes, because a JS
   replacement string treats `\\` as two characters and not as an escape. The
   tests it was meant to fix caught it.
3. **Generated files defeat a left-anchored pattern, and their order matters.**
   In `templates.generated.ts` a line-initial `bb.settings` is `\nbb.settings`
   inside a JSON string, so the character before `bb` is `n` and the anchor
   refused it. Regenerating fixes it — but `generate-templates.mjs` reads
   `bundled-types/*.d.ts`, so the dts build has to run first. Run the other way
   round it embeds a prettier-formatted copy of a generated file, and the drift
   gate catches that instead.
4. **Markdown TOC anchors are derived names.** Renaming `## bb.log` to
   `## patcher.log` silently breaks `](#bblog)` — 26 of them. Verified by
   re-deriving GitHub's slug from every heading and checking each link lands.
   GitHub does not collapse runs of whitespace, so an em-dash heading yields
   two hyphens; a naive slugifier reports false breakage.

**Deliberately left.** `bb.ready` and `window.bb` are the frozen page-script
boundary: the _documented_ surface now teaches `patcher.ready`, and the loader
tests that still pass `code: "bb.ready(…)"` are what keeps the alias covered —
renaming them too would have removed its only regression test.
`PROJECT_IDS.bb` and the `"bb"` provider filter in `SkillsCollection` are a
demo project and a UI label (6). `bb_connect` stays per the table above. The
`bb-cli` builtin skill is named after the binary and moves with it (7).

**A phase-3 residue this phase exposed.** Six identifiers carry `Bb` as a
_suffix_ — `validBb`, `mapCodexReasoningLevelToBb`, `createAutomationServiceBb`,
`readPluginManifestBb`, `updatesWithBb`, `runSourceBb`, 39 occurrences. Phase 3
anchored `Bb` on a following capital, which by construction cannot see a token
that ends in `Bb`. Renamed here. Separately, `apps/app/src/lib/bb-desktop.ts`,
`apps/app/src/types/bb-desktop.d.ts` and `apps/desktop/src/bb-process.ts` with
their tests were assigned to phase 3 by phase 2's deferral table and never
moved; they hold `PatcherDesktop*` identifiers behind `bb-desktop` filenames.
They go to phase 6.

**Verified** on Node 22.20.0: `typecheck --force` 54/54, `lint` clean (0
errors, 152 pre-existing warnings), `build` 13/13,
`env -u CLAUDE_CONFIG_DIR bun run test` 54/54, generated set with no drift.
The plan's own check was run for real, not inferred: `plugin new hello --app`
scaffolds `patcher-plugin-hello` with the `patcher` manifest key,
`engines.patcherPluginSdk: "^1.0.0"`, tsconfig `paths` onto
`types/patcher-plugin-sdk*.d.ts`, and a `(patcher: PatcherPluginApi)` entry;
`plugin build` emits both bundles with `sdkMajor: 1`. `@patcher/server` failed
two or three tests under full parallel load on three separate runs — a
different set each time, including the 90MB plugin-host budget test — and
passed alone at 204/204 files and 1 777/1 777 tests. The load-sensitivity
caveat, as in phases 1–3.

Formatting: 476 files fail prettier and 411 already failed at the parent
commit; 65 were formatted. Six of those 65 were the bundled `.d.ts` — generated
files that have never been prettier-clean and only looked new because they had
just been renamed. Regenerating put them back, and the tree settles at 417
pre-existing failures.

### Phase 6 — Product identity — **done** (`c4c65f27e`)

758 files, +3 970 / −3 723, 20 renames. By tree: `apps` 459, `packages` 183,
`plugins` 47, `examples` 31, `tests` 12, `docs` 10, `scripts` 5, `qa` 3,
`.github` 2, six at the root.

**The line this phase runs along: the product renames, the binary does not.**
`bb` in prose is the product; `bb` in front of a subcommand is the executable,
and that is phase 7. So the pass renames on a 33-name subcommand list, with an
article rule in front of it so "a bb plugin" and "the bb thread" — noun
phrases, not invocations — move anyway. The result reads correctly and stays
true: docs say Patcher does X and still tell you to run `bb foo`, which is the
command that exists until the bins move. 2 291 invocations are left standing
on purpose.

**A bare `bb` corrupted 17 binary assets, and the build caught it.** The
byte-preserving latin1 applier that carried phases 2–5 has no binary guard; it
never needed one, because `BB_`, `@bb/` and `bb-plugin` do not occur in
compressed data. A two-byte `bb` next to arbitrary bytes occurs constantly.
Eight PNGs, two ICNS files and the screenshot came back as
`pngload: libspng read error` from `@patcher/app:build`, were restored from
`HEAD`, and the applier now skips any file with a NUL byte **unless** it has a
text extension — the qualifier matters, because `PluginNewThreadComposer.tsx`
and `packages/db/src/data/events.ts` carry literal NULs and still have to be
rewritten (trap 2 of phase 2).

**The anchor that protected code also protected the assertions.** To spare
URLs, binaries and CLI strings, the prose rule refused a `bb` preceded by `/`,
`"`, `'` or a backtick. Those are exactly the characters that open a string or
a regex literal, so the _source_ moved and the _expectation_ did not: six
consecutive full test runs each surfaced one more package with a stale literal
— `/bb’s own shortcut wins/u`, `"Provider: bb"`, `refs/heads/bb/probe`,
`/tmp/bb-claude-code-bridge.mjs`, `github.com/bb/browser`, `"## bb acme"`.
Each fix was one line; the lesson is to follow the anchored pass with a second
one restricted to test files, with the quote characters allowed.

**Names that turned out to be more than prose.**

- **`bb/` is a git branch prefix** written into the _user's_ repository by
  `thread-create-helpers.ts`. Now `patcher/`.
- **`[bb system]` is parsed, not decorative.** `computeMutedPrefixLength`
  matches `startsWith("[bb")` to find where a generated message's chrome ends,
  and a test hard-coded the prefix length. Now `[Patcher …]`, with the two
  lengths recomputed (13 → 18, 12 → 17).
- **`PATCHER_THREAD_NAME_TAG = "bb"`** is the `[bb]` tag put on thread titles
  forwarded to a provider, and stripped on the way back. Now `Patcher`.
- **`machine-auth@bb.internal`** is the persisted system-user email; `bbde_`
  and `bbdh_` are the prefixes on issued enroll and host keys; `bb-shared` is a
  skill provider id that crosses the daemon wire; `bb-global-skills-v1` is fed
  into a hash. All moved — the daemon wire is covered by the 108 bump, the rest
  by the clean break.
- **The skills provider sentinel `"bb"`** was both the filter value and its own
  display label. Split: value `patcher`, label `Patcher`.

**Phase-5 residue this phase found:** `engine: "bb" | "patcherPluginSdk"` in
the update resolver — the discriminant that names which `engines` field failed,
left behind when `engines.bb` became `engines.patcher` — and eight doc comments
still calling the plugin API object `` `bb` ``.

**A gap for phase 7:** `headers.set("originator", "bb")` goes to the ChatGPT
backend from two places, next to a `bb-host-daemon` User-Agent. Outbound
identity to a third party, so it belongs with the skills-registry UA in phase 7
rather than here.

**Deliberately kept.** `docs/architecture/bb-migration.md` keeps its filename:
it names the thing being migrated _from_, and `patcher-migration.md` would
misdescribe it. Its title is now `bb → Patcher: Migration Map` — the prose pass
had made it `Patcher → Agent Browser`, which is nonsense in both halves. Add
the filename to the phase-8 allow-list.

**The appId is applied but still provisional.** `dev.bb.desktop` →
`app.patcher.desktop`, and the launchd label follows to
`app.patcher.host-daemon.*`. Nothing has shipped as Patcher yet, so changing it
again before the first release costs nothing; after that it is a new
application.

**Deferred at the time: the artwork.** `assets/bb-logo*.{png,svg}` (5) and
`apps/desktop/assets/icon*.{png,icns}` (5) still carried the old mark, and
their names were left alone on purpose — renaming a file to `patcher-logo.svg`
while the image still says bb hides an unfinished deliverable from both the
reader and the phase-8 audit. Landed after phase 7; see **Artwork** below.

**Verified** on Node 22.20.0: `typecheck --force` 54/54, `lint` clean (0
errors, 152 pre-existing warnings), `build` 13/13,
`env -u CLAUDE_CONFIG_DIR bun run test` 54/54, generated set with no drift. A
later run showed a single `@patcher/host-watcher` failure that passed alone at
20/20 — the load-sensitivity caveat. `smoke:packaged` and the `lsregister`
default-browser check are deferred with the artwork: both exercise a packaged
bundle whose icons are the part still outstanding.

Formatting: 493 files fail prettier, 417 already at the parent commit; 76 were
formatted.

### Phase 7 — External identity — **done** (`a9e19a3ba`, `b4c9a23e8`)

692 files, 35 renames (plus two too small for git to pair). By tree: `apps`
329, `packages` 233, `plugins` 62, `examples` 31, `docs` 10, `tests` 9,
`scripts` 5, `qa` 3, eleven at the root. The rename itself is +3 897 / −3 883;
the commit reads +6 873 / −5 955 because 163 of the same files were also run
through prettier for the first time. Tree footprint 4 290 occurrences across
709 files → **664 across 255**, and what is left is the frozen set, the drizzle
names, English words, and history.

**The repository was renamed in place, not replaced.** `laruss/bb-browser` →
`laruss/patcher-browser` via `gh repo rename`. In place matters: GitHub keeps
the old URL redirecting (web and git), keeps the issues, and keeps the fork
edge to `get-bb/bb`, which is the thing this fork should not hide. The 465
inherited `github.com/get-bb/bb` links — release downloads, the auto-update
feed base, the plugin-registry raw URL, `package.json` `repository`/`bugs`/
`homepage` in five manifests — all point at the new name. None of them was a
citation of upstream; they were this repo's own links, wrong since the fork.

**The fork is now stated, not just implied by GitHub's banner.** Both READMEs
say Patcher is a fork of bb by Michael Yong, keeps its MIT license, and is
developed independently — own data directory, ports, package names and plugin
contract, no reading or migrating of bb state, installable side by side. The
`LICENSE` copyright line was already correct and was not touched.

**The npm package moved as one unit, because it cannot move as several.**
`packages/bb-app` → `packages/patcher-app`; the published name `bb-app` →
`patcher-app` (checked: 404 on the registry, and the `@patcher` scope is free
too — `patcher` itself is taken, which is why the launcher keeps the `-app`
suffix); the four bins `bb`/`bb-app`/`bb-server`/`bb-host-daemon` →
`patcher`/`patcher-app`/`patcher-server`/`patcher-host-daemon`, with their
`dist/*.js` entry files and `src/bin/*.ts` sources; the `files` allow-list;
`publish-bb-app.yml` → `publish-patcher-app.yml`; `check-version-lockstep.mjs`;
`patcher-app-artifact.ts`; and the `@patcher/config/bb-app-managed-config`
subpath export with its three source files. `bun.lock` moved with them in its
own commit — 41 insertions, 41 deletions, every one of them the workspace entry
relocating. No dependency resolved differently (trap 4).

**`BBSdk` collided with the type it implements.** The published class is
`BBSdk implements BbSdk`; phase 3 renamed the interface to `PatcherSdk`, so the
mechanical rename produced `class PatcherSdk implements PatcherSdk`. The
interface is now imported as `PatcherSdkContract` and the class keeps the
public name. The module also does `export type * from "@patcher/sdk/node"`,
which re-exports a `PatcherSdk` type — the explicit local export wins over a
star export, and the class satisfies the interface, so consumers see the same
shape either way.

**The binary rename is what unblocked the 2 291 invocations phase 6 left.**
`apps/cli/bin/bb` → `bin/patcher`, the commander `.name("bb")`, the root
`bun run bb` / `bb:dev` scripts, `patcherExecutableFileName()` — which returns
the filename the agent shell gets as `PATCHER_CLI` — and the daemon bundle's
own `dist/bb`. Then the same bare-token rule ran over the whole tree: 2 486
replacements in 361 files, and `bb <subcommand>` is gone from docs, skills,
runbooks, plugin CLIs and command-output tests.

**Outbound identity, and the one string that stays.** `bb-skills-registry` →
`patcher-skills-registry` (our proxy to a public registry); the `User-Agent`
`bb-host-daemon` → `patcher-host-daemon` (a User-Agent is free-form and never
matched on); `x-cursor-client-version: cli-bb-host-daemon` →
`cli-patcher-host-daemon` — safe on evidence, because `cli-bb-host-daemon` is
not a Cursor version string either and the call works today, so the field is
plainly not validated. `originator: "bb"` is the exception and goes into the
Frozen table with its reasoning.

`x-bb-*` → `x-patcher-*` across nine headers. `x-bb-app-surface` and
`x-bb-content-encoding` / `x-bb-size-bytes` are a **public HTTP API break** —
external clients reading them must change — which is what the clean break is
for. `x-bb-plugin-id` / `-key` / `-token` were phase 5's to move and were
missed there; they moved here.

**Telemetry now sends nothing.** The default `DEFAULT_PATCHER_POSTHOG_API_KEY`
was upstream's write key: shipping it would have posted this fork's events into
bb's PostHog project — polluting their data and handing them ours. It is now
`""`, which `telemetry.ts` already treats as "disabled", so production runs
send nothing until Patcher has a project of its own. The README paragraph says
so plainly instead of describing a sender that does not run.

**The Discord badge and the Settings → Community row were removed.** The invite
was bb's server. A Patcher user clicking "Join Discord" and asking Patcher
questions there helps neither project. The `Discord` icon stays in shared-ui —
it is part of the plugin-visible icon set.

**Phase-6 residue this phase found.**

- **932 uppercase `BB`.** Phase 6's prose rule was anchored on lowercase, so
  "BB Official", "the BB app", "spawns a BB thread", the window-title fallback
  `?? "BB"` and 280 files' worth of doc comments never moved. All `Patcher`
  now. `BB-<n>` is excluded: those 19 are issue keys from bb's tracker, cited
  in comments like "none reserving it is BB-46", and renumbering them into a
  Patcher tracker that has no such issues would make them lie.
- **The prose rule capitalised a variable.** `export const bb =
createBrowserBbSdk()` in `@patcher/sdk/browser` became `export const Patcher`
  — a value, not a sentence. Now `patcher`. The same slip in the launcher
  README and the tarball smoke left `const Patcher = new PatcherSdk()` with
  every use still reading `bb.threads…`: sample code that no longer ran.

**Two real breakages, both from anchoring.**

- **Rule order ate a derived label.** `bb-app` → `patcher-app` ran before
  `machine-getbb-app` → `machine-patcher-app`, so `machine-getbb-app` became
  `machine-get` + `patcher-app`. The install-script test then looked for a
  launchd plist named `app.patcher.host-daemon.machine-getpatcher-app` that the
  script never writes. The lesson is the ordinary one for an ordered rule list:
  a shorter rule that is a substring of a longer one has to come second.
- **The slash anchor hid assertions again.** Excluding a `bb` preceded by `/`
  spared `docs/architecture/bb-migration.md` and also spared `"/opt/tools/bb"`
  and `"/opt/custom/bb"` — expectations for `PATCHER_CLI` candidate paths whose
  implementations had already moved. A follow-up rule for a path-final `bb`
  (with `get-bb/bb` excluded, so the new fork attribution survives) took 29 more
  in 20 files. This is the same shape as phase 6's quote anchor; a rename pass
  wants a second, narrower sweep over test files after every anchored one.

**Deliberately kept.** `qa/manual-pass-log.md` — a dated record (2026-03-31) of
a manual QA pass that actually ran against bb, temp paths and all. Rewriting a
log falsifies it. Add it, the `BB-<n>` keys, and `linked_bb_project_id` to the
phase-8 allow-list alongside `bb-migration.md`.

**`smoke:tarball` was broken before this phase and nobody knew.** It is the
plan's stated phase-7 verification, and its first run failed with
`Timed out waiting for builtin plugins to run: connect=missing` — the connect
plugin was deleted in **phase 1**, and `EXPECTED_RUNNING_BUILTIN_PLUGINS` still
listed it. The list had also drifted the other way and was missing `side-chat`.
Both fixed against `builtin-registry.ts`; the smoke now passes end to end
against the packed tarball, which is the only check that exercises the four
renamed bins, the published `patcher-app` layout and the SDK import together.
A task deferred long enough stops being deferred and starts being unnoticed.

**Verified** on Node 22.20.0: `typecheck --force` 54/54, `lint` clean (0
errors, 152 pre-existing warnings), `build --force` 13/13, generated set with
no drift, `env -u CLAUDE_CONFIG_DIR bun run test` **54/54 under full load**,
`smoke:tarball` 8/8. Formatting: the
tree went from 417 files failing prettier to **357** — the 163 changed-and-
unformatted files were formatted, and the generators were re-run afterwards,
because prettier reformats generated output and the `--check` gates then fail
(the phase-5 trap, hit again).

**Not done, and not doable from here.** No npm publish — `patcher-app@0.37.0`
has never been released and the workflow's `npm view patcher-app versions` will
404 on the first run until it is. No release tags: `desktop-latest` and
`desktop-nightly` do not exist in the renamed repo, so the auto-update feed
resolves to nothing until the first desktop build publishes them. No PostHog
project. No Discord. The artwork was still outstanding from phase 6 when this
phase landed, and with it `smoke:packaged` and the `lsregister` default-browser
check; both are covered in **Artwork** below.

### Phase 8 — Audit gate — **done** (`e240e5d19`)

`scripts/rename-audit.mjs`, `bun run audit:rename`, and a step in CI's `checks`
job. Every remaining occurrence of `bb` in the tree is answered by one rule in
`ALLOW` that says why it stays; `--list` prints the current tally per rule. The
count is deliberately not restated here — it moved the first time this file was
edited, and a number in prose has no way to stay true.

**The forward scan is blunt on purpose, against this plan's own advice.** The
regex sketched here —
`(?<![A-Za-z0-9_-])[Bb][Bb](?![A-Za-z0-9_-])|@bb/|\bBB_[A-Z]|\bBb[A-Z]` —
excludes `-` and `_` from its boundaries, so it cannot see `bb-desktop` (78),
`bbDesktop` (77), `rollback_bb_version` (60), `bb_connect` (33) or
`bb-migration` (26). That is most of what is left, and worse, it is exactly the
shape the next leftover will take: somebody adds `bb-something` and the gate
says nothing. So the scan matches **any word containing `bb` in any case** and
the allow-list carries the noise. A clever pattern that skips `bubble` also
skips the token nobody thought of.

**The reverse scan checks only the left side.** `(?<!dis)patcher` as written
here would have flagged forty legitimate things on the first run: the issued
key prefixes `patcherde_` and `patcherdh_`, and every markdown anchor generated
from a `patcher.log`-style heading — `#patcherlog`, `#patchersettings`,
`#patcherbackground--services-and-schedules`. `patcher` **followed** by
lowercase is ordinary. `patcher` with a lowercase letter or digit welded to its
**left** is damage — `clopatcherer` out of `clobber`, `apatcherrev` out of
`abbrev`, a hex digest grown a word in its middle — and `dispatch` is the only
thing that legitimately runs into it from that side.

**The gate found fifteen leftovers on its first run**, each one a blind spot of
an earlier pass's anchor:

- `BB-specific`, `BB-thread`, `BB-side`, `BB-shimmed`, `BB-published` — phase
  6's uppercase rule excluded a following `-`, so the hyphenated compounds
  survived while bare `BB` moved.
- `_bb_` — markdown italics. `_` was a boundary character in every pass, so a
  word emphasised with underscores was invisible to all of them.
- A **broken table-of-contents anchor**:
  `[patcher.cli — an agent-facing \`patcher\` subcommand](#patchercli--an-agent-facing-bb-subcommand)`.
The heading moved in phase 7 and the link did not. This is the phase-5 trap
again, and the forward scan caught it for free because the stale anchor still
contained `bb`.
- Nine fixture paths and ids: `/Users/test-bb`, `/tmp/custom-bb-*`,
  `*/bb-foo-*`, `*/bb-bar-*`, `code-bb-abc123`, `/nonexistent-bb-test-dir`,
  `definitely-not-a-real-binary-bb`, `other-owner/bb.git`, and a padded project
  id `proj_bb0000…`.
- `__bb_timeline_truncation_noop__`, a JSON path chosen to be one no event
  payload can contain, evaluated inside SQLite and never stored.
- `bbapp`, the misspelled word a spellchecker test adds to the dictionary.

**Three holes in the allow-list, found by attacking it.** A gate that has never
failed is not known to work, so the rules were tested against a file that
deliberately contained one of each token class. That test found the audit
excusing things it should have caught:

- The aaa/bbb placeholder rule matched `([A-Za-z])\1+` — which matches a bare
  **`bb`**. Every bare `bb` in the tree was being justified as a placeholder,
  including `@bb/thing` and `bb plugin list` in the probe. It now requires
  three repeats.
- A base64 rule keyed on length alone excused `BbSomethingLongEnoughToLook`.
  It now also demands a shouted uppercase run or two digits — the things a
  digest has and an identifier does not.
- The page-script rule's line pattern included a backticked `` `bb` ``, which
  excused any comment that merely mentioned the name — including a comment
  written for this very workflow step. Narrowed to the actual dereferences plus
  the one preload file.

An allow-list needs a negative test as much as the scan does. Rule order
matters too: the specific rules run first, so `--list` attributes each
occurrence to the narrowest reason that covers it rather than the broadest.

**Anchors were swept separately.** A GitHub-accurate slugifier over every
same-file `](#…)` link in every tracked markdown file — remembering that GitHub
does not collapse runs of whitespace, so an em-dash heading yields two hyphens
— found three hits, all of them this file quoting a broken anchor as an
example. Zero real breaks. The checker was not shipped: it cannot tell a link
from a link quoted inside backticks, and a gate with a known false-positive
class trains people to ignore it. The one real break it found was already
caught by the forward scan, because a stale anchor still contains the old
token; the case it would add is a heading renamed with no `bb` on either side,
which is docs hygiene rather than rename damage.

**What the rules justify**, largest first: English words and library names
(192), digests and opaque ids (207), the frozen IPC channels (78) and
`bbDesktop` (77), `rollback_bb_version` (60), camelCase seams like `tabButton`
(45), `bb_connect` (33), `dispatcher` on the reverse side (28), `bb-migration`
(26), the QA pass log (25), the page-script API (24), the `BB-` issue keys
(19), BBEdit (16), npm integrity fragments (12), aaa/bbb placeholders (11), the
fork attribution (10), upstream transcript captures (10),
`linked_bb_project_id` (8), and single-digit tails for the partition name, the
originator, the subprotocol, the migration filename and the deliberate `BB_*`
comment.

**Noted, not deleted:** `apps/server/test/public/app-scaffold-template.digest.json`
is unreferenced — nothing has read it since before this rename — and it names
`src/bb-sdk.d.ts` in a template that no longer exists in the tree. It is
allow-listed by path rather than quietly removed, because it was dead before
any of this started.

**Verified** on Node 22.20.0: `audit:rename` clean, `typecheck --force` 54/54,
`build --force` 13/13, `lint` clean (0 errors, 152 pre-existing warnings),
generated set with no drift, `env -u CLAUDE_CONFIG_DIR bun run test` **54/54 under full load**.

The full set, for anyone repeating it: on Node 22.20.0 from `.nvmrc`,
`env -u CLAUDE_CONFIG_DIR bun run test` — read turbo's
`Tasks: N successful, M total` line, not `$?` — then `bun run audit:rename`,
`bun run lint`, `bunx turbo run typecheck`, `smoke:tarball`, and
`smoke:packaged` against a `bun run --filter @patcher/desktop package` build.

## Artwork

Landed after phase 7 from a chosen concept — a geometric black **P** with a red
square patch at its lower right, on a cream rounded plate. Two source SVGs, one
generator, nineteen rasters.

**Two sources, because the app inverts one of them.** `assets/patcher-icon.svg`
is the full mark: plate, ink P, red patch. `assets/patcher-logo.svg` is the
glyph alone in a single fill, and it has to be single-fill because the three
places the app renders it apply `dark:invert` and `brightness-0 invert` —
a CSS inversion turns a red patch cyan. So the in-app mark carries the patch as
**shape**, not colour, and the patch is offset 1.5 units clear of the bowl it
touches in the colour version. That gap is the whole reason the mark still
reads at 16px in a sidebar; tangent to the bowl, monochrome, it merges into a
blob.

**`scripts/build-brand-assets.mjs`** renders everything else from that geometry:
the repository PNGs, three desktop icons and two `.icns`, the five hand-authored
PWA bases, and six favicons. It is deliberately **not** CI-gated — these are
committed binaries that change only when the mark does — but
`generate-pwa-icons` still is, so the two run in order. It resolves `sharp`
through `createRequire` against `apps/app` rather than adding a root
dependency, because a dependency change here is never incidental
(bb-migration.md invariant 4).

**The PWA plate is a lighter cream than the desktop plate, on purpose.**
`generate-pwa-icons` derives forty tinted variants and two alpha masks with a
luma threshold: at or above 245 a pixel is backing, below it is glyph.
`#F5F1E8` measures 241.2. Left at that, every colour variant would have tinted
the whole tile instead of the mark, and both monochrome masks would have
carried a faint full-canvas square. `#FAF8F4` measures 248.2 and is
indistinguishable at icon size.

**Three plates, one mark.** Cream for stable, `#378055` for dev, `#F9D71C` for
nightly — the dev and nightly colours are the ones the old icons used, so the
Dock still means what it used to. Desktop icons sit on the macOS 824-of-1024
grid; the previous stable icon did not, and rendered visibly larger than its
neighbours.

**Removed:** `bb-logo-dev.png` and `bb-logo-black-white-bg-discord.png`. Both
were unreferenced, and the second names a link phase 7 deleted. Both READMEs
now embed `assets/patcher-icon.png` in place of two `user-attachments` URLs
that pointed at images uploaded to bb's GitHub account.

**The two checks the artwork was blocking both pass.** `bun run package` builds
`Patcher.app` with the new `icon.icns`, and `smoke:packaged` launches it green.
Registering that bundle with `lsregister` puts **Patcher.app** in the macOS
browser candidate list for `https` — alongside Safari, Arc and Chrome — with
the user's actual default untouched before and after. That is the whole point
of the `CFBundleURLTypes` declaration, and it is the first time it has been
confirmed under `app.patcher.desktop`.

**Deleted rather than kept:** `assets/app-screenshot.png`. It was a screenshot,
not a mark — full of `BB-` task keys and a project literally named `bb` — and
replacing it means running Patcher with plausible data, not editing artwork. The
root README led with it, so until someone takes that screenshot the README shows
the other product; a README with no hero image says less but says it truthfully.
The file is gone with the reference.

## Open items

- **A product screenshot of Patcher.** There is none: bb's was deleted rather
  than shipped as if it were ours, so the root README has no hero image.
- **First release.** `patcher-app` has never been published, and the
  `desktop-latest` / `desktop-nightly` tags do not exist in the renamed repo, so
  the auto-update feed resolves to nothing. Confirmed against the live
  repository, not inferred: `gh release list` returns nothing. The README used to
  link both tags as its only install path and now says there is no release yet.
  The publish workflow's `npm view patcher-app versions` no longer 404s the run
  itself — that guard landed — but nothing has been published through it.
- **A PostHog project.** `DEFAULT_PATCHER_POSTHOG_API_KEY` is `""`, which
  disables telemetry outright. Set a Patcher-owned write-only key to turn it
  back on, or delete the sender.
- **`originator: "bb"`** — frozen on a cost asymmetry, not on knowledge. One
  authenticated ChatGPT request with `originator: patcher` settles it.
- **A Discord server**, if the community link is wanted back.
- The desktop appId — `app.patcher.desktop` is applied but provisional; it
  is free to change until the first Patcher release, not after.

Settled by phase 7: the repository name (`laruss/patcher-browser`, renamed in
place), and npm availability — `patcher-app` and the `@patcher` scope are both
free, `patcher` is not.
