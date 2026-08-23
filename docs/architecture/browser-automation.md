# Browser Automation — plan

Target: everything the [Playwright Agent CLI](https://playwright.dev/agent-cli/introduction)
exposes to an agent, **minus its Testing group**, driving the user's real browser
surface instead of a headless instance.

Where this started is [agent-browser-tools.md](agent-browser-tools.md): 12 tools
covering navigation, tab bookkeeping and reading page text, plus `patcher browser` as
a terminal path onto the same API — roughly PW's `goto` / `go-back` /
`go-forward` / `reload` / `tab-*` and half of `snapshot`, with **no interaction
at all**. Stages A through F closed that: an agent can now snapshot a page,
address its elements, act on them, see what it did, carry a signed-in session in
and out, run its own code in the page where none of that reaches, act at raw
coordinates, answer the page's requests itself — and leave a record of the whole
session behind.

## Two decisions that shape everything else

### 1. CDP is the backbone

Phase 5 read pages by injecting a constant script into an isolated world. That
was right for `innerText`. It does not survive contact with the rest of the
list, and the reason is not effort — it is that the hard parts are already
solved behind `webContents.debugger`:

| What we need                                         | Hand-rolled                                                                  | Via CDP                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Accessibility tree with stable refs                  | reimplement accessible-name computation (the accname spec)                   | `Accessibility.getFullAXTree`                                  |
| Accept/dismiss a JS dialog                           | **impossible** — Electron only offers `disableDialogs` (suppress, no result) | `Page.javascriptDialogOpening` + `Page.handleJavaScriptDialog` |
| Mock a response body                                 | `webRequest` can block but cannot supply a body                              | `Fetch.enable` + `Fetch.fulfillRequest`                        |
| File input upload                                    | no Electron API                                                              | `DOM.setFileInputFiles`                                        |
| Viewport control without fighting the surface layout | —                                                                            | `Emulation.setDeviceMetricsOverride`                           |
| Console + network observation                        | partial (`webRequest` sees no bodies)                                        | `Runtime`/`Log`/`Network` events                               |

PW itself is a CDP client; matching it without CDP means rewriting the parts of
Chromium's protocol that make it possible. Verified present in Electron 41.7.0:
`webContents.debugger.attach(protocolVersion)`.

Electron natively covers a few things more cheaply, and those stay native:
`capturePage()` (screenshot, already used for resize placeholders),
`printToPDF()` (PDF), `session.cookies` (cookies), `sendInputEvent()` (trusted
input — an alternative to `Input.dispatchMouseEvent`, both give `isTrusted:
true`; `element.click()` in an isolated world does not, and sites reject it).

Caveats to design around rather than discover:

- **One CDP client per `webContents`.** Attaching conflicts with DevTools on that
  view. Browsed views already deny DevTools, so this is compatible — but it must
  be enforced, not assumed.
- **Attach lazily, detach on teardown.** A debugger attached to every tab for the
  session's lifetime is both overhead and exposure. Attach on first automation
  command for a tab; detach with the view.
- **Handle the `detach` event.** A renderer crash drops the session silently and
  every later command would fail opaquely.
- **No visible indicator.** Unlike Chrome, Electron shows no "DevTools is
  debugging this browser" banner. Whatever we surface in the UI is the only
  signal the user gets.

### 2. The CLI is the primary surface, not 70 agent tools

PW Agent CLI exposes ~70 commands and it is _a CLI_, not 70 tool definitions —
deliberately, for token efficiency, with `install --skills` teaching the agent
what exists. That is the right answer for us too, and we already have the shape:
`patcher browser`.

So the long tail lands in `patcher browser <command>`, and the registered agent tools
stay a small curated set — the ones worth the tool-slot cost because they are
used constantly and their results need structure:

```
browser_snapshot        browser_click       browser_fill
browser_navigate        browser_press       browser_screenshot
browser_tabs_*          browser_page_get_text
```

Everything else (cookies, storage, routes, tracing, video, PDF, vision) is
reachable as `patcher browser …`. Patcher agents run with shell access, so this costs them
nothing, and it keeps the provider's tool list from ballooning past the point
where models pick well.

Corollary: a dedicated skill teaching `patcher browser` becomes worth writing — our
equivalent of `install --skills`.

## Scope map

| PW group                                                            | Plan                          | Mechanism                                                                                                     |
| ------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Core — navigation                                                   | done                          | existing                                                                                                      |
| Core — `snapshot`                                                   | **Stage A**                   | `Accessibility.getFullAXTree`, scoped by `DOM.querySelector`                                                  |
| Core — dialogs                                                      | **Stage A** (also a live bug) | `Page.javascriptDialogOpening` / `handleJavaScriptDialog`                                                     |
| Core — click/fill/type/select/check/hover/drag/upload/press         | done                          | `Input.*`, `DOM.setFileInputFiles`                                                                            |
| Core — `resize`                                                     | done                          | `Emulation.setDeviceMetricsOverride`                                                                          |
| Core — `screenshot`                                                 | done                          | `capturePage()`; `Page.captureScreenshot` for `--full-page`                                                   |
| PDF                                                                 | done                          | `printToPDF()`                                                                                                |
| DevTools — `console`                                                | done                          | `console-message` (**not** CDP — see Stage C)                                                                 |
| Network — observe                                                   | done                          | `webRequest` (**not** CDP — see Stage C)                                                                      |
| Storage — cookies / localStorage / sessionStorage / state-save/load | done                          | `session.cookies` + an isolated-world script (**not** `DOMStorage` — see Stage D)                             |
| Network — `route` / `route-list` / `unroute` / offline              | done                          | `Fetch.enable` + `fulfillRequest`, `Network.emulateNetworkConditions`                                         |
| Vision — mousemove/down/up/wheel                                    | done                          | `Input.dispatchMouseEvent` by coordinate                                                                      |
| Core — `eval`                                                       | done                          | `Runtime.callFunctionOn` in the page's own world                                                              |
| Core — `run-code`                                                   | **out**                       | PW's is a driver-side script with the Playwright API; ours would be arbitrary code in the shell — see Stage E |
| DevTools — tracing                                                  | done                          | our own action log, kept in the app (see Stage F)                                                             |
| DevTools — video                                                    | done                          | `Page.startScreencast` → frames + timings; the system's ffmpeg encodes on `--encode`                          |
| Sessions (`-s`, `--profile`, `--persistent`)                        | **n/a**                       | PW runs separate browsers; ours is the user's one browser, and tabs are the unit                              |
| Testing (assertions, locator generation)                            | **out**                       | we are not a test runner                                                                                      |

## Stages

Each stage is independently useful and independently verifiable; the build stays
runnable throughout (plan §21 rule 10).

### Stage A — the primitive everything else needs

Without addressable elements there is no interaction: `innerText` cannot say
"click _this_ button", and asking a model for CSS selectors is the brittle path
PW exists to avoid.

**Done:**

- **CDP session manager** (`desktop-browser-cdp.ts`) — lazy per-`webContents`
  attach, command dispatch, event fan-out, domain enablement deduplicated across
  concurrent callers, `detach` recovery, and a named refusal when another client
  (DevTools) holds the target.
- **`browser_snapshot`** (`desktop-browser-snapshot.ts`) —
  `Accessibility.getFullAXTree` reduced to PW's compact form, refs on interactive
  nodes only, state worth acting on (`[checked]`, `[collapsed]`, `[disabled]`),
  node/length/depth caps that report truncation. Reachable as an agent tool, as
  `patcher.browser.page.snapshot`, and as `patcher browser snapshot`.
- **Ref lifetime** — refs map to `backendNodeId`, invalidated on navigation and
  on same-document navigation, with a `generation` carried in the result so a
  later interaction command can be refused rather than resolved against whatever
  holds that node id now.

- **Dialogs**, with the app drawing its own. `Page.javascriptDialogOpening` →
  the shell records the dialog, captures the frozen page as a bitmap, hides the
  native view and pushes the dialog to the renderer;
  `BrowserPageDialog` draws over the placeholder; answering goes back through
  `Page.handleJavaScriptDialog` and the view returns. Agents answer the same
  dialog through `browser_handle_dialog` / `patcher browser dialog`.

- **Selector-scoped snapshots**, added after F. `patcher browser snapshot --selector
"form.checkout"` — and the `selector` parameter on the snapshot tool — render
  the matched element's subtree instead of the page, with refs for it alone.

  It does **not** work the way this plan guessed. `Accessibility.getPartialAXTree`
  answers with the node and one level of children, so building a subtree from it
  would be a protocol round trip per level; the tree is fetched whole as before
  and the render starts at the matched node. So the saving is the _caller's
  context_, not the protocol traffic — which is the scarce thing here anyway,
  and the honest way to describe the feature.

  The lookup is `DOM.getDocument` → `DOM.querySelector` → `DOM.describeNode`,
  the last of those only to turn the DOM agent's node id into the backend id the
  accessibility tree carries. Three refusals are worth their own names, because
  each sends a caller somewhere different: a selector the browser will not parse
  (`invalid-selector` — its complaint is passed through, since only the browser
  can judge one), a selector that matched nothing (`no-match`, which the
  protocol reports as node id zero rather than as an error), and a selector that
  matched an element the accessibility tree does not describe — a hidden one —
  which is `no-match` with a message that says so rather than a silent fallback
  to the whole page.

  It rides **its own channel and its own optional method**, which is the part
  that looks like overkill and is not: the unscoped snapshot request is
  `.strict()` and wire-frozen, so a `selector` added to it would be rejected
  outright by any older shell — and rejected as "no view", advice about a
  problem the caller does not have. On the agent wire, which ships with the
  server that serves it, the same capability is one nullable field.

  A scoped snapshot replaces the tab's ref table like any other, because it
  hands out `e1` again for a different element.

Done when: an agent can snapshot a real page and refer to its elements. ✅

### Stage B — interaction

**Done.**

- **Actionability** (`desktop-browser-actions.ts`) — the substantial part, as
  expected. One probe run in an isolated world answers attached / visible /
  settled / enabled / not-covered in a single round trip and returns the point to
  act at; the manager polls it until it passes or a 5s deadline expires, then
  reports _why_ it never did. Stability is two `requestAnimationFrame`s and a box
  comparison; "not covered" is a hit test at the point about to be clicked, which
  is the check that catches the fading-out modal backdrop. The blocked reasons
  are separate because each implies a different fix — `covered` means dismiss
  something, `disabled` means fill something else first, `unstable` means wait.
- **One `interact` channel**, not one per verb. Every action shares the same
  preamble (resolve the ref, check the generation, wait for actionability), and a
  channel per verb would freeze nine copies of it across a wire-frozen boundary.
- `click` (with button, double, modifiers), `hover`, `drag` — trusted input at
  the probed point. A double click is press/release at count 1 then at count 2,
  because one event claiming `clickCount: 2` is not a double click to Chromium.
- `fill` — select the old value, then `Input.insertText`. Clearing is a Delete
  keystroke, since inserting an empty string inserts nothing.
- `type` — one key event per character, which is the whole difference from
  `fill`: autocompletes and input masks react to keystrokes, not to a value
  appearing.
- `press` — a small key table (`desktop-browser-keyboard.ts`) rather than
  Playwright's full HID map. Each event carries `key`, `code`,
  `windowsVirtualKeyCode` and `text`, because different consumers inside a page
  read different ones, and a key that inserts nothing uses `rawKeyDown`. An
  unknown key name is refused by name — pressing the wrong key on a live page is
  a side effect, so guessing is not an option.
- `select`, `check`/`uncheck` — semantic. Not a stylistic preference: a native
  `<select>` opens an OS-drawn popup no synthetic mouse event can reach, and
  "click the checkbox" is a toggle where an agent wants a known end state.
  Check/uncheck read the state first, click only if it differs, and confirm
  afterwards, because a controlled component can refuse.
- `upload` — `DOM.setFileInputFiles`, with no actionability wait: a styled upload
  control almost always hides the real `<input type=file>`.
- `resize` — `Emulation.setDeviceMetricsOverride`, with `0 0` clearing it. Device
  metrics rather than the view's bounds, which the renderer's layout owns.

Three registered agent tools (`browser_click`, `browser_fill`, `browser_press`),
the rest as `patcher browser click|hover|drag|type|select|check|uncheck|upload|resize`
— the split the CLI decision above calls for. The instructions block tells the
model the CLI exists, since a tool it cannot see is a tool it will not use.

Done when: an agent can fill and submit a real form. ✅ (against fakes; see the
live-verification note at the end)

#### Ref lifetime, and the check that is deliberately optional

Interactions carry the `generation` of the snapshot their refs came from, and the
shell refuses a mismatch. It is **optional**, and the reasoning is worth keeping:
navigation already drops every ref, so acting on an element that no longer exists
fails either way (`unknown-ref`). What the generation adds is protection against
a _newer_ snapshot having reassigned `e5` to a different element between the
caller reading it and acting on it — narrow, but silent when it bites.

So it is offered everywhere (the snapshot prints it, the tools take it, the CLI
has `--generation`) and required nowhere. Threading a value through every call
for a narrow race is ceremony a model pays for on every action; refusing to offer
it at all would be pretending the race does not exist.

### Stage C — observation

**Done.** Cheap and high value, as expected. The one thing worth writing down is
that two of the four came out on a different mechanism than this plan sketched,
and the reason is not convenience.

**Nothing in this stage attaches the browser debugger**, except the one capture
added afterwards that cannot avoid it. That is the property the whole stage is
built around, and it is why the mechanisms moved:

- **`screenshot`** — `capturePage()`, the visible viewport, JPEG by default and
  PNG on request. Full-page is the exception below.
- **`pdf`** — `printToPDF()`, which _is_ the whole document. It is also the one
  call that can come back `result_too_large`; a truncated PDF is not a smaller
  PDF, so the cap is a refusal.
- **`console`** — Electron's own `console-message` event, buffered per tab from
  the moment the tab is created.
- **`network`** — `webRequest.onCompleted` / `onErrorOccurred`, attributed by
  `webContentsId` exactly as the session firewall already attributes requests,
  buffered the same way.

The plan said `Runtime.consoleAPICalled` / `Log.entryAdded` and `Network.*`. Both
would have started recording at the first automation command, so the honest
answer to "what did this page log" would always have been "nothing yet — reload
and ask again", and asking would have enabled a domain, which attaches the
debugger, which moves that tab's dialogs off Chromium's native path for a human
who only wanted to look. Native events cost none of that and are already flowing.

What the swap costs, stated rather than discovered: `console-message` hands over
text Chromium has already flattened, so no structured arguments and no stack
traces; `webRequest` sees method, type, status and cache but never bodies. Both
answer "did this page error" and "what did it call". Neither is a DevTools panel,
and bodies are Stage E's business anyway.

Two design points that follow from the buffers being rings:

- **`droppedCount`, not a completeness flag.** A caller reading a log needs to
  know it is looking at a window. One number covers both ways entries go missing
  — evicted by the ring, or cut by the requested limit — because from the
  caller's side they are the same fact.
- **Tab-scoped, not page-scoped.** A navigation does not clear either log. The
  alternative was tempting and wrong: clearing on `did-navigate` would drop the
  main-frame request's own status, which is the single most useful line in a
  network log, and it would hide the redirect chain that explains where the tab
  ended up.

One registered agent tool, `browser_screenshot`, which returns the **image
itself** rather than a path — a model that asked to see the page has to see it in
the same turn, and it cannot open a file. The other three are
`patcher browser screenshot <file> | pdf <file> | console | network`, where a file is
the right answer because a terminal cannot show an image and a human can open
one. The CLI resolves a relative path against the invoking shell's `cwd`, not the
server process's.

#### Full-page capture, added after F

`patcher browser screenshot out.jpg --full-page`, the `fullPage` parameter on the
screenshot tool, and `patcher.browser.page.screenshot({ fullPage: true })` capture the
whole scrollable document. This is the item Stage C deferred, and it is deferred
no longer for the reason it was deferred in the first place: there is no way to
do it without the debugger, so the only honest options were to attach one or to
keep saying no.

**It pays for exactly as much of the debugger as it needs.** A session is
attached; the `Page` domain is **not** enabled. That distinction is the whole
design: enabling `Page` is what moves a tab's dialogs off Chromium's native modal
and onto ours, and a picture must not cost a browsing human that. So this is the
one automation command that attaches without taking the tab over — and the one
observation that can answer `debugger_unavailable`, which it does rather than
quietly handing back a viewport picture when DevTools holds the tab.

The region is measured by a script in the **page-read isolated world**, not by
`Page.getLayoutMetrics`, which is the obvious CDP answer and wants the `Page`
domain. That script takes the largest of `scrollHeight`/`offsetHeight`/
`clientHeight` across `documentElement` and `body`, because no single one of them
is right everywhere — standards mode grows one element, quirks mode the other,
and out-of-flow content reports a `scrollHeight` smaller than its `offsetHeight`.
Measuring too large costs blank pixels at the bottom; measuring too small cuts
the page off silently.

Then `Page.captureScreenshot` with an explicit clip and `captureBeyondViewport`.
The clip carries `scale: 1`, which is what makes the result **CSS pixels** — a
viewport capture comes back in the display's device pixels, so on a retina screen
the two report sizes in different units for the same page. The result says which
it is (`fullPage`), and the SDK's type documents both.

Two limits, reported rather than hidden:

- **~16k pixels.** A composited capture is a GPU texture, and past the driver's
  maximum size the answer is a blank image, not a bigger one. A longer document
  is captured down to its top with `truncated` set — the opposite of the PDF's
  cap, which refuses, because half a PDF is not a smaller PDF while the top of a
  page is a useful picture of the top of a page.
- **The bridge's 8MB.** Past that it is `result_too_large`, with the message
  naming the three ways out (JPEG, lower quality, or print it to a PDF).

It rides its own channel and its own optional method, and for a sharper reason
than the scoped snapshot's. The observation union's members are plain objects, so
an older shell would not _reject_ a `fullPage` flag added to the screenshot
member — it would **strip** it, capture the viewport, and report success. A
caller cannot see that it got the wrong answer. Feature-detecting `captureFullPage`
turns a silent wrong picture into "this version cannot do that, ask for the
viewport". The agent wire keeps one union and one required boolean, so the
executor rebuilds the shell's screenshot observation rather than forwarding it;
the drift-guard test pins both halves of that (`observation-contract.test.ts`).

Done when: an agent can see the page and read what went wrong on it. ✅ (against
fakes, as with A and B)

### Stage D — storage and state

**Done.** Cookies, `localStorage`, `sessionStorage`, `state-save` /
`state-load`, all seventeen of PW's storage verbs, none of them a registered
agent tool — this is the group the CLI decision above was written for.

**This stage attaches no debugger either**, and the second half of that is the
mechanism that changed. Cookies were always going to be `session.cookies`, which
is also why `httpOnly` ones are included at all: `document.cookie` cannot see
them, and they are the ones holding a login. Web storage was planned as CDP's
`DOMStorage` and came out as a script in the **same isolated world the page read
uses** — the debugger would have moved that tab's dialogs off Chromium's native
path for a user who only asked what a site had stored, and Stage C's rule is
worth more here than `DOMStorage`'s structured parameters.

What that costs, stated rather than discovered: main frame only, as with every
other isolated-world read; and the operation has to reach the page as text, so a
key and a value are carried as one `JSON.stringify`d literal instead of as
protocol arguments. That is safe for plain data — JSON's output is a JavaScript
expression, and the one historical hole in that claim (U+2028/U+2029 ending a
string literal) closed with ES2019 — but it is a sharper edge than the page
read's fixed constant, and the reason the payload is one literal rather than
spliced into expressions.

**Playwright's `storageState` is the file format**, deliberately: a session saved
here loads into Playwright and one Playwright saved loads back here. That is
worth the mapping it costs — `no_restriction` → `None`, a missing
`expirationDate` → `expires: -1`, and a leading dot deciding whether a cookie is
written host-only or to a whole domain. `sessionStorage` is absent from that
format and stays absent; inventing a field would break the interop it exists for.

Three scope decisions, which are where the security of this group actually lives:

- **Reads are tab-scoped.** Cookies for the URL the tab is on, web storage for
  its origin. There is no whole-jar read, and that is not an oversight: the tab
  is this browser's unit, and one call handing over every site the user is signed
  into is a different thing from one handing over the site they are looking at.
- **Writes are not.** A cookie carrying its own domain is written to that domain,
  because a `storageState` file whose cookies were re-homed onto the current tab
  restores a session that does not work. So `state-load` can put a cookie
  anywhere; the gate is the plugin toggle, as it is for `upload`.
- **`state-load` applies `localStorage` for the tab's origin only**, and says how
  many other origins it skipped. Loading the rest would mean navigating the
  user's browser around their saved sites one by one, which is a much larger
  thing to do than the command asks for.

Writes answer with counts (`applied` / `rejected`) rather than nothing, because a
partial write is the realistic outcome — Chromium refuses a cookie whose domain
and scheme disagree — and a silent one costs an hour of asking why a restored
session half works.

The framing the plan asked for is in the tool instructions, the CLI's own help
and the plugin-authoring skill, in those words: **these are the user's real
logins, not settings.** Values come back in the clear, which is the honest
choice — a redacted cookie is not a cookie, `state-save` writes them to a file
regardless, and a fig leaf would only teach an agent to route around it.

Done when: an agent can carry a signed-in session in and out of a tab. ✅
(against fakes, as with A, B and C)

### Stage E — interception, vision, eval

**Done**, and the first stage since B that genuinely needed CDP — `Fetch`,
`Input`, `Runtime` and `Network.emulateNetworkConditions`, none of which
Electron offers an equivalent for. So this is also the stage where the property
C and D held — _no debugger_ — stops holding, by design rather than by drift.

What it is, stated as the plan asked: **this is the group whose members hand a
caller what the rest of the API deliberately withholds.** That is what they have
in common, and it is why they share one channel rather than being filed under
Network, Vision and Core. `eval` runs the caller's JavaScript in a page that may
hold the user's live logins. The mouse commands act at raw viewport coordinates,
skipping both the ref lookup and the actionability check, so they land on
whatever is at that point. A route rewrites what the page receives from the
network, and `network-state-set offline` cuts it off. None of it is a registered
agent tool; all of it is `patcher browser`, behind the plugin toggle.

**`eval` runs in the page's own world**, which is the deliberate inversion of
every other script in this codebase. The isolated world exists to stop a page
shadowing the globals _our_ fixed scripts read; it cannot protect an expression
whose entire purpose is to touch the page, and running there would silently hide
`window.__NEXT_DATA__`, a framework's state and any function the page defined —
which is what people reach for `eval` to read. The expression is never spliced
into a string: it crosses as CDP's `functionDeclaration`, so the protocol parses
it as one function, and a ref is passed as its argument (`(el) => el.value`,
exactly Playwright's shape).

**`run-code` is out**, and that is a scope decision rather than an omission.
Playwright's `run-code` runs a script _in the driver_ with the full Playwright
API. Our driver is the Electron shell; the equivalent would be arbitrary code in
the main process, which is a different thing from arbitrary code in a page and
not something a page-automation plugin should offer. `eval` covers what
`run-code` is actually used for in a browser.

Three implementation decisions worth keeping:

- **`Fetch` is enabled only while a tab holds a route, and disabled the moment
  it holds none.** An enabled `Fetch` domain pauses _every_ request until
  something answers it, so an interception left on with nothing behind it is a
  page that never loads. For the same reason the handler answers on every path
  including its own failure: a request neither fulfilled nor continued hangs
  until the page gives up.
- **Routes and offline do not outlive the debugger session.** Chromium drops
  both when its protocol client detaches, so keeping the table would mean
  `route-list` describing a tab that is no longer mocked. They are cleared with
  the session.
- **Offline is per tab, not per session.** Electron's own
  `session.enableNetworkEmulation` would have taken every browsed tab offline at
  once; `Network.emulateNetworkConditions` is scoped to the target, and the tab
  is this browser's unit everywhere else.

Two smaller ones, stated because a reader will otherwise assume the opposite:
`mousedown` / `mouseup` / `mousewheel` act at the last `mousemove` point, which
is (0,0) until something moves it — Chromium wants a point on every mouse event
while Playwright's commands name none, and tracking it is what makes
move → down → up a click. And a ref click from Stage B does **not** move that
pointer: vision's pointer is vision's own.

What is deliberately not built: PW's `--remove-header` (it modifies a request
that a fulfilled route never sends) and route patterns that abort rather than
answer. Both are additions if something needs them, not gaps left by accident.

Done when: an agent can reach what the accessibility tree cannot describe, and
decide what a page is told. ✅ (against fakes, as with A through D)

### Stage F — recording

**Done**, and it is two features rather than one. They record different things,
they live in different processes, and the only thing they share is a command.

**The trace is the app's**, and that is the decision in this stage worth
arguing about. The shell sees more of the browser and holds the pixels, but it
cannot tell an agent's command from a person's: a `navigate` arriving there
looks identical whether a tool call or the user's omnibox sent it, and a log of
"what the agent did" that also logs what the user did is not that log. The
executor in the app is the only place a browser command exists _as a command_,
so the trace is kept there — which also means it needs no IPC channel, no
desktop-contract change and no version skew.

So this is the fifth of these command unions and the first deliberately **not**
mirrored on both wires: the shell's half carries the three `video-*` members and
refuses `trace-start` / `trace-stop`. The drift test pins both halves of that,
because a later tidy-up making the two identical would break the second one
silently.

**Tracing** is our own artifact, as planned: PW's traces are a bespoke format
its own viewer opens, and ours is a JSON log — sequence, elapsed time, the
command, a rendered detail line, the outcome, and optionally a JPEG of the
visible tab after each step that could have changed it. Rendered rather than
serialized, deliberately: the JSON of a `state.load` is a set of the user's
cookies, and a trace is a file people save and send each other. So keys are
named and their values are not — while text typed into a field _is_ kept, since
a log that will not say what was filled in is not a log of what happened.

**Video is `Page.startScreencast`, and the recording stops at the frames.** What
comes back over the wire is JPEGs with their timings, not a webm — the artifact
is the frames plus an ffconcat playlist that carries them, and the encode is a
separate, optional step over an artifact that is already complete.

### The encoder decision

**Patcher ships no encoder and downloads none. `--encode` runs the ffmpeg the machine
already has.** The alternatives, and why each lost:

- **Bundling ffmpeg** — 40–80MB in every auto-update payload for a mac-arm64-only
  app, a GPL build inside the distribution, and another binary to sign once
  notarization is turned on (today `identity: null`, `notarize: false`). Real
  costs, for a feature most sessions never use.
- **Downloading one on demand** — worse, not better. Patcher would execute a binary
  that was never part of a Patcher release: responsibly done that means a pinned URL,
  a checksum, and a story for updates, and on Apple Silicon it also means
  depending on how a third party signed their build, with a quarantine flag to
  strip if it comes to that. Writing code whose job is to remove a Gatekeeper
  attribute from a freshly downloaded executable is not a thing to do quietly.
  It would also install onto the _server's_ machine, which on a remote server is
  not the machine the terminal is on.
- **`MediaRecorder` in a renderer** — the dependency-free path, and it fails on
  timing rather than on packaging: MediaRecorder timestamps frames by when they
  arrive on the stream, so preserving a 30-second recording's pacing costs 30
  seconds of wall clock inside a tool call. (The hidden-window painting problem
  is real too, but this one alone settles it.)

So: `patcher browser video-stop <dir> --encode` writes `video.mp4` beside the frames,
and `patcher browser install-ffmpeg` installs one with Homebrew when there is none.
Three properties make that acceptable rather than a shrug:

- **The frames are the artifact, the video is a rendering of it.** A missing or
  failing encoder costs the convenience, never the recording — and the failure
  message says so, because the alternative is someone re-recording a session
  they still have on disk.
- **The lookup is a candidate list, not `PATH`.** `PATCHER_FFMPEG` → `PATH` →
  `/opt/homebrew/bin` → `/usr/local/bin`, and each candidate is _run_ rather than
  stat-ed, because a path can exist and be the wrong architecture. A server
  started from a macOS GUI inherits `/usr/bin:/bin` and nothing else, so `PATH`
  alone finds neither Homebrew's ffmpeg nor Homebrew — the lesson the automations
  plugin already paid for and wrote down.
- **Installing is its own command.** It is the one thing here that changes the
  machine it runs on, so it is never a side effect of stopping a recording. An
  agent that hits a missing encoder is told the exact command; it has shell
  access, so that _is_ the button, pressed by something with the right to press
  it and installing a signed, updatable build.

One bug this fixed on the way: the `ffmpeg` line the CLI used to print has no
`-vf scale=trunc(iw/2)*2:trunc(ih/2)*2`, and Chromium scales screencast frames
to fit the cap while keeping the aspect ratio — so an odd height is the normal
case and H.264 with `yuv420p` refuses it outright. The documented command failed
on exactly the recordings people make.

Three implementation notes, in the order they bite:

- **Every screencast frame is acknowledged, including the ones dropped for
  pacing.** Chromium sends the next frame only once the last has been answered,
  so a frame that is silently ignored does not cost one frame — it ends the
  recording. Pacing therefore keeps or discards _after_ the ack, never instead
  of it.
- **The frames are budgeted while filming, not at the end.** They arrive at the
  page's paint rate for as long as it runs, so an unbounded buffer is a
  page-controlled allocation in the main process; the recording stops keeping
  frames at its cap and reports how many it dropped.
- **A film dies with the debugger session**, like the routes, because Chromium
  stops the screencast when its client detaches. A recording that survived would
  answer `video-stop` with a film that stopped growing minutes earlier.

Two smaller ones. PW's `video-start [file]` names the file when filming begins;
ours names a directory when it ends, because the artifact crosses the command
wire and the CLI is the writer — the same shape as `screenshot <path>` and
`state-save <path>`, and it keeps the shell out of the business of writing files
at a path someone else chose. And the tab has to stay **visible**: a
`WebContentsView` that is not on screen paints nothing, so it produces no
frames — the same reason a step screenshot is taken of the active tab and of no
other.

What the trace does not record, stated because a reader will assume otherwise:
anything the _user_ does in the same browser while it runs, and any navigation a
_page_ starts by itself. It records the commands Patcher was asked to run.

Done when: a session an agent drove can be reviewed after the fact. ✅ (against
fakes, as with A through E)

### How the dialog UI works, and why it looks like that

The app cannot draw over a live page — a `WebContentsView` composites above the
DOM — so the sequence is: capture the frozen page, **hide the view**, push the
dialog, and draw the modal over the captured bitmap in the panel where the page
was. That is the resize-burst machinery reused wholesale; the placeholder `<img>`
and the hide/reveal ordering already existed for exactly this shape of problem.

Two consequences worth keeping in mind while extending it:

- **The modal must render after the placeholder.** They are absolutely
  positioned siblings, so DOM order decides which one is on top.
- **The view must come back on every path out**, including a
  `Page.handleJavaScriptDialog` that throws because the page died mid-answer.
  Losing a dialog is recoverable; leaving the user's browser view permanently
  hidden is not.

`alert()` gets no Cancel button, because `alert()` offers no such choice; Escape
dismisses everything else. The message is page-authored, so it renders as text.

## The dialog bug Stage A fixed

Before Stage A, `apps/desktop/src/desktop-browser-view.ts` handled JavaScript
dialogs **not at all**: no `disableDialogs`, no interception. Electron's default
is a native modal owned by the app window, so a page calling `alert()` or
`confirm()` blocked the whole Patcher window rather than only itself — and **an agent
had no way to answer it**. The user could click its buttons; the automation path
could not, so a dialog stopped an agent dead.

That was a live defect, not only a missing PW feature: reachable by any page,
independent of the automation work, which is why dialog handling sat in Stage A
rather than with the rest of the Core group.

Taking dialogs over via CDP has a consequence worth deciding deliberately rather
than discovering: once the `Page` domain is enabled on a view, Chromium routes
its dialogs to the protocol client and stops showing the native modal. So
whatever we do with them becomes what a **human** using that tab sees too, and
React cannot simply draw a replacement over the page — a `WebContentsView`
composites above the DOM (the same constraint that forces the omnibox list to
take layout space). Attaching CDP lazily, per tab, on first automation command
is what keeps ordinary browsing on the native path.

## What Stages A through F are and are not verified against

Covered by tests: the key table and chord parsing, including the one genuinely
ambiguous case (`"Shift++"` is the plus key, `"Shift+"` is nothing); the probe
parsers, where an unusable answer has to be told apart from "not ready yet"
because only the second is worth retrying; ref resolution reaching CDP as the
backend node id the snapshot recorded; a stale generation and an unknown ref both
refusing **before** anything is dispatched; the actionability wait giving up with
its reason; each action's CDP call sequence; and the interaction union parsing
identically on both wires, which is the only mechanical guard on the "must not
drift" claim those two schemas make about each other.

Stage C adds: the ring buffer's eviction and its dropped count (including the
case that matters — a limit hiding entries the ring never evicted); the console
and network normalizers, where an unrecognized level must not become `error` by
accident; requests landing against the tab that made them and not against a
sibling; a capture answering without the debugger ever being attached, which is
the stage's whole premise; and the observation union parsing identically on both
wires.

