# patcher-plugin-explain-selection

The `browser.contextMenu.items` and `browser.tab.actions` example — no frontend
entry, no dependencies. Select text on a browsed page, right-click, **Explain
with Agent**: a Patcher thread opens with an agent explaining what you selected.
Right-click the _tab_ instead and **Explain this page** does the same for the
whole page.

This is the plan's own Phase 6 example
([`docs/PROJECT_PLAN.md`](../../../docs/PROJECT_PLAN.md) §18): _"Create a plugin
that adds `Explain with Agent` when text is selected."_ Nothing about it is
hardcoded into the browser — it is one plugin file against the shipped SDK.

What it demonstrates:

- **`patcher.browser.registerContextMenuItem`** with a `when` — `{ selection: true }`,
  so the entry appears on a selection and nowhere else. `run(context)` receives
  the tab, the page URL and whatever was under the pointer.
- **`patcher.browser.registerTabAction`** — the same explanation from the tab strip's
  own menu. A tab action has no `when` (it is offered on every tab), so the entry
  decides for itself what it can work with: its context reports `url: null` for a
  Patcher screen and `""` for a tab with no page yet, and neither is a page to explain.
  It also carries `pinned`, `muted` and `active`, which is where a plugin is told
  the tab state that `patcher.browser.tabs.list()` does not report.
- **`patcher.sdk.threads.spawn`** — the handler spawns a Patcher thread whose prompt quotes
  the selection. Patcher fills in `origin: "plugin"` and
  `originPluginId: "explain-selection"`, so the thread is attributed in the
  thread list.
- **`patcher.browser.tabs.open`** — the plugin then drives the browser the click came
  from, opening the new thread in a tab. A context-menu `run` returns nothing (the
  menu closed when the user clicked), so a plugin that wants the browser to move
  asks it to, rather than returning a URL the way an omnibox `run` does.
- **`patcher.status.needsConfiguration`** — the entry needs a project to spawn into, so
  an unconfigured install contributes no entry and says why instead.

## Try it

```bash
patcher plugin install ./examples/plugins/explain-selection
patcher plugin config explain-selection set project <project-id>
patcher plugin reload explain-selection
```

Then open the browser surface (`/browser`, or the Browser button in the sidebar
footer), select some text on a page and right-click — or right-click the tab. Change `run`, run `patcher plugin
reload explain-selection`, and the menu entry behaves differently — no
browser-core edit involved. That round trip is the point of the example.

## Declared, not asked for

Worth reading next to [`../omnibox-agent`](../omnibox-agent), because the same
configuration question gets the opposite answer.

An omnibox provider is asked on every keystroke, so it can decide per call and
offer some rows unconfigured. A context-menu item is **declared**: the desktop
shell holds the list so a right-click opens without a round trip to the server,
which means `title` and `when` are fixed at registration and whether the entry
exists at all is decided once, at load. So this plugin registers nothing until a
project is set — an entry that cannot work would sit in the menu doing nothing —
and configuring it takes a `patcher plugin reload` to show up.

## The selection is untrusted

`selectionText` is text a web page wrote, and it is on its way into an agent's
context. The prompt keeps it as data: instructions first, then one marker after
which everything is quoted content, with the page URL quoted alongside it. A
delimiter _pair_ would be weaker — a page can write the closing half of one, and
nothing it writes can undo "to the end of the message".

## Tests

`server.test.ts` runs against `@patcher/plugin-sdk/testing` — no Patcher server, no
browser. The end-to-end path (install → contributions → picked entry → spawned
thread → the selection in the agent's first message) is covered by `hero plugin:
explain-selection` in `apps/server/test/services/plugins/heroes.test.ts`, which
is also the plan's §22 scenario.
