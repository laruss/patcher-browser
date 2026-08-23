# Browser Gaps

What a desktop browser does that this one does not, taken at `63cc4fccf` — after
plan §18 Phase 5 and the automation stages in
[browser-automation.md](browser-automation.md).

Every other document here describes what was built and why. This one describes
what is missing, so the next phase can argue with a written list instead of
discovering it one site at a time.

## How this was produced

Direct reading of `apps/desktop/src` — the shell owns nearly every decision
below — and `apps/app/src`, checked against Chrome's own published feature and
shortcut surface. Each entry names where the behaviour is decided in code, or
states that no such code exists: **an absent handler is the finding**, and the
grep that found nothing is the evidence.

Two kinds of gap are kept apart throughout, because they need different
arguments. A **decided** gap has a comment or a document saying so and a reason
behind it; an **unbuilt** gap is simply work nobody has done. Re-opening the
first is a policy discussion. Closing the second is scheduling.

## Tier 1 — dead ends

A user hits these within minutes of real browsing, and every one of them fails
_silently_: no error screen, no toast, no log. That is the common defect, and it
matters more than any single item — a browser that refuses is usable, a browser
that does nothing is broken.

### ~~Downloads are cancelled, and nothing says so~~ — closed

Every download link, "export CSV" button and `Content-Disposition: attachment`
response used to do nothing at all: `will-download` answered `preventDefault()`
with no message anywhere. Downloads now write to the user's downloads folder and
report themselves — see [browser-downloads.md](browser-downloads.md), which also
covers the plugin contribution point that lets a plugin re-home or consume them.

A toolbar button appears once something has been downloaded, listing the ten
most recent with open and show-in-folder on each. What is still missing is
progress, persistence across restarts, and pause/resume — deliberate omissions
rather than oversights, listed in that document's own Next section.

### ~~PDFs are a dead click~~ — closed

The browsed view set no `plugins` preference, so it defaulted off, Chromium's
built-in viewer never loaded, and Chromium fell back to downloading a document
it cannot display — which, while downloads were also denied, meant a PDF link
produced _nothing_.

Both halves are decided now. Downloads work, and `plugins: true` turns the
viewer on, so a PDF opens as a page. The cost was worth stating rather than
inheriting, and it is stated in [browser-surface.md](browser-surface.md): the
viewer admits one more parser of an attacker-supplied format, bounded by
PDFium's own sandboxed process — where the alternative, an OS reader opening
every downloaded PDF, has no sandbox at all.

**Reading** one was the other half, and it is closed too. The viewer's wrapper
frame really is empty, and Chromium hands the text over nowhere — not through
the accessibility tree, which is where it looked most likely to be. So the shell
refetches the document through the browsing session and parses it in a utility
process; the accessibility snapshot still sees only the wrapper, which is the
honest limit, because a PDF has no elements to act on either way. See the PDF
section of [browser-surface.md](browser-surface.md).

### ~~`window.open` flows break~~ — closed

The shell used to deny every popup and hand the URL to the renderer to open as
a tab. For a plain `target="_blank"` link that is exactly right, and it still
works that way — see the popup section of
[browser-surface.md](browser-surface.md), which is where the surface's missing
subscription was fixed.

What it could not serve is a page that **uses the handle it got back**:

- `window.open()` returned `null`, which is precisely how a page detects a popup
  blocker — so OAuth and payment SDKs reported "popup blocked" and stopped,
  rather than continuing into the tab we opened for them;
- the new tab had no `window.opener`, so the `postMessage` handshake an OAuth
  popup completes with could not run;
- `about:blank` popups — the shape a page uses when it opens a window and writes
  into it — were dropped outright, because `isAllowedPublicBrowserPopupUrl`
  requires public `http(s)`.

The practical consequence was that **"Sign in with …" did not work**, on a
browser whose whole point is to be the user's real logged-in session.

Popups are real now for tabs that claim them — Chromium creates the window, the
shell hosts it as a tab, and the page gets the handle, the opener and the
`window.close()` it was always asking for. The security decision was made rather
than avoided, and it is written down in
[browser-surface.md](browser-surface.md): the popup policy and the rate limiter
both survive unchanged, `about:blank` is admitted deliberately and only on this
path, and the hardening rides along because a popup inherits its opener's web
preferences.

