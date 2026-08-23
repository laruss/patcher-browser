# Browser History

The [browser-gaps.md](browser-gaps.md) Data item that was not a browser feature
at all: history was **24 rows of `localStorage`**, per surface, per window.

That number is what made it a recents list rather than a history. It capped the
new-tab screen's "Recently visited" (fine), but it was also the entire corpus
the omnibox could ever rank against — the ranking work in [omnibox.md](omnibox.md)
was competing over 24 rows — and it was in a place no plugin and no second
window could read.

Now it is a server table with an API in front of it, and the browser writes to
it over that API like anything else.

## Scope, not ownership

A row is keyed `(scope_id, url)`. The scope is the surface the visit happened on
— an agent thread's id, or the browser surface's own `browser-surface` — and it
is what keeps the new-tab screen showing _this thread's_ pages, which is the
behaviour the localStorage version had by accident of where it stored things.

Two consequences worth stating, because both were choices:

- **Reads are not scoped by default.** The omnibox and anything that wants "the
  user's history" reads across every scope; `scopeId` narrows a read rather than
  owning the rows. A page visited in a thread is still a page the user visited.
- **`scope_id` is not a foreign key to `threads`.** The browser surface is not a
  thread, so the column could not be one — and a scope that outlives its thread
  leaves history readable rather than cascading it away. Deleting a thread does
  not delete what was read while it was open.

A revisit updates `last_visited_at` and increments `visit_count` instead of
adding a row, so the table counts _pages_, not page views. That is what keeps it
small enough to search with `LIKE` and no FTS index.

## Case folding is done in JavaScript, on purpose

The table carries a `search_text` column holding `url` and `title` lowercased —
by JavaScript, before the write.

SQLite's `lower()` and its `LIKE` fold ASCII only. A title in Cyrillic, Greek or
anything else with case outside ASCII would never match a query typed in the
other case, and the user of this browser types in Russian. One redundant column
is the cheapest correct answer; the alternative was an ICU build or FTS5, both
of which are a dependency decision for a substring match.

## The cap, and who pays for it

`BROWSER_HISTORY_MAX_ENTRIES = 10_000` distinct pages. Over that, the oldest are
dropped on insert, so the cost of the cap falls on the visit that caused it
rather than on a sweep nobody scheduled.

The cut is by `last_visited_at` rather than by row count, so entries sharing the
cutoff timestamp survive together: an import that stamps a thousand visits with
one timestamp should not lose an arbitrary half of them.

## Plugins see a visit before it is stored

`patcher.browser.registerHistoryFilter(filter)` is called with every visit on its way
to the table, and returns one of three things:

| Return           | Effect                        |
| ---------------- | ----------------------------- |
| nothing          | record the visit as it stands |
| `{ url, title }` | record something else instead |
| `null`           | do not record it              |

That is deliberately the whole vocabulary, and it is enough for the things a
browser would otherwise need settings for: "never record this host" is a plugin,
"strip the tracking parameters" is a plugin, "retitle pages whose own title is
useless" is a plugin. Filters run in plugin id order, each seeing what the
previous one left, so a rewriting plugin and a dropping plugin compose instead
of racing.

`undefined` and `null` mean opposite things here, which is the one hazard in the
design: over the plugin process boundary they are the same JSON value. So the
decision is normalised into `{ drop: true }` / `{ rewrite }` on whichever side
ran the filter (`plugin-history-filter.ts`), and read back into an ordinary
filter's return value on the other. The out-of-process test in
`plugin-browser-history.test.ts` exists because the first version of this
normalised twice and silently dropped every rewrite.

Reading and editing the store afterwards is `patcher.sdk.browserHistory` —
`list`, `record`, `remove`, `clear`. Both halves are gated by one `history`
permission rather than a read/write pair: neither gate that enforces it sees the
HTTP method (one keys on the `patcher.sdk` area, the other on the URL prefix), so a
read-only variant would be a boundary on paper that `DELETE
/browser-history/:id` walks straight through.

`record` taking an optional `visitedAt` is what makes an importer possible — a
plugin that reads Chrome's or Firefox's history and writes it here keeps the
timestamps.

## What is broadcast, and what is not

Removals broadcast `browser-history-changed`; ordinary visits do not.

A visit happens on every page load, and telling every open window to re-read its
recents that often is a lot of traffic for a list the window that navigated can
refresh on its own. A removal is the opposite: rare, asked for by the user, and
a window still showing what another one just cleared is showing something the
user asked to be gone.

The recording side has its own quieting: a browsed tab reports its state
whenever anything about it changes, so the same finished page arrives many
times. Against `localStorage` that cost a rewrite nobody noticed; against the
server it would be a request per report, each one running every plugin's
filters. `useBrowserHistory` drops a repeat of the last `url`+`title` it sent.

## What the omnibox does differently now

The history provider used to be handed an array and score it. It now takes a
`search` function, is `async`, and asks the server per keystroke — the store is
too large to hold in a renderer and too useful to sample.

The server does the substring match and returns up to
`OMNIBOX_HISTORY_SEARCH_LIMIT` candidates newest-first; the provider still
scores them with `scoreOmniboxTextMatch`, so ranking is unchanged and a row
whose only match was somewhere the ranking does not count is dropped rather than
shown with a zero score. Recency still needs no score term: equal-scoring rows
tie on input order, and the server's order is newest first.

The controller already had what this needs — providers may be async, runs are
debounced, and each run carries an `AbortSignal` a provider is expected to
forward.

## Next

- **A history page.** There is no screen for this yet: no per-day view, no
  search UI, no bulk delete. The API under it is complete (`list` takes a query
  and a limit, `remove` takes an id, `clear` takes a scope), so this is a UI.
- **Clear browsing data.** `clear` deletes history rows and nothing else —
  cookies, storage and the cache are still untouched, which is the separate
  [browser-gaps.md](browser-gaps.md) item.
- **Frecency.** `visit_count` is stored and exposed and nothing ranks on it yet;
  the omnibox scores text match alone. That is deliberately left to whatever
  omnibox work comes next rather than folded in here.
- **What is not recorded is the app's decision.** The surface still records any
  non-empty URL it finishes loading, including `about:blank`. A filter can drop
  those today, which is why no rule for it was hardcoded.
