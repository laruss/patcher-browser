# patcher.browser — the Patcher desktop browser surface

Hooks the browser asks a plugin about (omnibox, context menu, find bar, HTTP
auth, PDF text, downloads, history) and the API that drives tabs and pages.
Every hook runs server-side; the driving calls need a connected browser window,
so call them from handlers, tools, and services, never at load time.

- [Omnibox suggestions](#patcherbrowser--omnibox-suggestions-in-the-browser-surface)
- [Page context menu](#patcherbrowser--adding-to-a-pages-context-menu)
- [Find-bar button](#patcherbrowser--adding-a-button-to-the-find-bar)
- [HTTP auth provider](#patcherbrowser--answering-a-sites-login-prompt)
- [PDF text provider](#patcherbrowser--reading-a-pdf-the-browser-cannot)
- [Download handler](#patcherbrowser--taking-over-downloads)
- [External link routing](#patcherbrowser--routing-a-link-the-system-opened)
- [History filter](#patcherbrowser--deciding-what-the-browser-remembers)
- [Driving tabs and pages](#patcherbrowser--driving-the-browser-surface)

## patcher.browser — omnibox suggestions in the browser surface

```ts
patcher.browser.registerOmniboxProvider({
  id: "agent",
  label: "Agent", // shown as the row's source, next to the browser's own rows
  suggest({ query }) {
    // 2s time box, failure = no rows; the browser's own rows are unaffected
    return [
      {
        id: "ask",
        title: `Ask an agent: ${query}`,
        score: 0.8, // optional, [0, 1], defaults to 0.5
        action: { type: "run" }, // calls run(itemId) below when picked
      },
      {
        id: "docs",
        title: `Search the docs for ${query}`,
        action: { type: "navigate", url: `https://example.test/?q=${query}` },
      },
    ];
  },
  run(itemId) {
    // only for { type: "run" } rows; return a url to open it afterwards
    return { navigate: "https://example.test/done" };
  },
});
```

## patcher.browser — adding to a page's context menu

```ts
patcher.browser.registerContextMenuItem({
  id: "save-selection",
  title: "Save selection to notes",
  when: { selection: true }, // any match shows it; omit `when` for everywhere
  async run(context) {
    // context: { tabId, pageUrl, linkUrl, imageUrl, selectionText }
    await patcher.storage.kv.set(`note:${Date.now()}`, context.selectionText);
  },
});
```

`when` keys are `link`, `image`, `selection` and `page` (a right-click with
nothing under the pointer). Entries appear below the browser's own, in plugin
id order.

Items are **declared, not asked for at click time**: the desktop shell holds
the list so a right-click opens without waiting on the server. The consequence
worth knowing is that `title` and `when` are fixed at registration — an item
cannot decide its own label from what was clicked. `run` is time-boxed (10s)
and failure-isolated, and nothing waits on it: the menu closed when the user
clicked.

`examples/plugins/explain-selection` is the worked example — a selection handed
to an agent — including what to do when an item needs configuration it does not
have, and how to quote page text into a prompt as data rather than as
instructions.

## patcher.browser — adding an entry to a tab's menu

Right-clicking a tab in the browser surface's strip shows Patcher's own entries
(Duplicate, Pin, Mute, Close) and then whatever plugins added, in plugin id
order. This is where "do something with _this_ tab" belongs.

Needs `tabMenu.register` — a separate permission from `contextMenu.register`,
because a tab entry sees a tab rather than what was clicked.

```ts
patcher.browser.registerTabAction({
  id: "file-tab",
  title: "File this tab",
  async run(context) {
    // context: { tabId, url, title, pinned, muted, active }
    // url is "" for a tab with no page yet, and null for a Patcher screen
    // (Settings, a plugin panel) — a tab with no page at all.
    if (context.url === null || context.url.length === 0) return;
    await patcher.storage.kv.set(`filed:${context.tabId}`, context.url);
  },
});
```

Declared like context-menu items, with the same consequence: `title` is fixed at
registration, so an entry cannot rename itself from the tab it appears on. `run`
is time-boxed (10s) and failure-isolated, and nothing waits on it.

To **mark** a tab rather than act on one, use the frontend half —
`contentScript.experimental_setBrowserTabStatus`, in
[frontend-runtime.md](frontend-runtime.md).

## patcher.browser — pinning, muting, duplicating and moving a tab

The same things the tab menu and a drag do, driveable. All of them cost
`tabs.modify`, and each states the end result rather than toggling, so asking
twice lands where asking once did.

```ts
const tabs = await patcher.browser.tabs.list();
const first = tabs[0];
if (first !== undefined) {
  await patcher.browser.tabs.pin({ tabId: first.tabId, pinned: true });
  await patcher.browser.tabs.mute({ tabId: first.tabId, muted: true });
  const copy = await patcher.browser.tabs.duplicate({ tabId: first.tabId });
  // Counting from 0, and clamped into the tab's own block: pinned tabs lead the
  // strip, so an unpinned tab asked for 0 goes first among the unpinned ones.
  await patcher.browser.tabs.move({ tabId: copy.tabId, toIndex: 0 });
}
```

Two limits worth knowing. `tabs.list()` does **not** report which tabs are
pinned or muted — a tab action's context is where you are told. And a mute lives
on the page's own view, so it lasts as long as that page does: a restarted
browser comes back audible.

## patcher.browser — offering a search engine

What the address bar does with text that is not an address. Patcher ships a few
engines; a plugin can offer more, and the user picks one in Settings.

Needs `searchEngine.register`.

```ts
patcher.browser.registerSearchEngine({
  id: "kagi",
  name: "Kagi",
  // `%s` is where the browser puts the escaped query.
  urlTemplate: "https://kagi.com/search?q=%s",
});
```

A **template, not a callback**, and that is the constraint worth knowing: the
browser resolves what Enter does synchronously from the typed text — so that
pressing Enter before the omnibox's debounce elapses does the same thing as
pressing it after — and nothing can be awaited in that path. `https` only, with
one exception: **loopback**, so a plugin's own route can be an engine.

That exception is the interesting one, because an engine then need not search:

```ts
patcher.http.route("GET", "/ask", async (context) => {
  const query = (context.req.query("q") ?? "").trim();
  const thread = await patcher.sdk.threads.spawn({ /* … */ prompt: query });
  return new Response(null, {
    status: 302,
    headers: {
      location: `${patcher.server.loopbackBaseUrl}/threads/${thread.id}`,
    },
  });
});

patcher.browser.registerSearchEngine({
  id: "ask-agent",
  name: "Ask an agent",
  urlTemplate: `${patcher.server.loopbackBaseUrl}/api/v1/plugins/<your-id>/http/ask?q=%s`,
});
```

Offering is not choosing: the engine appears in the setting's list, labelled with
your plugin id, and is used only once the user selects it. A template the host
cannot use is refused **at load** — an engine that silently searches nowhere would
be worse than a plugin that fails to install. `examples/plugins/omnibox-agent`
ships both halves.

## patcher.browser — adding a section to the site-info panel

Clicking the padlock in the address bar opens what the browser can honestly say
about the connection, and then whatever plugins know about the site. This is the
one surface that is about the _site_ rather than the page.

Needs `siteInfo.register`.

```ts
patcher.browser.registerSiteInfoProvider({
  id: "logins",
  label: "Passwords",
  async describe(context) {
    // context: { tabId, url, host } — host is "example.com[:port]"
    const saved = await patcher.storage.kv.get(`logins:${context.host}`);
    if (!saved) return null; // nothing to say about this site: no heading shown
    return [{ label: "Saved logins", value: String(saved.length) }];
  },
});
```

Asked each time the panel opens, concurrently with every other provider,
time-boxed to 2s and failure-isolated — a provider that throws or hangs drops out
and the rest of the panel still renders. At most 8 rows per section; labels and
values are trimmed to 60 and 200 characters.

Rows are text, deliberately. A section **reports**; anything to _do_ belongs on
the tab menu or the page's context menu, where a click has somewhere to go.

`examples/plugins/private-history` has a worked one: how many pages the store kept
for this site, and whether recording is off for it.

## patcher.browser — putting a control in the toolbar

The address row is where the browser keeps what applies to the page you are
looking at _right now_: a star that knows whether this page is saved, a reader
mode, "open this in the other browser". Your control sits between the address bar
and Patcher's own buttons.

Needs `toolbar.register` — its own permission because of `state` below: it is
asked about every page the user opens, on navigation, without the user doing
anything.

**One control per plugin.** A second `registerToolbarItem` is refused at load, not
dropped at render: the row cannot grow the way a menu can. If you need more, put
them in your panel.

```ts
patcher.browser.registerToolbarItem({
  id: "star",
  title: "Save this page", // the accessible name and the tooltip
  icon: "Star", // resolved like every plugin icon: branding → manifest → this
  async state(context) {
    // context: { tabId, url, title } — asked on navigation, and again after run
    const saved = await patcher.storage.kv.get(`saved:${context.url}`);
    if (!saved) return null; // keep what was declared
    return { active: true, title: "Remove from saved" };
  },
  async run(context) {
    const key = `saved:${context.url}`;
    const saved = await patcher.storage.kv.get(key);
    if (saved) await patcher.storage.kv.delete(key);
    else await patcher.storage.kv.set(key, { title: context.title });
    // Nothing else to do: Patcher asks `state` again once this resolves.
  },
});
```

Three things follow from the control being drawn _before_ anyone answers:

- **`state` is optional, and omitting it is the cheap path.** A control that looks
  the same everywhere is drawn from the declaration alone, and nothing is asked of
  your plugin as the user browses. Register a `state` only if the answer actually
  differs per page.
- **Every field of a state is optional**, and `null` means "keep what was
  declared". Returning `{ active: false }` and returning `null` look the same on
  screen; prefer `null` when you have nothing to say.
- **The icon cannot change per page** — `active` renders as an accent on the icon
  you declared. A per-state icon would flicker: the first paint would show the
  wrong glyph and swap it once the answer arrived.

`state` is time-boxed to 1s and failure-isolated (a slow or throwing one leaves the
declared look), and `run` gets the same 10s box a picked menu entry does. Titles
are trimmed to 60 characters.

## patcher.browser — a section on the new-tab screen

A new tab is the one moment the browser has nothing to show. Patcher fills it with
recently visited pages; a widget adds a section under that — saved pages, a
reading list, the tabs you closed yesterday.

Needs `newTab.register`. A new tab has no page, so nothing about the user's
browsing is handed over; what the permission buys is the placement.

```ts
patcher.browser.registerNewTabWidget({
  id: "saved",
  label: "Bookmarks", // the section heading
  async rows(context) {
    // context: { tabId } — there is no page yet, that is the point
    const saved =
      await patcher.storage.kv.get<{ url: string; title: string }[]>("saved");
    if (!saved?.length) return null; // no heading over an empty list
    return saved.map((entry) => ({
      title: entry.title,
      subtitle: "saved", // optional second line; the host shows the URL's host without one
      url: entry.url,
    }));
  },
});
```

Rows are **links**, and that is the design rather than a limitation: clicking one
navigates to what you already said, so no plugin code runs on the click and a list
of saved pages behaves like part of the browser. `http` and `https` only — a
`javascript:` or `file:` row is refused where it was made, not when it is clicked.

Asked each time a new-tab screen appears, concurrently with every other widget,
time-boxed to 2s and failure-isolated: one that throws or hangs is left out and
Patcher's own recents still render. At most 12 rows; titles and subtitles are trimmed to
200 characters.

The screen is the same one the thread panel's browser shows, so a widget appears in
both — a saved-pages list is as useful beside an agent as it is on its own tab.

## patcher.browser — restyling the sites the user let you reach

The cheapest way onto a page, and the only one that needs no code running in it:
hide a banner, widen a column, restyle something the user stares at all day.

Needs **two** declarations, because this is one of the two permissions whose
answer is a list of sites rather than a capability:

```json
{
  "patcher": {
    "permissions": ["pageStyle.register"],
    "sites": ["https://github.com/**"]
  }
}
```

`permissions` says the plugin restyles pages; `patcher.sites` says which ones. Holding
one without the other reaches nothing. `patcher.sites` takes URL globs — `**` crosses
`/`, `*` stops at one — `https` only, except loopback over plain http
(`http://localhost:5173/**`). Anything else is refused by the manifest, before the
install. Unrelated to `patcher.sdk.hosts`, which is enrolled machines; these are
websites.

```ts
patcher.browser.registerPageStyle({
  id: "declutter",
  // Each entry must be one of the patterns in patcher.sites, verbatim: code picks
  // from the list the user read before installing and cannot widen it.
  matches: ["https://github.com/**"],
  css: ".js-notification-shelf { display: none !important }",
});
```

Data only — no callback, nothing asked of the plugin as the user browses, so the
style keeps working while the plugin is idle. Register one per site you declared if
they need different CSS; ids are unique within the plugin, css is capped at 64,000
characters.

What the browser can promise, measured rather than assumed:

- **One document.** Inserted CSS does not survive a navigation or a reload, so the
  shell re-applies whatever matches on every committed navigation. You do not have
  to clean anything up.
- **Main frame only.** A subframe keeps its own stylesheets — an ad inside an
  iframe is out of reach.
- **After commit, not before first paint.** A rule usually lands before a network
  page has streamed the element it hides, but a page's own inline script can still
  observe the unstyled state. If a style must _never_ be seen, this surface cannot
  promise it.

The page's author wrote their stylesheet first, so a rule that has to win says
`!important` like any other late stylesheet.

For the browser-UI half of "when I'm on GitHub, show me my open PRs", scope a
frontend panel to the same pages with `app.slots.experimental_leadingPanel({
matches })` — see references/frontend-slots.md. That one costs no permission: it is
Patcher's own chrome reacting to the address bar, not code reaching into a page.

## patcher.browser — running your own code in a page

`patcher.browser.registerPageScript` is everything a page style cannot do: read the
page, add a control to it, and answer a click by asking your own backend. It is the
replacement for a userscript, with the thing a userscript never has — a backend.

A **separate** permission over the same `patcher.sites`, because a stylesheet that
cannot read the page and a program that can are not the same thing to agree to:

```json
{
  "patcher": {
    "permissions": ["pageScript.register"],
    "sites": ["https://github.com/**"]
  }
}
```

```ts
patcher.browser.registerPageScript({
  id: "note-button",
  // Same rule as a page style's: verbatim members of patcher.sites.
  matches: ["https://github.com/**"],
  // Source text, capped at 64,000 characters. It is wrapped in a function before
  // it runs, and `patcher` is in scope: `declare const patcher: PluginPageScriptApi` at the
  // top of the file types it.
  code: `
    patcher.ready(function () {
      const button = document.createElement("button");
      button.textContent = "Note this page";
      button.addEventListener("click", function () {
        patcher.rpc("notePage", { url: location.href }).then(function (answer) {
          button.textContent = answer.repo === null ? "Not a repo" : "Noted";
        });
      });
      document.body.append(button);
    });
  `,
});
```

Inside the script there are exactly two names:

- `patcher.rpc(method, input?)` — **your** plugin's rpc methods and nothing else.
  Resolves with the result, rejects with the plugin's own message. JSON in and out,
  bounded in size, and rate limited per tab.
- `patcher.ready(callback)` — runs once the document has parsed.

What the browser can promise, measured rather than assumed:

- **It runs before the page's own first script**, when the document exists and the
  parser has produced nothing — `document.documentElement` is null. That is the
  power (you can patch what the page is about to use) and the footgun: DOM work
  goes in `patcher.ready`, or it throws.
- **An isolated world of your own.** The page cannot see `patcher` or anything the
  script defines and cannot shadow what it reads; two of your scripts share that
  world, another plugin's do not. Nothing is exposed to the page's own world.
- **Main frame only**, as with the css.
- **Per document.** A site's client-side navigation is not a new document: it
  replaces the page's content and takes your elements with it, and re-mounting is
  the script's job (a `MutationObserver` on `document.body`). This is the single
  most common reason a generated page script "stops working".
- **A new registration runs on the next load** of a matching page, as Chrome's
  content scripts do. Reload the tab.
- **An error is contained.** It lands in the page's console — which Patcher's
  observation log collects, so `patcher.browser.tabs.observe` can read it — and the next
  script still runs.

Nothing here is evaluated in the server: the source is text all the way to the
page. A syntax error is reported by the page's console, in the world it would have
run in.

See examples/plugins/site-tweaks for the whole loop — a button in GitHub's page, a
row in the plugin's SQLite, and the note appearing in Patcher's own panel.

## patcher.browser — adding a button to the find bar

The browser's `Cmd+F` bar is the one place that knows what the user is looking
for on this page. A registered action becomes a button after the browser's own
counter and arrows, carrying whatever is in the field.

```ts
patcher.browser.registerFindAction({
  id: "save-search",
  title: "Search my notes too",
  async run(context) {
    // context: { tabId, pageUrl, query } — query is never empty
    await patcher.storage.kv.set(`search:${context.tabId}`, context.query);
  },
});
```

Declared like context-menu items, with the same consequence: `title` is fixed at
registration, so a button cannot rename itself from the query. Buttons are
disabled while the bar is empty, `run` is time-boxed (10s) and failure-isolated,
and the bar does not wait on it — report through your own surfaces.

## patcher.browser — answering a site's login prompt

When a browsed page hits HTTP authentication, Patcher asks every registered provider
before it asks the user. This is where a password manager plugs in.

```ts
patcher.browser.registerAuthProvider(async (challenge) => {
  // challenge: { tabId, host, insecure } — host is "example.com[:port]"
  if (challenge.insecure) return null; // decline: it would go in the clear
  const entry = await patcher.storage.kv.get(`login:${challenge.host}`);
  return entry ?? null; // { username, password }, or null to let the user answer
});
```

Providers are asked in plugin id order and the first to return credentials
wins; declining, throwing and running past the 5s box all mean the same thing —
ask the next one, then the user. A provider is asked once per host per tab: a
second challenge from the same host means the first answer was wrong.

Certificate errors are deliberately not delegated. "Trust this server anyway"
is not a credential a plugin can look up.

## patcher.browser — reading a PDF the browser cannot

Patcher reads a PDF tab as text by refetching the document through the browsing
session and parsing it. A scan has nothing to parse — its pages are images —
and that is the one case a provider is asked about.

```ts
patcher.browser.registerPdfTextProvider(async (document) => {
  // document: { tabId, pageUrl, title }
  // The document is behind whatever the tab is signed in to, so fetch it the
  // way the browser would.
  const { cookies } = await patcher.browser.storage.cookies({
    tabId: document.tabId,
  });
  const text = await ocrService(document.pageUrl, cookies);
  return text.length > 0 ? text : null; // null declines, and the next is asked
});
```

Providers are **only** asked for a document Patcher has already parsed and found no
text in, so this is not a way to intercept ordinary reads — a PDF with a text
layer never reaches one. They are asked in plugin id order, the first non-empty
answer wins, and declining, throwing, answering with the wrong shape and running
past the 10s box all mean the same thing: ask the next one. When nobody answers,
the agent is told the document has no text layer.

The box is the longest of any browser hook because this is the only one asked to
do real work — an OCR pass, a call to a document service — and nothing is held
up on screen while it runs.

## patcher.browser — taking over downloads

Patcher writes a browser download to the user's downloads folder, then hands it to
every registered handler. This is where a plugin re-homes, renames, consumes or
deletes downloads.

```ts
import { rename } from "node:fs/promises";

patcher.browser.registerDownloadHandler(async (download) => {
  // state: "completed" | "cancelled" | "interrupted" | "refused".
  // Only "completed" has a file behind it; "refused" is Patcher's own rate limit
  // and never wrote anything, so its savePath is null.
  if (download.state !== "completed" || download.savePath === null) return;
  if (download.mimeType !== "application/pdf") return;
  await rename(download.savePath, `/Users/me/Papers/${download.filename}`);
  patcher.log.info("filed a paper", { url: download.url });
});
```

The handler runs **after** the write, never before it, and that is a platform
limit rather than a policy: Chromium demands the save path synchronously while
a plugin lives in another process. So a plugin cannot stop a download — it
moves or deletes the finished file instead. Handlers are additive, time-boxed
(30s) and failure-isolated: throwing changes nothing for the other handlers or
for the browser.

## patcher.browser — routing a link the system opened

While Patcher is the user's default browser, macOS hands it every web link clicked in
another app — Mail, Slack, a terminal. Each one is offered to the registered
handlers before it becomes a tab, which is where a plugin decides _where_ it
goes.

```ts
patcher.browser.registerExternalLinkHandler((link) => {
  // link: { url }, always http(s).
  const { host } = new URL(link.url);
  // Send the tracker's links to the issue they belong to...
  if (host === "tracker.example.com") {
    return { url: `https://work.example.com/issues?from=${host}` };
  }
  // ...file a paper away without opening anything.
  if (host === "arxiv.org") {
    void patcher.storage.kv.set(`reading:${link.url}`, {
      addedAt: Date.now(),
    });
    return { handled: true };
  }
  return null; // declines, and the next handler is asked
});
```

Handlers are asked in plugin id order and the **first decision wins**: two
handlers rewriting one click would fight over it. Declining, throwing, answering
with the wrong shape and running past the **2s** box all mean the same thing —
ask the next one, and open the link in a tab exactly as Patcher would with no plugins
at all. The box is the tightest of the browser hooks after the history filter,
because the user is waiting for the link they just clicked.

A rewritten address must be `http(s)`: it opens in a browsed view, where `file:`
would be a reader for the local disk. `handled: true` opens nothing, and holds
even if the address alongside it was refused.

Costs `externalLink.handle`, which is a standing read of every address the user
opens from outside Patcher — declare it knowing that is what the manifest says.

## patcher.browser — deciding what the browser remembers

Every page the browser visits passes through the registered history filters on
its way to the history store. A filter returns nothing to accept the visit, a
rewrite to record something else, or `null` to drop it.

```ts
patcher.browser.registerHistoryFilter((visit) => {
  // visit: { scopeId, url, title, visitedAt }
  const url = new URL(visit.url);
  if (url.hostname.endsWith(".internal.example")) return null; // never recorded
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_")) url.searchParams.delete(key);
  }
  return { url: url.toString() };
});
```

Needs the `history` permission. Filters are additive across plugins, run in
plugin id order with each seeing the previous one's result, and the first `null`
ends it. A filter that throws or exceeds its 1s box is skipped, so a broken
plugin loses its own say rather than the user's history.

Reading and editing the store afterwards is `patcher.sdk.browserHistory` (see
[patcher.sdk](backend-sdk.md)); this hook is the only place a plugin sees a visit as
it happens.

## patcher.browser — driving the browser surface

Tabs, pages and navigation of the Patcher desktop app's browser. Needs a connected
browser window, so call these from handlers, tools and services — never at load
time, where nothing is connected yet.

```ts
const tabs = await patcher.browser.tabs.list();
// Each tab: { tabId, url, title, active, live, loading, canGoBack, canGoForward }