Which tabs claim popups is the renderer's declaration, not the shell's guess.
The thread panel claims none — a link there follows the user's in-app-link
preference and may leave for the system browser — so it keeps the older
deny-and-push behaviour, which is also the fallback for anything unclaimed.

### ~~Absent handlers~~ — closed

Each of these was a documented Electron event with no listener anywhere in
`apps/desktop/src`. All five are handled now; see
[browser-surface.md](browser-surface.md) for the policies and what they refuse.

| What the user does                           | Event                                               | What happens now                                                               |
| -------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Loads a page behind HTTP basic auth          | `login`                                             | A prompt naming the host — after any plugin auth provider has been asked first |
| Reaches a self-signed or expired certificate | `certificate-error`                                 | A prompt with the certificate's details and "proceed" behind them              |
| Clicks a video's fullscreen button           | `enter-html-full-screen` / `leave-html-full-screen` | The view takes the whole window and gives it back                              |
| Sits on a page whose renderer dies or hangs  | `render-process-gone` / `unresponsive`              | The error screen that already existed, with its reload button                  |
| Hits a site asking for a client certificate  | `select-client-certificate`                         | A picker, instead of Electron handing over the first certificate in the store  |

The observation that drove this is worth keeping: `did-fail-load` **was**
already handled and already drove an error screen, which is what made the rest
of the table an oversight rather than a policy — the machinery for telling the
user something went wrong existed and these paths did not reach it. Two of them
now reach exactly that machinery rather than growing a second one.

## Tier 2 — unbuilt surfaces

Standard browser functionality with no code behind it. Nothing here is decided
against; it is simply not written. Entries marked **Done** were written since
this list was made and are kept rather than deleted, because what a surface was
missing is part of why it ended up shaped the way it is.

**Page**

| Feature                               | State                                                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find in page (`Cmd+F`)                | **Done** — a find bar in the chrome, plus a plugin contribution point ([browser-surface.md](browser-surface.md))                                                                                               |
| ~~Zoom (`Cmd +/-/0`), per-site zoom~~ | **Done.** The shell scales the browsed view and reports back what Chromium settled on; per-site is Chromium's own memory, which is why the report is needed. `patcher.browser.page.zoom` costs `page.interact` |
| Print (`Cmd+P`)                       | `printToPDF` exists for agents only; no user-facing print                                                                                                                                                      |
| Page context menu                     | **Done** — link, image, selection and navigation entries, plus a plugin contribution point ([browser-surface.md](browser-surface.md))                                                                          |
| View source                           | **Done** — Chromium's own DevTools, opened in the panel ([browser-surface.md](browser-surface.md))                                                                                                             |
| Reading a PDF as text                 | **Done** — refetched through the browsing session and parsed out of process ([browser-surface.md](browser-surface.md))                                                                                         |
| Spellcheck corrections                | Underlining is Chromium's default; the browsed view's menu offers no suggestions                                                                                                                               |

The context menu is now built (open link in new tab or the default browser,
copy link address, copy/save image, search for the selection, back/forward/
reload), and plugins can add entries to it. What is left in that table is zoom,
print and spellcheck suggestions — each blocked on a shell capability rather
than on menu wiring.

**Developer panel** — closed

`Cmd+Alt+I` opens Chromium's own DevTools — Elements, Console, Network,
Sources — in a view the shell owns, with an **Inspect** entry in the page
context menu. See [browser-surface.md](browser-surface.md).

What this entry planned for is worth keeping, because almost none of it was
needed:

- **The panel was going to be built** over the per-tab console and network
  buffers (`entry.consoleLog` / `entry.networkLog`, read through `observe`),
  with their limits written on it: flattened console text, no stack traces, and
  network without bodies. `setDevToolsWebContents` made that unnecessary — the
  panel _is_ DevTools, so it carries none of those limits. The buffers stayed
  where they were useful, as what an agent reads
  ([browser-automation.md](browser-automation.md), Stage C).
- **View source** was the piece with nothing behind it, and the open question
  was which source it means: the live DOM or what the server sent. Real DevTools
  answers both and does not have to choose — Elements is the live DOM, Sources
  and Network are the served bytes.
- **Inspect** was going to need `DOM.getNodeForLocation` and the context menu's
  `x`/`y`. It needs neither: `inspectElement(x, y)` is Chromium's own.

