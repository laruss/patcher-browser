# Development

The loop for working on Patcher itself. For installing Patcher to use it, see
[Installation](installation.md).

Read [AGENTS.md](../AGENTS.md) and
[the migration map](architecture/bb-migration.md) before changing contracts,
dependencies, or packaging — this repository carries inherited invariants a
passing build does not protect.

## The dev loop

```bash
bun install
bun run dev
```

That starts the Vite app and proxies API and WebSocket traffic to a separate
dev server. The launcher prints the actual ports at startup. Each checkout gets
a data directory under `~/.patcher-dev/<checkout-instance>/` and deterministic
high ports derived from the checkout path. The checkout instance id is the
sanitized path to the checkout, relative to your home directory, plus a short
hash suffix. Separate worktrees can run alongside each other and the packaged
production instance.

To run that same source dev server inside the Electron desktop shell — which is
how you work on the browser surface:

```bash
bun run dev:desktop
```

This uses `scripts/patcher-dev-app current --desktop`, which stops stale
launcher sessions, checks dependencies and native modules, starts the source dev
server, then opens the desktop shell against that dev app. The launcher prints
the web URL but does not open a browser unless you pass `--open`.

```bash
bun run dev:status
bun run dev:stop
```

## What hot reloads, and what does not

Development behavior is intentionally split:

- the app hot reloads itself
- the server does not hot reload
- the host daemon does not hot reload

When you want the server and host daemon to pick up the latest build output:

```bash
bun run dev:restart
bun run dev:restart-server
bun run dev:restart-host-daemon
```

These rebuild first, then restart only the targeted stateful services.

## Production mode from a checkout

```bash
bun run start
```

That builds only the app, server, and host-daemon runtime artifacts, then runs
the launcher directly against those workspace outputs. Use the `patcher-app`
tarball smoke task when validating the `patcher-app` package layout.

## CLI and state

```bash
bun run patcher --help       # built CLI, targets the default/prod instance
bun run reset                # clear production state

bun run patcher:dev --help   # source CLI, targets this checkout's dev instance
bun run reset:dev            # clear this checkout's dev state

bun run reset:all            # clear both production and dev states
```

These reset commands prompt for confirmation before deleting anything.

## Tests

```bash
bun run test
bun run typecheck
bun run lint
```

## Reaching a dev instance from another machine

To use the dev app from another machine over Tailscale, run `bun run dev`, note
the printed app port, and publish the loopback Vite listener:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:<app-port>
```

Then open `https://<machine>.<tailnet>.ts.net`. Source dev binds both the Vite
app and main server to loopback by default; Vite continues to proxy API and
WebSocket traffic.

The public API is unauthenticated. Do not expose it to a network you do not
control — see [Security](security.md#the-local-api-is-unauthenticated).

## Storybook

```bash
bun run storybook
```

Ladle binds to all interfaces and configures its HMR WebSocket to use the
browser's current host instead of `localhost`, so it works from another machine
without extra setup. For the same reason, do not run `bun run storybook` on an
untrusted network.
