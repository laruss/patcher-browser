# Site tweaks example

Three things a Chrome extension is usually reached for, done as one Patcher plugin with
no change to the browser:

- **Change how a site looks.** `patcher.browser.registerPageStyle` puts CSS into
  GitHub's own pages — the notification shelf and the dashboard feed go away, and
  code gets the window's full width.
- **Put a control in the page that can do more than a page can.**
  `patcher.browser.registerPageScript` adds a "Note this page" button to github.com.
  Clicking it calls this plugin's own rpc, which writes a row in its own SQLite —
  something the page itself has no database and no credentials to do.
- **Add a panel that belongs to the browser, not to the page.** A leading-edge
  panel scoped with `matches` appears only while the active tab is on GitHub, and
  shows that repository's notes.

Together they are one loop rather than three features: the button is in GitHub's
page, the row is in the plugin's database, and the note appears in the browser's
own chrome as the click lands — over `patcher.realtime.publish`, with neither end
knowing about the other.

The third one is the part a userscript cannot do at all: it is Patcher's own chrome,
so it survives navigation, cannot be broken by the page, and does not have to
fight the site's stylesheet.

## The permission model, which is the thing to read

```json
{
  "permissions": ["pageStyle.register", "pageScript.register"],
  "sites": ["https://github.com/**"]
}
```

`pageStyle.register` says this plugin restyles pages. `pageScript.register` says it
runs its own code in them. `patcher.sites` says which pages — for both. Nothing reaches
anything without both halves, and every `matches` must be one of the declared
patterns **verbatim**, so widening the reach means editing the manifest, which is
the line whoever installs this actually reads. `patcher plugin install` prints both
claims above the confirmation.

They are two permissions over one list on purpose: a plugin the user let restyle
GitHub has not thereby been let read what they are doing there.

The panel's own `matches` costs nothing and is checked against nothing: it decides
whether Patcher draws one of its own columns, not what the plugin may reach.

## What the browser promises about the css

Measured on Electron 41.7.0, not assumed:

- **One document.** Inserted CSS does not survive a navigation, so the shell
  re-applies whatever matches on every commit. Nothing to clean up.
- **Main frame only.** An ad inside an iframe is out of reach.
- **After commit, not before first paint.** A rule usually lands before a network
  page has streamed the element it hides, but the page's own inline script can
  still see the unstyled state.

That last point is why this example hides chrome-like furniture rather than, say,
a paywall overlay: a style that must _never_ be seen is not something this surface
can promise.

## What the browser promises about the script

Also measured:

- **It runs before the page's own first script**, when the document exists and has
  no elements yet — `document.documentElement` is null. Hence `patcher.ready` for
  anything touching the DOM, and hence the ability to patch what the page is about
  to use.
- **In an isolated world of this plugin's own.** GitHub cannot see `patcher` or anything
  the script defines, and cannot shadow what it reads. Another plugin's scripts get
  their own world.
- **Main frame only**, like the css.
- **Per document.** GitHub's client-side navigations are not new documents: they
  replace the page's content and take the button with them, and re-mounting is the
  script's job. That is what the `MutationObserver` in `server.ts` is for — the
  single thing most likely to be missing from a generated page script.
- **A registration takes effect on the next load** of a matching page, as Chrome's
  content scripts do. Reload the tab after installing.

`patcher.rpc` inside the script reaches **this plugin's** rpc methods and nothing else.
It is bounded: JSON in and out, an answer size limit, and a rate limit per tab.

## Running it

```
patcher plugin install ./examples/plugins/site-tweaks
patcher plugin dev            # rebuild + reload on save
```

`bun run test` in this directory exercises the backend against
`@patcher/plugin-sdk/testing`, including the refusal an install would make if `matches`
named a site the manifest does not.