One constraint did survive the change: the panel is **persistent**, open while
browsing, so it cannot use the freeze-and-overlay trick the downloads dropdown
and tab switcher use. It takes layout space and the page shrinks around it —
sharpened, because freezing a page to draw over it would defeat the point of
inspecting a live one.

And the Tier 3 collision predicted here was real and already settled: DevTools
takes the one protocol client per `webContents` that Chromium allows, so a tab
whose tools are open refuses automation with a typed `debugger-unavailable`
rather than failing obscurely.

**Tabs**

~~No tab context menu, no pin / duplicate / mute.~~ Done: right-clicking a tab
offers Duplicate, Pin / Unpin, Mute / Unmute and Close, and both of Phase 8's tab
surfaces arrived with it — plugin **actions** on the menu
(`patcher.browser.registerTabAction`, permission `tabMenu.register`) and plugin
**decorators** on the tabs themselves
(`contentScript.experimental_setBrowserTabStatus`). All three are driveable too
(`tabs.pin`, `tabs.mute`, `tabs.duplicate` under `tabs.modify`). See
[browser-surface.md](browser-surface.md) for the rules that turned out to matter:
pinned tabs are a block rather than a flag, mute lives exactly as long as the
page's `webContents`, and duplicate and mute do not apply to a Patcher screen.

~~Still open: no drag reorder~~ — done: tabs reorder by drag (`@dnd-kit`, as the
thread panel's strip does), and `tabs.move` drives the same reducer for a plugin
or an agent. Still open: no audio indicator for a tab that is playing
on its own — that one needs the shell to report what Chromium noticed, which the
mute channel deliberately does not. Reopening a closed tab is done, with its page
state ([browser-surface.md](browser-surface.md)). Tab overflow is covered: the
strip clips at a width floor rather than scrolling, which is a
[decided](browser-surface.md) trade rather than a gap.

**Keyboard** — mostly closed

The tab chords are in: `Cmd+T`, `Cmd+W`, `Cmd+Shift+T` (restoring history and
scroll, not just the URL), `Cmd+1`–`9`, `Cmd+[` / `Cmd+]`, and `Ctrl+Tab` /
`Ctrl+Shift+Tab` walking **recently used** tabs rather than positions. See
[browser-surface.md](browser-surface.md) for the ordering rule that decides
`Cmd+T` between the browser and the thread panel, and for why the MRU cycle ends
on a timer.

`Cmd+F` is in too, and arrived with the find bar rather than as a binding; so
did `Cmd+Shift+F` with fullscreen and `Cmd+Alt+I` with the developer panel —
see [browser-surface.md](browser-surface.md). The zoom trio is in too, and it
arrived the same way — with the capability rather than as a binding, because a
chord that scales Patcher's own chrome instead of the page is not the binding being
missing. `Cmd+P` is in too, and it needed the same thing — a
user-facing print, not a chord.

**Data**

- **Bookmarks do not exist**, and after a design pass on 2026-08-19 they are
  **deliberately deferred** rather than pending. Not because they are expensive —
  because they are the best available proof of what this browser claims. A plugin
  can already own the whole feature: its own SQLite (`patcher.storage.database`), an
  entry on the tab menu and the page menu to save a page, an omnibox provider to
  get it back, a site-info section for "this page is saved", and a panel for the
  list. Building that in the core would spend the demonstration on the one
  feature that could have made it.

  What a plugin cannot do yet is exactly two named Phase 8 surfaces plus one
  smaller thing: put a **star in the address bar** (toolbar items), put a section
  on the **new-tab screen** (new-tab widgets), and own a chord —
  `patcher.ui.registerKeybinding` rebinds Patcher's _existing_ commands and refuses an
  unknown id (`appCommandIdSchema`). So the order is: those surfaces first,
  bookmarks as an example plugin on top of them. This is only the right call if
  that example actually ships; a plugin nobody installs is not a feature.

- ~~**History is 24 entries of localStorage.**~~ Done: it is a server table with
  an API in front of it, searchable, capped at 10,000 distinct pages, and
  readable and writable by plugins — see
  [browser-history.md](browser-history.md). The omnibox now searches the store
  per keystroke instead of ranking a 24-row corpus. Still missing, and named in
  that document's Next section: a history **page** (no per-day view, no search
  UI, no bulk delete).
