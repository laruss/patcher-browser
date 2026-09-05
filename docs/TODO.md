# TODO

Work that is **deliberately not done**, with the reason, so nobody has to
re-derive it — and so nothing here reads as an oversight. Anything that is simply
next lives in [PROJECT_PLAN.md](PROJECT_PLAN.md); anything that will never be
done lives in its §19 Non-Goals.

## The test that sorts this list

**Can a plugin close this gap today?**

- **Yes** → it is an example plugin, not core work. Building it in the core spends
  the demonstration the MVP exists to make ("the browser can be extended through
  coding-agent-generated plugins").
- **No, for a structural reason** → the core does it, in the plugin-shaped way
  where the structure allows.

That test is what deferred bookmarks and what reshaped the search engine into a
declared plugin point rather than a setting — see
[architecture/browser-gaps.md](architecture/browser-gaps.md) for both arguments in
full.

## First — the account, the keychain, and the machine's own locks

The top of the list, ahead of everything below it, and one story rather than
three: signing in to a site is the thing a browser does that nothing else can do
for the user, and it is the thing this browser currently does worst. Every entry
here was measured against Electron 41.7.0 on this machine rather than assumed —
what the shell can reach, what a browsed page can reach, and where those two
disagree.

Reading order is the order in which they block each other.

- **A password manager.** Reverses a Non-Goal, deliberately:
  [PROJECT_PLAN.md](PROJECT_PLAN.md) §19 rules out a _sophisticated_ one, and that
  still stands — no sync, no sharing, no breach monitoring. What is missing is the plain thing. Patcher prompts for **HTTP
  authentication** today and lets a plugin answer one
  (`patcher.browser.registerAuthProvider`), which is the rare case; a **form login**,
  which is nearly every case, has nowhere to be saved from, nothing to fill it,
  and no "save this password?" at all. Chromium's own manager is not in Electron,
  so it is not a switch to flip.

  The sorting test now answers differently than it would have last week: after
  Phase 9 Stage B a plugin **can** fill a form, on sites it declared. What a
  plugin cannot do is keep the secret safely (see the next item), require a
  fingerprint to release it (the one after), or be granted "every site the user
  has an account on" in a way a person can meaningfully consent to (the last).
  So the core owes three capabilities, and the manager itself can then be a
  plugin — which is also how it stays out of the way of somebody who wants 1Password
  instead.

- **A keychain-backed secret store for the server side.** Present-tense
  weakness, not a feature: every plugin secret — an API token, a cookie a plugin
  saved, whatever a credential plugin would hold — is written by
  `@patcher/secret-storage` as a **plaintext file with `0600` permissions**
  (`packages/secret-storage/src/secret-file.ts`). Any process running as the user
  reads it, and so does anyone who gets a copy of the data directory: a backup, a
  synced folder, a laptop without FileVault.

  The desktop shell already does this properly for its own Connect credential —
  `safeStorage`, backed by the OS keychain, measured available here
  (`isEncryptionAvailable() === true`), with a documented no-op fallback when the
  OS offers no backend (`apps/desktop/src/connect-credential-cache.ts`). The
  structural reason it stops there: `safeStorage` is an **Electron** API and the
  plugin host is a plain Node process that may be running with no shell at all.
  Closing this means either handing the server a keychain capability over the
  desktop bridge, or accepting that secrets are only encrypted at rest when a
  shell is attached — and saying which, in writing, before anything stores a
  password.

- **The machine's own locks: Touch ID, and a keyboard nobody else can read.**
  Both measured present and both unused today:
  - `systemPreferences.canPromptTouchID()` → **true**, and `promptTouchID` is
    there. So "release this password" / "unlock the vault" / "approve this agent
    action" can cost a fingerprint rather than nothing. What has to be decided is
    what a _failed_ or _unavailable_ prompt means — a fallback nobody thought about
    is how a biometric gate becomes theatre.
  - `app.setSecureKeyboardEntryEnabled` → present. Chrome turns this on while a
    password field has focus, which stops other processes on the machine from
    logging the keystrokes. Patcher never turns it on. Cheap, and the shell already
    knows when a page's focused field is a password one.

- **Passkeys, and the way the page hangs without them.** The measurement that
  worries me most. In a browsed page, on a secure origin: `PublicKeyCredential`
  and `navigator.credentials` **exist**, and
  `isConditionalMediationAvailable()` answers **true** — so a site is told
  WebAuthn is available — while
  `isUserVerifyingPlatformAuthenticatorAvailable()` answers **false**: there is
  no platform authenticator, because Electron does not ship Chrome's macOS one.
  The Secure Enclave is reachable from the _shell_ (Touch ID, above) and not from
  a _page_.

  Worse than unsupported: `navigator.credentials.create()` asking for a platform
  authenticator **never settles** — no resolve, no reject, and the `timeout` in
  the request is not honoured. A login page that leads with a passkey therefore
  sits forever instead of falling back to a password, and the user sees a browser
  that is broken rather than one that is limited. Whatever the eventual answer
  (a real platform authenticator, or intercepting the ceremony and refusing it
  honestly so the site's fallback runs), the refusal is the part that cannot
  wait.

- **A per-site grant the user makes at runtime.** `patcher.sites` is declared in the
  manifest, and that is exactly right for "declutter GitHub". It is the wrong
  shape for a credential filler, which legitimately needs every site the user has
  an account on — and `["https://**/**"]` in a manifest is a disclosure that says
  nothing while granting everything: code in every page the user ever opens.

  What is missing is the other kind of grant: the user, standing on a page,
  saying "use it here", stored per site and revocable, with the manifest list
  staying the ceiling rather than the whole answer. Everything the current model
  rests on stays — membership not containment, refuse at the earliest place — but
  the answer to _where_ stops being frozen at install time. This is the
  prerequisite for the password manager being a plugin rather than core code, and
  it is why it is listed last here and blocks the first item.

  Related and no longer cosmetic: **the app shows no plugin permissions** (below).
  A runtime grant is a UI that does not exist yet, in a surface that renders none
  of this today.

## A plugin could own these — and now nothing is in the way

Each of these is a whole feature a plugin can store, act on and search
(`patcher.storage.database`, tab and page menu entries, an omnibox provider, a
site-info section, its own panel). What they used to be missing was a place in Patcher's
chrome; as of 2026-08-19 they have all three:

- a **star in the address bar** — `patcher.browser.registerToolbarItem`, with the
  per-page state a star needs;
- a section on the **new-tab screen** — `patcher.browser.registerNewTabWidget`;
- **a chord of their own** — `patcher.ui.registerCommand`.

See [architecture/browser-surface.md](architecture/browser-surface.md) for all
three.

- ~~**Bookmarks.**~~ **Done as an example**, which is where the sorting test put
  it: `examples/plugins/bookmarks` — the star, the new-tab list, `Cmd+D`, an
  omnibox provider and its own SQLite, with no core change.
- **Read-later, per-site notes, link collections.** Nothing is in the way; each is
  the bookmarks example with a different table. They stay unbuilt because one
  worked example makes the point and three would be three copies of it.

**Nothing here is waiting on core work any more.** What is left in this file is
either a screen Patcher has not drawn (below) or a decision nobody has needed yet.

## Core-only, cheap

- **A history page** — per-day view, search UI, bulk delete. The API and the store
  are done ([architecture/browser-history.md](architecture/browser-history.md));
  this is a screen.
- **Download progress**, and a download list that survives a restart
  ([architecture/browser-downloads.md](architecture/browser-downloads.md)).
- **Clear browsing data** — history has a delete API, cookies have one through
  `page.storage`; there is no UI that spends them.
- **"Close others" / "Close to the right"** on the tab menu.
- **Spellcheck suggestions** in the page's context menu (underlining already
  works — it is Chromium's).

## Core-only, structural

- **The browser level does not reach a plugin running in its own process.**
  `browserExternalAccess` is charged on commands issued on the caller's own
  async stack — every built-in plugin, so all of `patcher browser` — and an
  installed plugin's browser call is charged on a channel message in a fresh
  async context, where the scope does not reach. Measured, and pinned by a test
  in `browser-external-access-route.test.ts` so it stays a known limit. It means
  a third-party plugin with browser permissions and a CLI command of its own is
  a door the setting does not close, which every user-facing description of the
  setting now says. Two ways to close it, and the second is the right one: a
  per-plugin "an outside CLI call is in flight" flag read by
  `chargeBrowserCommand`, which is small and gets the concurrency case wrong in
  the direction of a wrong refusal; or carrying the scope over the plugin
  channel, so the plugin process holds it for the invocation and the host reads
  it back off the frame — a wire change, and the one that is actually correct.
  The narrower credential this used to wait on now exists
  ([architecture/browser-external-access.md](architecture/browser-external-access.md)),
  so the second of those is the next thing to do here: with a grant reaching two
  routes, an installed plugin's own CLI command is the remaining way its holder's
  machine gets browser access nobody charged.
- **The "who is driving" indicator is only in the browser chrome.**
  `browser-command-request` now carries an `issuer`
  ([architecture/browser-external-access.md](architecture/browser-external-access.md)),
  and the browser surface draws a row naming the grant, the turn, or a bare
  "outside" while commands are arriving. What it does not cover: a person
  reading a thread in another window sees nothing, because the row lives in a
  surface they do not have open. A window-level signal — the title bar, the tab
  strip, a tray item — is the piece that would fix that, and it is a different
  surface rather than a bigger version of this one.
- **A plugin in its own process drives the browser anonymously.** The `issuer`
  rides an `AsyncLocalStorage`, which does not cross the plugin channel, so a
  third-party plugin's browser command reaches the window with no caller on it
  and the chrome says nothing — whoever asked for it. It is the same gap as the
  access level's, one door seen from two sides, and the same fix closes both:
  carry the caller over the channel keyed by the host's own in-flight call,
  never by anything the plugin says about itself.
- **The indicator says who, not what.** A grant's name and level, and nothing
  about the command: no URL, no selector, no count of what was read. The trace
  recorder (`patcher browser trace-start`) already records exactly that and is
  not wired to it, and the scope sketch calls an automatic trace for outside
  callers the optional half of this. Worth doing when somebody wants to answer
  "what did it do" rather than "is something happening".
- **Revoking or pausing a browser access grant does not undo what it set up.**
  The credential stops at the next request
  ([architecture/browser-external-access.md](architecture/browser-external-access.md)),
  and a network mock (`route`), an offline session (`network-state-set`), a
  trace or a video the holder started keep running until the tab is closed —
  they live on the `BrowserViewEntry` in the shell, not on the caller. The
  caller is now _on_ the wire, which is what the first of the two ways needed:
  clear grant-installed routes and stop grant-started recordings when the grant
  stops. The other way is to say it in the copy, which is what the docs do
  today.
- **Grants outlive the key they were derived from, in the list only.** If the
  app key file is lost the server writes a new one, every credential stops
  verifying — the refusal is correct and says the grant is not this install's —
  but the list still shows the rows un-revoked and Settings still says they last
  until you revoke them. A key fingerprint on the row would let the list mark
  them; nobody has hit this outside a deliberate test.
- **An audio indicator** — "this tab is making noise" is Chromium's observation,
  and the shell would have to report it. Muting is done; the indicator is not
  ([architecture/browser-surface.md](architecture/browser-surface.md)).
- **A per-origin favicon store.** Icons are keyed by _tab id_ and session-scoped,
  so no list of _addresses_ — history, bookmarks, the omnibox — can show one.
- **Frecency ranking.** `visit_count` is stored and unused; the omnibox ranks by
  match and recency only.
- **Dragging a tab between windows.** Reordering within a strip is done; moving a
  tab across windows means moving its `WebContentsView` between hosts.
- **Session restore fidelity.** A restart brings back URLs; scroll position and
  form state come back only for a tab reopened within the session (the shell holds
  Chromium's `pageState` in memory).
- **Per-site permission toggles and a cookie count** in the site panel. Patcher's
  permission policy is fixed in the shell, so there is nothing per-site to toggle
  yet.
- **Opening another app from a link.** `spotify:`, `zoommtg:`, `vscode:`,
  `itms-apps:` — a page hands one of these to the browser expecting the OS to
  take it, and Chrome asks "Open Spotify?" and remembers the answer. Patcher does
  nothing visible at all: top-level navigation is `http(s)`-only
  (`isAllowedBrowserUrl` in `desktop-browser-policy.ts`, which treats every other
  scheme as hostile), and the `will-navigate` / `will-frame-navigate` guards
  `preventDefault()` without saying so, so the page sits there and reads as
  broken. The hand-off itself is not the missing part — `shell.openExternal` is
  already wired for "open in the system browser". The consent around it is: the
  URL comes from the page, so it needs a prompt that names what is about to open,
  a remembered per-scheme answer so a second click is not a second prompt, and an
  allowlist narrow enough that `file:` and `javascript:` never reach the OS
  through it. Open question: Chrome knows whether a handler is installed before
  it asks, and Electron exposes no Launch Services binding, so Patcher either
  prompts optimistically and reports the failure, or grows a small native probe.
- **Incognito and profiles.** One fixed `persist:patcher-browser` partition.
- **Picture-in-picture and media keys**; **DRM will not play** at all (no Widevine
  in Electron).
- **One overlay owner per window.** Freezing the page for a panel is owned in two
  places today — the surface (tab menu, tab switcher) and the chrome (downloads,
  site panel) — so two panels open at once could thaw each other's page. Unlikely
  in practice because each closes the other, documented rather than fixed.
- **Streaming HTTP across the plugin boundary.** Deferred on purpose; a plugin's
  route buffers its response.
- **Permissions the user grants, rather than the plugin declaring them.** Today
  `patcher.permissions` is written by whoever wrote the plugin — which, in the case this
  product exists for, is the user's own agent. The install is one all-or-nothing
  yes (and only in the CLI), nothing can be granted in part, and nothing can be
  taken back afterwards short of uninstalling. So "the agent asked for `threads`
  and `filesystem`" is a sentence the user has never actually answered, and a
  plugin that reads more of their data than they expected — by accident as easily
  as by design — is inside what Patcher currently permits.

  Not higher up this list for a reason that has to be said before anyone builds
  the dialog: **a grant UI over today's mechanism would be theatre.**
  [architecture/plugin-permissions.md](architecture/plugin-permissions.md) states
  the case — a plugin is a Node module with `node:fs`, `child_process` and the
  loopback base URL, so a gate on the `patcher` object stops none of it. Running it out
  of process closed **none** of those three: the child is a Node process like any
  other and is handed `loopbackBaseUrl` as soon as the server binds
  (`plugin-child-runtime.ts`). What that move bought was crash and memory
  isolation, which is worth having and is not this. Asking
  somebody to deny a capability the code can take anyway is worse than not asking:
  it manufactures a belief that is not true. The order is therefore **enforceable
  first, then consented** — which is also why this is one item and not two.

  What is cheap and honest before any of that exists is the **record**: the gate is
  two chokepoints (`callBrowser` and the `patcher.sdk` wrapper), so "what has this
  plugin actually reached" is collectable today, and it describes behaviour instead
  of promising containment. Three questions the design has to answer when it is
  time: which permissions are worth asking about at all (a dialog listing twenty is
  a list nobody reads, and `newTab.register` is not `filesystem`); when to ask —
  install time has no context, first use has no user present when the caller is a
  background service; and where the answer lives, including what revoking one does
  to a plugin that is running, which is a failure its author has never had to
  handle.

- **The plugin pages show no plugin permissions.** The CLI prints
  `patcher.permissions` and `patcher.sites` before an install and `patcher plugin info`
  lists them, and the consent prompt an agent's plugin change raises now shows
  both at the moment they decide something — but the app's own plugin list and
  detail pages still render neither, so a plugin the user installs through the
  app's dialog, or one they are merely looking at, discloses nothing. `sites` is
  the one whose scope only the reader can judge: it scopes two permissions, one
  of which runs the plugin's code in those pages. `InstalledPlugin` carries both
  on the wire already; what is missing is the surface.
- **A page script cannot reach a subframe.** Same limit as a page style, and for a
  different reason: a session preload does not run in subframes unless the browsing
  session opts into `nodeIntegrationInSubFrames`, which is experimental and would
  change every browsed page rather than the matching ones. Measured, documented in
  [browser-surface.md](architecture/browser-surface.md), and left alone until
  something real needs it.
- **A page script registered while a page is open runs on the next load.** Preloads
  are read as a document is created, so installing a plugin does not retro-inject
  into the tab in front of the user. Chrome behaves the same way; the alternative is
  reloading somebody's pages for them. Worth revisiting only with a way to inject
  into a live document that does not also mean a preload in every page.

- **Content blocking has no contribution point, and the firewall it needs is
  already running.** The shell wires a session-wide
  `webRequest.onBeforeRequest` over every browsed view, deciding each request
  through one pure predicate (`shouldBlockBrowserRequest` in
  `desktop-browser-policy.ts`) — synchronous, before the request leaves, across
  subresources, `fetch`/XHR, iframes and WebSockets, with no debugger attached.
  That is everything a network-level blocker needs and everything the page
  surfaces cannot do, and no plugin API reaches it. So "hide ads with a page
  style" works today and "block them" is unavailable, which reads as a browser
  limitation and is not one.

  `control.route` is not the answer and should be refused as one: per tab,
  imperative, alive only as long as that tab's debugger session, refused while
  DevTools holds the tab, capped, and with no navigation event to reattach on. A
  blocker built on it works in a demo and is gone by the next reload.

  Three things have to be decided, and the second is the interesting one.

  **It has to be data, not a callback.** The hook is synchronous and plugins may
  run out of process, so nothing can await a plugin inside it. Rules must be
  pushed into the shell the way page styles already are
  (`PATCHER_DESKTOP_BROWSER_SET_PAGE_STYLES_CHANNEL` → a module array, capped at
  64). That rules out anything dynamic and is fine for a rule list.

  **Blocking is a weaker ask than reading, and nothing in the permission model
  says so yet.** `patcher.sites` answers _where the plugin's code runs_; a rule list
  answers _which request targets to refuse_, which is a different question with a
  different risk. A plugin that hands over patterns gets no callback and never
  sees a request — it is data, not a program, so it can cost far less than
  `pageScript.register`. The dangerous shape is the _observing_ one, a callback
  per request, which is a standing read of every URL the user opens and should
  stay unavailable. Conflating the two is probably why neither exists.

  **The matcher would have to be indexed.** `matchesBrowserUrlPattern` compiles a
  fresh `RegExp` per call with no cache, and `patcher.sites` caps at 32 patterns —
  fine for "which sites may this plugin restyle", useless for a real rule list of
  tens of thousands. Every request would pay for every rule. Bucketing by host
  before matching is the work, and it is the only part of this that is not
  design.

  Cosmetics stay necessary either way: a cancelled request leaves a hole in the
  layout, so hiding and blocking are complements, not alternatives. The one thing
  blocking reaches that styles never will is the iframe — the firewall sees every
  frame, while a page style and a page script see only the main one.

- **There is no page without a tab — no hidden window.** A plugin that wants to
  read a site the user is not looking at has nowhere to put it. Every page this
  app loads belongs to a browser-surface tab, and a tab is a row in the strip:
  `tabs.open` writes `browserSurfaceTabsAtom`, which is what the strip renders
  and is an `atomWithStorage`, so a tab a schedule opens is visible **and
  survives a restart**. `activate: false` buys inactivity, not invisibility, and
  it does not even load — only the active tab's `WebContentsView` is ever created
  (`BrowserTabDeck.selectActiveBrowserTab`). So a cron can create a tab it can
  never read, sitting in the user's strip until they click it. `window.open`
  popups are no exception: they become ordinary tabs.

  What is missing is the other shape — a `BrowserWindow` that is never shown (or
  an offscreen `webContents`), addressed by the plugin API rather than by the
  strip. The three `show: false` sites in the shell today are all "create, then
  show when ready" for real windows and dialogs; nothing here stays hidden.

  **Measured**, because it decides whether the shape is worth anything (Electron
  41.7.0 / Chrome 146, a `WebContentsView` with this repo's own
  `webPreferences`, `setVisible(false)`):

  |                         | visible | hidden 4s | hidden 30s | hidden 5.5min |
  | ----------------------- | ------- | --------- | ---------- | ------------- |
  | `visibilityState`       | visible | hidden    | hidden     | hidden        |
  | `setInterval(10ms)`     | 100/s   | 1/s       | 1/s        | ~0/s          |
  | `requestAnimationFrame` | 120/s   | 0         | 0          | 0             |
  | pushed network events   | 10/s    | 9.8/s     | 9.8/s      | 9.8/s         |

  So a hidden page is **not frozen**: network-driven callbacks keep arriving at
  full rate indefinitely, which is what a chat or feed watcher actually runs on.
  What dies is everything clock-driven — timers throttled to 1/s at once, and by
  5.5 minutes below what a 4s sample can see (consistent with Chromium's 1/min
  intensive throttling; the window is too short to tell 1/min from 0). rAF stops
  outright, and pixel reads go with it: `capturePage` needs a visible view, which
  is why `captureAndHide` and `setOverlay` both snapshot _before_ hiding.
  `backgroundThrottling: false` removes all of it — timers stay at 100/s and the
  page keeps reporting `visibilityState: "visible"` while hidden.

  Which is where the real cost is, and it is not the throttling. A hidden page is
  a full renderer process holding the user's real session, with no strip row, no
  favicon and no padlock — nothing on screen that says it exists, and the reason
  the deck is lazy in the first place was to avoid quietly resurrecting a batch
  of them from stale URLs. Open questions before any of it: what tells the user
  such a page is running and lets them end it; what the ceiling is and what
  happens at it; whether it is one permission or an extension of `sites`; and
  whether `backgroundThrottling: false` is the plugin's choice or the host's,
  given a page that cannot tell it is hidden also cannot pause itself politely.

## Installing it at all — Linux

- **`npx patcher-app` fails silently on Linux.** Measured on stock Ubuntu 24.04
  x86_64 under WSL2, Node 22.20.0, empty npm cache: exit 1, nothing at all on
  stdout, and a stderr holding three deprecation warnings and no cause.
  `npm install patcher-app` in the same shell is loud about the same failure, so
  the information exists and `npm exec` drops it. The failure itself is
  `node-pty`: its install step is `node scripts/prebuild.js || node-gyp rebuild`,
  its tarball carries prebuilds for `darwin-arm64`, `darwin-x64`, `win32-arm64`
  and `win32-x64` and none for Linux, so the first half reports that
  `prebuilds/linux-x64` does not exist and the second dies on `not found: make`.
  npm then rolls the tree back, which leaves no `node_modules` to inspect and no
  `patcher` binary — a reader who follows the README gets silence and an empty
  directory. `better-sqlite3` is not involved; `prebuild-install` finds its
  linux-x64 build. The package's `os` field claims `darwin` and `linux`, so npm
  never warns anyone off either. Three ways out, none free: vendor a Linux
  prebuild for `node-pty`, which means building and hosting one per ABI; narrow
  `os` to `darwin`, which at least fails loudly with `EBADPLATFORM` and gives up
  Linux honestly; or leave it to documentation, which is where it stands — both
  READMEs now name `build-essential` as a Linux prerequisite. Untested either
  way: whether Patcher runs on Linux once the toolchain is there has not been
  measured.

## Flaky, and known to be

- **A Tiptap timer outliving its test.** `apps/app` once failed a root
  `bun run test` with all 3076 tests passing and one error _outside_ them: a
  timer inside `@tiptap/react` (dist/index.js:497) fired after vitest had torn
  the file's environment down, which is enough to exit 1. Blamed on
  `src/components/promptbox/PromptBoxInternal.test.tsx`, which is where the
  editor is mounted, but the file passes on its own — measured three times, 85
  tests, clean. It did not reproduce afterwards: the app suite alone is green,
  and so is a full `--force` root run with nothing cached (54/54). The root
  script is `turbo run test --concurrency=2`, so the suite there shares the
  machine with another package, which is the difference between the run that
  failed and every run that has not. If it comes back, the fix is on our side of
  the seam — destroy the editor in the test's own teardown rather than leaving it
  to `cleanup()` — not a retry.

## Deliberately not for the browser at all

- **Agent tools** wrapping the browser commands added for plugins (`page.zoom`,
  `tabs.pin`/`mute`/`duplicate`/`move`). The plugin API is what asked for them; an
  agent that needs them can go through a plugin.
- Everything in [PROJECT_PLAN.md](PROJECT_PLAN.md) §19 — a Chrome replacement, a
  Chromium fork, sync, every browser setting. **Except** the password manager,
  which moved to the top of this file: §19 rules out a _sophisticated_ one and
  that still holds, but "no way to sign in to a site" turned out to be a hole
  rather than a scope boundary.
