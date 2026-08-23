# Plugin manifest, packaging, and distribution

Everything `package.json` declares, what `patcher plugin build` emits, how engine
ranges and updates are enforced, and how users install a plugin.

The complete manifest, with the optional fields SKILL.md leaves out:

```json
{
  "name": "patcher-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "engines": { "patcher": ">=0.9", "patcherPluginSdk": "^1.0.0" },
  "patcher": {
    "name": "Hello",
    "description": "A friendly example plugin.",
    "branding": { "icon": "Zap" },
    "server": "./server.ts",
    "app": "./app.tsx",
    "permissions": ["tabs.read", "threads"],
    "sites": ["https://github.com/**"],
    "skills": ["skills"]
  }
}
```

- `patcher.server` (required) — backend entry. Path installs load it as
  TypeScript directly (no build step); `patcher plugin build` also emits a
  self-contained `dist/server.js` + `server.meta.json` that git/npm installs
  prefer when its SDK major matches, so consumers never need npm or
  node_modules. `patcher.app` (optional) — frontend entry compiled by
  `patcher plugin build` into `dist/app.js` + `app.css` + `app.meta.json`; path
  and git installs build it automatically at install time. Git installs also
  run `npm install --omit=dev` first (so a git plugin may use third-party
  packages) and keep node_modules, since bundling cannot inline data files read
  at runtime. So every package your source imports that Patcher does not shim
  belongs in `dependencies`: a build-required package left in
  `devDependencies` makes the plugin uninstallable from git, and unbuildable
  after any install that omits dev deps — including the packaged CLI's own,
  which runs npm under `NODE_ENV=production`. `devDependencies` is for types
  and tooling only.
  Installing or updating a git plugin needs `npm` on PATH; checking for
  updates does not, because a check reads the manifest and never builds. Path
  installs build from dependencies you have already installed.
- Building yourself (CI, or verifying a build without a running Patcher): add
  `patcher-app` to `devDependencies` and set `"build": "patcher plugin build"`.
  `patcher plugin build` needs no server, and depending on `patcher-app@X` builds
  against exactly that release's shim configuration. Patcher downloads its build
  toolchain on first use, so cache `<dataDir>/plugins/toolchain-*` in CI.