- No download **progress** and no history across restarts (downloads and their
  list now work — see [browser-downloads.md](browser-downloads.md)), and no
  clear-browsing-data UI. ~~No site-info popover — the padlock in the omnibox is
  decorative, computed from the URL by `getBrowserUrlSecurity`.~~ Done: the
  padlock is a button that opens what the browser can honestly say about the
  connection, and it stopped lying in both directions — a certificate the user
  waved through no longer gets a lock, and loopback no longer gets a warning.
  Plugins add sections to the panel (`patcher.browser.registerSiteInfoProvider`,
  permission `siteInfo.register`). See
  [browser-surface.md](browser-surface.md).

**Everything else**

Search engine **was** hardcoded (`SEARCH_ENGINE_URL`, `browser-url.ts:4` — Google,
no setting), and it was reshaped rather than deferred, for the reason bookmarks
were deferred: a plugin cannot close it. `resolveOmniboxDefaultAction` resolves
what Enter does **synchronously** from the query — deliberately, so pressing Enter
before the debounce elapses does the same thing as after — while every plugin
provider is asynchronous. The most a plugin could offer was a row the user picks
with an arrow key.

So the engine is now a _declared_ choice: Patcher ships a few, plugins declare more
(`patcher.browser.registerSearchEngine`, permission `searchEngine.register`), and the
setting picks among them. Declared rather than asked, like context-menu items, is
what keeps Enter synchronous. The payoff beyond the setting is that an engine need
not be a search engine — a plugin route that spawns an agent thread is a legal
one, which is the thing an agent-first browser wants from its address bar. No incognito or profiles: one fixed `persist:patcher-browser` partition.
No autofill or password manager. ~~No per-tab mute~~ — done, from the tab's menu
and over `tabs.mute`; still no audio _indicator_, no picture-in-picture and no
media keys, and no Widevine in Electron, so DRM streaming will not play. Session restore carries URLs only — no scroll position, no form state.

**Multiple windows** is the one structural item in this tier, and it is now
**observed rather than inferred** — run by hand on 2026-08-19, and it behaves as
the keying predicted. Browser views are keyed
`${hostWindow.webContents.id}:${tabId}` (`browserViewKey` in
`desktop-browser-view.ts`), while surface tabs live in one module-scoped
`atomWithStorage` over localStorage under a key with no window in it
(`getBrowserSurfaceTabsStorageKey`), whose sync storage subscribes to the
`storage` event. So two app windows on `/browser` share one tab list — including
`activeTabId`, which is why activating a tab in one window activates it in the
other — while each builds its **own** `WebContentsView` for every tab in it.
The result is not one tab shown twice but _two live copies of the page_: two sets
of timers, two media elements, two form states.

The same run turned up a crash that had nothing to do with the tab list and was
fixed on the spot: closing a window threw `TypeError: Object has been destroyed`
out of `browserViewKey`. Electron tears a `BrowserWindow`'s `webContents` down
before the child views it owned finish closing, so the views were asking a gone
window for its id while computing their own key. `releaseWindow` already took the
id as a number for exactly that reason; the `destroyed` handler did not, and now
captures it at wiring time. Two lies in the test fake are why it shipped — a
plain `id` field that never threw, and a `close()` that set a flag without firing
`destroyed`. Both now behave as Electron does.

**Done**: each window gets its own tabs, the way a browser's windows do. The
cost is not the storage key, it is that **the renderer has no window identity at
all** — neither `desktop-contract` nor `patcher-desktop.ts` carries one. Since browser
IPC schemas are wire-frozen ([bb-migration.md](bb-migration.md), Invariant 2),
that identity arrives as a new channel plus an optional method on
`PatcherDesktopBrowserApi`, feature-detected — the shape already used for scoped popup
requests and tab favicons. Scoping the tab store then follows, and two things
have to be decided rather than derived: which window the agent's `browser_tabs_*`
addresses (the focused one), and what session restore does with more than one
list. History stays shared across windows — it is the user's, not the window's
(see [browser-history.md](browser-history.md)).

