# Omnibox

Milestone B of [`docs/PROJECT_PLAN.md`](../PROJECT_PLAN.md) §11: the address bar
becomes an aggregation of providers instead of a single text input.

The plan's §12 vertical slice is what this exists for — plugin suggestions mixed
into the same ranked list as the browser's own. So the shape that matters here is
not the UI but the seam: `OmniboxProvider`. Milestone C bridges the plugin
contribution point onto it and should need no change to the controller, the
ranking, or the chrome.

## Layers

| Piece                                        | File                                                       |
| -------------------------------------------- | ---------------------------------------------------------- |
| Provider contract, actions, dedupe identity  | `lib/omnibox/types.ts`                                     |
| Aggregation, caps, ranking                   | `lib/omnibox/rank.ts`                                      |
| Debounce, cancellation, progressive emission | `lib/omnibox/controller.ts`                                |
| Default action (what Enter does)             | `lib/omnibox/default-action.ts`                            |
| Arrow-key cycle                              | `lib/omnibox/highlight.ts`                                 |
| Built-in providers                           | `lib/omnibox/providers/*.ts`                               |
| React binding                                | `lib/omnibox/useOmnibox.ts`                                |
| Chrome (nav controls + input + list)         | `components/browser-surface/BrowserSurfaceChrome.tsx`      |
| Suggestion list                              | `components/browser-surface/BrowserOmniboxSuggestions.tsx` |

Everything above `useOmnibox` is free of React and of any Patcher service, so the
timing rules are tested with fake timers rather than through a rendered
component.

## The rule the ranking hangs on

**The first row is always what Enter does.**

