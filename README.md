<p align="center">
  <img alt="Patcher" src="assets/patcher-icon.png" width="128">
</p>

# Patcher

Patcher is an agentic IDE that builds itself. It can control, customize, and automate
itself, laying the groundwork for your own software factory.

Every surface — the desktop app, web app, CLI, and HTTP API — is a first-class
way to drive Patcher. Work runs in threads you can follow live, steer at any point,
or hand off to another agent.

> [!NOTE]
> Patcher is in active development. Core architecture is stable, but workflows
> and surfaces are still evolving.

Patcher is a fork of [bb](https://github.com/get-bb/bb) by Michael Yong, and
keeps its MIT license. It is developed independently: it has its own data
directory, ports, package names, and plugin contract, and it neither reads nor
migrates the state of a bb install. The two can be installed side by side.

## Use Patcher

### Install from npm

```bash
npx patcher-app@latest
```

That starts the server and host daemon and serves the web app on
`http://localhost:38986`. The same package carries the `patcher` CLI:

```bash
npx --package patcher-app patcher --help
```

The desktop app has no release yet. The
[releases page](https://github.com/laruss/patcher-browser/releases) is empty and
no update feed resolves, so the Electron shell still has to be built from this
repository — see [Development](#development).
[`.github/workflows/build-desktop.yml`](./.github/workflows/build-desktop.yml)
is the workflow that cuts it.

### Supported platforms

**The desktop app is macOS on Apple Silicon only.** The Electron shell is
arm64-only by configuration.

The npm package reaches further, by declaration: `os: ["darwin", "linux"]` with
no CPU restriction, and Node 22.19, 24, or 26. npm therefore installs it on an
Intel Mac and on Linux, and nothing in the launcher, server, or CLI refuses to
start on either. Only macOS on Apple Silicon has actually been run, so treat the
rest as untested rather than supported. Windows fails npm's own platform check;
run Patcher inside WSL2, which
[`packages/patcher-app/README.md`](./packages/patcher-app/README.md) describes.

Patcher uses the provider CLI you already have authenticated.

Enrolling an additional machine from a running Patcher needs no registry: the
server builds and serves its own `patcher-app` package, and the enrollment
script installs that.

### Telemetry

Patcher currently sends no telemetry: it ships with an empty PostHog key, and
an empty key disables the sender. The code path is still there, and if a key is
ever configured, production runs (the desktop app and the packaged launcher) would
send anonymous usage telemetry (app starts, thread creation counts, and user
message counts). Identification would be a random per-install id stored in your
data dir — no user, host, project, workspace, or message content is ever
attached. Development/source runs never send. Opt out of any run with
`PATCHER_TELEMETRY=false`. See
[`apps/server/src/services/system/telemetry.ts`](./apps/server/src/services/system/telemetry.ts).

## Development

Use the development loop when working on Patcher itself:

```bash
bun run dev
```

That starts the Vite app and proxies API and WebSocket traffic to a separate
dev server. The launcher prints the actual ports at startup. Each checkout gets
a data directory under
`~/.patcher-dev/<checkout-instance>/` and deterministic high ports derived from the
checkout path. The checkout instance id is the sanitized path to the checkout,
relative to your home directory, plus a short hash suffix. Separate worktrees
can run alongside each other and the packaged production instance.

To run that same source dev server with the Electron desktop shell:

```bash
bun run dev:desktop
```

This uses `scripts/patcher-dev-app current --desktop`, which stops stale launcher
sessions, checks dependencies and native modules, starts the source dev server,
then opens the desktop shell against that dev app. The launcher prints the web
URL but does not open a browser unless you pass `--open`.

To use the dev app from another machine over Tailscale, run `bun run dev`, note the
printed app port, and publish the loopback Vite listener:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:<app-port>
```

Then open `https://<machine>.<tailnet>.ts.net`. Source dev binds both the Vite
app and main server to loopback by default; Vite continues to proxy API and
WebSocket traffic.

To use the component storybook from another machine, run:

```bash
bun run storybook
```

Ladle binds to all interfaces and configures its HMR WebSocket to use the
browser's current host instead of `localhost`. Do not run `bun run storybook` on an
untrusted network.

Development behavior is intentionally split:

- the app hot reloads itself
- the server does not hot reload
- the host daemon does not hot reload

When you want the server and host daemon to pick up the latest build output, use:

```bash
bun run dev:restart
bun run dev:restart-server
bun run dev:restart-host-daemon
```

These rebuild first, then restart only the targeted stateful services.

To run a production-mode build from a source checkout:

```bash
bun run start
```

That builds only the app, server, and host-daemon runtime artifacts, then runs
the launcher directly against those workspace outputs. Use the `patcher-app`
tarball smoke task when validating the `patcher-app` package layout.

```bash
bun run patcher --help            # built CLI, targets the default/prod instance
bun run reset                # clear production state

bun run patcher:dev --help        # source CLI, targets this checkout's dev instance
bun run reset:dev            # clear this checkout's dev state

bun run reset:all            # clear both production and dev states
```

These reset commands prompt for confirmation before deleting anything.

## Further Reading

Seven links here used to point at `docs/` pages the fork does not carry
(`repository-overview`, `system-overview`, `VISION`, `platform-support`,
`configuration`, `multiple-devices`, `worktrees`). What exists:

- [AGENTS.md](AGENTS.md) — working agreements, and the invariants a passing build
  does not protect
- [Migration map](docs/architecture/bb-migration.md) — what this fork inherited,
  and the contracts that must survive changing it
- [Project plan](docs/PROJECT_PLAN.md) and [TODO](docs/TODO.md)
- [Lifecycle diagrams](docs/lifecycle-diagrams.md)
- [`docs/architecture/`](docs/architecture) — the browser surface, the plugin
  contract, permissions, and the transport between them

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Troubleshooting

### `Could not locate the bindings file`

Patcher uses native add-ons, for example `better-sqlite3` and `@parcel/watcher`. npm
downloads or builds those binaries in a package install script. If npm does not
run install scripts, the binaries are absent. Patcher then stops at startup with this
error:

```
Error: Could not locate the bindings file. Tried:
 → .../node_modules/better-sqlite3/build/better_sqlite3.node
```

The usual cause is `ignore-scripts=true` in your `~/.npmrc`. The desktop app is
unaffected — it ships its native modules prebuilt — so this bites the two paths
that run `npm install` on your machine: enrolling a machine from a running
Patcher, and building from this repository.

Set the `npm_config_ignore_scripts` environment variable for that one command:

```bash
npm_config_ignore_scripts=false sh install.sh --join-code <code> --host-id <id> --server <url>
npm_config_ignore_scripts=false bun install    # in a checkout
```

The environment variable applies to the command you put it in front of. Keep
`ignore-scripts=true` in your `~/.npmrc` if you want it for security.

The same error has other causes. A Node.js major-version change after the
install causes it. A copy of `node_modules` from a different operating system,
CPU architecture, or libc variant also causes it. To recover, install the
package again, or run `npm rebuild better-sqlite3`.