What it took was smaller than that reads, because two of the three pieces were
already there. The server has modelled several browser hosts all along —
`registerBrowserHost` keeps a map, `getBrowserHostSnapshot` reports `hostCount`,
and the most recently registered window is the primary one an agent's commands
reach — so nothing changed there. And the shell already assigns every window a
`WindowStateKey` and persists its geometry under it, so the tab list needed no
identity of its own: it hangs off the same key, and a window that reopens where
it was reopens with what it had.

The one new thing is how that key reaches the renderer. It cannot be a method,
because the answer is needed while modules initialise — the tabs atom picks its
storage key before anything can await — so it rides in as
`--patcher-window-key=<stateKey>` in the window's `additionalArguments` and lands as
an optional `windowKey` on `PatcherDesktopApi`. Optional is the negotiation: a web
build or an older shell has none, and per-window state falls back to the single
shared store, which is exactly what every build did before. One migration comes
with it: whichever window opens first adopts the pre-split list and deletes it,
so upgrading does not lose the tabs the user had open and the _second_ window
does not inherit them.

Three things the first run of two real windows turned up, all fixed with it:

- **A new window opened with two empty tabs.** The effect that guarantees the
  surface a page read "no tabs" from a render it had already left, and React's
  development double-invoke ran it twice — each run opening one. Invisible while
  the store was shared, because it was never empty. The decision now happens
  inside the state update, so whoever arrives second sees the first one's tab.
- **Closing the last tab left an empty window.** It now closes, the way it does
  in every other browser. That needed a renderer→shell call, which did not
  exist: the only close plumbing ran the other way (the shell asking the
  renderer whether Cmd+W may proceed). `closeWindow?()` is optional like the
  rest, so a web build or an older shell keeps the empty new-tab screen.
- **`window.new` moved from Mod+Shift+N to Mod+N**, and `thread.new` gave the
  chord up — it keeps its existing Mod+Shift+O. Mod+N opens a window in every
  other browser, and Patcher is one. Mod+Shift+N is now deliberately unassigned: it
  is incognito everywhere else, and that window is still on this list.

**Zoom** arrived with the same shape as the rest of this list's closed items:
the capability was missing, not the chord. `setZoomFactor` existed only for the
app window, and the View menu's Electron zoom roles act on that window's own
`webContents` — so `Cmd+=` scaled Patcher's chrome while the page underneath stood
still, and the window factory's `setZoomFactor(1)` on every load threw even that
away. Now the shell scales the browsed view, and **reports back what Chromium
settled on** rather than echoing the request: it clamps, and it also remembers
zoom per site, so a tab that navigates to a site the user zoomed before arrives
already scaled by a decision nobody made here. That is why zoom needed a push
channel and not just a setter. The steps are Chrome's table (…90, 100, 110,
125…) rather than a ratio, because those are the notches a user recognises.

Plugins and agents reach it as `page.zoom`, charged to `page.interact` — it is
less than a click, and anyone who can click can already do it. Out-of-range
factors are refused by the command schema rather than clamped, because reporting
a factor that was quietly changed reads to a model as a browser that lies. Two
things are deliberately not in: the View menu still holds the Electron roles
(pointing them at the surface would make the item inert on a thread, which is a
separate trade to make), and no agent _tool_ wraps `page.zoom` — an agent reads
the DOM, so the plugin API is the surface that was owed, not a tool nobody
asked for.

**Print** is `Cmd+P` on the browser surface, and the interesting part is that the
chord was already taken: `file.quickOpen` held Mod+P everywhere in Patcher while being
a second binding for what `panel.newTab` already did on Mod+T. So the command
went rather than the chord being shared — see the note further down — and the
test pins that Mod+P now resolves to `browser.print` alone.

What the shell does is `webContents.print()` on the browsed view, and what it
reports is nothing. Printed, saved-as-PDF and cancelled are one answer from
here, and the dialog is the user's conversation, not this browser's. It is also
**blocking** — owned by the app window, so Patcher is frozen while it is up, an agent
waiting on a browser command included. That is the right trade for a chord the
user just pressed and the wrong one for anything else, which is why nothing but
`browser.print` can reach it: no plugin method, and no path from a page.

Print therefore ships **without** a new plugin surface, deliberately. The
programmatic half already exists and is better: `patcher.browser.page.pdf()` renders
the document with no dialog at all, which is what a plugin that files invoices or
drives a label printer actually wants. A plugin-triggered modal would be a
footgun wearing a contribution point's clothes.

