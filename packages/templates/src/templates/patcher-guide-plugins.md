---
kind: instruction
title: Patcher Guide — Plugins
summary: Command reference for installing, configuring, running, and authoring Patcher plugins and their contributed CLI commands.
intent: Provide complete plugin command documentation plus an authoring walkthrough for agents and humans building Patcher plugins.
editingNotes: Keep flags accurate against the CLI implementation (apps/cli/src/commands/plugin.ts) and the server plugin service; a CLI test asserts every `patcher plugin` subcommand appears in this chapter. The full authoring reference is the patcher-plugin-authoring builtin skill.
---
Plugin commands

A Patcher plugin is a TypeScript package that extends the Patcher server in-process:
background services, cron schedules, HTTP/RPC endpoints, thread lifecycle
handlers, settings, storage — and `patcher` CLI subcommands that agents and humans
run like any other command. Plugins are full-trust code inside the server.

Plugins are on by default. Builtin plugins (`builtin:<name>`) ship with Patcher;
user-installed plugins come from `patcher plugin install` or the official store.
Plugin state lives under `<patcher-data-dir>/plugins/<id>/` (per-plugin SQLite file,
secrets, logs).

The builtin Custom instructions plugin adds a multiline editor under Settings
→ Custom instructions. Saved text is persisted on this Patcher host and included in
agent task instructions; blank text contributes nothing.

The opt-in builtin Provider retry plugin continues Codex and Claude Code
turns after a structured subscription window resets. Enable it under
Extensions → Plugins or run `patcher plugin enable provider-retry`. It keeps its
timers in memory, coordinates waits by machine/provider subscription, and adds
a composer banner with a Cancel action while an automatic retry is pending.
The banner disappears when the retry starts, is cancelled, or the user
continues the thread. A server restart or plugin reload clears pending timers
without changing the original failed thread. Inspect it with
`patcher provider-retry status`. See `patcher guide providers` for the eligibility rules.
Prior output or tool activity does not block recovery. Its `maximumWait`
setting defaults to `6 hours`; choose `24 hours` or `No limit` from the plugin
detail page, or configure it with
`patcher plugin config provider-retry set maximumWait <value>`.

The builtin Workflows plugin runs durable provider-independent JavaScript
orchestration. It is disabled on fresh installations; enable `workflows` under
Extensions → Plugins or run `patcher plugin enable workflows` before using:

  patcher workflows validate (--script '<javascript>'|--source '<javascript>'|
                        --file <path>|--name <name>)
  patcher workflows run (--script '<javascript>'|--source '<javascript>'|
                   --file <path>|--name <name>)
                   [--args '<json>'] [--resume <run-id>]
  patcher workflows status <run-id>
  patcher workflows history <run-id> [--cursor <call-index>] [--limit <1-100>]
  patcher workflows list [--limit <1-50>]
  patcher workflows stop <run-id>

Commands must run from a Patcher project thread. Workflows has six plugin
settings, configurable with `patcher plugin config workflows set <key> <value>`:
`maxActiveRuns` (default 4, range 1–32), `maxConcurrentAgents` (8, 1–64),
`maxAgentCalls` (100, 1–1000), `totalRunTimeoutMs` (86400000, 60000–604800000),
`retentionDays` (30, 1–3650), and `maxNotificationBytes` (16384,
1024–262144). `maxActiveRuns` applies live; the other five are snapshotted for
each new run. Settings changes do not require a plugin reload.

`status` is a bounded polling summary, and `list` returns only compact run
summaries. Detailed run and call records are paged JSONL: redirect `history`
into `$PATCHER_THREAD_STORAGE` before inspecting it, and continue with the final
page record's `nextCursor`. The invoking shell writes
that file on the thread's execution host, so this works the same on local and
remote hosts without granting the plugin arbitrary filesystem access. Use `patcher
provider list --environment "$PATCHER_ENVIRONMENT_ID" --json` and then `patcher provider
models <provider-id> --environment "$PATCHER_ENVIRONMENT_ID" --json` before writing
an explicit selection; never guess ACP model IDs.