const tab = await patcher.browser.navigation.open(
  { url: "https://example.test/" }, // http(s) only; resolves once the page loads
  { signal }, // pass ctx.signal from an agent tool so an abandoned turn stops waiting
);

// tabId defaults to the active tab everywhere.
const { text, truncated } = await patcher.browser.page.getText({
  maxLength: 20_000,
});
const { text: selected } = await patcher.browser.page.getSelection();

// Acting on a page: snapshot for refs, then name one.
const page = await patcher.browser.page.snapshot();
// page.snapshot is Playwright's compact tree with [ref=eN] on every
// interactive element; page.generation identifies the refs it handed out.
await patcher.browser.page.act({
  action: { action: "fill", ref: "e2", text: "hello" },
  generation: page.generation, // optional; refuses a ref a newer snapshot reassigned
});
const ended = await patcher.browser.page.act({
  action: { action: "click", ref: "e1" },
});
// ended: { tabId, url, title } — where the tab landed, since clicks navigate.

// Looking without touching: none of these attaches the browser debugger, so
// they work on a tab the user is merely browsing — except a full-page capture,
// which is the one that must (it still leaves the tab's dialogs alone).
const shot = await patcher.browser.page.screenshot(); // visible viewport, JPEG by default
// shot: { tabId, url, title, mimeType, base64, width, height, fullPage, truncated }
const whole = await patcher.browser.page.screenshot({ fullPage: true }); // the document
// width/height are device pixels for a viewport capture and CSS pixels for a
// full-page one; truncated means the document was past ~16k pixels and this is
// its top. fullPage fails with debugger_unavailable while DevTools has the tab.
const doc = await patcher.browser.page.pdf({}, { timeoutMs: 60_000 }); // whole document
const log = await patcher.browser.page.console({ limit: 50 });
const requests = await patcher.browser.page.network({ limit: 50 });
// Each log: { entries, droppedCount } — read droppedCount before concluding a
// page was quiet; the buffers are fixed-size rings.

