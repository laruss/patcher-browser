# @patcher/desktop

macOS Electron shell for Patcher. The desktop app loads the existing Patcher web UI and
uses the packaged `patcher-app` launcher for server and host-daemon lifecycle.

## Development

From the repo root, the full source dev loop is:

```bash
bun run dev:desktop
```

That starts the source dev server and the Electron shell through
`scripts/patcher-dev-app`. To run only the desktop package task directly:

```bash
bunx turbo run dev --filter=@patcher/desktop
```

The dev script builds `patcher-app`, compiles the Electron main/preload files, and
opens Electron directly. By default it uses the same checkout-scoped
`~/.patcher-dev/<checkout-instance>` data directory and deterministic high ports as
the main repo dev launcher; it prints the resolved data dir, server URL, and
Electron user-data dir at startup. It intentionally overwrites inherited
`PATCHER_DATA_DIR`, `PATCHER_SERVER_PORT`, `PATCHER_SERVER_URL`, and `PATCHER_HOST_DAEMON_PORT` so a
desktop dev run launched from an existing Patcher session still targets the current
checkout. Set `PATCHER_DESKTOP_USER_DATA_DIR` to override only Electron's user-data
directory.

The launcher probes the checkout's Vite app port at startup and adapts:

- **`bun run dev` is already running** (Vite reachable): the shell loads the Vite
  dev URL, so you get live source and HMR for `@patcher/app` changes — no rebuild
  needed. It still attaches to the same running server/daemon for all API/WS
  traffic. The launcher prints `app <url> (Vite dev server — live reload)`. This
  is the fast loop for iterating on the desktop UI.
- **`bun run dev` is not running**: the shell starts its own `patcher-app` runtime and
  loads the built UI it serves, so you must rebuild (re-run this task) to pick up
  source changes. The launcher prints `app (own patcher-app runtime — …)`.

The override is plumbed via `PATCHER_DESKTOP_APP_URL`, which the launcher only sets
when Vite is confirmed reachable; it is never set in packaged builds, so
production always loads the server's own built UI.

To run the slower unpacked Electron Builder app, which more closely matches the
packaged runtime and keeps native dependencies rebuilt for Electron's bundled
Node runtime:

```bash
bunx turbo run start --filter=@patcher/desktop
```

Electron is pinned to `41.7.0`, the highest stable line verified to rebuild the
packaged native modules with the current dependency set. Electron 42.2.0 was
tested, but `better-sqlite3@12.10.0` does not compile against Electron ABI 146.
Revisit the pin when `better-sqlite3` ships support or prebuilds for that ABI.

## Validation

```bash
bunx turbo run typecheck --filter=@patcher/desktop --filter=patcher-app
bunx turbo run build --filter=@patcher/desktop
bunx turbo run test --filter=@patcher/desktop --filter=patcher-app --force
bunx turbo run dev --filter=@patcher/desktop
```

## Packaging

```bash
bunx turbo run desktop:build --filter=@patcher/desktop
bunx turbo run smoke:packaged --filter=@patcher/desktop
```

Artifacts are written under `apps/desktop/release/`. The desktop build is
macOS-only and Apple Silicon arm64-only. Without signing secrets, local builds
sign with a code-signing identity auto-discovered from the keychain and skip
notarization. A valid signature matters even for local builds: macOS
provenance-tracks unsigned apps, forcing syspolicyd to evaluate every exec in
the app's process tree, which can stall process launches system-wide. On
machines with no keychain identity (or with `CSC_IDENTITY_AUTO_DISCOVERY=false`,
as CI sets for workflow-artifact-only builds), artifacts remain unsigned and
macOS shows the normal Gatekeeper warning on first launch.

## Releasing

`patcher-app` and `@patcher/desktop` versions are LOCKED in lockstep. The desktop package
depends on `patcher-app: workspace:*`, and the displayed release version string must
match `packages/patcher-app/package.json`.

To bump for a release:

```bash
node scripts/bump-version.mjs <new-version>
```

Then commit and ship through the normal `sawyer-next` → `main` flow. You can also
use `--patch`, `--minor`, or `--major` instead of an explicit version.

CI enforces this lockstep. Direct edits that leave
`packages/patcher-app/package.json` and `apps/desktop/package.json` with different
versions fail the build. Never edit either package version directly for a
release; use `scripts/bump-version.mjs` so both files move together.

The desktop release tag uses the locked version: `desktop-v<version>` for
immutable releases and `desktop-latest` for the moving pointer.

## Nightly channel

The scheduled `publish-patcher-app.yml` workflow runs from `main` every day at
3:00 AM Pacific (`America/Los_Angeles`, including daylight-saving changes). It
derives a unique version such as `0.34.1-nightly.<run-id>.<attempt>` without
committing that version, publishes `patcher-app` with the npm `nightly` dist-tag,
and builds the desktop app from that same lockstep version.