The chord is Mod+P alone now. It had been a _second_ binding for the panel's new
tab — `panel.newTab` already owned Mod+T and both handlers called the same
function — so print took it rather than shadowing it, and `file.quickOpen` is
gone from the command list, its two duplicate handlers, and the launcher label
that named it (which now names the chord that actually opens the launcher).

Two things the first run of print and zoom turned up in the omnibox, both fixed:
the source column was `w-14`, which clipped "History" and "Search" to "His…" and
"Se…" — a column whose whole job is being scanned down; and the suggestion list
spanned the chrome rather than the address bar, so a window-wide list hung under
a much narrower input. The list now lives _inside_ the address bar's own flex
column, which makes the width structural rather than measured, and it still takes
layout height rather than overlaying the page — the constraint that has shaped
this chrome from the start.

An empty tab also focuses its address bar now: nothing to read, one thing to do,
and Chrome's new-tab page does the same. Once per tab rather than on every URL
push, or it would take focus back from a user who had already moved on.

## Tier 3 — decided, and worth not re-litigating

These look like gaps in a feature comparison and are answers, each with its
reasoning already written down somewhere in this directory or in a code comment:

- **Permissions**: everything denied except `clipboard-sanitized-write` and
  `fullscreen` (`isAllowedBrowserPermission`); the second was added after the
  first blanket denial turned out to make every fullscreen button dead. A prompt
  UI is still explicitly "a later phase".
- **DevTools on browsed views**: **reversed**, the way favicons were. It was
  denied because CDP allows one protocol client per `webContents` and the
  automation stack holds it ([browser-automation.md](browser-automation.md)).
  The trade turned out to be worth making in the other direction — a browser
  with no way to look at a page is missing more than automation loses — and the
  conflict is now a typed refusal (`debugger-unavailable`) on the tab whose
  tools are open, rather than a denial for every tab.
- **Search completions** from a suggest endpoint: a network and privacy
  decision, not an omnibox one ([omnibox.md](omnibox.md)).
- **Chrome extension compatibility**: plan §10, out of scope for the MVP.
- **Favicons live for the session only**: localStorage is not for page-supplied
  bytes ([browser-surface.md](browser-surface.md)).
- **Tab strip clips instead of scrolling**: a floor and a scrollport answer the
  same question, and this surface answers with the floor.

Changing any of these is legitimate — but as a reversal with a stated reason,
the way favicons were reversed, not as filling in a blank.

## Where the deferred work is listed