Stage D adds: the cookie mapping in both directions, where the cases that matter
are the ones a wrong guess makes silently wrong — a session cookie's expiry
spelled `-1` and then _omitted_ rather than sent as 1969, a host-only cookie
staying host-only because naming its domain would widen it, and a non-secure
cookie offered over `http` because Chromium refuses it the other way round; that
a key which reads as code stays a string; that reads answer without the debugger
being attached; that a page's own refusal is passed through rather than flattened
into a generic failure; and the storage union parsing identically on both wires.
End to end through the CLI: that `state-save` produces Playwright's shape, that
`state-load` writes back what it saved and reports the origins it could not
place, and that a file which is not a saved session is refused rather than
half-applied.

Stage E adds: the route glob in Playwright's dialect, including the case that
decides whether a mock fires at all (`*` stopping at a path separator where `**`
does not) and the one a wrong implementation gets silently wrong — regex syntax
in a pattern matching those characters rather than meaning something; a paused
request being fulfilled when it matches and **continued when it does not**,
which is the difference between a mocked page and a page that never finishes
loading; the interception being torn down with the last route and forgotten with
the session; an expression reaching the page's own world rather than the
isolated one, with a ref resolved into that same world; a page's own exception
text surviving as the answer; and the control union parsing identically on both
wires.

