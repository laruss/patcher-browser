# Installation

Patcher has two halves, and they install differently. This page is the long
version of the README's [Install](../README.md#install) section.

| What you get                             | How you get it               | State                    |
| ---------------------------------------- | ---------------------------- | ------------------------ |
| The **browser** — tabs, omnibox, plugins | GitHub prerelease, or source | macOS Apple Silicon only |
| The **agent runtime, web app, and CLI**  | `npx patcher-app@latest`     | macOS and Linux          |

## The desktop browser

**The desktop app is macOS on Apple Silicon only.** The Electron shell is
arm64-only by configuration.

### Download the alpha

The [releases page](https://github.com/laruss/patcher-browser/releases) carries
a `.dmg` — `0.1.1-alpha.2` at the time of writing. Alphas are published as
prereleases, so `/releases/latest` and the release API skip them by design; the
page itself is the list. Open the `.dmg`, drag Patcher to Applications, and
expect one refusal on first launch: the build is ad-hoc signed, not signed with an Apple Developer ID, so
Gatekeeper will not open it unattended.

Allow it once in **System Settings → Privacy & Security** → **Open Anyway**, or
strip the quarantine flag yourself:

```bash
xattr -d com.apple.quarantine /Applications/Patcher.app
```

Each release also carries `SHA256SUMS.txt`, which is what stands in for the
notarization ticket this build does not have — `shasum -a 256 -c SHA256SUMS.txt`
confirms the bytes, though not who produced them.

Neither override is a workaround for a broken download — the signature is valid,
it just carries no Apple identity. What notarization would buy is skipping this step;
see [Security](security.md) for what the signature does and does not say about
the code.

Alpha builds do not update themselves. `electron-updater` installs only a
Developer ID-signed update, so the alpha deliberately leaves the update feed
alone rather than offering one it cannot apply. Check the releases page.

### Or build it from source

[`.github/workflows/build-desktop.yml`](../.github/workflows/build-desktop.yml)
is the workflow that cuts a release; the steps below are the same build by hand.

### Prerequisites

- macOS on Apple Silicon.
- [Bun](https://bun.sh) 1.3.14 or newer — the version CI pins.
- Node.js as pinned in [`.nvmrc`](../.nvmrc) — 22.20.0. That is narrower than
  the `^22.19.0 || ^24 || ^26` the published package declares, and deliberately
  so: `engines` is the floor for _running_ `patcher-app`, while `.nvmrc` is the
  one version this checkout is developed and tested on. The gap is load-bearing
  in at least one direction — Node 25 enables Web Storage globals that shadow
  jsdom's `localStorage` inside vitest, and whole test files fail with
  `clear is not a function`. See invariant 2 of
  [bb-migration.md](architecture/bb-migration.md).
- Git.
- At least one authenticated agent provider — see
  [Provider credentials](../packages/patcher-app/README.md#provider-credentials).
  Patcher uses the provider CLI you already have authenticated.

### Build and run

```bash
git clone https://github.com/laruss/patcher-browser
cd patcher-browser
bun install
bun run dev:desktop
```

`dev:desktop` runs `scripts/patcher-dev-app current --desktop`: it stops stale
launcher sessions, checks dependencies and native modules, starts the source dev
server, then opens the desktop shell against that dev app. See
[Development](development.md) for what that dev server does and where it stores
its data.

For a packaged local build instead of the dev loop:

```bash
bun run --filter @patcher/desktop package   # .app under apps/desktop/release
bun run --filter @patcher/desktop start     # package, then launch it
```

A local build signs with a code-signing identity found in your keychain, and
falls back to unsigned if there is none. That is fine for a build you made
yourself — a local app never gets the quarantine flag — but it is not what a
download needs; see the signing section of
[`apps/desktop/README.md`](../apps/desktop/README.md#macos-signing--notarization).

## The agent runtime and web app

```bash
npx patcher-app@latest
```

That starts the server and host daemon and serves the web app on
`http://localhost:38986`. **It does not give you the browser** — the browser
surface lives in the Electron shell above. What it gives you is threads,
projects, plugin management, and the CLI.

The same package carries the `patcher` CLI:

```bash
npx --package patcher-app patcher --help
```

[`packages/patcher-app/README.md`](../packages/patcher-app/README.md) documents
the launcher, the CLI, the Node SDK, provider credentials, and configuration.

### Supported platforms

The npm package reaches further than the desktop app, by declaration:
`os: ["darwin", "linux"]` with no CPU restriction, and Node 22.19, 24, or 26.
npm therefore installs it on an Intel Mac as well, and nothing in the launcher,
server, or CLI refuses a platform outright. Verified on macOS arm64 from an
empty npm cache: install, `patcher --version`, and the packaged-tarball smoke.

**Linux needs a C++ toolchain.** `node-pty` ships prebuilt binaries for
`darwin-arm64`, `darwin-x64`, `win32-arm64`, and `win32-x64`, and none for
Linux, so there its install step falls back to `node-gyp rebuild`. On a stock
Ubuntu 24.04 that aborts at `not found: make`, and npm rolls the whole tree
back, so nothing is left behind to debug. Install `build-essential` first.
Whether Patcher then runs on Linux is still unverified. macOS never meets this
because it gets a prebuild, which is also why Xcode is not a prerequisite there.

**Windows** fails npm's own platform check; run Patcher inside WSL2, which
[`packages/patcher-app/README.md`](../packages/patcher-app/README.md) describes.
WSL2 is Linux, so the toolchain requirement follows it there.

## Enrolling another machine

Enrolling an additional machine from a running Patcher needs no registry: the
server builds and serves its own `patcher-app` package, and the enrollment
script installs that. If that install fails with
`Could not locate the bindings file`, see
[Troubleshooting](troubleshooting.md#could-not-locate-the-bindings-file).
