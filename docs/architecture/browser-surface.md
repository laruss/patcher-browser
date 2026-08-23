# Browser Surface

Milestone A of [`docs/PROJECT_PLAN.md`](../PROJECT_PLAN.md) §18 Phase 1: the
browser stops being a panel inside a thread and becomes a surface of its own.

## What was added, and what was deliberately reused

Phase 0 found that Patcher already contains a working embedded browser (see
[bb-migration.md](bb-migration.md)), so this milestone adds only what was
genuinely missing and reuses the rest unchanged:

| Piece                                                                        | Status                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Electron `WebContentsView` manager, session partition, popup policy          | reused, untouched                                                              |
| `packages/desktop-contract` browser IPC contract                             | reused, untouched                                                              |
| `BrowserTabContent` — bounds sync, resize snapshot, load errors, address bar | reused, untouched                                                              |
| `BrowserTabDeck` — mounts only the active tab's view                         | reused, untouched                                                              |
| Thread-independent tab ownership                                             | **new** (`apps/app/src/lib/browser-surface-tabs.ts`)                           |
| Tab strip                                                                    | **new** (`apps/app/src/components/browser-surface/BrowserSurfaceTabStrip.tsx`) |
| `/browser` route                                                             | **new** (`apps/app/src/views/BrowserSurfaceView.tsx`)                          |

Reusing `BrowserTabContent` matters more than it looks: its ~400 lines of effects
are the hard part — measuring the panel rect in CSS pixels, pushing it to the
main process on every layout move, standing in a bitmap while a native resize
burst hides the view. A second implementation of that would drift immediately.

## Tab ownership

The thread secondary panel keeps browser tabs in `secondaryPanelTabState.ts`
beside file previews, each carrying a `threadId` that pruning keys on. Surface
tabs carry no thread: they live in their own `atomWithStorage`, persist across
restarts, and survive thread navigation because nothing prunes them.

Reducers are pure and separate from the atom (`addBrowserSurfaceTab`,
`closeBrowserSurfaceTab`, `activateBrowserSurfaceTab`,
`updateBrowserSurfaceTab`), so tab behaviour is unit-testable without React —
including the two rules that are easy to get wrong: closing the focused tab hands
focus to the right-hand neighbour and falls back left, and a stored `activeTabId`
naming a tab that no longer exists is repointed on load rather than rendering an
empty surface behind a populated strip.

`updateBrowserSurfaceTab` returns the _same_ state object when nothing changed.
The native view pushes navigation state on every `webContents` event, so without
that the whole strip would re-render on each one.

### Popups are a subscription, and this surface shipped without one

`window.open` and `target="_blank"` never open a native popup: the shell denies
every one of them and pushes the request to the renderer instead
(`setWindowOpenHandler` → the open-tab channels). Nothing in the shell decides
where such a tab goes — **the mounted view does**, by subscribing. So the
subscription is not plumbing, it is the whole feature, and a route without one is
a link that silently does nothing. That is exactly what this surface shipped
with: `ThreadDetailView` and `RootComposeView` each subscribe for their own
panel, neither is mounted on `/browser`, and the surface subscribed nowhere.