To publish or dry-run the channel manually from `main`, dispatch the same
workflow with `npm_tag=nightly`. A non-dry run publishes both npm and desktop;
a dry run validates only the npm package path.

The nightly desktop is a separate installation:

- product name: `Patcher Nightly`
- bundle identifier: `app.patcher.desktop.nightly`
- app/update release: `desktop-nightly`
- update metadata: `nightly-mac.yml`
- icon: `assets/icon-nightly.icns` and `assets/icon-nightly.png`

Download it from
[`desktop-nightly`](https://github.com/laruss/patcher-browser/releases/tag/desktop-nightly)
or run the CLI build with:

```bash
npx patcher-app@nightly
```

Stable and nightly desktop bundles can coexist. Electron-owned preferences,
window state, and process supervision use separate application data
directories; the embedded Patcher runtime still uses the normal `~/.patcher` data and
default server port unless the corresponding environment variables are
overridden.

Nightly builds set `PATCHER_DESKTOP_RELEASE_CHANNEL=nightly` at build time. The value
is baked into the Electron main/preload bundles and selects the nightly product
identity, yellow icon, and update URLs. Omit the variable (or set it to
`latest`) for stable and local builds.

## macOS signing + notarization

The desktop package is ready for Developer ID signing and Apple notarization.
Local builds with no secrets sign via keychain auto-discovery and skip
notarization. To activate signed and notarized release artifacts, add these
GitHub Actions secrets:

| Secret                       | Value                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MACOS_CERTIFICATE_P12`      | Base64-encoded `.p12` exported from Keychain Access for a `Developer ID Application` certificate and its private key. On macOS: `base64 -i DeveloperID.p12 -o certificate.base64.txt`. |
| `MACOS_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12`.                                                                                                                                               |
| `MACOS_CERTIFICATE_NAME`     | Optional certificate common name, without the `Developer ID Application:` prefix. Leave unset when the `.p12` contains a single usable identity and electron-builder can derive it.    |
| `APPLE_ID`                   | Apple ID email for the Developer Program account.                                                                                                                                      |
| `APPLE_APP_PASSWORD`         | App-specific password from `appleid.apple.com` under Sign-In and Security.                                                                                                             |
| `APPLE_TEAM_ID`              | Developer Team ID from `developer.apple.com/account` membership details.                                                                                                               |

Once those secrets are present, the next `Build Desktop` workflow run with
`publish=true` and `release_channel=stable` signs the `.app`, notarizes it, and
publishes the signed `.dmg` / `.zip` assets to `desktop-latest`. If no required
signing secrets are configured, the workflow still builds unsigned artifacts, but
the release job publishes only `desktop-version.json` and withholds unsigned
binaries from `desktop-latest`. If only some required signing secrets are set,
the workflow fails before packaging so a misconfigured release cannot silently
produce unsigned or signed-but-not-notarized artifacts.

## Auto-update

The renderer update toast keeps using `desktop-version.json` as the lightweight
feature surface. The installer path uses `electron-updater` against the same
`desktop-latest` release asset directory and reads `latest-mac.yml`. These
checks run in parallel on launch, hourly, and when the app becomes active: the
JSON feed can show "update available" even when CI has published metadata only,
while the Electron updater only flips the toast to "ready to install" after a
signed update has actually downloaded. Local dev builds skip Electron auto-update
unless `PATCHER_DESKTOP_AUTO_UPDATE=1` is set.

`Patcher Nightly` follows the equivalent isolated `desktop-nightly` release and
`nightly-mac.yml`; it never reads or moves the stable feed. The scheduled
workflow requires the complete signing/notarization secret set before
publishing nightly desktop assets.

To verify a downloaded or unpacked build:

```bash
spctl --assess --verbose /path/to/Patcher.app
codesign --verify --deep --strict --verbose=2 /path/to/Patcher.app
```

## Debugging

Use the View menu to toggle DevTools. To open them automatically on launch, set
`PATCHER_DESKTOP_OPEN_DEVTOOLS=1`:

```bash
PATCHER_DESKTOP_OPEN_DEVTOOLS=1 apps/desktop/release/mac-arm64/Patcher.app/Contents/MacOS/patcher
```

When the desktop app spawns `patcher-app`, server and daemon logs land under
`~/.patcher/logs/` or `$PATCHER_DATA_DIR/logs/` when `PATCHER_DATA_DIR` is set.

To verify attach-if-found manually, start a compatible Patcher first, then launch the
desktop app:

```bash
npx patcher-app@latest
bunx turbo run dev --filter=@patcher/desktop
```

The desktop supervisor handles normal quits plus `SIGINT` and `SIGTERM`, and it
writes a PID file so the next launch can reap a stale Electron-owned `patcher-app`
launcher. Hard crashes such as process aborts, segfaults, or kernel-level kills
cannot run cleanup in the crashing process; the startup PID-file reap is the
recovery path for those cases.