// Scaling the page. `factor` is a multiplier where 1 is 100%; one outside
// Chrome's own 0.25-5 is refused rather than clamped, and the answer is what
// Chromium settled on rather than what was asked for. Costs `page.interact`: it
// is less than a click, and anyone who can click can already do it.
const applied = await patcher.browser.page.zoom({ factor: 1.25 });
// Chromium remembers zoom **per site**, so this also decides what that site
// looks like the next time any tab opens it — including for the user.

// Stored state. Scoped to the tab: cookies for the URL it is on, web storage
// for its origin. Read the warning below before using any of it.
const { cookies } = await patcher.browser.storage.cookies();
// Each cookie is Playwright's storageState shape:
// { name, value, domain, path, expires, httpOnly, secure, sameSite }
await patcher.browser.storage.setCookies({
  cookies: [{ name: "flag", value: "1" }],
});
const { removed } = await patcher.browser.storage.clearCookies({
  name: "flag",
});
const stored = await patcher.browser.storage.items({ area: "local" }); // or "session"
// stored: { ..., items: [{ name, value }], truncated }
const write = await patcher.browser.storage.setItems({
  area: "local",
  items: [{ name: "token", value: "x" }],
});
// write: { applied, rejected } — a partial write is the realistic outcome.

// Direct control. Everything here skips what makes the calls above safe; read
// the warning below before reaching for any of it.
const got = await patcher.browser.control.evaluate({
  expression: "() => document.title", // a function, as Playwright's eval takes
  // ref: "e4",                       // passes that element in: (el) => el.value
});
// got: { ..., value, truncated } — value is JSON text, "undefined" for nothing.
await patcher.browser.control.mouseMove({ x: 850, y: 45 }); // viewport pixels
await patcher.browser.control.mouseButton({ down: true }); // acts where you last moved
await patcher.browser.control.mouseButton({ down: false });
await patcher.browser.control.route({
  pattern: "**/api/me", // Playwright's URL glob: ** crosses /, * does not
  body: '{"id":1}', // status defaults to 200, content type follows the body
});
const mocked = await patcher.browser.control.routes();
// mocked: { ..., routes: [{ pattern, status, matched, ... }], offline }
await patcher.browser.control.unroute(); // one pattern, or all of them
await patcher.browser.control.setOffline({ offline: true }); // this tab only