- `patcher.permissions` (optional, but **undeclared means denied**) — what this
  plugin may reach through `patcher.browser` and `patcher.sdk`. Absent or `[]` reaches
  nothing gated; the first call to a surface you did not declare throws with
  the permission named, and registering a browser contribution you did not
  declare fails the factory, so the plugin loads in `error`. Add entries as
  you need them, then `patcher plugin reload <id>`. An unknown string is rejected
  at install, so a typo cannot silently grant nothing.

  | Permission              | Opens                                                                                                                                     |
  | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
  | `tabs.read`             | `browser.tabs.list`, `page.url`, `page.title`                                                                                             |
  | `tabs.modify`           | opening, closing, activating tabs, `browser.tabs.pin/mute/duplicate/move`, `browser.navigation.*`                                         |
  | `page.read`             | page text, selection, snapshot, screenshot, PDF, console                                                                                  |
  | `page.interact`         | `page.act`, answering page dialogs, mouse input, `page.zoom`                                                                              |
  | `page.inject`           | `browser.control.evaluate` — arbitrary JavaScript in the page                                                                             |
  | `network.observe`       | the page's network log, including headers                                                                                                 |
  | `network.intercept`     | route mocking, unrouting, forcing a tab offline                                                                                           |
  | `page.credentials`      | `browser.storage.*` — the user's cookies and site storage                                                                                 |
  | `page.record`           | `browser.recording.*` — traces and video                                                                                                  |
  | `omnibox.register`      | `browser.registerOmniboxProvider` (sees everything typed in the address bar)                                                              |
  | `contextMenu.register`  | `browser.registerContextMenuItem` (receives the selection or link clicked)                                                                |
  | `tabMenu.register`      | `browser.registerTabAction` (receives the tab the entry was picked on)                                                                    |
  | `siteInfo.register`     | `browser.registerSiteInfoProvider` (receives the page's address and host)                                                                 |
  | `toolbar.register`      | `browser.registerToolbarItem` (asked about every page the user opens, on navigation)                                                      |
  | `newTab.register`       | `browser.registerNewTabWidget` (a section on the new-tab screen; a new tab has no page)                                                   |
  | `pageStyle.register`    | `browser.registerPageStyle` — CSS in the pages of the sites listed in `patcher.sites`, which this permission is scoped by                 |
  | `pageScript.register`   | `browser.registerPageScript` — the plugin's own code in those same pages, and `patcher.rpc` back to itself; scoped by `patcher.sites` too |
  | `searchEngine.register` | `browser.registerSearchEngine` (a chosen engine receives everything typed in the address bar)                                             |
  | `find.register`         | `browser.registerFindAction` (receives the find query)                                                                                    |
  | `downloads.handle`      | `browser.registerDownloadHandler`                                                                                                         |
  | `auth.provide`          | `browser.registerAuthProvider`                                                                                                            |
  | `pdf.provide`           | `browser.registerPdfTextProvider`                                                                                                         |
  | `externalLink.handle`   | `browser.registerExternalLinkHandler` (every address the user opens from outside Patcher, while Patcher is the default browser)           |
  | `history`               | `browser.registerHistoryFilter` and `sdk.browserHistory` — the browsing history, read and write                                           |
  | `threads`               | `sdk.threads`, `sdk.threadSections`, `sdk.subscribe({event:"thread:changed"})`                                                            |
  | `filesystem`            | `sdk.files`                                                                                                                               |
  | `shell`                 | `sdk.terminals`                                                                                                                           |
  | `workspace`             | `sdk.projects`, `environments`, `hosts`, `providers`, `skills`, `system`, `theme`, `status`, `guide`, and the other `subscribe` feeds     |
  | `plugins`               | `sdk.plugins`                                                                                                                             |

- `patcher.sites` (optional) — which **websites** this plugin's page contributions may
  reach, as URL globs. Not a permission but the _scope_ of two: `pageStyle.register`
  says the plugin restyles pages and `pageScript.register` says it runs code in
  them, while this says which pages. Absent or `[]` reaches none, so a permission
  alone reaches nothing and this alone reaches nothing either.

  ```json
  { "permissions": ["pageScript.register"], "sites": ["https://github.com/**"] }
  ```

  Two permissions over one list on purpose: a plugin the user let restyle a site
  has not thereby been let read it.

  `**` crosses `/`, `*` stops at one, `?` is one non-`/` character; a pattern with
  no wildcard is an exact URL. Write the host in **lower case** — matching is exact
  and a URL never arrives with an upper-case host, so `https://GitHub.com/**` is
  refused at install rather than left to claim nothing. `https` only, except
  loopback over plain http (`http://localhost:5173/**`) — plain http to another machine is refused at
  install, because standing access to a site the user is signed in to is not
  something to hand over a connection anyone on the path can impersonate. An `http`
  pattern with a wildcard in its host is refused for the same reason. At most 32
  patterns, since the list is shown to whoever installs the plugin.

  A `registerPageStyle` call's `matches` must be one of these patterns **verbatim**
  — membership, not containment — so code picks from what the user read and cannot
  widen it. Declare a second pattern rather than trying to broaden one.

  `patcher.sites` is nothing to do with `patcher.sdk.hosts`, which is enrolled
  machines. Frontend `matches` on a leading panel is also unrelated and costs
  nothing: that is Patcher's own chrome reacting to the address bar, not code reaching
  into a page.

  The same list applies to the loopback API, not only to the `patcher.sdk` object:
  your plugin's SDK client identifies itself, so calling
  `patcher.server.loopbackBaseUrl` with `fetch` is checked exactly like the
  equivalent `patcher.sdk` call and answers 403 the same way. Three calls cost more
  than their area suggests, because of what they reach:
  `sdk.environments.archiveThreads` and `sdk.status.get` also need `threads`,
  and `sdk.threadSections.list` also needs `workspace` (it reads a route that
  answers with every project).

  These gate the Patcher API, not the process. A plugin is full-trust code in the
  Patcher server and can still use `node:fs` or spawn a shell. Declaring less does
  not sandbox a plugin — it records what the plugin uses, shows it to whoever
  installs it, and refuses calls it did not ask for. `patcher.log`, `patcher.settings`,
  `patcher.storage`, `patcher.http`, `patcher.rpc`, `patcher.realtime`, `patcher.background`,
  `patcher.cli`, `patcher.agents`, `patcher.ui`, `patcher.events` and
  `patcher.browser.getStatus()` are ungated: they reach the plugin's own resources
  or report only whether a browser window is connected.

  `@patcher/plugin-sdk/testing` enforces the same list, so a suite that exercises
  a surface the manifest omits fails in the test rather than on install — pass
  `pluginPermissionsFromManifest(import.meta.url)` and it reads this file.

- `patcher.skills` (optional) — relocates the auto-imported skills directories
  (default `skills/`; `[]` opts out). Every `skills/<name>/SKILL.md` is
  injected into agent threads as the plugin skills tier.
- `patcher.themes` (optional) — contributes palettes to Settings → Appearance and
  `patcher theme list`. Each entry is
  `{ id, name, description?, css: "./themes/name.css" }`; Patcher namespaces its
  selectable id as `plugin:<plugin-id>:<id>`. Only loaded plugins contribute.
- `patcher.name` and `patcher.description` (required) — non-empty human-facing plugin
  identity. The top-level package `name` remains the package identity and
  source of the plugin id.
- `patcher.branding` (required) — declare `patcher.branding.icon` as either the plugin's
  canonical Patcher icon name, such as `Zap`, or a plugin-relative compact SVG path
  such as `./assets/icon.svg`. Patcher validates and hash-serves path-shaped SVGs,
  then renders them as CSS masks so their shape inherits the surrounding text
  color; SVG colors are ignored. Patcher reuses this icon on roomy surfaces when no
  logo override is declared. Add `logo.light` only for
  intentionally different rich/full-size identity artwork; optional
  `logo.dark` is preferred in dark mode. Logo paths are explicit
  plugin-relative `.svg`, `.png`, or `.webp` files: nulls, empty strings,
  missing/escaping files, unsupported extensions, and a dark logo without a
  light logo fail the manifest. There is no root logo auto-detection. Logo-only
  manifests remain supported for compatibility, so at least an icon or light
  logo is required. Patcher uses a declared logo where space permits, such as roomy
  Settings rows and cards.
  Compact sidebar, menu, action, mention, and panel-title surfaces prefer the
  plugin-owned icon asset, then a named manifest icon, then a contribution's
  local `icon` hint, then Zap. Branding changes are picked up on
  `patcher plugin reload`. Named inline icons use `currentColor`; compact SVG assets
  should contain only the intended transparent glyph shape. Do not duplicate
  the same artwork across `icon` and `logo`; reserve logos for intentionally
  different branded artwork and provide a dark variant when needed.
- `engines.patcher` — optional semver range checked against the Patcher app version.
- `engines.patcherPluginSdk` — optional semver range for the plugin SDK surface
  (currently `1.0.0`; the scaffold writes `"^1.0.0"`). Absent means a legacy
  manifest. Managed (`git:`/`npm:`) installs **refuse** a mismatch against
  the running SDK; path installs surface it as `incompatible` at load.
  Compatible updates (`patcher plugin outdated` / `patcher plugin update`) only select
  candidates that satisfy these ranges; newer incompatible releases are
  reported as blocked rather than applied. Dev builds (Patcher `0.0.0`) skip
  enforcing `engines.patcher` and annotate that on check results.
- **Manual updates:** `patcher plugin outdated` checks tracking sources and
  `patcher plugin update` applies compatible candidates (reinstall of an already
  installed managed plugin is refused). A failed activation **rolls back** to
  the previous state snapshot and records the failure for the user. Keep
  `engines.*` honest and ship load-safe factories so an update never strands
  users.
- `patcher plugin build` stamps authoritative metadata into both
  `dist/server.meta.json` and `dist/app.meta.json`: `sdkMajor`, `sdkVersion`,
  `artifactFormatVersion` (currently `1`), `pluginId`, `pluginVersion`, and
  `builtWith: { patcherVersion, pluginSdkVersion }`. Managed installs reject
  artifacts whose `pluginId`/`pluginVersion` disagree with the package
  manifest, or whose SDK major does not match the host.
- Default to `patcher-plugin-hello` for the package name. Scoped names such as
  `@acme/patcher-plugin-hello` are also supported. The plugin id is the final
  package-name component minus the `patcher-plugin-` prefix, so both forms use
  `hello`; it namespaces routes, storage, settings, and CLI commands. Builtin
  ids such as
  `automations`, `custom-instructions`, `inline-vis`, `secrets`, and `side-chat`
  cannot use a non-`builtin:` source — use `builtin:<name>` instead.

## Distributing a plugin

Users can install third-party plugins directly from a local path, npm package,
or Git repository:

```sh
patcher plugin install ./patcher-plugin-notes
patcher plugin install npm:patcher-plugin-notes@^1.0.0
patcher plugin install https://github.com/acme/patcher-plugin-notes
patcher plugin install git:https://github.com/acme/patcher-plugin-notes.git@main
```

A bare HTTP(S) repository URL tracks its default branch. Use the `git:` form
with an explicit branch, tag, or commit when that tracking intent matters.

Patcher has one maintained set of official plugins; users cannot add third-party
catalogs. Official-plugin inclusion is a Patcher release decision, not part of the
plugin authoring workflow: official plugins ship bundled inside the app itself
and install from that local copy — no network fetch, no separate publish
pipeline.