Everything this document decided _not_ to do is collected in
[../TODO.md](../TODO.md), with the reason and the test that sorted it ("can a
plugin close this gap today?"). The arguments stay here; that file is the index.

## What the gaps have in common

Three patterns, and each suggests a different kind of fix:

1. **Silence.** Downloads, PDFs, popups and every absent handler used to fail
   without telling anyone, while the error screen that could have said so
   already existed. All of those paths now report — each through the surface
   that fits it rather than through one shared channel, which is the part of
   this diagnosis that did not survive contact: a refused download, a page
   asking for a password and a PDF an agent cannot read are three different
   answers to three different audiences. The pattern is still the way to read
   what is left here — an unbuilt feature announces itself, a denied one has to
   be made to.
2. **v1 denials that were never revisited.** Downloads and permissions were both
   deferred with a comment. Both turned out to be load-bearing in a way the
   comments did not say: the download denial made every download link dead, and
   the blanket permission denial made every fullscreen button dead, because
   `fullscreen` is a permission and denying it rejects `requestFullscreen()`
   before any handler can run. Both are now allowed, deliberately and
   individually — the rest of the list still stands as written.
3. **The shell is finished where the renderer is not.** Keyboard forwarding, the
   context menu, favicons and page reads all had complete main-process support
   and were missing only a command table, menu entries, a UI — which is why
   those items closed cheaply and downloads and popups did not. The asymmetry
   still predicts cost in what is left: a tab context menu is renderer work,
   zoom and print are not. Both halves of that held — the menu needed no shell
   work at all beyond the one channel mute required.

## Ordering

By value against cost, not by tier:

1. ~~**Keyboard set**~~ — done, minus the two chords that are really other
   features (`Cmd+P`, zoom).
2. ~~**Page context menu link/image entries**~~ — done, including the plugin
   contribution point.
3. ~~**Find in page**~~ — done: `findInPage` / `stopFindInPage` behind a new
   channel pair, a find bar that takes layout space (freezing the page would
   hide the highlights), and a plugin contribution point.
4. ~~**The absent Tier 1 handlers**~~ — done: all five, on one prompt channel
   that copies `BrowserPageDialog`'s freeze-and-draw pattern, plus an auth
   provider plugins can answer from. `Cmd+Shift+F` arrived with the fullscreen
   handler, since it is the same expansion asked for by hand.
5. ~~**PDF**~~ — done: the preference is on, the security question is answered
   in writing, and reading one as text is done too. That last part is not the
   viewer's doing — the text is not in the DOM and Chromium will not hand it
   over, so the shell refetches the document and parses it in a utility
   process.
6. ~~**Downloads**~~ — done; the manager UI it deliberately left out is in
   [browser-downloads.md](browser-downloads.md)'s Next section.
7. ~~**Popups with a live opener**~~ — done: real windows for tabs that claim
   them, hosted as tabs, with the popup policy and rate limiter intact and
   `about:blank` admitted on purpose.
8. ~~**Developer panel**~~ — done, and it turned out not to need building:
   `setDevToolsWebContents` puts Chromium's own DevTools in a view of ours, so
   the panel _is_ Elements, Console, Network and Sources rather than an
   imitation. It did argue with the CDP decision as predicted, and the argument
   was already settled — see [browser-surface.md](browser-surface.md).

9. ~~**The tab menu, with pin / duplicate / mute**~~ — done, and the prediction
   above held: it was renderer work, apart from the one channel muting needed.
   One thing it did _not_ predict: a renderer-drawn menu over the page area opens
   **behind** it, because the page is a native view — so the menu had to take the
   freeze-and-overlay path the downloads dropdown already used. Drag reorder
   landed with it.
   It also carried both of Phase 8's tab surfaces, which is where the cost
   actually was — a plugin's entry on the menu runs on the backend like a
   context-menu item, while a plugin's mark on a tab is the frontend's, like a
   thread row's status. See [browser-surface.md](browser-surface.md).

10. ~~**Site-info popover**~~ — done, and the interesting part was not the
    panel. The padlock was a decoration derived from the address bar, which made
    it wrong for the two cases Patcher can actually distinguish: a certificate a human
    accepted after Chromium refused it (encrypted, unidentified — and the
    exception applies to every later tab on that host) and loopback (no network to
    listen on, which is how Patcher serves its own pages). The shell now reports the
    one fact only it knows, on its own channel, and the panel says what is _not_
    checked instead of implying it was.

11. ~~**Search engine**~~ — done, and reshaped on the way: not a setting with a
    list of presets, but a declared plugin point with a setting that picks among
    what is declared. The test that decided it is the one that deferred bookmarks,
    run the other way — a plugin _cannot_ close this gap, because Enter resolves
    synchronously and every provider is asynchronous. See
    [omnibox.md](omnibox.md) for the shape and [../TODO.md](../TODO.md) for the
    test.

History's 24-entry cap sat outside this list — cheap to raise, and it changed
what the omnibox could do rather than what the browser could do. It is done:
[browser-history.md](browser-history.md). What it left behind is a UI item (a
history page) rather than a capability.

## Not verified

Everything with a file and line reference above was read at `63cc4fccf`, and
every "no such code" claim is a grep over `apps/desktop/src` and `apps/app/src`.
What is **inferred from code rather than observed in a running browser**, and
should be confirmed by hand before anyone plans around it:

- that a PDF link produces nothing (the `plugins`-off → download → cancelled
  chain) — the reading half of this was measured rather than inferred: the
  viewer's frame layout, the empty accessibility tree, the cookie-carrying
  refetch and the utility-process parse were each run against a real Electron
  before being written;
- the exact failure mode of an OAuth popup, which differs per SDK;
- the multi-window behaviour described above;
- that `<input type="file">` still opens Chromium's native picker, and that
  dragging a file into a page works — neither is blocked by anything found here,
  and neither was exercised.

The shortest way to check the first three is the same one the automation plan
uses: `bun run dev` plus `bun run dev:desktop`, then `/browser` in the desktop
app.