The full-page capture added after F is covered where it can go wrong: that the
region comes from the isolated-world measurement and reaches the clip, that
`captureBeyondViewport` is set and `Page` is never enabled — the two halves of
"attach, but do not take the tab over"; that PNG is asked for without a quality,
which has no meaning for it; that a document past the texture limit is clipped
and says so while one past the bridge's cap is refused instead; that a page which
never answers how large it is costs no capture request at all; and that DevTools
holding the tab is reported as itself rather than as a generic failure. On the
agent side: that `fullPage` picks the channel instead of travelling on the
observation, that an older shell is reported as unsupported rather than answered
with a viewport picture, and that the shell's union _strips_ the flag — which is
the fact the whole channel decision rests on.

The selector scoping added after F is covered where it can go wrong: that the
render starts at the matched element and its siblings are gone, that a wrapper
the tree calls generic renders as its contents (which is what `#app` names on
most pages), that a scoped snapshot invalidates the previous one's refs because
it hands out `e1` again, and that the three refusals stay apart — a selector the
browser will not parse, one that matched nothing, and one that matched something
the accessibility tree does not describe.

Stage F adds: the screencast's pacing arithmetic, including the property the
whole recording rests on — every frame acknowledged, including the ones the
pacing throws away, because an unacknowledged frame ends the film rather than
shortening it; a second `video-start` on the same tab refused instead of
replacing the first, and the film forgotten when the debugger detaches; frames
handed back even when the stop command itself fails; the trace recording one
step per command an agent issued, including the case where one command runs
another internally; a step's failure carried as its code, which is what a trace
is read for; the caps dropping images while the log keeps going; that cookie and
storage _values_ never reach a step's detail line while filled-in text does;
that the recording union is the same on both wires for video and deliberately
not for the trace; and, end to end through the CLI, a trace written as a
directory of JSON and JPEGs and a film written with the ffconcat playlist that
carries its timings.