The Memory plugin is an opt-in install, bundled with the app:
`patcher plugin install memory`. Once installed, it injects a compact global and
current-project memory index into agent context and progressively discloses
full records through CLI-only commands. Because its store works across
providers, we recommend disabling provider-native memory under Settings →
Providers to avoid duplicate or conflicting stores. Settings → Memory lists
every global and project memory and supports version-checked edits and soft
deletion.

  patcher memory catalog [--scope project|global|all] [--json]
  patcher memory search <query> [--scope project|global|all] [--json]
  patcher memory get <id> [--scope project|global|all] [--json]
  patcher memory add --scope project|global --name <name> --summary <text>
                --details <text> --reason <text> [--kind <kind>]
                [--tag <tag>]... [--importance <0-100>] [--pinned] [--json]
  patcher memory update <id> --expected-version <n> [fields...] [--json]
  patcher memory forget <id> --expected-version <n> --reason <text> [--json]
  patcher memory history <id> [--scope project|global|all] [--limit 1-100] [--json]

Project writes use the invoking CLI's current project. Global writes require
the explicit `--scope global` flag.

The Docs plugin is an opt-in official plugin bundled with the app:
`patcher plugin install docs`. Read-only discovery remains direct, while edits use
a manifest-backed local workspace:

  patcher docs vaults [--json]
  patcher docs list [--vault <id>] [--json]
  patcher docs read <path> [--vault <id>]
  patcher docs pull <path> [--folder] [--vault <id>] [--into <dir>]
  patcher docs pull --all [--vault <id>] [--into <dir>]
  patcher docs status [workspace-dir] [--delete] [--diff] [--json]
  patcher docs push [workspace-dir] [--delete] [--dry-run] [--diff] [--json]

Pull preserves vault-relative paths and writes `.patcher-docs-state.json`; edit the
ordinary files and leave that state file untouched. Push uses pulled SHA-256
versions as compare-and-swap guards. Concurrent changes stop with exit 3.
Local file and empty-directory deletions are warnings unless `--delete` is
explicit; a pulled folder root is retained, so pull its parent or the whole
vault to remove that folder. Use `--workspace-host <id>` when a standalone
CLI's working directory is on a non-primary host. Direct `write`, `mkdir`,
`move`, and `remove` remain only as deprecated compatibility commands.

The Tasks plugin is an opt-in official plugin bundled with the app:
`patcher plugin install tasks`. It adds a task tracker, agent delegation,
and the `patcher tasks` command. Common agent operations are:

  patcher tasks show <key-or-id> [--json]
  patcher tasks list [--project <prefix-or-id>] [filters...] [--sort manual|priority|due] [--limit 1-500] [--cursor <opaque>] [--json]
  patcher tasks comment <key-or-id> (--body <markdown> | --body-file <path>) [--json]
  patcher tasks attachment add <key-or-comment-id> --file <path> [--json]
  patcher tasks attachment get <attachment-id> --out <path> [--json]
  patcher tasks attach <key-or-id> [--json]
  patcher tasks update <key-or-id> --status in_review [--json]
  patcher tasks update <key-or-id> (--parent <parent-key-or-id> | --no-parent) [--json]

