<p align="center">
  <img alt="Patcher" src="assets/patcher-icon.png" width="96">
</p>

<h1 align="center">Patcher</h1>

<p align="center">
  <strong>The browser that writes its own extensions.</strong>
</p>

<p align="center">
  Describe what you want a website — or the browser itself — to do.
  Patcher turns the request into a <em>patch</em>, shows you the code and the
  access it asks for, and installs it into your browser.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#what-works-today">What works today</a> ·
  <a href="#security-model">Security model</a> ·
  <a href="#current-limitations">Limitations</a>
</p>

<p align="center">
  <img alt="Concept animation of Patcher turning a prompt into an installed patch" src="assets/demo.gif" width="800">
</p>

<p align="center">
  <sub>Design concept — not a screen recording.</sub>
</p>

> [!NOTE]
> Patcher is in active development. The desktop browser is an alpha for **macOS
> on Apple Silicon**, and it is not signed with an Apple Developer ID, so the
> first launch needs one explicit approval. See [Install](#install).

## Patch the web around you

- **Modify websites** — remove distractions, restyle a page you stare at all
  day, add actions to a site's own UI.
- **Modify the browser** — add sidebars, toolbar controls, context-menu entries,
  new-tab sections and omnibox providers.
- **Automate workflows** — persistent jobs that run on demand or on a schedule,
  driving your real logged-in browser.
- **Edit everything again** — inspect, change, disable or remove any patch it
  wrote for you.

A **patch** is a Patcher plugin created or modified for you by a coding agent.
Inside the architecture they are plugins, with a documented contract you can
write by hand; in the product you ask for a patch.

## How patches work

```text
Prompt  →  Code  →  Permissions  →  Installed
```

1. A coding agent scaffolds or edits a plugin against Patcher's plugin SDK.
2. You review the generated code in the thread's diff, like any other change an
   agent makes.
3. When the agent asks to install it, Patcher shows the declared permissions and
   site scopes for approval — that prompt carries the declaration, not the diff.
4. You allow or refuse. The patch then persists across restarts, and can be
   edited, disabled or removed later.

That approval is a consent and audit boundary, not a sandbox — see
[Security model](#security-model).

Patcher uses the coding-agent CLI you already have authenticated — Claude Code,
Codex, Cursor, Pi, OpenCode, Grok Build, Hermes, or any ACP-compatible agent.

## What works today

**Browser**

- Persistent Chromium tabs and browsing sessions, surviving restarts
- Omnibox with history-backed ranking, and pluggable search engines
- Real `window.open` popups, so OAuth and payment flows complete
- History, downloads, find-in-page, zoom, PDF viewing and reading
- Chromium's own DevTools, with **Inspect** in the page context menu
- Tab context menu: duplicate, pin, mute, close, reopen, drag to reorder
- Prompts for HTTP basic auth, certificate errors and client certificates

**Patches**

- Toolbar items, panels, context-menu and tab-menu entries, new-tab widgets
- Page scripts and page styles, scoped to the sites the patch declared
- Cron schedules and long-lived background services
- Per-patch SQLite storage, settings, and agent tools
- Declared permissions and site scopes, printed by the CLI and by every prompt

**Agents**

- Agent control over the live browser — tabs, navigation, page reads, interaction
- Threads you can follow live, steer, or hand off to another provider
- A consent prompt before any agent-requested patch install, update or removal

The plugin contract is documented in
[`docs/architecture/`](docs/architecture) — start with
[browser-surface.md](docs/architecture/browser-surface.md) and
[plugin-permissions.md](docs/architecture/plugin-permissions.md).

## Install

Patcher has two halves, and right now they install differently.

### The desktop browser

**[Download the alpha](https://github.com/laruss/patcher-browser/releases)** —
a `.dmg` for **macOS on Apple Silicon**, currently `0.1.1-alpha.1`. Open it and
drag Patcher to Applications. Alphas are published as prereleases, so GitHub's
"latest release" link skips them — the releases page itself is the list.

The build is ad-hoc signed rather than signed with an Apple Developer ID, so
macOS refuses it on your word alone the first time. Open Patcher, then go to
**System Settings → Privacy & Security**, scroll to Security, and choose **Open
Anyway**. Later launches ask nothing. The release notes carry the same steps and
a terminal equivalent.

Alpha builds do not update themselves — check the releases page for a newer one.

To run it from source instead:

```bash
git clone https://github.com/laruss/patcher-browser
cd patcher-browser
bun install
bun run dev:desktop
```

Needs [Bun](https://bun.sh) 1.3.14+, the Node version in `.nvmrc`, and an
authenticated agent CLI. Full prerequisites and a packaged local build are in
[docs/installation.md](docs/installation.md).

### The agent runtime and web app

```bash
npx patcher-app@latest
```

That starts the server and host daemon and serves the web app on
`http://localhost:38986`, on macOS and Linux. **It does not include the
browser** — it gives you threads, projects, patch management and the `patcher`
CLI. See [`packages/patcher-app/README.md`](./packages/patcher-app/README.md).

## Security model

Patcher is experimental software that runs code an agent wrote.

- Agent-requested patch changes made through Patcher's normal CLI path pause for
  your confirmation, and the prompt shows the declared permissions and sites.
- **That is a consent and audit boundary, not a sandbox against malicious code.**
  The local API is unauthenticated and patch backends are not isolated, so the
  gate records and slows a decision rather than enforcing it.
- Browser access operates on your real authenticated sessions.
- **Patch backends are not sandboxed yet** and may execute local Node.js code
  with the server process's own privileges.
- The local API binds to loopback, which is the only thing standing in for the
  authentication it does not have.
- Install only patches you understand and trust.

The reasoning, the exits a patch can still take, and the telemetry position
(currently: none is sent) are in [docs/security.md](docs/security.md).

## Current limitations

- **The browser is macOS arm64 only**, and its download is an alpha.
- **Not notarized.** With no Apple Developer ID, the build is ad-hoc signed:
  Gatekeeper refuses it until you allow it once, and it cannot update itself,
  because `electron-updater` installs only a Developer ID-signed update.
- **Patches are not isolated.** Process isolation is planned work, not shipped.
- **Not a Chrome extension host.** Chrome extension compatibility is out of
  scope for now.
- **Missing browser features:** no user-facing print, no spellcheck suggestions,
  no audio indicator on a tab playing on its own, and no download progress or
  pause/resume.
- **No prompt for a site's permission requests.** A page asking for camera,
  microphone, geolocation, notifications or MIDI is refused outright rather than
  put to you; only sanitized clipboard writes and fullscreen are allowed. This
  is about what _websites_ may ask for, and is unrelated to the permissions a
  patch declares.
- **Linux and WSL2 are unverified** for the runtime, and need a C++ toolchain to
  install at all.

The full list, with the reasoning and what is decided versus merely unbuilt, is
[browser-gaps.md](docs/architecture/browser-gaps.md).

## Example patches

Things the contract already supports end to end:

- _"Strip the sidebar from this docs site and widen the article column."_ — a
  page style scoped to one site.
- _"Add a toolbar button that saves the current page to a reading list, and put
  the list on my new-tab screen."_ — a toolbar item, per-patch storage, a
  new-tab widget.
- _"When I'm on a GitHub pull request, show me a panel summarizing it."_ — a
  panel with a URL match, plus an agent tool.
- _"Every weekday at 9, check our dashboards and open anything that's red."_ — a
  cron schedule driving the browser.
- _"Make our internal wiki searchable from the address bar."_ — an omnibox
  provider or a search engine.

Bundled plugins under [`plugins/`](plugins) and
[`examples/plugins/`](examples/plugins) are working references.

## Built on bb

Patcher is a fork of [bb](https://github.com/get-bb/bb) by Michael Yong, built on
its open-source agent infrastructure, and keeps its MIT license.

Patcher develops an independent browser-first product, plugin contract,
application identity and release lifecycle. It has its own data directory, ports
and package names, and it neither reads nor migrates the state of a bb install —
the two can be installed side by side.

## Development

```bash
bun install
bun run dev          # web app + server
bun run dev:desktop  # the same dev server inside the Electron browser
bun run test
```

[docs/development.md](docs/development.md) covers the dev loop, what hot reloads
and what does not, per-checkout data directories and ports, Storybook, and
reaching a dev instance from another machine.

Before changing contracts, dependencies or packaging, read [AGENTS.md](AGENTS.md)
and [the migration map](docs/architecture/bb-migration.md): this repository
carries inherited invariants a passing build does not protect.

## Troubleshooting

Common failures — `Could not locate the bindings file`, `not found: make` on
Linux, npm refusing to install on Windows, `debugger-unavailable` on a tab with
DevTools open — are in
[docs/troubleshooting.md](docs/troubleshooting.md).

## Further reading

- [`docs/architecture/`](docs/architecture) — the browser surface, the plugin
  contract, permissions, and the transport between them
- [Migration map](docs/architecture/bb-migration.md) — what this fork inherited,
  and the contracts that must survive changing it
- [Project plan](docs/PROJECT_PLAN.md) and [TODO](docs/TODO.md)
- [Lifecycle diagrams](docs/lifecycle-diagrams.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
