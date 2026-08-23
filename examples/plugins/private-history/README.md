# patcher-plugin-private-history

The `browser.history.filters` example — no frontend entry, no dependencies.
Name a few hosts, and the browser stops remembering them; everything it does
remember loses its tracking parameters on the way in.

The browser has no idea what a "private host" is, and it does not need one. It
asks whoever registered a filter, and this plugin answers — which is the point
of the example: it does not add a surface the browser was missing, it **changes
a decision the browser was already making**. See
[`docs/architecture/browser-history.md`](../../../docs/architecture/browser-history.md).

What it demonstrates:

- **`patcher.browser.registerHistoryFilter`** — the only place a plugin sees a page
  before it is stored. Returning nothing accepts the visit, `{ url, title }`
  records something else, and `null` drops it. All three appear here.
- **Reading settings out of the hot path** — the filter runs on every page load
  and is time-boxed to a second, so the host list is read once at load and kept
  current with `settings.onChange` rather than awaited inside the filter.
- **`patcher.sdk.browserHistory`** — the other half of the same `history` permission,
  and a different job: the filter decides what is stored from now on, the SDK
  cleans up what was stored before the rule existed. `patcher private-history forget
<text>` lists matching entries and removes them.
- **`patcher.browser.registerSiteInfoProvider`** — a third face of the same
  permission, in the panel behind the address bar's padlock: how many pages this
  site has in the store, and whether recording is off for it. The section reads
  the store rather than keeping its own tally, so what it shows is what a
  `patcher private-history forget` would find.
- **`patcher.status.needsConfiguration`** as a hint rather than a refusal — with no
  hosts named the plugin still strips tracking parameters, so it loads and says
  what it is missing instead of contributing nothing.

## Try it

```bash
patcher plugin install ./examples/plugins/private-history
patcher plugin config private-history set hosts "internal.example, bank.test"
patcher plugin reload private-history
```

Then browse. `patcher private-history list` shows what was kept.

Subdomains count: `internal.example` also covers `vpn.internal.example`. A host
ending in the same letters does not — `notbank.test` is not `bank.test`, and the
test for that is there because a suffix match is how a host rule quietly stops
meaning what the user wrote.

## What it does not do

Dropping a visit is not private browsing. The page was still loaded in the
user's real session: cookies were sent and set, the cache was written, and the
site knows. This keeps a URL out of one local table — useful for a shared
screen, not a substitute for an incognito profile the browser does not have yet.

## Tests

```bash
bun run --cwd examples/plugins/private-history test
```

Against `@patcher/plugin-sdk/testing`: no Patcher server, no browser. The harness holds
the registered filter, so the tests call it directly with a visit.