Run `patcher tasks --help` for project, folder, task, label, attachment, and demo-data
commands, plus preset management, delegation, and attached-thread inspection.
Delegated threads are attached automatically; use `patcher tasks attach` only when
work started outside Tasks. Task update resolves both task keys and IDs for
`--parent`; use `--no-parent` to promote a subtask to the top level. File paths
in tasks commands resolve on the invoking machine (the thread's machine inside
an agent thread, otherwise the server's); pass `--machine <id-or-name>` to
target another enrolled machine.
Task lists default to 100 rows. JSON pages include `nextCursor`; human pages
print the exact continuation option when more rows exist. Cursors are bound to
the filters, sort, and task-list revision. Any add, removal, reorder, update,
label-link/name change, active-thread change, or project-prefix change invalidates an
outstanding cursor; restart without `--cursor` instead of accepting a mixed
snapshot.

The builtin Secrets plugin provides a secure credential form and guarded
dotenv reconciliation:

  patcher secret request <NAME...> --write-env <path>
                    [--purpose <text>] [--describe <NAME> <text>]...

The command blocks until the user submits or cancels the form. Secret values
never appear in command arguments, model-visible output, or persisted
interaction data; success prints only the path, variable names, and
added/updated/unchanged counts.

  patcher plugin search <query>       Search Patcher's official plugins (bundled with
                                 the app)
  patcher plugin install <entry>      Install a bundled official plugin by name
                                 (github, docs, memory, tasks), a Git repository
                                 URL, local path, builtin:<name>,
                                 git:<url>[@<ref>], or
                                 npm:<package>[@<version|tag|range>]
                                 (npm: needs npm on PATH; installs prompt —
                                 pass --yes to skip). Managed git:/npm:
                                 installs refuse engines.patcher / engines.patcherPluginSdk
                                 mismatches, manifest/artifact identity
                                 mismatches, and ids reserved by bundled plugins
                                 Omitted npm specs, ranges, dist-tags, omitted
                                 Git refs, and Git branches track; exact npm
                                 versions, Git tags, and Git commits are pinned
  patcher plugin outdated             Check installed plugins for compatible
                                 updates (table; --json for raw results).
                                 Columns: installed, latest compatible,
                                 blocked newer (incompatible releases not
                                 selected), status. Dev builds (Patcher 0.0.0)
                                 annotate that engines.patcher is not enforced
  patcher plugin update <id> | --all  Apply compatible updates for one plugin or
                                 every tracking plugin with an update. Same
                                 full-trust confirmation as
                                 install (--yes skips; non-TTY refuses without
                                 --yes). Use outdated to preview; pinned
                                 installs stay put
  patcher plugin list                 Status, services, schedules, handler timings
  patcher plugin source <id> [--json] Show requested/resolved source, engine ranges,
                                 install time, and recent activation history
  patcher plugin enable|disable <id>  Load or unload an installed plugin
  patcher plugin reload [id]          Re-run factories against current sources
  patcher plugin config <id> [set <key> <value> | unset <key>]
                                 Show or change a plugin's declared settings
  patcher plugin logs <id> [-n N] [-f]  Print (or follow) a plugin's patcher.log output
  patcher plugin run <id> [args...]   Run the plugin's CLI command explicitly
  patcher plugin token <id> [--rotate]  Print the token for auth:"token" HTTP
                                 routes; --rotate generates a new token,
                                 invalidating the old one
  patcher plugin remove <id>          Uninstall (managed git:/npm: files deleted;
                                 builtin removals are remembered)
  patcher plugin new <name> [--app]   Scaffold a new plugin and install its npm
                                 dependencies (no server required; --app adds
                                 a frontend entry, app.tsx, plus a
                                 typecheck-only tsconfig.json)
  patcher plugin types [path]         Write this Patcher's @patcher/plugin-sdk declarations
                                 into the plugin's types/ (default: cwd);
                                 --check reports staleness and writes nothing
  patcher plugin build [path]         Compile the plugin into dist/ — the backend
                                 bundle (server.js, server.meta.json) and,
                                 when patcher.app is declared, the frontend bundle
                                 (app.js, app.css, app.meta.json). Each
                                 *.meta.json is stamped with SDK major/version,
                                 artifactFormatVersion, pluginId, pluginVersion,
                                 and builtWith (Patcher + plugin SDK versions); no
                                 server required
  patcher plugin dev [path]           Watch a plugin's sources (default: cwd) and
                                 on every change rebuild its frontend bundle
                                 (if it declares patcher.app) and reload the
                                 plugin; Ctrl+C to stop

Patcher Official plugins

Patcher's official plugins — GitHub, Docs, Memory, and Tasks — ship bundled inside
the app itself. They appear in Extensions → Plugins → Browse
and install with one click from the local bundled copy: no network, no
download, no separate release. Install from the CLI by bare name
(`patcher plugin install github`, `patcher plugin install docs`, `patcher plugin install
memory`, or `patcher plugin install tasks`). Installed official plugins are pinned
to the bundled copy and update automatically when the Patcher app updates.

For direct git:/npm: installs, updates are manual: `patcher plugin outdated`
checks tracking sources and `patcher plugin update` applies compatible candidates.
Reinstalling an already-installed managed plugin is refused — use
`patcher plugin update`. A failed activation restores the pre-update snapshot and
leaves the latest failure visible as needing attention. Exact npm versions,
git tags and commits, path sources, and bundled official plugins are pinned;
npm ranges/omitted specs/dist-tags, omitted Git refs (the repository default
branch), and Git branches track compatible updates.

`patcher plugin search <query>` matches id, display name, description, and
category across the bundled official plugins (status: installed / compatible
/ requires newer Patcher). Install an official plugin by its bare name. Direct
HTTP(S) Git repository URLs, `path:`, `npm:`, `git:`, and `builtin:`
sources—and path-like syntax—continue to bypass official-plugin resolution.

