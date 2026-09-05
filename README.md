<p align="center">
  <img alt="Patcher" src="assets/patcher-icon.png" width="96">
</p>

<h1 align="center">Patcher</h1>

<p align="center">
  <strong>The browser that writes its own extensions.</strong>
</p>

<p align="center">
  Tell your coding agent what you want a website — or the browser itself — to do.
  It builds a Patcher plugin, shows you the generated code and the access it
  asks for, and installs the plugin into your browser.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#what-works-today">What works today</a> ·
  <a href="#security-model">Security model</a> ·
  <a href="#current-limitations">Limitations</a>
</p>

<p align="center">
  <img alt="Concept animation of an agent creating and installing a Patcher plugin" src="assets/demo.gif" width="800">
</p>

<p align="center">
  <sub>Design concept — not a screen recording.</sub>
</p>

> [!NOTE]
> Patcher is in active development. The desktop browser is an alpha for **macOS
> on Apple Silicon**, and it is not signed with an Apple Developer ID, so the
> first launch needs one explicit approval. See [Install](#install).

## Try it

Once you have Patcher ([install](#install)), open a thread and tell your coding
agent, in as many words, to use Patcher:

> **Using Patcher, create and install a browser plugin that shows a summarizing
> sidebar whenever I'm on a GitHub pull request.**

Starting with **"Using Patcher…"** is what points the agent at Patcher's CLI and
plugin system, rather than at writing an unrelated script or project. Saying
"create and install" asks for both halves: the plugin gets written _and_ offered
for installation.

## Make the web work your way

- **Modify websites** — remove distractions, restyle a page you stare at all
  day, add actions to a site's own UI.
- **Modify the browser** — add sidebars, toolbar controls, context-menu entries,
  new-tab sections and omnibox providers.
- **Automate workflows** — persistent jobs that run on demand or on a schedule,
  driving your real logged-in browser.
- **Edit everything again** — inspect, change, disable or remove any generated
  plugin.

## How generated plugins work

```text
Prompt  →  Code  →  Permissions  →  Installed
```

1. In a Patcher thread, you ask the agent to use Patcher and describe the
   browser behaviour you want.
2. The agent scaffolds or edits a plugin against Patcher's plugin SDK.
3. You review the generated code in the thread's diff, like any other change an
   agent makes.
4. When the agent asks to install it, Patcher shows the plugin's declared
   permissions and site scopes — that prompt carries the declaration, not the
   diff.
5. You allow or refuse. An installed plugin persists across restarts, and can be
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

**Plugins**

- Toolbar items, panels, context-menu and tab-menu entries, new-tab widgets
- Page scripts and page styles, scoped to the sites declared by the plugin
- Cron schedules and long-lived background services
- Per-plugin SQLite storage, settings, and agent tools
- Declared permissions and site scopes, shown by the CLI and consent prompt

**Agents**

- Agent control over the live browser — tabs, navigation, page reads, interaction
- Threads you can follow live, steer, or hand off to another provider
- A consent prompt before an agent-requested plugin install, update, removal or
  configuration change

The plugin contract is documented in
[`docs/architecture/`](docs/architecture) — start with
[browser-surface.md](docs/architecture/browser-surface.md) and
[plugin-permissions.md](docs/architecture/plugin-permissions.md).

## Install

Patcher has two halves, and right now they install differently.

### The desktop browser

**[Download the alpha](https://github.com/laruss/patcher-browser/releases)** —
a `.dmg` for **macOS on Apple Silicon**, currently `0.1.1-alpha.3`. Open it and
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
browser** — it gives you threads, projects, plugin management and the `patcher`
CLI. See [`packages/patcher-app/README.md`](./packages/patcher-app/README.md).

## Security model

Patcher is experimental software that runs plugins written by coding agents.

- Agent-requested plugin changes made through Patcher's normal CLI path pause
  for your confirmation, and the prompt shows the declared permissions and
  sites.
- **That is a consent and audit boundary, not a sandbox against malicious code.**
- Browser access operates on your real authenticated sessions. `patcher browser`
  refuses agents outside Patcher — Claude Code, Codex, a script in a terminal —
  until you say otherwise. Two ways to say it, and the narrow one is the
  recommended one: `patcher agent-access grant "Claude Code" --for claude-code`
  hands **one** agent a credential that reaches `patcher browser` and no other
  part of Patcher's API, listed in **Settings → General** where you can pause it
  for now or revoke it for good; the level in
  **Settings → General → Agents outside Patcher** opens it to every process on
  the machine that can read the app key. Both run from reading a page to handing
  over its cookies. While something outside Patcher is driving, a row under the
  browser's toolbar says so — by the name you gave the grant, with a button that
  pauses it. Neither is charged on a plugin you installed, which is charged the
  permissions it declared and drives without that row.
- **A plugin you installed runs in its own process, which is not a sandbox.** It
  has the filesystem, subprocesses and the network, and runs as you — so treat
  installing a plugin as running a local script with your account's privileges.
- The permissions a plugin declares are enforced on every path Patcher owns:
  each browser command is charged on the server's side of the process boundary,
  and the local API refuses a request that does not say who it is. A plugin can
  still read the key off your disk, because nothing sandboxes it.
- The local API binds to loopback, and takes a per-install key that local
  clients read from your data directory.
- Install only plugins you understand and trust.

The reasoning, the exits a plugin can still take, and the telemetry position
(currently: none is sent) are in [docs/security.md](docs/security.md).

## Current limitations

- **The browser is macOS arm64 only**, and its download is an alpha.
- **Not notarized.** With no Apple Developer ID, the build is ad-hoc signed:
  Gatekeeper refuses it until you allow it once, and it cannot update itself,
  because `electron-updater` installs only a Developer ID-signed update.
- **Plugins run in their own process, but are not sandboxed.** The process
  boundary keeps a plugin out of the server's memory and is where the permission
  gate now sits; it does not take away the filesystem, subprocesses or the
  network, so a plugin that goes around Patcher entirely is not stopped.
- **Not a Chrome extension host.** Chrome extension compatibility is out of
  scope for now.
- **Missing browser features:** no user-facing print, no spellcheck suggestions,
  no audio indicator on a tab playing on its own, and no download progress or
  pause/resume.
- **No prompt for a site's permission requests.** A page asking for camera,
  microphone, geolocation, notifications or MIDI is refused outright rather than
  put to you; only sanitized clipboard writes and fullscreen are allowed. This
  is about what _websites_ may ask for, and is unrelated to the permissions a
  plugin declares.
- **Linux and WSL2 need setting up.** A C++ toolchain to install at all, and
  bubblewrap plus unprivileged user namespaces for the sandboxed permission
  modes. CI exercises both on `ubuntu-latest`; nobody has logged a manual pass
  on a Linux desktop, and WSL2 is not in CI at all.
  [Installation](docs/installation.md#supported-platforms) has the commands.

The full list, with the reasoning and what is decided versus merely unbuilt, is
[browser-gaps.md](docs/architecture/browser-gaps.md).

## Example prompts

Copy one into a Patcher thread:

> Using Patcher, create and install a browser plugin that removes the sidebar
> from this documentation site and widens the article column.

> Using Patcher, create and install a browser plugin that adds a toolbar button
> for saving the current page to a reading list and shows that list on the
> new-tab screen.

> Using Patcher, create and install a browser plugin that shows a summarizing
> panel whenever I'm viewing a GitHub pull request.

> Using Patcher, create and install a browser plugin that runs every weekday at
> 9 AM, checks our dashboards, and opens anything that is red.

> Using Patcher, create and install a browser plugin that makes our internal
> wiki searchable from the address bar.

These use plugin capabilities that already work end to end — page styles,
toolbar items and per-plugin storage, panels with a URL match, cron schedules,
and omnibox providers. Bundled plugins under [`plugins/`](plugins) and
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