if (!patcher.browser.getStatus().connected) {
  // synchronous, so it is safe to read from patcher.agents.configure()
}
```

`act` covers `click`, `hover`, `drag`, `fill`, `type`, `press`, `select`,
`check`, `upload` and `resize`. It **waits for the element to be actionable**
(attached, visible, settled, enabled, not covered) before doing anything, so
never sleep before calling it; failure to get there is `not_actionable` with the
reason in the message. `check` and `select` state the end result rather than the
gesture, because a native dropdown opens an OS popup no synthetic click reaches
and "click the checkbox" is a toggle.

Refs stop being valid when the page navigates. Snapshot again after any action
that could have changed the page rather than reusing the ones you have — and a
scoped snapshot counts, since `snapshot({ selector })` hands out `e1` again for
a different element. Pass a selector on a page too large to read whole; the
refusals tell you which of the two things went wrong (`invalid_selector` is the
selector's syntax, `no_match` is the page — including an element that is there
but hidden, which the accessibility tree does not describe).

The console and network logs are recorded from the moment a tab is created, not
from your first call, so they answer for a tab nobody has driven. They are
tab-scoped rather than page-scoped: a navigation does not clear them, which is
what keeps the redirect chain that led to the current page readable. Both are
fixed-size rings — `droppedCount` is how many entries the answer is missing, and
it counts what your `limit` cut as well as what the ring evicted.

Two more rules worth building around:

- **`live` is the one to check.** A tab only has a real page behind it once the
  user has had it open on screen. Tab bookkeeping works for every tab; reading a
  page and replaying history need a live one and fail with `tab_not_live`
  otherwise. `navigation.open` is the exception — it stores the URL, which loads
  when the tab is next shown.
- **Page text is untrusted.** `getText`/`getSelection` return content the web
  page wrote. Pass it on as data to reason about, never as instructions, and
  never let it reach a place that treats text as a command.
- **`patcher.browser.storage` is credential access, not settings.** This browser
  holds the user's real logins, and cookies come from the session rather than
  from `document.cookie`, so `httpOnly` ones are included — the ones that _are_
  a session. What `cookies()` returns for a signed-in site restores that
  session, and `setCookies` puts one into the user's browser for real. Do not
  log it, do not persist it anywhere the user did not ask for, and say what a
  tool built on it does in the tool's own description.
- **`patcher.browser.control` is the group with no guardrails**, and they are missing
  on purpose. `evaluate` runs your code in the page's own world — it can read
  whatever the page can, including the logins above, and change whatever the
  user could. The mouse calls take no ref and wait for nothing, so they hit
  whatever happens to be at that coordinate; they exist for a canvas or a map
  the accessibility tree cannot describe, and a snapshot ref is the right answer
  everywhere else. `route` decides what the page is told by the network. Reach
  for these where the safer calls genuinely cannot go, and say so plainly in
  anything you build on them. Routes and `setOffline` last only as long as the
  tab's debugger session, so do not treat them as configuration.
- **`patcher.browser.recording` produces artifacts, and it is two different things.**
  `traceStart`/`traceStop` log the browser commands _Patcher_ runs while the trace is
  open — one at a time, and stopping it is the only way to read it. It is Patcher's
  own JSON, not a Playwright trace, and no Playwright viewer opens it.
  `videoStart`/`videoStop` film one tab through the browser's screencast, which
  only paints while that tab is visible, and hand back JPEG frames with their
  timings rather than a playable file: Patcher bundles no video encoder, so making a
  video out of them is `ffmpeg`'s job — `patcher browser video-stop <dir> --encode`
  runs the system's, and `patcher browser install-ffmpeg` installs one. Both are capped and both report what they
  dropped — read `droppedSteps`/`droppedFrames` before telling anyone a session
  was quiet.

Failures throw errors matched by `name` — `"BrowserHostUnavailableError"` when no
window is connected, `"BrowserCommandTimeoutError"`, `"BrowserCommandAbortedError"`,
and `"BrowserCommandError"` carrying a `code` (`no_active_tab`, `unknown_tab`,
`tab_not_live`, `desktop_unavailable`, `unsupported_command`, `blocked_url`,
`page_read_timeout`, `page_read_failed`, `debugger_unavailable`, `stale_refs`,
`unknown_ref`, `invalid_selector`, `no_match`, `not_actionable`,
`unsupported_key`, `result_too_large`,
`evaluation_failed`, `too_many_routes`, `already_recording`, `not_recording`).
The bundled `browser-tools`
plugin is the worked example.

Rows land in the same ranked list as the browser's address, search, open-tab
and history rows. Score 1 belongs to the browser's default action — what Enter
does with nothing selected — and plugin rows lose score ties to the built-in
providers, so a plugin can never take the top row away from what the user
typed. Handlers run server-side; changing them and running `patcher plugin reload`
updates the omnibox with no browser-core change.