Builds are automatic once installed. Git installs run `npm install`
(lifecycle scripts disabled), then compile both bundles — so a git plugin may
depend on third-party packages. node_modules is kept, because bundling cannot
inline data files a dependency reads at runtime. A committed dist/ is always
replaced by the bundles Patcher builds. Path installs compile dist/ at install time
from dependencies you have already installed. A build failure fails the
install. npm packages must ship a metadata-validated prebuilt app or the
install is refused. The server rebuilds source-built apps after a Patcher upgrade.

Installing or updating a git plugin requires `npm` on PATH. Checking for
updates does not: a check reads the candidate's manifest and stops, so
polling never resolves a dependency tree or builds. A candidate that fails to
build is reported as available and fails when you apply it.

Patcher ships no build toolchain. The first time a git or path plugin is built on
a machine, Patcher downloads a pinned esbuild + Tailwind set into
`<dataDir>/plugins/toolchain-<versions>/` and reuses it afterwards. Installing
a prebuilt npm plugin never triggers that download.

To build a plugin yourself — in CI, or to check it compiles without a running
Patcher — depend on the published `patcher-app` package and call the CLI:

```jsonc
// your plugin's package.json
"devDependencies": { "patcher-app": "^0.35.1" },
"scripts": { "build": "patcher plugin build" }
```

`patcher plugin build` talks to no server. Depending on `patcher-app@X` builds with
exactly that release's shim configuration, so the bundle cannot be built
against a mismatched host runtime. Cache the toolchain directory in CI to skip
the download on later runs. Only `patcher plugin dev` needs a running Patcher, because
it reloads the installed plugin after each rebuild.

The backend half is prebuilt too: when a builtin/official/git/npm install
ships a dist/server.js built for the running SDK major, the server loads it
instead of the TypeScript source. Path installs always load server.ts from
source, so `patcher plugin dev`/reload see edits immediately.

