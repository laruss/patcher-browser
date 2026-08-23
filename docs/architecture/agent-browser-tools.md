# Agent Browser Tools

Phase 5 of [`docs/PROJECT_PLAN.md`](../PROJECT_PLAN.md) §18: Patcher agents can read
and operate browser state, through Browser APIs rather than Electron internals.

## The gap this had to cross

Phases 1–4 put the browser in the app ([browser-surface.md](browser-surface.md),
[omnibox.md](omnibox.md)). Phase 5 ran into something none of them did:

- Plugin **agent tool handlers execute in the Patcher server process**
  (`apps/server/src/internal/tool-calls.ts` → `invokePluginAgentTool`), with a
  context of only `{ threadId, projectId, signal }`.
- **The browser is nowhere near the server.** Tabs are renderer state
  (`browser-surface-tabs.ts`, a jotai atom over localStorage); pages are
  `WebContentsView`s in the Electron main process. Nothing browser-shaped exists
  in `apps/server/src` or `packages/db`.
- The desktop browser IPC contract was **entirely fire-and-forget** and had **no
  page-content channel at all**.

So the tools are the small part. The work was a request/response path from a
server-side handler down to a page, and back.

```
agent tool call
   ↓  apps/server/src/internal/tool-calls.ts        (already existed)
plugins/browser-tools/src/server.ts                  bundled plugin, 12 tools
   ↓  patcher.browser.tabs / page / navigation            plugin SDK contract
apps/server/.../plugins/plugin-api.ts                argument validation
   ↓  services/browser/browser-bridge.ts             request ids, timeouts, errors
apps/server/src/ws/hub.ts                            addressed to the browser host
   ↓  WebSocket
apps/app/src/lib/ws.ts                               signal in, response out
apps/app/src/lib/browser-agent/                      the executor
   ↓  getDesktopBrowserApi()
packages/desktop-contract/src/browser.ts             optional readPage, new channel
apps/desktop/src/desktop-browser-view.ts             isolated-world read
```

Every hop copies something already in the tree. Nothing here is a new idea about
how Patcher talks to itself.

## Why the tools are a plugin

Plan §20 asks that agent interfaces use the same APIs as plugins, and warns
against a separate hidden browser-control system for agents. So `patcher.browser`
grew a control API and the tools are an ordinary bundled plugin using it. Two
consequences worth having: anything an agent can do to the browser, a plugin can
do too — which is what Phase 6's generated plugins will need — and the tools got
no privileged path of their own.

`plugins/ask-user-question/` was the model throughout: a bundled plugin whose
tool handler blocks on the frontend doing the real work.

### It ships disabled

`defaultEnabled: false` in `builtin-registry.ts`. An agent driving this browser
acts inside the user's real logged-in session, and plan §9's permission model
does not exist yet, so the plugin toggle is the whole gate and the user turns it
on (`patcher plugin enable browser-tools`). Saying that plainly is better than
implying a permission story that is not there.

## The constraint everything else bends around

**A tab only has a native view once it has been the active tab while the browser
surface was open.** The deck mounts one `BrowserTabContent`, and that mount is
what calls `attach`.

It is not as narrow as it sounds: unmount does _not_ detach — "deletion owns
detach" — so a tab activated at any point in a session keeps its live view after
the user navigates away from `/browser`. Reading the page a user is looking at
while talking to an agent in a thread works, which is the case that matters.

What each operation does without one:

| Operation                           | No live view                                     | Web build (no desktop bridge) |
| ----------------------------------- | ------------------------------------------------ | ----------------------------- |
| tabs list / open / close / activate | works — renderer state                           | works                         |
| page get url / title                | works — from tab state                           | works                         |
| navigation open                     | stores the URL; loads when the tab is next shown | `desktop_unavailable`         |
| navigation back / forward / reload  | `tab_not_live`                                   | `desktop_unavailable`         |
| page get text / selection           | `tab_not_live`                                   | `desktop_unavailable`         |

`navigation.open`'s fallback is safe because `BrowserTabContent` reads the tab's
URL at mount and `loadIfNeeded` skips a load the view already shows — the
write-through converges whether or not a view exists.

Every refusal is a distinct code with a sentence saying what to do next, because
an agent that is told "no" without a reason retries the same call.

## Reading a page

The one browser IPC command that answers, so it is an `invoke`/`handle` pair
rather than a `send`. Per invariant 2 of [bb-migration.md](bb-migration.md) it is
a **new channel** plus an **optional** method on `PatcherDesktopBrowserApi`, which is
the same shape scoped popups and favicons used — this is that pattern's first
request/response instance, and callers feature-detect `readPage` exactly as they
feature-detect `onFavicon`.

