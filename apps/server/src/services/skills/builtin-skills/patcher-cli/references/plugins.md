# Managing plugins from the CLI

Installing, updating, inspecting, and scaffolding Patcher plugins. To WRITE one,
use the `patcher-plugin-authoring` skill instead.

- A Patcher plugin is a TypeScript package running inside the Patcher server, extending
  it with services, schedules, HTTP/RPC endpoints, settings — and `patcher` CLI
  subcommands that agents run through bash like any other command.
- Plugins are on by default. Auto-installed builtin plugins ship with Patcher
  (except `side-chat`, which is gated by the **"Side chat plugin"**
  experiment); official plugins install from the bundled store on demand.
- **Patcher Official plugins** (store under `/api/v1/plugin-catalog`):
  - Patcher's official plugins (GitHub, Docs, Memory, and Tasks) ship
    bundled inside the app and install from the local copy — no network. Installed official
    plugins are pinned to the bundled copy and update with Patcher app releases.
  - `patcher plugin search <query> [--json]` — search the official plugins by id,
    name, description, or category; status shows installed / compatible /
    requires newer Patcher.
- Commands:
  - `patcher plugin install <src>` — official plugin name (github, docs, memory,
    tasks), HTTP(S) Git repository URL, local path, `builtin:<name>`,
    `git:<url>[@<ref>]`, or `npm:<package>[@<version|tag|range>]` (npm on PATH
    required for `npm:`). Repository URLs and prefixes `path:` / `npm:` /
    `git:` / `builtin:` skip official-plugin resolution. To pin or range an
    npm package, install with `npm:<package>@…`.
    Omit the npm spec to track compatible stable releases; ranges and dist-tags
    track, while exact versions are pinned. Omit the Git ref to track the
    repository's default branch; explicit branches track, while tags and
    commits are pinned. Installs prompt for confirmation (plugins are full-trust code);
    pass `--yes` to skip. Reinstalling an already-installed managed plugin is
    refused — use `patcher plugin update`. Plugins that declare a frontend (`patcher.app`)
    are built at install time for path sources and git sources without a
    prebuilt app when their imported dependencies are already available;
    git/npm packages can also ship a metadata-validated prebuilt `dist/`, and
    npm packages must. Managed git/npm installs refuse `engines.patcher` /
    `engines.patcherPluginSdk` mismatches, manifest vs. artifact identity mismatches,
    and ids reserved by bundled plugins.
  - `patcher plugin outdated` — check installed plugins for compatible updates
    (table; `--json` for raw results). Shows latest compatible candidate and
    any blocked incompatible newer release. Dev builds (Patcher `0.0.0`) annotate
    that `engines.patcher` is not enforced.
  - `patcher plugin update <id>` / `patcher plugin update --all` — apply compatible
    updates for tracking sources. Same full-trust confirmation as install
    (`--yes` skips; non-TTY refuses without it). Use `patcher plugin outdated` to
    preview available updates; changing a pinned source requires reinstalling
    it after removal.
  - `patcher plugin list` — status, background services, schedules, handler timings,
    and each plugin's contributed `patcher` command.
  - `patcher plugin source <id> [--json]` — requested and resolved source, engine
    ranges, install time, integrity/registry details, and recent activation
    history.
  - `patcher plugin enable|disable <id>`, `patcher plugin reload [id]`,
    `patcher plugin remove <id>` (builtin removals are remembered).
  - `patcher plugin config <id> [set <key> <value> | unset <key>]` — declared
    settings. Reload the plugin after configuring (`patcher plugin reload <id>`).
  - `patcher plugin logs <id> [-n N] [-f]` — the plugin's `patcher.log` output.
  - `patcher plugin run <id> [args...]` — explicit form of a plugin's CLI command.
  - `patcher plugin new <name> [--app]` — scaffold a plugin and install its npm
    dependencies (`--app` adds a frontend entry plus a typecheck-only
    `tsconfig.json`; scaffold sets `engines.patcherPluginSdk` to `^1.0.0`). The
    install is best-effort and verified: if npm is missing or leaves a package
    out, it says so and prints the manual `npm install --include=dev` step
    rather than reporting success; `patcher plugin build [path]` —
    compile the plugin into `dist/`: the backend bundle (`server.js` +
    `server.meta.json` stamped with SDK/identity metadata; preferred by
    git/npm installs over source) and, when `patcher.app` is declared, `app.js` +
    `app.css` + `app.meta.json`. Neither needs the server.
  - `patcher plugin types [path]` — rewrite the plugin's `types/*.d.ts` from the
    running Patcher's `@patcher/plugin-sdk` declarations, creating `types/` when absent.
    Run it in a cloned or older plugin: the scaffold seeds those files once and
    the SDK surface grows every release. `--check` reports staleness and exits
    non-zero without writing (for CI). `patcher plugin build` and `patcher plugin dev`
    refresh them automatically. Needs no server.
  - `patcher plugin dev [path]` — watch loop for an installed plugin (default:
    cwd): on every change it rebuilds the frontend bundle (when `patcher.app` is
    declared) and reloads the plugin; open app pages pick the new UI up live.
    Build/reload failures print and keep watching; Ctrl+C stops.
  - Frontend entries default-export `definePluginApp` from
    `@patcher/plugin-sdk/app` and register UI slots (homepageSection,
    settingsSection, navPanel, threadPanelAction, fileOpener) with hooks
    (useRpc, useRealtime, useRealtimeConnectionState,
    useSettings, usePatcherContext,
    usePatcherNavigate, useComposer for scoped text editing / quote / mention /
    focus access); components are vendored shadcn source the
    plugin owns. Installed
    plugins and their settings also appear under Extensions → Plugins.
- Plugins can add top-level `patcher` subcommands (e.g. `patcher linear issues`). Run
  them directly — unknown `patcher` commands are resolved against installed plugins
  and proxied to the server. Core command names always win. In agent threads,
  the injected `plugin-commands` skill lists what is available.
- Plugin commands share a 1,048,576-byte combined stdout/stderr ceiling. An
  oversized result is rejected in full as `plugin_cli_output_too_large` (valid
  JSON for `--json` callers), never truncated. Use pagination or file/streaming
  commands for large results.
- **Writing a plugin?** Use the `patcher-plugin-authoring` skill — the complete
  authoring reference for the backend `PatcherPluginApi` (settings, storage, sdk,
  http/rpc/realtime, background services and schedules, CLI commands, agent
  tools and context, host-rendered UI, lifecycle) and the frontend
  `@patcher/plugin-sdk/app` contract (slots, hooks, UI kit), with working patterns
  and gotchas. `patcher guide plugins` has the short walkthrough.