`patcher plugin dev` is the edit loop: it requires the directory to already be
installed as a plugin (`patcher plugin install .` first), ignores dist/,
node_modules/, and .git/, batches saves, and prints one line per cycle. A
build or reload failure prints the error and keeps watching (a failed build
skips that cycle's reload). Reloads reach open app pages live — changed
frontend bundles re-import and their UI slots remount without a page
refresh.

Frontend entries (app.tsx) default-export `definePluginApp` from
`@patcher/plugin-sdk/app` and register UI slots: homepageSection (root compose),
settingsSection (per-plugin settings page below the host-rendered settings
form; no props in V1, optional host-rendered title),
navPanel (own sidebar entry + /plugins/<id>/<path>/* route; the remainder
arrives as the component's subPath prop for panel-internal deep links; the
host always renders the shared plugin title bar and the component owns a
zero-padding full-bleed body, including its scrolling; optional
experimental_sidebarAccessory mounts a presentational live-value component at
the trailing edge of the sidebar row on wide viewports, bounded to one short
line, replaced visually by the host options button on hover/focus, and omitted
on compact viewports),
threadPanelAction
(a thread-only entry in an existing thread's right-panel new-tab Actions list;
it is never offered on root compose, and its run() can
open closable panel tabs with recursive `JsonValue` params; restored
components read a required `threadId` plus `JsonValue | null`),
experimental_newThreadPanelAction (the root New thread counterpart, with
`projectId: string | null` instead of `threadId`), pendingInteraction (temporarily replace a thread composer with a
plugin form), fileOpener (register as a per-extension file viewer/editor;
users pick defaults under Settings → File openers and can right-click a
file link for a one-off choice), and messageDirective (replace a leaf
`::name{k="v"}` block inside assistant / nested-agent Markdown with a plugin
component; unknown, disabled, incomplete, code-fenced, or crashing
directives fall back to the original source; components receive a nullable
openWorkspaceFile(path) callback for opening a worktree-relative file in the
host workspace viewer and a nullable
openThreadPanel({ actionId, title?, params? }) callback for opening one of the
same plugin's thread-panel actions). Hooks:
useRpc, useRealtime, useRealtimeConnectionState (the shared realtime socket's
connecting/connected/reconnecting lifecycle; reconcile on later connected
transitions, not the initial connection), useSettings (secrets excluded),
usePatcherContext,
usePatcherNavigate, useComposer (read/replace/update/clear scoped composer text,
apply a class-based text effect, lock input, quote selections, insert mention
pills, and focus the composer), and useComposerView (reactive bound scope,
layout, draft, and run state). Plain-text edits preserve attachments and
reconcile only inline mentions overlapped by the edit. Define RPC methods with `defineRpcContract`
and Standard Schema-compatible input/output validators (Zod works directly),
register via `patcher.rpc.register(contract, handlers)`, then use a type-only
backend contract import with `useRpc<typeof contract>()` for exact frontend
method/input/result inference. The server validates both schemas and rejects
non-JSON results (including cyclic and non-finite values) with structured
error codes. Components are vendored shadcn source the plugin owns (the
shadcn model): `patcher plugin new --app` pre-vendors a starter set into
components/ui/ and `npx shadcn add @patcher/<name>` pulls more from the Patcher
component registry (the full stock shadcn set, version-matched to the
running Patcher via the pinned ref in components.json). `import { toast } from
"sonner"` reaches the host toaster; react, the portaling radix families,
sonner, vaul, and @pierre/diffs (the app's syntax-highlighted diff
renderer) are runtime-shimmed (never bundled), everything else
bundles from the plugin's node_modules (`npm install` for authors; Patcher installs
release packages with their declared production dependencies). A crashing slot collapses to a
"plugin <id> crashed" chip without
touching the rest of the app. Installed plugins and their declared settings
(same data as `patcher plugin config`) also appear under Extensions → Plugins.

Plugin CLI commands: a plugin can register one top-level subcommand (for
example `patcher github …`). Unknown `patcher` commands are looked up against installed
plugins and proxied to the server, so plugin commands work exactly like core
commands; core command names always win. Inside agent threads the generated
`plugin-commands` skill lists the available plugin commands.

Settings changes do not auto-reload a plugin — run `patcher plugin reload <id>`
after configuring. Add --json to plugin commands for machine-readable output.
Plugin CLI stdout plus stderr is capped at 1,048,576 UTF-8 bytes from the
shared `@patcher/plugin-sdk` constant. Results above the ceiling are rejected in
full with a structured `plugin_cli_output_too_large` error; output is never
silently clipped. Page growing collections and use file/streaming commands for
large content.

Authoring a plugin

The loop: `patcher plugin new <name>` scaffolds `./patcher-plugin-<name>` (add --app
for a frontend entry); `patcher plugin install .` registers it; `patcher plugin dev`
watches and reloads on every save. The manifest is package.json: required
`patcher.name` and `patcher.description` human identity, required `patcher.branding` with at
least `icon` or `logo.light`, `patcher.server`
(backend entry, loaded as TypeScript — no build step), optional `patcher.app`
(frontend entry), optional `patcher.skills` (static skill directories auto-imported
into agent threads unless filtered by `patcher.agents.configure`; default
`skills/`), `engines.patcher` (supported Patcher range),
and optional `engines.patcherPluginSdk` (supported plugin SDK range; scaffold
writes `"^1.0.0"` for SDK 1.0.0). Use `patcher-plugin-hello` for the package name by
default. Scoped names such as `@acme/patcher-plugin-hello` are also supported. The
plugin id is the final package-name component minus `patcher-plugin-`, so both forms
use `hello`.

Plugins can contribute palettes with `patcher.themes`: an array of
`{ id, name, description?, css }`, where `css` is a plugin-relative `.css`
file. Loaded plugin palettes appear in Settings → Appearance and `patcher theme
list`; their selectable id is `plugin:<plugin-id>:<theme-id>`. Disabling or
removing the owning plugin makes Patcher fall back to the default palette.

Branding is explicit. Declare `patcher.branding.icon` as either the plugin's
canonical Patcher icon name or a plugin-relative compact SVG such as
`./assets/icon.svg`. Patcher validates and hash-serves path-shaped SVGs, then
renders them as masks that inherit the surrounding text color. Compact chrome
prefers the manifest icon, then a contribution's local icon hint, and finally
Zap. Roomy surfaces reuse the same icon when no logo override is declared.

Add `patcher.branding.logo.light` only for intentionally different rich/full-size
identity artwork; optional `patcher.branding.logo.dark` is preferred in dark mode.
Logo paths must be plugin-relative `.svg`, `.png`, or `.webp` files. Root logo
files are not auto-detected, and a dark logo requires a light logo. Logo-only
manifests remain supported for compatibility, so at least an icon or light logo
is required. Do not duplicate the same artwork across fields. Patcher rejects nulls,
empty strings, missing or escaping assets, and unsupported extensions. Reload
the plugin to pick up branding changes.

The backend entry default-exports a factory receiving the full plugin API:

  import type { PatcherPluginApi } from "@patcher/plugin-sdk";
  export default async function plugin(patcher: PatcherPluginApi) { ... }

The import is type-only and erased at load; the scaffold ships the full API
as bundled .d.ts in types/ (tsconfig maps @patcher/plugin-sdk to them), so
`npm install && npx tsc --noEmit` typechecks anywhere — no Patcher checkout
needed. Those files are ordinary readable declarations, not a minified
bundle: read them for an exact signature. The SDK surface grows every
release, so `patcher plugin types` rewrites them from the running Patcher — run it in a
cloned or older plugin, and `patcher plugin types --check` in CI. `patcher plugin
build` and `patcher plugin dev` refresh them for you. Need a symbol the types
don't explain? Clone the repo: https://github.com/laruss/patcher-browser. The API in
one line each — patcher.log (plugin-scoped logger behind `patcher plugin logs`);
patcher.settings.define (declarative settings incl. secrets, editable via
`patcher plugin config`); patcher.storage.kv (JSON rows ≤256KB) and
patcher.storage.database()+migrate (the plugin's own database); patcher.sdk (the full
Patcher SDK — handlers/services only, not the factory; spawned threads are
attributed to the plugin; `visibility: "hidden"` creates directly addressable
background workers omitted from sidebar organization and unread/pending
favicon attention, with other behavior unchanged; a child thread inherits
its parent's visibility and still notifies that parent);
patcher.events.on (observe thread.created/idle/failed/deleted);
patcher.http.route (routes under /api/v1/plugins/<id>/http/* with
local/token/none auth); defineRpcContract + patcher.rpc.register (Standard
Schema-validated frontend data plane with inferred backend handlers and
type-only frontend method/input/result inference);
patcher.realtime.publish (ephemeral signals to open app pages);
patcher.background.service (long-lived, AbortSignal, restart w/ backoff) and
patcher.background.schedule (durable cron rows); patcher.cli.register (a top-level
`patcher <name>` command agents run through bash, with a shared 1 MiB combined
stdout/stderr ceiling and atomic structured over-limit errors); patcher.agents.registerTool
(static native tools with zod or JSON-schema parameters) and
patcher.agents.configure (one synchronous per-resolution callback selecting this
plugin's own tool/skill ids and optional dynamic instructions; tools apply on
the next provider session start/resume, while busy skill runtimes defer catalog
changes); patcher.ui
registerMentionProvider (host-rendered UI — no
frontend bundle needed); patcher.status.needsConfiguration (report
"unconfigured" instead of crashing); patcher.onDispose (LIFO cleanup on
reload/disable/shutdown).

Frontend entries register React slots (homepageSection, settingsSection,
navPanel, threadPanelAction, experimental_newThreadPanelAction, fileOpener,
messageDirective) and composer
customizations via `app.composer.customize({ actions, plusMenu, banners,
richText })`; action/banner components use `useComposer()` and
`useComposerView()`, while the host renders plus-menu rows and editor
decorations. The deprecated pre-1.0 `slots.composerAccessory` footer API was
removed; migrate controls to actions or the plus menu and larger content to
banners. Register all frontend surfaces via
definePluginApp, use the hooks
listed above, and render vendored components; styling is Tailwind against
the host theme's tokens only (semantic classes like bg-background and
tw-animate-css utilities compile in plugin builds).

For the complete authoring reference — exact signatures, working snippets
for every surface, the reload lifecycle, testing tips, and gotchas — use
the built-in `patcher-plugin-authoring` skill (agents: it loads on demand;
humans: apps/server/src/services/skills/builtin-skills/patcher-plugin-authoring/
in a checkout). The builtin `inline-vis` plugin renders
`::inline-vis{file="demo.html" height="480"}` through the sidebar's
path-shaped, sandboxed worktree HTML iframe preview; `height` is optional.
Its card header includes an open-in-sidebar action for the source HTML file.
The `plugins/` directory contains every bundled plugin: the auto-installed
builtins and the store-only Patcher Official GitHub, Docs, Memory, and Tasks
plugins. The `examples/plugins/` reference plugins cover slack-bot (webhook
bot), agent-enrichment (agent surfaces), composer-customization (all composer
regions), and t3sidebar (a replacement sidebar thread list).
