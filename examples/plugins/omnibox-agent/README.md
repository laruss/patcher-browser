# patcher-plugin-omnibox-agent

The `browser.omnibox.providers` and `browser.searchEngines` example — no frontend
entry, no dependencies. Type in the browser surface's omnibox and this plugin adds
rows to the same ranked list the browser fills with address, search, open-tab and
history rows — and, if you choose it in Settings, it becomes the thing **Enter**
does.

What it demonstrates:

- **`patcher.browser.registerOmniboxProvider`** with both action kinds:
  - `{ type: "navigate", url }` — "Search GitHub for …", resolved by the browser
    without calling back into the plugin.
  - `{ type: "run" }` — "Ask an agent: …", which calls the plugin's `run(itemId,
{ query })` when picked.
- **`patcher.sdk.threads.spawn`** — the `run` handler spawns a Patcher thread with the
  omnibox query as its prompt. Patcher fills in `origin: "plugin"` and
  `originPluginId: "omnibox-agent"`, so the thread is attributed in the thread
  list.
- **`patcher.server.loopbackBaseUrl`** — `run` returns
  `{ navigate: "<server>/threads/<id>" }`, so the browser opens the new thread in
  the tab the omnibox was used from: the plugin points the browser at the Patcher app
  it is itself running inside.
- **`patcher.browser.registerSearchEngine`** — two engines, and the pair is the point.
  `kagi` is an ordinary template. `ask-agent` points at the plugin's **own
  loopback route**, which spawns a thread and redirects the tab to it: an engine
  that is not a search engine. The address bar resolves what Enter does
  synchronously, so an engine is a URL template rather than a callback — which is
  exactly why a route is how a plugin does work on the way.
- **`patcher.http.route`** — that route (`GET /ask?q=…` → 302 to the new thread),
  refusing an empty query and saying so when no project is configured.
- **`patcher.status.needsConfiguration`** — the agent row needs a project, so it is
  offered only once one is set. The GitHub row works unconfigured, which is why
  the plugin is useful before anyone opens its settings.

## Try it

Pick the engine in **Settings → General → Search engine** to make Enter go to the
agent; the omnibox row works without changing anything.

```bash
patcher plugin install ./examples/plugins/omnibox-agent
patcher plugin config omnibox-agent set project <project-id>
patcher plugin reload omnibox-agent
```

Then open the browser surface (`/browser`, or the Browser button in the sidebar
footer) and type. Change `suggest` or `run`, run `patcher plugin reload
omnibox-agent`, and the omnibox changes — no browser-core edit involved. That
round trip is the point of the example.

## Ranking

Scores are advisory and clamped to [0, 1] by the host. Score 1 belongs to the
browser's own default action — what Enter does with nothing selected — and plugin
providers are ranked after the built-in ones at equal scores, so a plugin can
never take the top row away from what the user typed. This plugin asks for 0.8
(agent row) and 0.55 (site search), landing under the default row and around the
browser's own open-tab and history rows.

## Tests

`server.test.ts` runs against `@patcher/plugin-sdk/testing` — no Patcher server, no
browser. The end-to-end path (install → contributions → suggest → run → spawned
thread) is covered by `hero plugin: omnibox-agent` in
`apps/server/test/services/plugins/heroes.test.ts`.