**The read runs in an isolated world**
(`executeJavaScriptInIsolatedWorld`, `desktop-browser-page-read.ts`). Browsed
pages have `sandbox: true`, `contextIsolation: true` and deliberately no preload,
so the main world belongs to the page: there it could redefine `innerText` on the
prototype to forge the result, defeat the size cap, or use a property getter as a
side channel telling it an agent is reading right now. Cloaking against automated
readers is a real pattern, not a hypothetical. An isolated world shares the DOM
but not the globals, which is the Chrome content-script guarantee, and it also
bypasses page CSP so a strict-CSP page cannot refuse.

**The request is `{ tabId }` and nothing else, deliberately.** Any per-call knob —
a length, a selector, a format — would have to reach a script injected into an
untrusted page, which is a script-injection surface inside our own privileged
snippet. Limits are compile-time constants; a caller wanting less trims what it
gets back.

Bounded in three places that must agree: the in-page slice (so a huge document
never crosses the process boundary), a main-process re-truncate, and the wire
schema's `.max()`. Plus a 2s timeout, which is mandatory rather than defensive —
script execution is suspended while a page loads, and `innerText` forces layout.

Two limits are named rather than papered over: **iframe content is not included**
(`WebFrameMain` has no isolated-world execution), and **a selection inside an
`<input>`/`<textarea>` reads as empty**. The obvious fix for the second —
`activeElement.value` — is deliberately not done, because it reads form fields
including one the user is typing a password into.

## Addressing one browser

The hub tracks which client sockets can drive a browser
(`registerBrowserHost`), and `requestBrowserCommand` mirrors the daemon
online-RPC already there: correlated request ids, a timeout, waiter rejection on
socket close. It is **sent to one socket, never broadcast** — a command must be
performed once and answered once, and the SDK's realtime client is on the same
`/ws` endpoint with no business seeing browser commands.

With two app windows open, the most recently registered wins. That is not a new
invention: terminal resize ownership already resolves the same contention the
same way.

With none connected, the call fails immediately rather than waiting. A daemon is
expected to reconnect; a closed browser window is a user's action, and stalling
every tool call on the chance one appears is worse than saying so.

`unregisterBrowserHost` runs _before_ `unregisterClient`'s early return, since a
socket that never subscribed to anything can still be the browser host — without
that, closing the window leaves in-flight commands to time out.

## `patcher browser` — the bridge, without an agent

The tools are only reachable through a provider session inside a thread, which
makes a broken bridge show up as a model saying something odd, minutes later. So
the plugin also registers a CLI command over the **same** `patcher.browser` API:

```
patcher browser status                    is an app window connected at all
patcher browser tabs                      active/live/cold per tab
patcher browser open <url> [--new-tab]
patcher browser text [--tab <id>] [--max <n>]
patcher browser back | forward | reload
```

Plugin CLI commands execute in the server process — exactly where the agent
tools' handlers execute — so this drives the whole chain (server → hub →
WebSocket → app → executor → Electron) and leaves only the `registerTool`
wrapper untested, which is what the plugin's unit tests cover. `status` exits
non-zero when nothing is connected, so a script can gate on it, and failures
print the same sentences the agent is given.

That makes the first diagnostic question answerable in one command: if
`patcher browser tabs` works and a tool does not, the bridge is fine.

## What an agent does not gain

- **No new navigation reach.** `navigation.open` goes through the same
  `isAllowedBrowserUrl` gate as the omnibox (`http`/`https` only), and the
  session firewall still refuses LAN hosts and unattributed loopback, so the
  browser cannot become a probe of the user's own services. The tool requires a
  real URL rather than reusing `resolveBrowserAddressInput`'s search fallback:
  silently searching is right for a human typing and wrong for an agent that
  passed a malformed address.
- **No new session reach.** Everything stays in the `persist:patcher-browser`
  partition. No cookie, download, permission or devtools access is added.
- **No page eval.** The obvious next tool after `getText` would be a
  general "evaluate this JS in the page", which is a remote-code-execution
  primitive aimed at a session holding the user's live cookies. If DOM querying
  is wanted later it should be named, parameterless extractors as constant
  scripts — never a caller-supplied string.
- **Page text is untrusted, and labelled rather than filtered.** It is
  attacker-authored content entering a context that holds tools. Nothing
  sanitizes it; the tool delimits it and says whose words they are. Stripping
  "suspicious" strings would mangle legitimate content and buy false confidence.

