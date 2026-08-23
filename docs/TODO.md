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

- **The app shows no plugin permissions.** Nothing in the SPA renders
  `patcher.permissions`, and nothing renders `patcher.sites` either. The CLI prints both
  before an install and `patcher plugin info` lists them, so the agent-authored path
  discloses them — but a plugin installed through the app's own dialog does not,
  and `sites` is the one whose scope only the reader can judge. It now scopes two
  permissions, one of which runs the plugin's code in those pages, which raises what
  the gap costs. `InstalledPlugin` carries it on the wire already; what is missing is
  the surface.
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

## Deliberately not for the browser at all

- **Agent tools** wrapping the browser commands added for plugins (`page.zoom`,
  `tabs.pin`/`mute`/`duplicate`/`move`). The plugin API is what asked for them; an
  agent that needs them can go through a plugin.
- Everything in [PROJECT_PLAN.md](PROJECT_PLAN.md) §19 — a Chrome replacement, a
  Chromium fork, sync, every browser setting. **Except** the password manager,
  which moved to the top of this file: §19 rules out a _sophisticated_ one and
  that still holds, but "no way to sign in to a site" turned out to be a hole
  rather than a scope boundary.