**Untested, and worth knowing:** `patcher browser install-ffmpeg` end to end, which
would mean running Homebrew from a test suite — the candidate lists and the
messages are covered, the `brew install` is not. The encode path _is_ covered,
against a stand-in binary the test writes: what is worth pinning there is the
argv Patcher passes and that it checks a file appeared, neither of which needs a real
encoder, and a test that encodes video is a test that fails on a machine without
one. Also untested: the argument normalizers in the server's plugin
API — the observation defaults (JPEG at 80, a limit of 100), Stage D's cookie
defaults (host-only, path `/`, non-secure, `Lax`, session), Stage E's route
defaults (200, and a content type read off the body's first character) and their
range checks. Nothing in the server suite constructs a plugin API, so there is no seam
to test them through, and Stage B's action normalizer has the same gap. The
schemas behind them reject out-of-range values regardless; what is unpinned is
the default and the wording of the error.

**Not verified against a real browser.** Everything above runs against a fake
`webContents.debugger`, so what no test here proves is that Chromium behaves as
documented:

- that enabling the `Page` domain moves dialogs off the native path (the
  assumption the whole dialog UI rests on);
- that `Accessibility.getFullAXTree` shapes real pages the way the builder
  expects;
- that `Page.createIsolatedWorld` + `DOM.resolveNode` reach the element, and that
  trusted input at the probed point lands on it;
- that `console-message` fires for a `WebContentsView`'s contents at all, and
  carries the details object rather than only the legacy positional arguments —
  Stage C's console log is empty and silent if it does not;
- that an isolated world's `window.localStorage` is the _page origin's_ storage
  rather than a world of its own — it is for extension content scripts, which is
  the same mechanism, but if Electron differs here Stage D's web-storage reads
  come back empty on a page that plainly has data;
- that `Fetch.requestPaused` arrives for a `WebContentsView`'s subresources and
  not only its main frame, and that a fulfilled body reaches the page as the
  content type it was given — Stage E's routes are inert if either is wrong;
- that `Runtime.evaluate` with no execution context id really lands in the main
  world here, which is what makes `eval` able to see the page's globals at all;
- that `Page.startScreencast` delivers frames for a `WebContentsView` at all,
  and keeps delivering them while the Patcher window is merely unfocused rather than
  hidden — Stage F's video is a blank directory if it does not;
- that a `capturePage` taken immediately after an action shows the page _after_
  it, rather than the frame before the compositor caught up, which is what a
  trace's step images are for;
- that `Page.captureScreenshot` with a clip and `captureBeyondViewport` renders
  the region below the fold for a `WebContentsView` — it is the one call here
  that asks Chromium to render something nobody is looking at, and if it answers
  with the viewport padded out instead, a full-page capture is a tall picture of
  mostly blank;
- that what the page measures as its document is what Chromium then renders — a
  page whose layout depends on scroll position (sticky headers, viewport-unit
  sections, lazy images) can disagree with itself, and the capture is the version
  that wins.

The shortest way to find out, in order:

```bash
bun run dev            # and, in another shell, bun run dev:desktop
bun run patcher:dev plugin enable browser-tools
# open /browser in the desktop app and load a page with a form, then:
bun run patcher:dev browser snapshot        # refs, and the generation on stderr
bun run patcher:dev browser snapshot --selector form   # the form alone?
bun run patcher:dev browser fill e2 hello
bun run patcher:dev browser click e1
bun run patcher:dev browser console        # does anything at all come back?
bun run patcher:dev browser network        # the page's own request, with its status?
bun run patcher:dev browser screenshot /tmp/shot.png
bun run patcher:dev browser screenshot /tmp/full.jpg --full-page   # taller than the window?
bun run patcher:dev browser cookie-list     # on a site you are signed into
bun run patcher:dev browser localstorage-list   # empty here would mean the world is wrong
bun run patcher:dev browser eval "() => location.href"   # the page's world, or not?
bun run patcher:dev browser route "**/*.json" --body '{"mocked":true}'
bun run patcher:dev browser reload && bun run patcher:dev browser route-list  # matched > 0?
bun run patcher:dev browser tracing-start --screenshots
bun run patcher:dev browser click e1 && bun run patcher:dev browser tracing-stop /tmp/trace
bun run patcher:dev browser video-start && bun run patcher:dev browser reload
bun run patcher:dev browser video-stop /tmp/film --encode   # frames, then video.mp4?
# then, from the page's own console: alert("hi") — whose modal appears?
```

The observation commands are the cheapest thing to try first: they need no refs,
no snapshot and no debugger, so a `console` that returns entries proves the whole
server → hub → app → shell chain is alive before anything harder is attempted.

## Capability grouping

PW organises its commands into seven groups and then states plainly that in the
CLI all of them are always on. We should keep the grouping (Core / Network /
Storage / Vision / DevTools / PDF) as the shape of the docs and the CLI's help,
because it is also the natural seam if per-plugin permissions ever arrive
(PROJECT_PLAN §9, still unbuilt). Today the gate remains what it is: the
`browser-tools` plugin ships disabled, and enabling it hands an agent the user's
browser.

Stage E cuts across that grouping — its commands belong to PW's Network, Vision
and Core groups — and it still ships as one channel and one plugin-API namespace
(`patcher.browser.control`). That is deliberate: the CLI and the docs keep PW's
grouping because that is how someone looks a command up, while the wire groups
by how much a command hands over, because that is the line a permission would
one day be drawn along. `patcher browser eval` and `patcher browser route` have nothing in
common as verbs and everything in common as a thing to grant.

Stage F cuts across it differently: `tracing-*` and `video-*` are one CLI group
and one plugin-API namespace, while only half of them ever reaches the shell.
The line there is not how much a command hands over but where the thing being
recorded exists — commands in the app, pixels in the browser.

## Sizing

Stage A + B together came out comparable in size to all of Phase 5, as expected,
and the actionability checks were indeed the body of work — they are what
separates automation that works from automation that flakes. C was small, as
predicted, and smaller than planned for a reason worth remembering: two of its
four features turned out to need no CDP at all, so most of the stage was wire
plumbing over events the shell was already receiving. D repeated that — no CDP
in the end either, and its real work was the cookie format mapping rather than
the plumbing. E came out as predicted: moderate, and the first stage since B
that genuinely needed CDP. Its body of work was not the protocol but the
interception's lifecycle — an enabled `Fetch` domain that nothing answers is a
wedged tab, so when it is on, when it is off and what happens to a request that
matches nothing is the whole of it.

F was predicted to be the largest per unit of value, and it came out smaller
than that — but only because it stops where it does. The trace needed no wire at
all, and the video is a bounded buffer, an acknowledgement rule and a playlist.
Everything expensive about "video" is in the encoding, and the encoding is not
here — the decision that would have been large turned out to be a decision _not_
to ship an encoder, which cost one small module and a candidate list.

The two additions after F are both small, and both were small for the same
reason: the mechanism was already in the building. The scoped snapshot is one
lookup in front of a tree that was already fetched; the full-page capture is one
measurement in front of a session that already attaches everywhere else. What
each one actually cost was the wire decision — which of them can grow a field,
which needs a channel, and what an older shell does with the difference.

## Upload, and what it does not add

`upload` hands a web page the contents of local files by absolute path, which
reads like an exfiltration primitive and deserves saying out loud. In Patcher's threat
model it is not a new one: an agent with these tools already has shell access and
could `curl` the same file to the same host. What it adds is a path where the
agent never sees the bytes it moved.

The honest framing is therefore the same as the rest of this plugin — the gate is
the plugin toggle, and enabling it hands an agent the user's browser. It is not a
reason to leave `upload` out, and it is not something to soften.