It prefers `onScopedOpenTab`, which names the tab that asked, and opens the
popup only for a tab this surface owns — the thread panel's popups are that
panel's business. `onOpenTab` is the fallback for a shell predating attribution
(invariant 2's version skew, again), where a route path is filtered out because
it belongs to `RouteNavigationProvider`.

The popup opens in the foreground, which `addBrowserSurfaceTab` already does for
every tab. Two limits are the shell's policy rather than the surface's: the
popup URL must be public `http(s)` (`isAllowedPublicBrowserPopupUrl`, so
`about:blank` popups are dropped), and a page churning them hits the same rate
limiter the favicon path uses.

### …and a simulated popup is not a popup

Everything above describes a tab that _stands in_ for a popup, and the standing
in is where it fails. `window.open()` returned `null` — which is precisely how a
page detects a popup blocker — so an OAuth SDK reported "popup blocked" and
stopped, while a tab it never asked for sat open behind the message. The tab had
no `window.opener`, so the `postMessage` handshake a sign-in popup finishes with
could not run, and it could not close itself when the flow ended.

None of that is fixable inside the simulation: the opener link is made by
Chromium when it creates the window, and no tab created afterwards can be given
one. So popups are now **real** for tabs that claim them — `action: "allow"`
with `createWindow`, Chromium's own window, hosted here as a tab.

**Which tabs claim them is the renderer's call**, declared over
`setPopupTabs`. This surface claims its own, because it owns them and can host
a window. The thread panel claims nothing on purpose: there a link follows the
user's in-app-link preference and may leave for the system browser, where an
opener means nothing — so it keeps the deny-and-push behaviour above, unchanged.

Three consequences of the reversal are worth stating, because each is a rule
that now lives in the shell:

- **The shell names the tab.** Every other tab exists because the renderer asked
  for one; a popup exists the moment `window.open()` returns, before the app has
  heard of it. So the id travels shell → renderer (`browser-popup:N`), the
  surface adopts it, and `attach` on such a tab **places the view without
  loading into it** — loading would navigate the popup away from the flow it was
  opened for.
- **The shell reports the close.** `window.close()` is how every OAuth flow
  ends, and only the shell sees the `webContents` die. `destroyEntry` removes
  the entry before closing, so the `destroyed` handler can tell a page closing
  its own popup from the renderer closing a tab.
- **`about:blank` is allowed now**, and only on this path. A page that opens a
  blank window and writes into it is the shape half the OAuth SDKs use; the
  blank popup inherits the opener's origin, so what it can reach is what the
  opener could already reach. Everything else the popup policy refused it still
  refuses — `javascript:`, `file:`, loopback and private hosts — and the rate
  limiter applies to real popups exactly as it did to simulated ones.

The hardening survives because a popup **inherits its opener's web
preferences**, and `createWindow` receives them in the options Electron passes.
Passing those options through is also what adopts the `webContents` Chromium
already created — build a fresh one instead and the result looks identical and
has no opener, which is the bug this path exists to remove.

## The `threadId` prop is a scope key, not a thread

`BrowserTabDeck` and `BrowserTabContent` take `threadId`, and pass it to the
navigation-history atom family and the native-view identity record. Neither
parses it — any stable string scopes them. The surface therefore passes
`BROWSER_SURFACE_SCOPE_ID` rather than borrowing a thread's id, and
`environmentId` is null because a surface tab belongs to no workspace.

Renaming that prop to `scopeId` across the thread code paths is the honest
follow-up. It was left alone here so this milestone touches no working thread
behaviour; the type system will carry the rename whenever it happens.

## Layout, for now

The surface renders inside `AppLayout`, so Patcher's sidebar is still present and it
is reachable from a footer button next to Settings. That is deliberate for
Milestone A — plan §14 says to reuse Patcher surfaces until replacement is
necessary. The dedicated browser window (its own Electron window, no agent-
workspace chrome) is a later step, and the plan's target layout — tabs on top,
page left, agent panel right — arrives with it.

### The surface is hosted by the shell, not by its route

It began as a route element and is now mounted by `AppLayout` above `<Routes>`.
The reason is what the product is: this is a browser, so the browser is a
**region of the shell that outlives navigation**, not a page the router swaps in
and out. Keeping it mounted keeps its tabs, omnibox draft, find state and
recently-used cycle alive across a trip to Settings; the native views already
survived, since only an explicit tab close detaches one.

On desktop the surface now holds the main area for **every** route, and there is
no longer an inactive state — that is what stage 3 finished. The three kinds of
route are told apart by `classifySurfaceRoute` (`lib/app-surface-tabs.ts`):

- `browser` — `/browser` itself; the active web tab fills the page area.
- `agent-panel` — the agent screens (`/`, a thread, a project's compose screen).
  They paint in the side panel, and the browser keeps the main area behind them.
- `app-tab` — everything else: Settings, Extensions, a plugin's panel. These
  paint **inside** the surface, in place of the page area, as `appScreen`.

The constraint behind all three is the same one the visibility coordinator
exists for: a `WebContentsView` is an OS-level overlay that no DOM node can draw
over. So an app screen cannot be layered on the page — the deck unmounts and the
tab content hides its native view on cleanup. The view itself survives, keyed by
tab id, which is why returning from Settings shows the same page rather than a
reloaded one.

### A narrow window has a different panel, and it is over the page

Below 768px the sidebar is not a docked column but a drawer over the content,
with an open state of its own that nothing persists. Both halves of the agent
route broke there, and each for its own reason:

- **The wrong state was opened.** Entering an agent route opens the panel,
  because it is the only place that route paints — but the opener lived outside
  `SidebarProvider` (it renders it), so all it could reach was the docked state.
  Setting that on a narrow window opens nothing, and the screen painted into a
  closed drawer: the route looked like it had done nothing. `SidebarRouteOpener`
  now sits inside the provider, where which state _is_ the panel is knowable.
  The drawer also opens when it **becomes** the panel, which the docked one does
  not need: the docked state is persisted, so widening a window restores the
  user's last choice, while the drawer always starts closed.
- **The right state would not have helped.** "Over the content" is not available
  to the DOM while a page is there. The drawer and its backdrop would have opened
  behind the page, so it registers as a browser-dimming modal
  (`useBrowserDimmingModal`) — the same mechanism dialogs use — and the page
  steps aside for as long as it is open.

The app's toggle chord moved inside the provider with the opener, and for the
same reason: it was flipping the docked state too, so on a narrow window the
keyboard could not open the panel either.

### The panel says it is a narrow column, and its contents believe it

An agent screen moved into the panel keeps the layout it was given for a
full-width main area, and none of it survives a 400px column: a split workspace
puts panes side by side, each pane draws a header for maximize and close, the
thread's secondary panel splits the column again, and the collapsed-conversation
chrome reserves space for traffic lights that are at the other end of the window.

The app already renders all of that as a single page surface — at narrow widths,
where `useSplitWorkspaceActive` turns the pane chrome off. So `AgentPanelSidebar`
wraps its content in `CompactViewportOverrideProvider`: the panel states what it
is, and every one of those decisions follows from the statement rather than from
a width each screen would otherwise have to measure. Unconditional, not derived
from the dragged width — a split workspace inside a side panel is wrong at every
width, and a measured answer would re-lay-out the conversation mid-drag.

One thing had to follow it. In that form the secondary panel opens as a drawer
over the page area, and a drawer's backdrop cannot dim a `WebContentsView` any
more than a dialog's can — so `PersistentResponsiveDrawerShell` registers as a
browser-dimming modal, like every other modal that covers the page. It was
already missing that: on a genuinely narrow window the drawer opened behind the
page, and the panel only made it reachable at every width.

### There is one browser, and it is this surface

The thread's secondary panel used to host browser tabs of its own — a deck, an
address bar, popups, the lot. In the panel that became a browser inside a panel
beside the real one, which is the point at which the arrangement stopped being
defensible: two browsers, two tab strips, two sets of history, and a page whose
home depended on where the user happened to click.

So the panel hosts none. What opened a tab there now opens one here, through
`useOpenBrowserSurfaceTab`, and **no navigation goes with it**: on an agent route
the surface already owns the main area, so a link followed from a thread appears
beside the conversation rather than instead of it. The web build is unchanged —
it has no surface and no native view, so links keep going to the system browser,
gated as they always were on `isDesktopBrowserAvailable`.

Three things went with the hosting, and each was only ever there to serve it: the
panel's deck slot and its readiness gate, the popup subscription (the surface has
its own, scoped to its own tabs — and two subscribers to the unscoped fallback
channel meant an old shell's popup opened twice), and the "Browser" action on the
panel's new-tab page.

The `browser` tab kind stays in both schemas, and that is not an oversight: the
surface's own tabs are the same record, and saved panel state still holds the
tabs it used to keep. They are dropped in `normalizeFixedPanelTabsState` — the
one path both loading and saving go through — so they parse and then disappear
rather than failing a parse or returning as tabs nothing can render. The same
goes for a `browser` tab arriving from the server's thread-tab sync, written by
an older client.

Two things fall out and are worth stating:

- `data-app-browser` covers the app screen too, so the browser's chords keep
  working from Settings the way they do from a page in Chromium — Cmd+T opens a
  tab there. Handlers that need a page (find, reload, DevTools, fullscreen)
  decline when the active tab is not a web tab, so the chord falls through
  instead of acting on nothing. Every browser binding is scoped `browserFocus`,
  which resolves from the event target's `[data-app-browser]` ancestor.
- The **web build keeps the surface on its route**, because it has no native
  views to preserve and no shell to preserve them in — that is where its "needs
  the desktop app" screen still comes from. `isDesktopBrowserAvailable()` is the
  single gate both `AppLayout` and the route read, and on the web build every
  route renders in `main` exactly as before.

### The leading edge belongs to plugins

The window now has chrome at both ends, and they are owned by different people.
The trailing edge is Patcher's: the sidebar, the agent screens, the pinned trigger.
The leading edge is nobody's until a plugin claims it — `PluginLeadingPanel`
renders **nothing at all** with no registrations, because an empty column and a
toggle for a panel with nothing in it would be Patcher claiming an edge it has no use
for.

What the host draws there follows from how many plugins asked, not from
configuration:

- **one** gets the panel whole, with no chrome of Patcher's own around it. A rail to
  switch between one thing is a control that does nothing.
- **two or more** get a rail of icons, because now there is a choice to make and
  only the host can offer it.

The panel is not collapsible — the way to be rid of it is to disable the plugin
— and it is resizable, because how much room a plugin's panel needs is the
user's judgement rather than the plugin's. Its handle is on its **trailing**
edge, so the drag runs the opposite way to the sidebar's; that sign is the whole
content of `resolveLeadingPanelResizeWidth`.

Two shell obligations moved with the edge:

- **The macOS traffic lights.** They sit in the window's top-left, which is this
  panel's corner when it is there. So the surfaces that reserved that strip stop
  — the tab strip and the page header both read `useIsLeadingPanelShowing` — and
  the panel holds it open itself. It cannot indent the way they do: it is a
  column, and indenting would inset its content all the way down, so it gives up
  its first 48px row instead (`MACOS_TRAFFIC_LIGHT_TOP_RESERVE_CLASS`). Two
  surfaces reserving one strip is content inset twice; none reserving it is
  BB-46.
- **The browser's bounds.** The panel is in flow, so appearing, disappearing or
  being dragged moves the main area — and a `WebContentsView` is positioned from
  measured DOM rather than from layout. It dispatches a bounds sync on both.

### App tabs: many tabs, one router

A tab strip is plural and a window URL is singular, which is the one place this
migration could have grown a second navigation system. It did not. An
`AppSurfaceTab` record is a **remembered route** (`kind: "app"`, a `path`, a
`title`), only the active one is mounted, and what mounts it is the window's own
router. An inactive app tab is a path waiting to be visited.

The strip and the URL are kept describing the same thing by
`useBrowserSurfaceRouteSync`, and **whichever one just moved is the one that
wins**:

- the user navigates (a sidebar link, a deep link, Back) → the strip follows,
  via `reconcileBrowserSurfaceTabsWithRoute`;
- something activates a tab without the router hearing about it (an agent's
  `browser_tabs_open`, a page's popup, reopening a closed tab) → the window
  follows, via `resolveSurfaceTabRoute`.

A fixed winner breaks one direction or the other: route-always-wins snaps an
agent's new tab back out of view, strip-always-wins refuses to open Settings.

App tabs are **singletons per destination**, the way Chromium treats its own
`chrome://` pages: `resolveAppTabDestinationKey` maps every page under Settings
to one key, so asking for Settings again returns to the Settings tab wherever
inside it you had got to, and navigating within a destination moves its tab
rather than stacking near-identical ones.

Two consequences worth knowing before changing this:

- Restoring a session has no special path. The window URL wins there too, so
  whatever the app opens on is what the strip is corrected to — a persisted
  pointer at an app tab does not survive a start on `/browser`.
- The side panel and the main area share one URL, so a thread in the panel
  cannot be read _beside_ Settings the way it can beside a web page. That is the
  price of one router, and it is the thing a per-tab router would buy.

An agent's tools see web tabs only (`getBrowserSurfaceWebTabs`): Patcher's own screens
have no page to read, navigate or screenshot, and listing them would offer tools
that cannot work on them.

### The shell draws no chrome around the surface

`/browser` is the one route with neither the shared page header nor `main`'s
`p-4 md:p-5` content padding (`isBrowserSurfaceView` in `AppLayout`). The header
would be empty on this route — no title, no breadcrumbs, no actions — and the
padding read as a frame around a browser that should meet the window edge.

That is not free: the header is what normally holds the window's top-left
footprint, so the **tab strip inherits its obligations**. It therefore takes the
shared `CHROME_ROW_HEIGHT_CLASS` (48px) title-bar row and reserves the pinned
sidebar trigger — plus the macOS traffic lights while they are visible — by the
same rule as `AppPageHeader`
(`resolveTabStripChromeReserveClassName`). Two things break if that reserve
drifts, both silently: on the web build the sidebar toggle covers the first tab,
and in the macOS desktop app the traffic lights do — which is BB-46, a bug this
repo has already had once (see `lib/patcher-desktop.ts` for the paired geometry).
A strip shorter than the row would also let those controls spill onto the omnibox
row below, so the height is part of the contract, not styling.

Each reserve is the **whole** gap from the window edge, and it must ride the
element that already carries the surface's own inset. `pl-*`/`pr-*` replace one
side of a `px-*` on the same element but _add_ to a `px-*` on an ancestor, so a
reserve written as "the surface's 16px plus N" is right on whichever spelling it
was measured against and 16px wrong on the other. Both spellings were in the tree
at once, and both overlaps followed: the new-tab button under the sidebar
trigger, and the first tab under the traffic lights. `patcher-desktop.test.ts` now
locks each token to its target rather than to a sum, and the two surfaces that
had the reserve on an inner element (the page header, the secondary panel's top
chrome) carry it on the inset element instead.

When an app screen renders inside a tab, the shared page header comes with it and
lands _below_ the strip. It therefore claims none of the window chrome —
`ownsWindowTopLeft`, `ownsWindowTopRight` and `isWindowDragRegion` all go false —
because the strip above it already reserved both ends and already is the drag
region.

In desktop chrome the strip is also the window's drag region, since it is now the
only chrome on the title-bar row; every control on it opts back out
(`MACOS_WINDOW_NO_DRAG_CLASS`) to stay clickable.

### Tab sizing is Chromium's, and content is not an input to it

Every tab is the same width whatever its title says: Chromium's own 240px until
the tabs stop fitting, and from there they shrink together down to a floor.

The mechanism is one shared fixed width (`w-60`) plus `shrink`, deliberately
**not** `flex-1`: a title cannot widen its own tab either way, but dividing the
strip would stretch two open tabs across the whole window, and — the visible
tell — it would leave the leftover space _inside_ the tab list, pushing the
new-tab button to the far edge instead of following the last tab as Chromium's
does. Equal bases also shrink by equal amounts, so the tabs stay identical the
whole way down. No measuring, no resize observer.

**A definite width, not `basis-60`**, and the difference is a bug that survived
two fixes aimed at the wrong thing. The two flex identically; what they change is
the tab list's **max-content** size, which is what the list is sized by (it is
`flex: 0 1 auto`, so its width is `min(max-content, available)`). Flexbox derives
that from the items' content rather than their bases: each item offers
`max-content contribution − flex base size`, and when _every_ tab's content is
narrower than 240 — a fresh tab reading "New tab", a host name, a page that has
not reported a title yet — the largest of those offers is negative, so the list
sizes below 240 × N and the tabs shrink with it. One long title arrives and they
all snap back out, which is the jitter users saw on every load. A definite width
makes the contribution definite too: it equals the base, the offer is zero, and
the list is 240 × N whatever the pages say. Neither an added `max-width` (with
`flex-grow: 0` a long title could never stretch anything) nor the paddings around
the strip had anything to do with it.

The floor (`min-w-15`) is **what a tab needs once its title is gone**: the page
icon and the close control, nothing else. It is a sum of the tab's own geometry —
`pl-2` + a `size-4` icon + `gap-1.5` + the `pr-7` that reserves the close control
— so changing any of those paddings means recomputing it, which is why the
arithmetic is written out at `TAB_WIDTH_CLASS`.

Two consequences are deliberate rather than incidental:

- **No scrolling, at any count.** Past the floor the tab list clips. A floor and a
  scrollport are alternative answers to the same question, and this surface
  answers with the floor; the new-tab button therefore lives _outside_ the clipped
  list (and never shrinks) so a crowded strip never hides the way to open another
  tab — while the list's `min-w-0` is what still lets it be squeezed under its own
  content rather than pushing the button out of view.
- **Room for the close control is reserved, not overlapped**, at every width. The
  floor is what makes that affordable: no width exists where the control has to
  choose between covering the title and disappearing.

The tab is one control filling its box, with the close button as an absolutely
positioned sibling rather than a nested one: nesting would be invalid markup and
would fire both actions, and a tab whose hit area was only its text left the
padding above and below it dead.

**The tab's fill belongs to the box the close control is positioned in** — the
wrapper, not the inner button. Painting the button instead leaves the control
positioned against bounds nobody can see, which reads as a close button floating
outside its tab. The same bug had a second cause worth remembering:
`MACOS_WINDOW_NO_DRAG_CLASS` carries `relative`, and `cn` is tailwind-merge, so
appending it to an `absolute` element **replaces** the positioning and drops the
control into the strip's flow. The drag carve-out belongs on the tab box, which
covers both controls anyway.

### Page icons: a reversed decision, with its reason kept

The shell used to forward no favicons at all, and the comment saying so was a
security decision, not an omission: _"a remote, attacker-controlled favicon URL
must never be rendered (or fetched) by the trusted Patcher app surface."_ A browser
without tab icons is a worse browser, so the icons are now shown — and the
property that comment protected is still intact, because **the app never touches
the page's URL**:

- The **shell** fetches the icon, through `session.fetch` on the browsing
  partition. So the request carries that session's cookies rather than Patcher's, and
  it passes the session's own network firewall — `shouldBlockBrowserRequest`
  already refuses LAN hosts outright and loopback without frame attribution, which
  is what stops an icon from being a credentialed probe of Patcher's own services.
- The renderer receives a `data:` URI the shell built, with a media type taken
  from the shell's **allowlist** rather than from the response. A page cannot put a
  scheme, a URL, or a media type of its choosing into the strip's `<img>`.
- Candidates are `http(s)` only, the body is capped
  (`PATCHER_DESKTOP_BROWSER_MAX_FAVICON_BYTES`), and a page that churns its
  `<link rel=icon>` hits the same sliding-window limiter the popup policy uses.
- SVG is refused: a document format with a parser surface a 16px icon does not
  need. `.ico`, PNG, JPEG, GIF, WebP and BMP go through.

What is _not_ removed, and should be named: the renderer decodes image bytes a
page supplied, exactly as it would for any `<img>`. The caps and the allowlist
bound that; they do not eliminate it. The shell deliberately does no decoding
itself (no resize, no re-encode) so the privileged process never parses those
bytes.

**A spinner takes the icon's place while the tab loads** — Chromium's trade:
on a tab you are waiting for, progress is worth more than identity. Loading state
reaches the strip the same way the icon does (`onLoadingChange` off the state
pushes the tab content already subscribes to), and it is reported "not loading" on
unmount, since nothing observes a tab whose content is gone and a stuck spinner
would outlive the load.

**The icon is keyed to the page's origin, and dropped when loading settles** —
not at commit. Clearing at commit is what made a **reload lose its icon**: it
pushed `null` and then depended on the new document re-announcing an icon, which a
reload does not reliably do. Now a reload keeps what it had (same origin, nothing
to re-fetch even if the icon _is_ re-announced), a hash change or `pushState`
keeps it too, and landing on another site drops it at `did-stop-loading`. Origin
rather than full URL because that is the granularity a site's icon actually has —
and because comparing URLs made a reload lose its icon over a trailing slash. The
cost: a page that _removes_ its icon on reload keeps showing the old one, which is
also what a real favicon cache does.

Two structural notes:

- The icon rides **its own IPC channel** with an optional `onFavicon` on the
  preload bridge, not a new field on the wire-frozen state payload — invariant 2 in
  [bb-migration.md](bb-migration.md), and the same shape the scoped popup event
  used. An older SPA never sees a payload its strict parser would reject; a newer
  SPA against an older shell simply finds no `onFavicon` and shows the generic
  mark.
- Icons live **for the session only**, in the surface view rather than the
  persisted tab state. Persisted tabs are localStorage, whose 5MB budget the tab
  list must not spend on page-supplied bytes. The visible consequence: after a
  restart, tabs wear the generic globe until visited — and since the deck mounts
  only the active tab, that is also true of tabs never opened this session.

### Separators, not gaps

Unselected tabs have no fill, so flush tabs would run together. They are separated
by a hairline pinned to the left edge of a tab (`inset-y-1.5 left-0 w-px`), which
with no gap utility on the list _is_ the edge it shares with the tab before it —
the separator cannot drift away from either tab because there is no space for it
to drift into. Chromium's rule for which ones are drawn: not on the first tab, and
none touching the active tab, which is bounded by its own fill.

## Browser-first startup

A starting app opens the browser rather than Patcher's home
(`useBrowserFirstStartupRoute`). Two things keep that from turning into "the home
screen is gone":

- It fires **once per app load**, so navigating home later in the session goes
  home and stays there. That is why it is an effect with a one-shot guard rather
  than a `<Navigate>` on `/` — `/` is still Patcher's home route, and the plan's own
  target has the agent app and the browser sharing the shell.
- It **replaces** the entry instead of pushing, so Back does not walk the user out
  of the browser into a screen they never asked for.

It is desktop-only: on the web build the surface has no native view to put in it
and would show only its "needs the desktop app" screen, so the web keeps landing
on home. A start on any other route — a deep link, a reload on settings, a thread
URL — is the user's destination and is left alone.

## Verified

- `browser-surface-tabs.test.ts` — 13 pure state and persistence cases.
- `BrowserSurfaceTabStrip.test.tsx` — the top-left reserve rule (collapsed
  sidebar, visible traffic lights, expanded sidebar, compact viewport, no sidebar
  context), that tabs of wildly different title lengths render one identical
  width box, that the list clips rather than scrolls, that the new-tab button sits
  outside the clipped list, that the tab is the control while the close button is
  a sibling of it, that the close button stays `absolute` in desktop chrome (the
  tailwind-merge trap above), that hairlines fall between plain tabs only, that the
  tab list is sized by its tabs so the new-tab button follows the last one, and
  that a tab shows its page icon when known and the generic mark when not.
- `desktop-browser-favicon.test.ts` — the icon policy: `http(s)`-only candidates,
  the media-type allowlist (svg and non-images refused), every failure mode
  collapsing to a silent null, the byte cap, that the largest accepted icon still
  fits the wire cap the other package declares, and the page key (every URL on a
  site is one page; other sites, ports and schemes are not).
- `desktop-browser-view-manager.test.ts` — the wiring: a declared icon fetched
  **through the browsing session** and pushed on the favicon channel, no fetch for a
  non-`http(s)` candidate, **a reload keeping its icon** (both silently and with the
  icon re-announced, which must not refetch), the icon dropped once the tab settles
  on another site, no refetch of an icon already pushed, and a page churning its
  icon cut off at the limiter.
- `BrowserSurfaceView.test.tsx` — an icon pushed for a tab reaches that tab's
  strip entry.
- `browser-first-startup.test.ts` — home starts in the browser, any other
  starting route is left alone, the web build stays on home.
- `BrowserSurfaceView.test.tsx` — first-mount tab, add/close/refocus, reopen
  after the last close, and that the surface **attaches the active tab's native
  view** and re-attaches on switch (the point of the surface is that it drives
  the real Electron layer, so that assertion is the load-bearing one).
- `BrowserSurfaceView.test.tsx` — a popup from one of the surface's own tabs
  opening as a foreground tab whose URL is what gets attached, one from a tab it
  does not own ignored, and the unscoped fallback still opening the tab.
- Full `apps/app` suite: 2577 tests green. Repo typecheck: 58/58.
- Live: `bun run dev` plus `bun run dev:desktop` bring up server, daemon, Vite
  and the Electron shell; both new modules compile through Vite in the dev server.

Not verified automatically: how the surface _looks_, and a live page rendering
inside it. Open the desktop app and click the Browser button in the sidebar
footer, or go to `/browser`.

## Keyboard: the chords, and the two that are not Chromium's

The surface now carries a browser's tab chords — `Cmd+T`, `Cmd+W`,
`Cmd+Shift+T`, `Cmd+1`–`8`, `Cmd+9` for the last tab, `Cmd+[` / `Cmd+]`, and
`Ctrl+Tab` / `Ctrl+Shift+Tab`. The commands live on the view that owns the tabs;
the chrome keeps only the address bar and reload.

Nothing new was needed to make a key pressed _inside a page_ work: the shell
already resolves chords against the keybinding table in `before-input-event` and
dispatches them to the renderer. What was missing was the table entries.

**`Cmd+T` and `Cmd+W` were not free.** Both were already bound — to
`panel.newTab` and `panel.close`, scoped `mainSurface`. The browser bindings are
registered **after** them and scoped `browserFocus`, and both resolvers (the
shell's and the renderer's) walk the table from the end, so the browser wins
exactly when the browser has focus and the panel keeps them everywhere else.
That ordering is load-bearing rather than incidental: moving these entries above
the panel ones silently gives `Cmd+T` back to the panel.

`Cmd+9` is the _last_ tab rather than the ninth, which is Chromium's rule, so
`browser.selectTab.*` is eight ids and not nine.

### Reopening a closed tab means reopening its state

`Cmd+Shift+T` restores the page **where it was** — back/forward history, scroll
offset, form values — not just its URL. Chromium serializes that as
`pageState` on each navigation entry, and Electron 41 exposes both halves:
`navigationHistory.getAllEntries()` and `.restore({ entries, index })`.

The split between processes follows from where that data can exist:

- **The shell keeps the session.** It captures the history in `destroyEntry`,
  at the last moment the page still exists, into a bounded map keyed by tab id.
  The entries carry form values, which have no business crossing a wire or
  sitting in a React store — and the renderer could not read them anyway.
- **The renderer keeps the tab.** A small in-memory stack of `{ tab, index }`,
  so a reopened tab lands back at its old position rather than at the end.

The two meet on the **tab id**: a reopened tab keeps the id it had, so `attach`
finds the stored session and restores instead of loading. That is why nothing
new crosses the IPC boundary for this feature — no channel, no contract change,
no version skew. Restoring drives its own navigation, so it _replaces_ the load;
doing both would fetch the page twice and the user would watch it happen.

Three rules keep it from lying about what it can do. A session is spent when
used, so a later reload behaves like any other tab. A session whose URL
disagrees with the URL the renderer asked for is dropped — the renderer is the
authority on where a tab should be. And a failed restore falls back to a plain
load, so the tab still shows its page, just without the history behind it.

The renderer's stack is deliberately **not persisted**, unlike the open tabs:
the state that makes a restore worth anything dies with the shell, so a stack
that survived a restart would promise something it could no longer deliver.

### `Ctrl+Tab` is the IDE's, not Chromium's

Chromium walks tabs by position. This walks them by **use**, and shows the list
while you walk it: hold Ctrl, press Tab to move down the list, release Ctrl to
land. One press and release — the common case — lands on the tab you were in
before this one, wherever it sits in the strip.

The order updates from `activeTabId` rather than from the call sites that change
it, so a click, the omnibox, a shortcut and an agent all count the same — one
place to be right instead of five. A tab nobody has switched to yet has no use
to be ordered by, so **a fresh session starts in tab order** and diverges from
it as the user works; the first Ctrl+Tab after launch therefore looks positional
because at that moment the two orders are the same thing.

Four properties, each of which the obvious implementation gets wrong:

- **Nothing is activated while stepping.** The tab changes when the user lands,
  so walking across five tabs does not load five pages.
- **The order is frozen while the switcher is open.** A list that re-sorted as
  the walk promoted its own rows would move the row under the user's finger,
  and would bounce between two tabs forever.
- **Landing promotes**, which is what makes repeated press-and-release a toggle
  between the last two tabs rather than a slow crawl through all of them.
- **A click on a row lands immediately**, because a mouse never releases Ctrl.

#### Seeing the Ctrl release at all

An IDE ends the walk when Ctrl comes up. The shell forwards **key-downs only** —
a key released inside a browsed page never becomes an app command — so the
release has to happen somewhere the DOM can see it.

Two things arrange that, and both are the reason this works at all rather than
polish. The shell **focuses the host window** when a cycle command arrives
(`HOST_FOCUSING_APP_COMMANDS`, the same move `Cmd+L` makes so typing reaches the
address bar), and the switcher panel **takes focus when it opens**, so the next
Ctrl+Tab resolves inside the browser command context instead of on `body`.

There is still a backstop timer, and it is only that: five seconds, long enough
that a user reading the list is never interrupted, present so a missed release
cannot strand the overlay with the page frozen behind it.

The panel floats over the page using the same freeze the downloads dropdown
does — `setOverlay`, described below — which is also what lets a click outside
the list land on a scrim rather than on the page.

### Plugins can rebind any of it

`patcher.ui.registerKeybinding` lets a plugin change what a chord does, or free one
(`shortcut: null`). It is a third layer, and the order is the point: built-in
defaults, then plugins, then the user's own overrides on top. Folding a plugin
into the _defaults_ rather than into the overrides is what keeps the settings UI
truthful — a command a plugin rebound reads as this install's default, not as
something the user changed and could "reset".

Between plugins the lowest plugin id wins a contested command, so the result
does not depend on load order. An unknown command id fails the plugin at load
rather than being ignored, and nothing that plugin registered is applied.

What this does _not_ yet include is a plugin registering a command of its own —
a new id that runs plugin code. That is the other half of plan §7's
`browser.commands`, and it needs a dispatch path into the plugin host rather
than a table entry.

There is no switcher popup listing the tabs. It would now be possible — the
overlay machinery below is exactly what it needs — but it is a separate feature.

## The tab menu: pin, duplicate, mute

Right-clicking a tab opens Patcher's own entries — Duplicate, Pin / Unpin, Mute /
Unmute, Close — followed by whatever plugins contributed. The menu is
renderer-drawn (Radix), unlike the page's, which is Chromium's: the strip is Patcher's
own DOM, so there is no native menu to extend here.

Two entries do not apply to every tab, and both refusals are reasons rather than
taste:

- **Duplicate is web-only.** An app tab is a _remembered route_ (see
  `AppSurfaceTab`), and two tabs holding one route cannot both be the one the
  window's router is rendering.
- **Mute is web-only, and only with a page.** A Patcher screen shares the app's own
  `webContents`, so "mute this tab" would mute Patcher. A tab with no page yet has
  nothing to silence.

### Pinning is a block, not a flag

Pinned tabs are a block at the leading end of the strip, Chromium's rule.
`orderPinnedFirst` enforces it in one stable pass, and pin, unpin and reopen all
go through it — otherwise each would need its own idea of where a tab belongs.
Unpinning therefore lands a tab at the head of the unpinned block, which is also
Chromium's behaviour. Duplicating a pinned tab produces a pinned copy: the same
rule, and the thing that keeps a copy from splitting the block it was made in.

The flag is `pinned?: boolean` on the surface's own tab record — **absent**
rather than `false` when a tab is not pinned, so every strip an older build wrote
still parses, and unpinning writes the record back the way that build would have.
It is the surface's rather than the shared `BrowserFixedPanelTab`'s, because the
thread panel's strip has no pinned block.

A pinned tab renders as its page icon alone: no title, and no close control. The
chord and the menu still close it — what is removed is the affordance a stray
click can hit, which is the point of pinning. Its name moves to `aria-label` and
`title`, so it stays reachable by a screen reader and by hovering. It is also
sized by its content and `shrink-0`, unlike the equal-width unpinned tabs, which
keeps the pinned block out of the shrink pool the rest share.

### Mute lives exactly as long as the page does

`setMuted` is a new channel and a new optional method (invariant 2's rule for
extending the browser IPC), one-way: nothing but this renderer mutes a page, so
there is nothing to hear back. The shell calls `webContents.setAudioMuted`, and a
tab whose view does not exist yet finds no entry and does nothing.

That last part is why the record is the renderer's. The deck creates a view only
when its tab is first shown, so a mute set on an unvisited tab has nothing to
apply to yet; the surface re-asserts every mute whenever the active tab changes,
by which time the deck (a child, so its effects run first) has built the view.

The record lives in `sessionStorage` — for the reason page icons do
(`browser-favicons.ts`): a renderer reload throws React state away while the
shell's views survive, and a strip that stopped marking a page that is still
silent would be lying. It dies with the window, which is exactly as long as the
`webContents` it describes. The consequence, stated rather than hidden: a restart
brings restored tabs back audible. Chromium remembers mute per site; Patcher does not,
because a mute stored against a page that has not loaded is a promise about
something that does not exist.

**No "playing audio" indicator.** Chromium shows one, and it needs the shell to
report a `webContents` deciding on its own that it is making noise — a push
channel this deliberately does not add. What the strip marks is what the user
asked for.

### The menu has to freeze the page to be seen

The first thing the menu did in a real window was open **behind** the page. That
is not a z-index to raise: a browsed page is a native `WebContentsView` and
composites above the DOM, so the only way to draw over it is the one this repo
already has — freeze it to a bitmap, hide the view, draw on the DOM that is left
(`setOverlay`, see "Drawing over a page is possible" below). The downloads
dropdown and the tab switcher pay the same cost for the same reason.

One owner per window: the surface. Everything that draws over the page area only
_reports_ that it needs the freeze — the strip that a menu is open
(`onMenuOpenChange`), the chrome that the downloads list or the site panel is
(`onPageOverlayChange`) — and the surface ORs those with the switcher and makes
the single call. Two owners writing `setOverlay` for one tab have the second
one's close thaw the first one's panel: the page composites back over a panel
that is still open, and it is there but invisible and unclickable. The switcher
is what reaches that, because it is driven by keys, and a list that closes on a
click outside does not close on a keypress. The strip tracks _which_ tab's menu is open rather than a boolean —
right-clicking a second tab opens its menu and closes the first one's, and those
two callbacks can arrive in either order, so a stale close must not cancel a live
open.

Freezing also buys the thing that makes the menu usable at all: with the page
hidden, the whole window is DOM again, so a click outside the menu lands where
Radix can see it and dismisses it.

### Dragging a tab to reorder it

Tabs reorder by drag, with `@dnd-kit` — the same library, sensors and click
suppression the thread panel's tab strip uses (`SecondaryPanelTabStrip`), so the
two strips behave the same under the pointer: a few pixels of travel before a
press becomes a drag, a hold on touch, and the click that ends a drag swallowed
rather than selecting the tab it landed on.

Two differences from that strip, both because this one is simpler: the drag is
restricted to the horizontal axis and there is **no lifted clone** portaled out
to `document.body`. The panel's strip scrolls, so a translated tab would be
clipped by its viewport; this one is a single row that clips rather than scrolls,
and the sort happens inside it, so the tab never leaves the box.

The drop resolves to an index and goes through `moveBrowserSurfaceTab`, which is
also what `tabs.move` calls. The index is **clamped into the tab's own block**
rather than refused when it names the other one: pinned tabs lead the strip, so a
drag that crossed the boundary lands at the near edge of where it is allowed —
as far as it can go, rather than snapping back and saying nothing.

Right-clicking a tab must not start a drag, or aiming at the menu would carry the
tab behind it. dnd-kit's `MouseSensor` ignores the secondary button, and a test
pins that as a property of the strip rather than trusting the default — swap in a
sensor that accepts every button and it fails.

No drag between windows. Chromium tears a tab out into a new window; here a
window's tabs are its own (see the multi-window keying), and moving one across
would mean moving its `WebContentsView` between hosts.

### The two plugin points, and why they land on different sides

Phase 8 names _tab actions_ and _tab decorators_. They are both here, and they
are built on opposite sides of the boundary — the same split the surrounding code
already makes:

- **Tab actions** are declared on the backend
  (`patcher.browser.registerTabAction`) and run there when picked, exactly like page
  context-menu items: the shell (here, the strip) holds the list so a right-click
  opens without waiting on a server, and only the click travels. The context an
  action receives carries the tab's id, url, title, `pinned`, `muted` and
  `active`. A **null** url means a Patcher screen — a tab with no page at all, which
  an action has to be able to tell from a tab with no page _yet_ (empty string).
  New permission: `tabMenu.register`, beside `contextMenu.register` rather than
  folded into it, because the house rule here is one permission per contributed
  surface and folding would silently widen what already-granted plugins can do.
- **Tab decorators** are the frontend's
  (`contentScript.experimental_setBrowserTabStatus`), mirroring
  `experimental_setThreadRowStatus` down to the shape of the store: a mark is
  owned by the plugin generation that set it, and the host clears everything that
  generation set when it deactivates. Live paint belongs on the side that can
  paint without a round trip; an invoked action belongs where the plugin's logic
  is.

The strip reads the marks as one whole-store snapshot rather than a subscription
per tab (which is what `plugin-thread-row-status.ts` does): a window has a
handful of tabs in one component, where the sidebar has hundreds of independent
rows.

### Driveable, not only clickable

`tabs.pin`, `tabs.mute`, `tabs.duplicate` and `tabs.move` are browser commands,
so a plugin (`patcher.browser.tabs.pin/mute/duplicate/move`) or an agent can do what
the menu and the drag do. All four cost `tabs.modify`: none of them reaches into what a page contains, and all
three are things the user does from the tab's own menu. Each states the end
result rather than toggling, so asking twice lands where asking once did — a
caller that cannot see the strip has no way to check first.

What they deliberately do **not** come with is pin/mute state in `tabs.list`.
`browserTabSnapshotSchema` is wire-frozen, and a plugin that wants to know is
told by a tab action's context. There is no agent _tool_ wrapping the three
either, for the same reason `page.zoom` has none: the plugin API is the surface
that asked for them.

### Still missing

No "Close others" or "Close to the right". No audio indicator, as above. No test
covers the drag itself: dnd-kit's own swallow-the-click-after-a-drag listener
outlives the component in jsdom (nothing generates the click that would consume
it), so a test that dragged poisoned whatever ran next. The reducer underneath it
is tested; the gesture is verified by hand.

## The padlock, and what it is allowed to claim

The padlock was a decoration: `getBrowserUrlSecurity` read the scheme out of the
address bar, so anything `https` got a green lock and anything `http` got a
warning triangle. Both halves were wrong in a way that mattered.

- **A certificate the user waved through still got the lock.** Patcher asks before
  proceeding past a certificate error and remembers the answer for the session
  (`acceptedCertificates`, keyed `host|fingerprint`) — so a page can be encrypted
  and completely unidentified, and the omnibox called it secure. Worse, the
  exception is the _manager's_: a second tab reaching the same host is let
  through without being asked, and its padlock claimed the same thing.
- **Loopback got the warning.** `http://localhost:5173` never touches a network,
  and Patcher's own pages are served exactly that way, so the triangle warned about the
  one class of page with nothing to warn about.

So the padlock now has one source (`browser-page-security.ts`) that combines what
the URL settles with the single fact only the shell knows, pushed on every
committed navigation over its own channel (`onPageSecurity`):

| State                   | Glyph   | What it says                                    |
| ----------------------- | ------- | ----------------------------------------------- |
| `encrypted`             | lock    | others on this network cannot read it           |
| `certificate-untrusted` | warning | encrypted, but nobody vouched for the other end |
| `plain`                 | warning | travels in the clear                            |
| `local`                 | laptop  | never leaves this machine                       |
| `none`                  | search  | no page, so no claim                            |

The wording lives beside the states rather than in the component, so the glyph and
the sentence cannot drift apart and a test can hold the browser to what it says.

**What the padlock deliberately does not check**: mixed content, cipher age,
revocation — Chromium's own security state. That lives behind the DevTools
protocol, and a tab may have only one protocol client (the same constraint that
makes automation refuse a tab whose developer panel is open). A padlock that
needed it would go blank exactly when a developer was looking at the page, so the
popover says what it knows rather than implying a check that did not happen.

### Clicking it opens the site panel

A claim nobody can inspect is a claim nobody can check, so the padlock **is** the
trigger: it opens a popover with the state, the host, what it means in the user's
terms, and then whatever plugins know about the site. Like the tab menu, the panel
hangs over the page area and therefore freezes the page while it is open — see
the tab menu's section for why, and for the one-owner rule. Within the chrome the
two panels (this and downloads) close each other, so one page never has two
things claiming its freeze.

### The plugin point: sections, not controls

`patcher.browser.registerSiteInfoProvider` adds a section — a label and rows of
`{ label, value }` — asked each time the panel opens, concurrently, time-boxed at
2s and failure-isolated, exactly like an omnibox provider. A provider with nothing
to say about _this_ site returns null and no heading appears.

Rows are **text**. A section reports; anything to _do_ belongs on the tab menu or
the page's context menu, where a click already has somewhere to go. That keeps the
panel from becoming a second settings screen with no state behind it.

The request happens inside the popover's own content rather than behind an
`enabled` flag, which is structural rather than clever: a closed Radix popover
renders no content, so a provider that does real work to answer is not asked while
nobody is looking. Permission: `siteInfo.register`, its own for the reason
`tabMenu.register` is its own.

**Not built, and named rather than implied**: per-site permission toggles (Patcher's
permission policy is fixed in the shell, so there is nothing per-site to toggle
yet), a cookie count, and "clear data for this site". The panel says what is true
today.

The **thread panel's** browser chrome keeps its own three-way glyph and gained no
panel: it is a preview surface, and the shell pushes page security to whoever asked
for the surface's tab. It does inherit the loopback fix — a `local` page falls
through to its neutral glyph instead of the warning — so the one lie it could tell
is gone even though it makes no new claim.

## The toolbar: the first surface asked about a page nobody clicked

The address row had Patcher's own controls and nothing else. `patcher.browser.registerToolbarItem`
puts a plugin's control there — between the address bar and Patcher's downloads and
open-externally buttons, which is where a browser keeps other people's things and
leaves its own where the user learned them.

What made this one different from every browser point before it: the control has
to be **right before anyone touches it**. A star that only fills in once you press
it is not a star. So the surface has two halves that are asked for at different
times:

- the **declaration** — id, title, icon — arrives with every other contribution,
  once, and is enough to draw a complete control;
- the **state** — `{ active, title }` — is asked per page, as the user navigates,
  and only of the controls that offered a `state` at all.

`hasState` therefore rides on the contribution rather than being discovered from
the first answer. It is what buys the guarantee worth writing down: **a plugin
whose control looks the same everywhere costs nothing as the user browses.** With
no `state` declared, the app never issues the request, and the plugin's process is
never woken.

Every field of a state is optional, and every one has a declared default, because
the answer arrives after the control is on screen. That is also why the **icon is
fixed at registration**: a per-state icon would mean the first paint shows the
wrong glyph and swaps it a moment later. `active` renders as an accent on the
declared icon instead — Patcher's own downloads button already tints itself the same way
— and `aria-pressed` carries it to a screen reader.

Pressing runs server-side, time-boxed like a picked menu entry, with one
difference from every other run: the app **awaits it and then asks for states
again**. A control that toggles something therefore stops looking like it did
before the press without the plugin doing anything else, and what it looks like
afterwards is still the plugin's answer rather than the app's guess.

### One control per plugin

The menus let a plugin register as many entries as it likes. This point allows
one, refused at registration rather than dropped at render: a menu grows downwards
for free, the address row does not, and a plugin that found out at render time
which of its buttons survived could not do anything about it. A plugin that needs a
second control has a panel of its own to put it in — see "The leading edge belongs
to plugins".

### Why it costs a permission of its own

`toolbar.register` rather than sharing with the menus, and the reason is the
sentence above about state: every other browser point is scoped to something the
user did — a right-click, a picked entry, an opened panel. This one hands the
plugin **the address of every page the user opens**, on navigation, unasked. That
is a different thing to agree to, so it is a different line in the manifest.

The **thread panel's** chrome has no toolbar point: it is a preview surface, and a
control that appeared beside a preview would be a second place for the same plugin
to be pressed with no second thing to say.

## The new-tab screen, and the sections plugins add to it

A fresh tab shows what Patcher knows: recently visited pages. `patcher.browser.registerNewTabWidget`
adds a section under that — saved pages, a reading list, yesterday's closed tabs.
Permission: `newTab.register`, which is the cheapest of the browser's permissions
to reason about, because a new tab has no page: nothing about the user's browsing
is disclosed and what the permission buys is the placement itself.

**Rows are links, not controls.** A row carries `{ title, subtitle?, url }` and
clicking it navigates — no plugin code runs on the click. That is what makes a
saved-pages list feel like part of the browser rather than a remote call per row,
and it is why the URL is checked when the widget answers rather than when the user
clicks: `http` and `https` only, so a `javascript:` row is refused at the source.

Two things this surface does that the toolbar does not:

- **The screen is asked, not the app.** Rows come from a per-tab request made when
  a new-tab screen appears, gated on a declaration in the contributions list — with
  no widget registered, opening a tab issues no request at all. The declaration
  carries **ids only**; the heading travels with the rows, so no fact is stated on
  two wires.
- **It lands on both browsers.** `BrowserTabContent` renders this screen for the
  browser surface _and_ for the thread panel's browser, so a widget shows up beside
  an agent as well as on its own tab. The toolbar deliberately went to the surface
  only, because a control beside a preview would be a second place to press with
  nothing new to say; a _list_ has the same value in both.

The screen used to render nothing when there were no recents. It now renders
whenever a section might have something, because an install whose only new-tab
content comes from a plugin would otherwise never ask for it.

The worked example of all of this is `examples/plugins/bookmarks`: the star, the
list, `Cmd+D`, an omnibox provider and its own SQLite, with no change to the
browser. It is what the three surfaces were built for, and reading it is the
fastest way to see what they cost a plugin author.

## Commands a plugin owns

`patcher.ui.registerKeybinding` rebinds a command Patcher already has. `patcher.ui.registerCommand`
adds one Patcher has never heard of, with the chord that runs it — the last thing the
bookmarks-shaped features were waiting on, since `Cmd+D` cannot belong to a plugin
otherwise.

**The chord is not in Patcher's keybinding config, deliberately.** Patcher's command ids are
a closed enum (`APP_COMMAND_IDS`) that the settings UI, the palette metadata and
the user's override store all key on, and widening it for ids Patcher has never seen
would trade a compile-time guarantee for a string in every one of those places.
Plugin commands ride the contributions channel instead, where every other plugin
surface already lives, and the app matches them **after** every one of Patcher's own
bindings in the same loop — one place decides precedence, rather than two listeners
racing on the window.

What follows from that ordering, and is worth stating because it is a limit:

- **Patcher wins a contested chord**, the user's own rebindings included. A plugin
  cannot take `Cmd+T` away from the browser.
- **Between plugins, the lowest plugin id wins**, the same rule contested
  keybinding overrides already use, so nothing depends on load order.
- **Settings → Keyboard lists plugin commands** under their own heading, read-only,
  and names Patcher's own command when it shares the chord. It says "where both apply,
  Patcher's wins" rather than "this will not run", because Patcher's bindings are _scoped_:
  `Mod+D` is `diff.toggle` everywhere except a focused browser, which is exactly
  where the bookmarks example's `Cmd+D` wants to work. A row that claimed the
  command was dead would be the same kind of lie the padlock used to tell, in the
  other direction.
- **A chord never fires while the user is typing or a dialog is open** — Patcher's own
  scope rule, applied unchanged.

`run` is handed **no context**, which is the decision worth defending: passing the
current page would give every chord the address of whatever the user is looking at,
for a shortcut. A command that needs the page reads it (`patcher.browser.page.getUrl()`)
and pays `tabs.read`, the permission that already governs exactly that. Which is
also why `registerCommand` itself is ungated — a chord that runs the plugin's own
code discloses nothing.

## Pages a plugin restyles, and the first permission that names sites

`patcher.browser.registerPageStyle` applies a plugin's CSS to the pages the user let it
reach. It is the cheapest thing on this list and the first one that touches the
page itself rather than the chrome around it: hiding a banner, widening a column,
restyling a site somebody stares at all day is one rule, runs no plugin code in the
page, and reads nothing back.

**The permission answers _where_, and that is new.** Every other browser permission
answers _what_ — "may add a toolbar control", "may read a page" — and the plugin
then reaches whatever that buys. Styling one site the user named and styling every
site they visit are not the same risk, so one flag covering both would say neither.
The declaration is therefore split in two:

```json
{
  "patcher": {
    "permissions": ["pageStyle.register"],
    "sites": ["https://github.com/**"]
  }
}
```

`permissions` says the plugin restyles pages; `patcher.sites` says which ones, as URL
globs in the dialect route patterns already use. A registration's `matches` must be
**one of the declared patterns** — membership, not containment. Code picks from the
list the user read before installing and cannot widen it, and nobody has to trust an
answer to "is this glob inside that glob". `https` only, except loopback over plain
http, for the reason a registered search engine's template is: standing access to a
site the user is signed in to, over a connection anyone on the path can
impersonate, is not a plugin's call to make. `patcher.sites` is unrelated to
`patcher.sdk.hosts`, which is enrolled machines; these are websites.

Not to be confused with the _frontend_ `contentScripts.register`, which is trusted
code in Patcher's own page. This is CSS in a browsed page, and it was the first of the two
things a Chrome extension does that Patcher could not. The second — the plugin's own code
in a browsed page — is [below](#a-plugins-own-code-in-a-browsed-page).

### What the browser can promise about applying it, measured

All three of these were measured against Electron 41.7.0 rather than assumed, and
each one shapes the design:

- **Inserted CSS lives exactly one document.** It does not survive a navigation or
  a reload. So the shell holds the declared set and re-applies whatever matches on
  every committed navigation — and nothing has to be removed when a tab leaves a
  matching site, because the document that carried the stylesheet is already gone.
- **Main frame only.** A subframe keeps its own stylesheets, so an ad in an iframe
  is not something a page style can reach.
- **After commit, not before first paint.** The earliest hook that works is the
  navigation committing (`did-start-navigation` leaves `insertCSS` pending
  forever). A page's own inline script at the top of the document can still observe
  the unstyled state. In practice a rule lands before a network page has streamed
  the element it hides — but "in practice" is the honest word, and a style that must
  never be seen is not something this surface can promise.

### Why the shell holds the list

The renderer pushes the whole set on a new channel (`setPageStyles`, feature-
detected per Invariant 2) and the shell does the matching. Not because the renderer
could not match, but because it is not there at the right moment: re-application
belongs to the instant a page commits, and a round trip to the renderer would be a
race against first paint.

It is a **replacement**, not an add/remove pair. The renderer already knows the
complete set; reconciling two incremental streams against what a document currently
carries is a bug waiting for a reload to expose it. What the shell does with each
push is compare desired against applied per view — so a style whose plugin was just
removed comes off the page in front of the user, and one just installed goes on
without waiting for a navigation.

Two things follow that are worth knowing:

- **Same-document navigation reconciles too.** An SPA route change keeps the
  document, so its stylesheets survive — but the address moved, and that is exactly
  where one site's pattern stops matching and another's starts.
- **A page that is not a site gets nothing.** A fresh view is on the empty URL, and
  `https://**/**` is a pattern a plugin may declare, so "every site" must not be
  read as claiming Patcher's own blank page.

### A panel that comes and goes with the site

The other half of "when I'm on GitHub, show me my open PRs" is the panel, and it is
already a plugin surface — the window's leading edge. What it was missing is
_when_: `experimental_leadingPanel` now takes `matches`, the same URL globs, and the
host draws the column only while the active browser tab is on a matching page. The
panel's props carry that page's address, because "my open pull requests" is one
panel but which repository it is looking at is the tab's business.

Declared rather than decided in the component, for the reason the whole leading edge
exists on those terms: with nothing declared the column appears whenever the plugin
is installed, and a component that returns `null` for the page in front of the user
leaves an empty resizable edge behind — on macOS, one that owns the traffic lights.
The host removes the column instead. Filtering also decides the rail: with one of two
panels out of scope there is no choice left to offer.

This costs no permission and is checked against none. The panel is Patcher's own UI, and
what it is told about the tab is the address the address bar is already showing —
whereas `patcher.sites` governs something else entirely, code and styling _inside_ a page.

It is deliberately not scoped to the route: the leading edge is the _window's_, so a
site-scoped panel that vanished the moment the user glanced at a thread would take
the work they were doing in it with them.

The worked example of all three halves is `examples/plugins/site-tweaks`: CSS that
declutters GitHub, a button in GitHub's own page, and a panel scoped to the same site
that keeps notes per repository in the plugin's own SQLite — with no change to the
browser. Its test suite includes the refusal an install makes when `matches` names a
site the manifest does not, which is the property the whole permission rests on.

## A plugin's own code in a browsed page

`patcher.browser.registerPageScript` is the other half, and the one a userscript is
usually reached for: read the page, add a control to it, answer a click by asking
the plugin's backend — which is the part a userscript cannot do, because a page has
no database, no keychain and no way past the site's CSP.

**A separate permission over the same list.** `pageScript.register` is scoped by the
same `patcher.sites`, checked by the same membership rule, refused in the same three
places. It is not folded into `pageStyle.register` because a stylesheet that cannot
read the page and a program that can are not the same disclosure: a plugin the user
let restyle GitHub has not thereby been let read what they do there. Granting this
for a site is granting the plugin what a browser extension gets there.

### Why a session preload, and not the debugger

The obvious mechanism was CDP: `Page.addScriptToEvaluateOnNewDocument` with a
`worldName`, plus `Runtime.addBinding` for the channel back. It would have done
everything, including subframes.

It was rejected on a documented invariant rather than on taste.
[browser-automation.md](browser-automation.md) states that the browser debugger
attaches **lazily**, per tab, on the first automation command — because a debugger
attached to every tab for the life of the app is both overhead and exposure, and
enabling the `Page` domain moves dialogs off Chromium's native path, which changes
what an ordinary browsing session looks like to a human. Page scripts would have
required exactly that, permanently. Worse, CDP allows one client per target: opening
DevTools on a tab takes the session, so page scripts would silently stop working in
the one situation where somebody is debugging them.

So the shell registers a **session preload** for the browsing partition instead —
and registers it _only while at least one plugin declares a page script_. That last
part is the load-bearing property: a user with no such plugin runs a browser whose
pages carry no Patcher code at all, which is the state the shell was in before this
existed. Measured: after `unregisterPreloadScript`, the next document has no preload
and the isolated world is empty.

The standing rule that a browsed page never receives a Patcher bridge survives, because
the preload exposes nothing into the page's own world. It calls
`contextBridge.exposeInIsolatedWorld` for a world **per plugin**, and
`webFrame.executeJavaScriptInIsolatedWorld` runs the plugin's source there. Measured
in the page's own world: `patcher`, the script's globals, `process` and `require` are all
undefined.

### What the browser can promise about running it, measured

Each of these was measured against Electron 41.7.0, and each one shapes either the
API or what the documentation is allowed to claim:

- **Before the page's own first script.** The preload runs when the document exists
  and the parser has produced nothing — `document.documentElement` is still null.
  That is genuinely `document_start`, earlier than a page style lands, so a script
  can patch what the page is about to use. It is also why `patcher.ready` exists: a
  generated script whose first line touches `document.body` would otherwise throw
  every time.
- **A world per plugin, invisible in both directions.** Two scripts of one plugin
  share a world (measured: the second sees the first's globals); two plugins do not
  (each sees `undefined` where the other's marker is). Patcher's own CDP automation world
  is a third world again and shares nothing with either — measured, because a page
  script that could see the automation world, or vice versa, would be a hole in both.
- **Main frame only.** A session preload does not run in subframes without
  `nodeIntegrationInSubFrames`, which is experimental and would change _every_
  browsed page rather than the matching ones. Measured: a cross-origin iframe on a
  matching page never bootstrapped. Same limit as a page style, and left as one.
- **Per document, so a registration takes effect on the next load.** Preloads are
  read as a frame's document is created. Chrome's content scripts behave the same
  way, and the alternative — reloading the user's open pages to make an install feel
  instant — is not a trade the browser gets to make. It also means a site's own
  client-side navigation is _not_ a new document: it replaces the page's content and
  takes the script's elements with it, and re-mounting is the script's job.
- **A throwing script is contained.** The error lands in the page's console — which
  Patcher's observation log already collects, so an agent can read it — the injection
  promise rejects, and the next script still runs. One caveat the implementation has
  to respect: a second `exposeInIsolatedWorld` for the same world throws _and aborts
  the rest of the preload_, so every step there is wrapped.

### The channel back, and where it is checked

`patcher.rpc(method, input)` reaches the plugin's own rpc and nothing else. Getting there
crosses three processes, because no shorter path exists: the browsed page cannot
hold credentials, and the shell deliberately holds none for the Patcher server either. So
the page asks the shell, the shell asks that window's renderer, the renderer performs
the authenticated call, and the answer walks back. JSON text end to end, bounded in
both directions.

The address is the shell's, not the payload's. `event.senderFrame.url` — measured to
be the _new_ document's URL by the time the bootstrap is answered — is what decides
which scripts a frame gets and, on **every** call, whether the named plugin still
claims the page the caller is actually on. A browsed renderer that has been taken
over can therefore reach the plugins already granted its current address, which is
the same set a well-behaved script on that page could reach, and nothing else. The
renderer re-derives the same answer from its own contribution list before calling:
two checks of one rule, in two processes that would have to be wrong together.

Two bounds on top: a per-tab sliding window (60 calls / 10s), because a script in a
loop would otherwise be a page driving the Patcher server, and a 30-second backstop on an
unanswered call, because nothing else in that path has a deadline and a page script
awaiting a promise forever looks like a hung page.

### What is deliberately not here

Loading real CRX bundles, and shimming `chrome.*`. Both look like shortcuts and are
permanent compatibility obligations to a moving target, with a permission model that
is not ours. The agent is the translator instead: "port this userscript" is a prompt.

## The page context menu

Right-clicking a browsed page used to offer cut, copy, paste and select-all —
the editing roles and nothing else. It now offers what a browser offers, chosen
by what is under the pointer rather than shown all at once: a link menu is about
the link, and burying "Open Link in New Tab" under six editing roles is how a
menu stops being usable.

| Target         | Entries                                                |
| -------------- | ------------------------------------------------------ |
| Link           | Open in new tab, open in default browser, copy address |
| Image          | Copy image, copy address, save image                   |
| Editable field | Cut, copy, paste, select all                           |
| Selection      | Copy, search for it                                    |
| Bare page      | Back, forward, reload                                  |

Three of those reuse machinery rather than adding any. "Open in new tab" goes
down the **scoped open-tab channel popups already use**, so the renderer stays
the authority on where a tab goes. "Save image" is `downloadURL`, which lands in
`will-download` and is therefore named, rate-limited and reported by the code
[browser-downloads.md](browser-downloads.md) describes. And every entry that
acts on a URL takes the **same `http(s)`-only rule the popup policy applies** —
a page chooses these URLs, and `javascript:` in a link would otherwise become a
click that runs it. Copying an address stays enabled regardless: that goes to
the clipboard, not to a navigation.

"Search for …" is the one entry that cannot be answered in the shell: the search
engine belongs to the omnibox, and only the renderer knows what it is. So the
**query travels rather than a URL**, on its own channel, and the surface builds
the search with `buildBrowserSearchUrl` — the same function the omnibox uses,
rather than a second copy of the engine in the main process.

### Plugins can add to it

`patcher.browser.registerContextMenuItem` — the plan's `browser.contextMenu.items`.
An item declares an `id`, a `title`, an optional `when` (`link`, `image`,
`selection`, `page`; any match shows it) and a `run(context)` that receives the
tab, the page URL, and whichever of link, image and selection was under the
pointer.

**Items are declared, not asked for at click time**, and that is the design
rather than an optimisation. The menu opens on a synchronous Electron event; a
menu that asked the server what to show would put a round trip in front of every
right-click. So the app pushes the declared list to the shell whenever plugins
change, the shell composes it from what it already holds, and only the _click_
travels back — app → server → the plugin's `run`.

Two consequences worth stating because they are visible to plugin authors:
`title` and `when` are fixed at registration, so an item cannot label itself
from what was clicked; and entries append **below** the browser's own behind a
separator — a plugin adds to this menu, it does not rearrange it.

`examples/plugins/explain-selection/` is the worked example, and it is the
plan's own Phase 6 one: "Explain with Agent" on a selection, spawning a Patcher
thread that quotes it. Its README is where the first consequence above is
argued from the plugin author's side — an item that needs configuration cannot
decide per click, so it registers nothing until it has some. The end-to-end path
is `heroes.test.ts` > `hero plugin: explain-selection`, which is plan §22's
second scenario: install → declared entry → picked → the selection in an agent's
first message.

## Find in page

`Cmd+F` opens a find bar over the active tab: a field that searches as you type,
a `3/12` counter, arrows, Escape to close. Chromium does the searching —
`webContents.findInPage` / `stopFindInPage`, with the counts arriving on
`found-in-page`.

It rides a new channel pair and an optional `find` / `onFindResult` on
`PatcherDesktopBrowserApi` (invariant 2 in [bb-migration.md](bb-migration.md)). Two
channels rather than an invoke pair, because **one query answers many times**:
Chromium reports the count while it is still scanning, so a request/response
shape could carry only the first of those answers or only the last.

Three details are worth keeping:

- **The query rides every command**, including `next` and `previous`. Not an
  oversight — Chromium's own find takes the text on each call, so a step that
  carried none would have nothing to search for. An empty query therefore reads
  as "stop searching" rather than "search for nothing", which is also what
  clearing the field does.
- **The shell drops results for a superseded query.** The user types another
  character while the previous query is still being counted; both answer. The
  entry remembers the request id it last issued and ignores anything else, so
  the counter never jumps backwards onto a query the bar has moved on from. The
  same id is forgotten on `did-navigate`, because a new document ends Chromium's
  session with it.
- **`findNext` is Chromium's `new_session` under a misleading name**: true
  begins a search, false steps through the one already running. A step with no
  session behind it — the first Enter after a navigation ended one — is treated
  as a new search rather than a no-op.

### The find bar takes layout space, and this one had no choice

The rule below says a transient panel should freeze the page and float over it.
The find bar is the exception, and for a reason that decides itself: freezing
the page to a bitmap is exactly what makes the highlights it just asked for
impossible to see. So the bar sits in the chrome and the page shrinks under it —
which is where Firefox puts its own — and the deck's existing bounds sync
follows without being told.

`Cmd+F` also joins the shell's host-focusing command set, next to `Cmd+L` and
the tab switcher: the next keystroke has to land in the app's field rather than
in the page.

### Plugins can add to it

`patcher.browser.registerFindAction` — `browser.find.actions`. An action declares an
`id`, a `title` and a `run(context)` that receives the tab, the page URL and the
query. Buttons appear after the browser's own controls and are disabled while
the bar is empty, because every one of them is about the query.

The find bar is the one place that knows what the user is looking for on this
page, which is what makes it worth extending — "search this across my tabs",
"look it up in our docs", "ask an agent about it". Unlike the context menu this
needs no shell involvement at all: the bar is DOM, so the app renders the
declared list and posts the press to the server directly.

## The questions the network asks

Three Chromium events used to fail in silence, and their _defaults_ are what
made them dead ends rather than any missing UI: Electron cancels an
authentication challenge unless someone answers it, cancels a certificate error
the same way, and picks the **first certificate in the store** when a server
asks for a client certificate. So the page failed with nothing said, or a
credential was chosen for the user by position.

All three now ride one channel pair — `onPagePrompt` / `respondToPagePrompt`,
new and optional per invariant 2. They share a channel because they share a
shape: the load is stopped until something answers, and answering hands the
decision back to Chromium. Each prompt carries an `id`, which is what makes a
late answer harmless — a human can still be typing when the tab navigates away.

The view is hidden and the page frozen to a bitmap while one is open, exactly as
a JavaScript dialog does it.

### What is asked, and what is refused without asking

- **A password box is worth spoofing**, so a subresource may only ask when it is
  the page's own origin. Otherwise any page could embed an image from an
  attacker's server, have it answer `401`, and put a credential prompt in front
  of a user looking at someone else's address bar. A navigation may always ask:
  the user went there.
- **The realm is not on the wire at all.** It is server-controlled text next to
  a username field — the reason Chrome stopped showing it — so the shell keeps
  it only as the key deciding which parked requests one answer covers. The host
  is what the prompt shows, because it is the part a user can judge.
- **One prompt per tab.** A second question while one is open is refused rather
  than queued, which is the whole anti-nuisance policy.
- **Proxy authentication is refused outright**: there is no proxy configuration
  here to authenticate against, and a prompt attributed to no site is the least
  answerable of the lot.
- **Only the page's own certificate can be trusted by hand.** A subresource
  riding on a bad certificate is refused unless that exact certificate was
  already accepted for the page — a user cannot judge what they cannot see.
  Acceptance is keyed on host **and fingerprint**, so trusting one bad
  certificate does not trust the next one served from the same name, and it is
  session-only: never written down, gone on restart.

One path is unverified against a real server: declining a **client certificate**
calls Electron's callback with none, which is the one behaviour its docs do not
describe. It is wrapped, so a runtime that refuses it cannot take the main
process down — the request then fails, which is what declining meant.

### A page with a plugin behind it

`patcher.browser.registerAuthProvider` — `browser.auth.providers`. A provider is
asked before the user is, and returning credentials means no prompt appears at
all; that is what makes a password manager a plugin here rather than a feature.
Providers run in plugin id order, sequentially, and the first to answer wins —
asking a second keychain after the first said yes is a lookup nobody needed.

A provider is asked **once per host per tab**. A second challenge from the same
host means the first answer was wrong, and replaying it would spin forever, so
the second one goes to the user.

Certificates are deliberately **not** delegated: "trust this server anyway" is
not a credential a plugin can look up, and it is exactly the decision that
should cost a human a click.

### A crashed or hung page says so

`render-process-gone` and `unresponsive` route into the error text
`did-fail-load` already drives, which is what gives them the error screen that
already exists with a reload button on it — no new surface, no new wire field. A
clean exit says nothing (that is a tab being torn down), `oom` names itself, and
`responsive` takes its own message back while leaving a real load error
underneath alone.

## PDF

`plugins: true` on the browsed view, which turns on Chromium's built-in viewer.
The preference keeps a name from an era that ended — NPAPI and PPAPI are gone,
and PDFium is the only "plugin" left — so what it decides today is exactly one
thing: whether a PDF link is a page or a download.

Without it, Chromium falls back to downloading a document it cannot display.
That was doubly invisible while downloads were denied (the link did _nothing_,
which is how it reached [browser-gaps.md](browser-gaps.md)); with downloads
working it became a file on disk, which is still the wrong answer for a browser
whose whole point is to be the user's real session.

What it admits is one more parser of a complex, attacker-supplied format next to
untrusted content. That is the bargain every Chromium-based browser makes, and
what bounds it is that PDFium runs in its own sandboxed process rather than in
the page's renderer. The alternative — every PDF becomes a download opened by
the OS reader — moves the same parsing to a program with **no** sandbox at all,
so refusing here would not have been the safer choice, only the one that looked
safer.

Two consequences worth knowing:

- The viewer brings **its own toolbar** (zoom, rotate, print, download) drawn by
  Chromium inside the page. It is not ours and does not follow the app's theme.
- Its download button goes through `will-download` like any other download, so
  it is named, rate-limited and reported by the same code
  ([browser-downloads.md](browser-downloads.md)).

### Reading one as text

`readPage` answers a PDF tab with the document's text, so `page.get_text` works
on a PDF the way it works on an article. Everything about how is decided by one
fact: **the text is not in the DOM.** Chromium leaves a stub in the main frame —
a stylesheet link and an empty body — and renders the document in a process of
its own, so `document.body.innerText` is `""`.

Two ways around that were tried against a real viewer before the third was
written, and both are recorded in desktop-browser-pdf-text.ts so they are not
tried again. **The accessibility tree** does not carry it: PDFium builds one —
it is how a screen reader reads a PDF in Chrome — but in the browser process,
not in the renderer CDP answers from, so attaching to the PDF content frame
returns five nodes ending in an `EmbeddedObject`, with
`--force-renderer-accessibility` making no difference. **Asking the viewer** for
its selection means scripting an extension frame whose internals carry no
compatibility promise.

So the shell refetches the document and parses it:

- **Through the browsing session**, with `credentials: "include"`. That is what
  makes a PDF behind a login readable at all — the cookies that fetched it for
  the viewer fetch it again — and the usual answer comes straight from the cache
  the viewer just filled.
- **Bounded while streaming.** The body is read in chunks against a 32MB cap, so
  a server that keeps sending is refused at the first chunk past it rather than
  buffered whole: `Content-Length` is a claim, and `arrayBuffer()` on a body
  that keeps going is a page-controlled allocation in the main process.
- **In a utility process.** Not for privilege — the parser is JavaScript, so
  this is not the sandbox PDFium has — but because parsing is unbounded CPU work
  on a document the page chose, and the main process is where every window's UI
  thread lives. A parse that spins there freezes the app and no timeout can
  rescue it; a parse that spins in a child is killed. One process per document,
  killed as soon as it answers.
- **Under one deadline** of 15s covering fetch and parse together, so a slow
  server cannot buy the parser more time than the whole read is allowed.

The parser is pdf.js, packaged as `unpdf`: one dependency, no native code, and
no `eval` or `Function` constructor anywhere in the build — the path that made
CVE-2024-4367 possible was removed upstream rather than switched off.

What it does not do, stated rather than discovered:

- **`blob:` and `data:` documents are out of reach**, because the main process
  cannot resolve a URL that means something only inside one renderer, and
  neither can a document that exists only as the answer to a POST. All of them
  read as `unreadable`. An in-page fetch would cover the first two and is the
  fallback to add if it turns out to matter.
- **A long document is truncated** to the same 64KB every page read is, with
  `textTruncated` set. There is no page range to ask for.
- **A scan reads as nothing**, because there is nothing to read: its pages are
  images. The agent is told so — "no text layer" — rather than handed an empty
  success that reads as a blank document.

Two refusals are PDF-only and exist because each is worth a different next step
than "could not be read": `too-large` says the document is past the cap and will
not become readable by asking again, and `password-protected` says a human has
something the agent does not.

### The plugin contribution point

`patcher.browser.registerPdfTextProvider` — `browser.pdf.textProviders`. A provider
is handed `{ tabId, pageUrl, title }` and returns the document's text, or null.

It is asked in exactly one case: a document the browser parsed and found **no
text** in. That is the scan above, and it is the one case where reading needs
something the browser does not have — an OCR pass, a document service — and the
one case where asking costs nothing, because the built-in read has already come
back empty. A PDF with a text layer never reaches a provider, so this is not a
way to intercept ordinary reads.

Providers are asked in plugin id order and the first non-empty answer wins;
declining, throwing, and running past the 10s box all mean "ask the next one".
That box is the longest of any browser hook because this is the only one asked
to do real work, and nothing is held up on screen while it runs — an agent is
waiting for a tool result.

The viewer itself still offers no hook, for the reason it never did: it is
Chromium's own. A plugin that wants to re-home or convert PDFs registers a
download handler ([browser-downloads.md](browser-downloads.md)) instead.

## Developer tools

`Cmd+Alt+I` — Chromium's own chord — opens Chromium's own DevTools: Elements,
Console, Network, Sources. Not a panel that resembles them. The shell creates a
second native view, points the page's `webContents` at it with
`setDevToolsWebContents`, and opens the tools with `mode: "detach"` — detached
meaning "the host is ours", without which Chromium would dock them into a window
of its own choosing.

That decides almost everything else about the feature:

- **The app renders one control and nothing else.** `BrowserDevToolsPanel`
  reserves the area and reports its rect, exactly as `BrowserTabContent` does
  for the page. The exception is a close button, and it is an exception made
  after seeing the panel run: DevTools are opened detached because the host view
  is ours, and a detached DevTools expects a **window frame** to carry its close
  control — so it draws none. Preferring to add no chrome of our own is worth
  less than being able to close the panel without a keyboard.
- **The panel takes layout space**, like the find bar and for a sharper version
  of the same reason: two native views cannot be stacked, and freezing the page
  to draw over it would defeat the point of inspecting a live one.
- **The tools are per tab**, as in Chromium. Switching tabs hides one tab's
  tools and shows the other's, and the panel still hides for everything the app
  draws across the whole page area — a resize placeholder, a dialog, a network
  prompt, a dropdown — because it is a native view that would otherwise
  composite over them.
- **It no longer hides with the page itself**, which it used to. The page goes
  away for reasons that leave the panel exactly where it is, chief among them a
  failed load: the app hides the page view to draw "page unavailable" in the
  page's rect, and the shell, seeing only that the page had gone, took the panel
  with it. Turning the network off in the Network tab blanked the tools that
  reported it. Only the app can tell those cases apart, so it says which —
  `setDevToolsVisible`, an optional method on a channel of its own, per invariant
  2's shape (the request schemas are wire-frozen). A shell that predates it never
  hears it and keeps the old coupling; an app that never sends it gets the same,
  which is what the thread browser — where "Inspect" can open DevTools with no
  panel of Patcher's own — still relies on.
- **Both directions are reported.** DevTools open without the app asking
  ("Inspect" from the page menu) and close from their own toolbar, so
  `devtools-opened` / `devtools-closed` are pushed rather than assumed.
- **The view takes default web preferences.** It is not a browsed page: it is
  Chromium's own UI, and handing it the hardened, partitioned, sandboxed
  preferences meant for untrusted content would break the tools rather than
  contain them.

### The cost, which was predicted

[browser-gaps.md](browser-gaps.md) said this item would eventually argue with
the CDP decision, and it does: DevTools holds Chromium's only protocol client,
so while the panel is open the automation commands on that tab answer
`debugger-unavailable`.

Nothing had to be built for that. `createCdpSession` already refuses a target
that is attached, precisely because "DevTools is the realistic case", and every
automation result already carries `debugger-unavailable` as a typed refusal. A
human debugging a page and an agent driving it are two clients for one seat, and
the browser says so instead of failing somewhere else.

### Inspect

The page's context menu ends with **Inspect**, where every browser puts it: it
is about the page rather than about what was clicked. It opens the tools if they
are closed and calls `inspectElement` at the pointer, so the Elements panel
lands on the node — again Chromium's behaviour, because it is Chromium's code.

The entry is absent when the caller has no way to host the tools, rather than
present and inert.

## Fullscreen

Two different things share one mechanism. A page that calls the HTML fullscreen
API — a video player's button — gets what Chromium gives it: the **window** goes
to the OS's full screen and the **view** takes the whole content area of it, app
chrome included, with the renderer's own rect waiting untouched in
`desiredBounds` for the way back.

Two settings are what make a real fullscreen button — YouTube's, say — work at
all, and both were found by asking whether the API a page sees is Chromium's:

- **`fullscreen` is a permission**, and this session denied every permission but
  one. A denied `requestFullscreen()` rejects in the page, so
  `enter-html-full-screen` never fires and the button does nothing —
  handler or no handler. It is allowed now; `keyboardLock` stays denied
  _because_ of it, being the permission that would let a page keep the Escape
  that gets the user out.
- **`disableHtmlFullscreenWindowResize: true`** on the browsed view, which turns
  off Electron's own version of the window half so this code can do it instead.
  That is not a smaller behaviour but a more careful one: Electron's cannot tell
  a window the **user** had already put in full screen from one it expanded
  itself, so it would drop the user out of theirs when a video ended. Here the
  window is only taken back out if a page put it there, and closing the tab
  mid-video gives it back too.

With those, the page gets Chromium's own API and nothing simulated:
`document.fullscreenEnabled`, `fullscreenElement`, `fullscreenchange`, the
`:fullscreen` styling, `document.exitFullscreen()` and Escape are all
Chromium's, because all this code does is answer the embedder's question, move
the window and resize the view.

The OS animates its way into full screen, so the bounds applied on the event are
the pre-animation ones; the window's own resize burst re-applies them when it
settles (`endWindowResize`), which is the same path any window resize takes.

`Cmd+Shift+F` is the same expansion asked for by the user instead of by the
page, and it is held in a **separate flag** so a video leaving its own
fullscreen cannot take the user's choice with it, or the reverse. It never moves
the window, only the view — it is gated on the window already being full screen,
so there is nothing to move.

It ends when the tab does, too: switching tabs gives the chrome back, because
the expansion belongs to the tab it was asked for and a tab left expanded would
come back that way over a strip the user can no longer see.

It only does anything while the app window is already full screen, and that gate
lives in the renderer rather than the shell — the renderer is the side that
knows. Covering the tab strip and the omnibox inside an ordinary window would
leave a page with no browser around it and no obvious way back; in an ordinary
window the chord does nothing, which is what a browser does with a shortcut that
does not apply. Leaving the window's own full screen takes the page's with it.

## Drawing over a page is possible, and costs a frozen page

Two documents here say React cannot draw over the page area, and both are right
about the constraint: a native `WebContentsView` composites above the DOM. What
neither said is that there **is** a way through, that this repo already had it,
and that it is worth reaching for when the alternative reads wrong.

JavaScript dialogs freeze the page to a bitmap, hide the native view and draw on
the DOM that is left ([browser-automation.md](browser-automation.md), Stage A).
That sequence is now a command — `setOverlay` — and the downloads dropdown uses
it ([browser-downloads.md](browser-downloads.md)). It buys two things: a panel
that floats over the page, and clicks that land on the DOM everywhere, which is
what makes close-on-outside-click possible at all.

It costs a still page for as long as the overlay is up. So the rule is not "in
layout or nothing", it is:

- **Taking layout space** suits something tied to typing, where the page is not
  what the user is looking at and freezing it for the length of a search would
  be worse. The omnibox suggestion list stays as it is.
- **Freezing and overlaying** suits a transient panel opened and closed in
  seconds, where shoving the page down would read as a bug.

## Next

Milestone B is done: the reused address bar is replaced by the surface's own
omnibox chrome (`showChrome={false}` on the deck), and the per-scope navigation
history this surface records is one of its providers. See
[omnibox.md](omnibox.md) — including why the suggestion list takes layout space
instead of overlaying the page.