## Verified

- `desktop-browser-page-read.test.ts` — the script is a constant with no
  interpolation left in it and does not run in world 0 or 999; malformed results
  rejected; re-truncation and flag preservation; the largest accepted value still
  satisfies the other package's schema, so the two sets of caps cannot drift.
- `desktop-browser-view-manager.test.ts` — the read uses the **isolated** world
  and never the main one; missing / destroyed / empty-URL tabs each get their own
  refusal; a page that never answers times out and its late reply changes
  nothing; a throwing or malformed script is `unreadable`; titles truncate.
- `desktop-browser-main-ipc.test.ts` — an unowned sender, a malformed payload and
  a throwing manager all resolve to typed refusals rather than rejecting, because
  an `invoke` rejection reaches the renderer as an opaque string.
- `preload-browser-api.test.ts` — `readPage` is on the exposed surface, invokes
  the right channel, and turns a malformed reply and a rejected invoke into
  `{ ok: false }`.
- `hub-browser-command.test.ts` — delivery to the primary host only, response
  correlation, a response from another window ignored, stale responses dropped,
  timeout, in-flight rejection on disconnect, latest-registration-wins, and a
  host socket that never subscribed still being released.
- `ws.test.ts` — the signal routes to browser subscribers alone, the host
  re-announces after a reconnect, responses go out correlatable.
- `browser-agent/execute.test.ts` — all 12 commands, every degraded case in the
  table above, `blocked_url` for `javascript:`/`file:`/garbage, the close path
  tearing down the native view, and an open-then-read sequence in one turn seeing
  its own write.
- `browser-agent/live-state.test.ts` — state recorded for every tab rather than
  the mounted one, and settling that waits for the right tab and gives up rather
  than hanging.
- `plugins/browser-tools/src/server.test.ts` — every tool registered under a name
  the host accepts, all of them advertised with instructions, and each failure
  mapped to a sentence telling the model what to do next.
- `plugins/browser-tools/src/cli.test.ts` — `patcher browser` reaching the same API,
  the cold/live distinction visible in default output, `--json`, `--tab` and
  `--max`, a non-zero `status` when nothing is connected, and unknown commands
  and options refused rather than reinterpreted.

Not covered by tests, and worth doing by hand before trusting it: a real page
read in the running desktop app. `executeJavaScriptInIsolatedWorld` is exercised
only against a fake `webContents` here, so this is the one link nothing above
proves. `patcher browser text` is the shortest way to find out:

```bash
bun run dev            # and, in another shell, bun run dev:desktop
bun run patcher:dev plugin enable browser-tools
# open /browser in the desktop app and load a page, then:
bun run patcher:dev browser status
bun run patcher:dev browser tabs
bun run patcher:dev browser text
```

## The JavaScript dialog defect this shipped with

Worth recording, because it explains why dialogs were the first thing Stage A
fixed rather than a feature scheduled with the rest.

At this point `desktop-browser-view.ts` set no `disableDialogs` and intercepted
nothing, so Electron's default applied: a page calling `alert()` or `confirm()`
opened a native modal owned by the **app window**. Two consequences, of which the
second was the serious one:

- the modal blocked the whole Patcher window, not just the browsing view — a page
  could freeze the agent workspace, not only itself;
- **an agent had no way to answer it.** The user could click its buttons;
  nothing on the automation path could, so a dialog stopped an agent dead.

It predated the agent tools and was reachable without them. The fix needed CDP —
`Page.javascriptDialogOpening` / `Page.handleJavaScriptDialog`, since Electron's
`disableDialogs` only suppresses and cannot answer one — and landed with Stage A
of [browser-automation.md](browser-automation.md), which is where the
app-drawn replacement dialog is described.

## Next

Two threads run on from here.

**Automation breadth** — everything the Playwright Agent CLI gives an agent,
minus its testing group: snapshots with element refs, real interaction, storage,
network interception, recording. Planned in
[browser-automation.md](browser-automation.md), which also explains why that work
moves onto CDP and why the long tail belongs in `patcher browser` rather than in the
provider's tool list.

**Everything else** — the plan's Phase 6 (a coding agent creating a browser
plugin from a natural-language request) now has the browser API it would target.
The plugin permission model this milestone listed as absent has since landed —
see [plugin-permissions.md](plugin-permissions.md), which also explains why it
specifies Phase 7's boundary rather than replacing it. What remains from here is
moving the direct `getDesktopBrowserApi()` call sites in the renderer behind the
executor's boundary, which Phase 2 asked for and which this milestone
deliberately did not touch.
