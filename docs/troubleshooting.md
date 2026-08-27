# Troubleshooting

## `Could not locate the bindings file`

Patcher uses native add-ons, for example `better-sqlite3` and `@parcel/watcher`.
npm downloads or builds those binaries in a package install script. If npm does
not run install scripts, the binaries are absent. Patcher then stops at startup
with this error:

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

## `not found: make` during install on Linux or WSL2

`node-pty` ships no Linux prebuild and compiles at install time. Without a C++
toolchain the install aborts and npm rolls the whole tree back, leaving nothing
behind to debug. Install `build-essential` (Debian and Ubuntu) first, then
install again. See [Installation](installation.md#supported-platforms).

## A thread refuses to start because the machine cannot build a sandbox

Accept Edits and Approve for me run the agent inside a workspace sandbox, and
Patcher now refuses to start a turn on a machine that cannot build one rather
than running the turn unsandboxed and calling it the same thing. The message
names the missing piece:

```
Permission mode "auto" runs the agent inside a workspace sandbox, and this
machine cannot build one: the Linux sandbox is built with bubblewrap, and no
`bwrap` was found on PATH. Either install bubblewrap on this machine, or run the
thread at Full Access to work without a sandbox.
```

macOS composes its sandbox from Seatbelt, which ships with the OS, so this is a
Linux machine. Install bubblewrap (`apt install bubblewrap`,
`dnf install bubblewrap`) and start the turn again.

A machine that has `bwrap` and still cannot sandbox — a container without user
namespaces, most often — fails later and differently, from the Claude SDK's own
check rather than this one. The fix is the same: give the container the
namespaces, or run at Full Access, having read what that means in
[Security](security.md).

## npm refuses to install on Windows

`patcher-app` declares `os: ["darwin", "linux"]`, so npm's own platform check
fails on native Windows. Run Patcher inside WSL2 and keep every `patcher`
command, Node install, and provider CLI inside that distro — see the WSL2
section of [`packages/patcher-app/README.md`](../packages/patcher-app/README.md).

## The desktop app will not start, or there is nothing to download

There is no desktop release yet, and the update feed does not resolve. Build the
Electron shell from this repository — see
[Installation](installation.md#the-desktop-browser).

## A plugin throws with a permission name in the message

That is the intended behaviour, not a bug: a plugin that reaches for something
it did not declare fails loudly, with the permission named and the fix in the
message. Add the permission to the plugin's `patcher.permissions` (and the site
to `patcher.sites` if it touches a page), then reinstall. See
[plugin-permissions.md](architecture/plugin-permissions.md).

## A tab refuses automation with `debugger-unavailable`

Chromium allows one protocol client per `webContents`, and DevTools takes it. A
tab with its developer tools open cannot be driven by an agent until you close
them. See [browser-gaps.md](architecture/browser-gaps.md).

## Two Patchers fighting over ports or state

Each checkout gets its own data directory under
`~/.patcher-dev/<checkout-instance>/` and deterministic ports derived from the
checkout path, so worktrees and the packaged production instance coexist. If one
is stuck, `bun run dev:status` and `bun run dev:stop` act on the current
checkout's instance. `npx patcher-app stop` stops a packaged launcher.