Enter with no row selected resolves its action synchronously from the typed text
(`resolveOmniboxDefaultAction`, which is `resolveBrowserAddressInput` — the
address bar's existing rule, unchanged). It never reads the suggestion list.
Pressing Enter 20ms after typing therefore does exactly what pressing it 2s later
does. A default read off the list would depend on whether providers had answered
yet, which a user experiences as the address bar losing keystrokes.

For the visible list to agree with that, score 1 is reserved: exactly one of the
navigation and search providers claims it for any query (address-like input goes
to navigation, everything else to search), and every other provider stays below.
The controller clamps provider scores into [0, 1], so a provider cannot outbid
the default action by returning 99 — which matters once scores come from plugins.

### Which is why the search engine is a template

That synchronous resolution is also what decided the shape of the search-engine
setting. A plugin **cannot** own Enter by being asked for it — every provider is
asynchronous, and the whole point above is that Enter does not wait. So an engine
is a _declared URL template_ (`patcher.browser.registerSearchEngine`, permission
`searchEngine.register`) that the app holds and formats itself, the same way the
shell holds declared context-menu items: Patcher ships a few, plugins declare more, and
the setting picks among them by id.

Two consequences worth stating. An id whose plugin has been removed resolves back
to Patcher's default rather than failing on Enter. And an engine need not search — any
`https` or **loopback** template qualifies, so a plugin route that spawns an agent
thread is a legal engine, which is the thing an agent-first browser wants from its
address bar (`examples/plugins/omnibox-agent` ships one). Plain http to another
machine is refused at registration: a search is every word the user types here.

## Ranking order of operations

1. **Per-provider cap** first, so a provider returning fifty rows cannot crowd
   out the others before ranking starts. Untrusted plugin providers are the
   reason this comes first rather than last.
2. **Deduplicate by action**, keeping the strongest score. An open tab and a
   history entry for the same page is the common case, and two rows that do the
   same thing is worse than one row fewer. Identity is the action
   (`omniboxActionKey`), not the title: the same URL from two providers is one
   row, but "open this URL" and "switch to the tab holding it" are two.
3. **Global sort**, then the overall cap.

Ties break on provider-registration order, never on arrival order. Without that,
a slow provider's rows would jump position between emits _within one query_ — the
list would reshuffle under the user's cursor as answers trickle in.

## Timing

- **~120ms debounce.** One run per word for a fast typist rather than one per
  keystroke. The default action does not wait for it (see above), so the debounce
  costs nothing that the user can act on.
- **Typing emits nothing.** A keystroke schedules a run and leaves the previous
  query's rows up. Blanking the list on every keystroke is a visible flicker;
  stale rows for ~120ms are not.
- **Results emit per provider settle**, not after all providers. One slow provider
  delays only its own rows. This is what keeps an agent-backed plugin provider
  from holding up the search row.
- **Superseded runs are dropped on arrival.** Each run carries a monotonic id and
  an `AbortSignal`. A provider that ignores the signal wastes work but cannot
  write into the current result set — the id check is what enforces that, so
  correctness does not depend on plugins being well behaved.
- **A throwing provider drops out of its run**; the rest still show. With plugin
  providers this becomes the normal case rather than an edge case.

## Providers

| Provider     | Offers                                        | Action       |
| ------------ | --------------------------------------------- | ------------ |
| `navigation` | the typed text as an address, when it is one  | navigate     |
| `search`     | a search for the typed text (always)          | navigate     |
| `open-tabs`  | open tabs matching by title or host           | activate-tab |
| `history`    | previously visited pages                      | navigate     |
| `app-routes` | Patcher's own screens, and every plugin panel | open-app-tab |

`app-routes` is what makes Settings reachable by typing "settings" rather than by
knowing Patcher spells Extensions `/tools/plugins`. Its action is `open-app-tab`, not
`navigate`, because the destination belongs to the window's router: the surface
opens or focuses the destination's tab instead of pointing a `WebContentsView` at
a path (see [browser-surface.md](browser-surface.md), "App tabs"). Its list is
passed in, so a plugin's registered panel appears here on the same footing as
Settings — a plugin gets an address-bar entry by registering a panel, with no
change to the provider.

Matching is deliberately crude — prefix beats substring, nothing else scores.
A wrong fuzzy ranking is harder to explain than a missing row, and fuzzy matching
is a separate decision from the provider architecture.

URL candidates are matched host-first and scheme-stripped, because users type
`gith`, not `https://gith`.

History carries no recency term: entries arrive most-recent-first and equal
scores tie towards the earlier one, so recency is already in the order.

`history` is the one built-in provider that does I/O. Its corpus is a server
table rather than a per-window list, so it asks the server for candidates on
each (debounced) run and forwards the run's `AbortSignal` — see
[browser-history.md](browser-history.md). The server does the substring match;
the scoring above is unchanged and still happens here.

There are no _search completions_ (Google's suggest endpoint). That would make
the browser call out on every keystroke — a network and privacy decision, not an
omnibox one. The provider interface means adding it later is a new file, not an
edit to an existing one.

## Where the chrome lives, and why the list is not an overlay

The surface renders its own chrome and turns off the one inside
`BrowserTabContent` (`showChrome={false}`, defaulting to true so the thread panel
is untouched). Navigation state is read from the native view's own event stream in
the chrome component, so a navigation re-renders the strip alone and not the deck
below it.

The suggestion list is **part of the chrome's layout**, not an overlay over the
page. A native `WebContentsView` composites above the DOM, so anything drawn over
the page area is invisible in the desktop app — the same constraint that forces
the dimming-modal workaround and the resize snapshots (see
[browser-surface.md](browser-surface.md)). Taking layout space means the page
shrinks while the list is open and the bounds sync follows it, which is correct
by construction and needs no main-process change. Drawing the list over the page
requires a native overlay view above the page view; that is a later main-process
step, not a Milestone B one.

Its **width** comes from the address bar rather than from the chrome: the list is
a sibling of the input's `<form>` inside the same flex column, so it cannot be
wider than the control being typed into. It began as a sibling of the whole
toolbar row, which made a window-wide list hang under a much narrower input — two
controls, visually. Sharing the column makes the alignment structural, with
nothing measured and no magic insets to keep in step with the toolbar's buttons.

`Cmd+L` reaches the surface because the surface root carries `data-app-browser`
(the browser command context), and because `BrowserTabContent`'s handler now
declines when it has no address input of its own to focus.

## Verified

- `rank.test.ts` — ordering, per-provider cap, action dedupe, tie stability.
- `controller.test.ts` — debounce coalescing, per-settle emission, superseded
  runs dropped even when the signal is ignored, throw and rejection isolation,
  score clamping and provider-id stamping, blank query, clear, dispose,
  provider swap mid-run.
- `highlight.test.ts` — the arrow cycle, including back through the typed text.
- `providers.test.ts` — each built-in provider, plus cross-provider ordering:
  address first for an address, search first for a query, tab above history.
- `BrowserSurfaceChrome.test.tsx` — mixed list for a real query, Enter before any
  suggestion arrives, highlighted row overriding the default action, click,
  Escape, blur, and navigation state filtered by tab.
- Full `apps/app` suite: 2630 tests. `@patcher/server`: 1436. Repo typecheck: 58/58.
  `bun run lint`: 0 errors.

## The plugin contribution point

Milestone C: `patcher.browser.registerOmniboxProvider` — plugin rows in the same
ranked list, which is the plan's §12 vertical slice and its central hypothesis.

The contribution point is modelled on the mention providers Patcher already had
(`patcher.ui.registerMentionProvider`), deliberately: same shape, same guarantees,
same failure discipline. A plugin registers a provider with an `id` and a `label`
in its server module; `suggest({ query })` runs server-side; the host namespaces
item ids as `<providerId>:<itemId>` and never lets the plugin's internals reach
the client.

### The chain

| Step                                                        | Where                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| `patcher.browser.registerOmniboxProvider`                   | `packages/plugin-sdk/src/backend-contract.ts`               |
| Registration validation, runtime record                     | `apps/server/.../plugins/plugin-api.ts`                     |
| Fan-out, time box, isolation, normalization                 | `apps/server/.../plugins/plugin-service.ts`                 |
| `GET /plugins/omnibox/suggest`, `POST /plugins/omnibox/run` | `apps/server/src/routes/plugins.ts`                         |
| Contributions + fetchers                                    | `apps/app/src/hooks/queries/plugin-contribution-queries.ts` |
| `OmniboxProvider` adapter                                   | `apps/app/src/lib/omnibox/providers/plugin.ts`              |
| Example plugin                                              | `examples/plugins/omnibox-agent/`                           |

The browser core did not change to accommodate any of this. What the adapter
produces is an `OmniboxProvider` like the built-in four, so the controller's
debounce and cancellation, the score clamp, the per-provider cap, the action
dedupe and the failure isolation all apply to plugin rows without the plugin
being able to opt out.

### Two action kinds

- `{ type: "navigate", url }` — the browser opens it. No callback, so a link-only
  provider costs one round trip per query and nothing on pick.
- `{ type: "run" }` — the browser posts the item back and the plugin performs it,
  optionally returning a URL to open (`{ navigate }`). This is what makes a
  suggestion an _action_ rather than a destination: "ask an agent", "start a job".

`run` receives `(itemId, { query })`. The query is part of the contract because a
row like "Ask an agent: <query>" is meaningless without it, and the item id alone
would force every plugin to encode the query into its ids. The client carries the
query on the action, so the browser needs no extra state to perform one.

A row whose action the provider cannot perform (a `run` action from a provider
that registered no `run`) is rejected during normalization, not when the user
picks it — a mistake in a plugin should surface in its log, not as a dead row.

### What a plugin cannot do

- **Take the top row.** Score 1 is the browser's default action; plugin scores
  are clamped to [0, 1] by the _host_, not by the plugin, and plugin providers are
  registered after the built-ins so they lose score ties. What Enter does never
  depends on a plugin.
- **Flood the list.** The per-provider cap is applied before ranking, per
  contributed provider — so two plugins get a budget each rather than sharing one.
- **Break the omnibox.** A throwing, hanging (2s box) or malformed provider
  contributes nothing; the browser's own rows are unaffected. Errors land in the
  plugin's handler stats and log, visible in `patcher plugin list`.
- **Impersonate another source.** The host stamps provider attribution, and the
  row's visible label is the plugin's own — a plugin row is identifiable as one.

### One request, many providers

Each contributed provider stays a separate `OmniboxProvider` so it keeps its own
label and its own cap, but the server answers for every plugin in one call. The
adapter therefore shares a single in-flight request per query across providers
(`createPluginOmniboxSuggestionSource`); every provider in a run carries the same
abort signal, so the shared request is cancelled exactly when the run is.

### Verified

- `apps/server/.../plugin-omnibox-providers.test.ts` — contributions listing,
  aggregation with id namespacing, score clamping (42 → 1) and defaulting,
  dropped throwing/empty/unperformable providers, the suggest time box (a
  provider that never answers disappears while the fast one survives), the run
  action receiving the query, run failures reported rather than navigated, and
  the cross-origin guard on both routes.
- `heroes.test.ts` > `hero plugin: omnibox-agent` — the real example plugin
  installed as shipped: unconfigured it still contributes its navigate row, then
  configure + `reload` adds the agent row, and picking it spawns a Patcher thread
  attributed to the plugin whose URL the browser is told to open.
- `plugin.test.ts` — adapter mapping, query stamping, per-provider group
  filtering, one request per query, rows from different plugins staying distinct.
- `BrowserSurfaceChrome.plugin.test.tsx` — a plugin row rendered under the
  browser's own with its own source label, picking it posting the run and
  navigating to the returned URL, and a failing plugin endpoint leaving the
  built-in rows intact.
- `examples/plugins/omnibox-agent/server.test.ts` — the example against
  `@patcher/plugin-sdk/testing`.

## Next

`browser.tabs.*`, `browser.page.*` and `browser.navigation.*` landed next, as
plugin-facing control rather than a contribution point — see
[agent-browser-tools.md](agent-browser-tools.md), which is also plan §18 Phase 5.

The omnibox remains the first browser contribution point; `browser.omnibox.actions`
and the rest of plan §7 follow the same shape. The plan's §13
target layout (a dedicated browser window rather than a route inside the agent
app) and drawing the suggestion list over the page both need main-process work,
which is where the next browser-shell step goes.
