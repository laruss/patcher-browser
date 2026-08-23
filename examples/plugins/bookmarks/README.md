# patcher-plugin-bookmarks

The Phase 8 chrome example — no frontend entry, no dependencies, no
configuration. Press the star (or `Cmd+D`), and the page is on the next new tab.

Patcher has no bookmarks, and that is the point of this example rather than an
omission: **a plugin can own the whole feature.** What the core had to provide was
somewhere to put a control, because nothing else could — and those three
placements are what this plugin uses. See
[`docs/architecture/browser-surface.md`](../../../docs/architecture/browser-surface.md)
for the surfaces and [`docs/TODO.md`](../../../docs/TODO.md) for why bookmarks
live here instead of in the browser.

What it demonstrates:

- **`patcher.browser.registerToolbarItem`** — the star in the address bar, and the one
  surface that is asked about a page _before anyone touches it_: `state` runs on
  navigation, so the star is already filled in on a page saved last week. A press
  toggles, and Patcher asks `state` again once it resolves — the plugin does nothing to
  refresh its own control.
- **`patcher.browser.registerNewTabWidget`** — the list. Rows are **links** the plugin
  resolved when asked, so clicking one is navigation and never a call back into
  this process. With nothing saved it returns `null`, and a new tab looks exactly
  as it did before the plugin was installed.
- **`patcher.ui.registerCommand`** — `Cmd+D`, a command Patcher had never heard of. It is
  handed **no context**: it reads the page with `patcher.browser.page.getUrl()` and pays
  the `tabs.read` it already needed, instead of every chord in the app carrying the
  user's current address. Patcher's own bindings win a contested chord, and
  Settings → Keyboard lists this one under "Plugin shortcuts".
- **`patcher.browser.registerOmniboxProvider`** — typing finds what was saved, as a
  `navigate` row scored below the browser's own default action, so Enter still does
  what the user typed.
- **`patcher.storage.database()`** — the plugin's own SQLite, so the list survives a
  restart. One `toggle` behind the star, the chord and a second press of either, so
  they cannot disagree about what "saved" means.

Three details worth reading the code for, because each is a bug that was there
first:

- **A blank page title is stored as no title.** A row must carry a non-empty
  title, and the host drops a widget's _whole answer_ over one bad row — so an
  untitled page would have cost every other bookmark its place in the list.
- **`http`/`https` only.** The chord fires anywhere, including on Patcher's own screens
  and `file:` paths; the host would refuse those rows anyway, so the store never
  holds what the list could not show.
- **`ORDER BY saved_at DESC, rowid DESC`.** Two pages saved in the same
  millisecond is ordinary — a chord, then the star — and "newest first" has to mean
  something then too.

## Try it

```bash
patcher plugin install ./examples/plugins/bookmarks
```

No settings. Open a page, press the star or `Cmd+D`, then `Cmd+T`: the page is
under "Bookmarks". Start typing its title in the address bar to jump back to it.

## What it does not do

No folders, tags, import, export or sync — §19 of the project plan rules out a
complete bookmark manager, and this is the example that shows the surfaces, not a
product. It also has no way to remove a bookmark from the list itself: the star on
the page and a second `Cmd+D` are the ways out, which is enough for a page you can
still reach and deliberately not enough for one you cannot.

## Tests

```bash
bun run --cwd examples/plugins/bookmarks test
```

Against `@patcher/plugin-sdk/testing` — no Patcher server, no browser, but a real SQLite
file in a temp directory, so the store is exercised rather than mocked. The
end-to-end pass over the three routes the app actually calls lives in the server
suite, as `hero plugin: bookmarks` in
`apps/server/test/services/plugins/heroes.test.ts`.
