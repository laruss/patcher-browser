# Plugin permissions

What a plugin declares in `patcher.permissions`, what refuses it, and — the part
worth reading before the rest — what this does not do.

Plan §9 asks that generated plugins not run with everything the host has. This
is the first half of that answer. The second half is plan Phase 7, and the
order matters: this document argues that the declaration had to come first,
and that it is worth having before it can be enforced against hostile code.

## This is not a security boundary, and cannot be one yet

A plugin's `server.ts` is a Node module loaded into the Patcher server process
(`plugin-runtime.ts`, via `jiti.import`). Three exits are open to it today and
no gate on the `patcher` object closes any of them:

- `import("node:child_process")` and `node:fs` — the process's own capabilities;
- `patcher.server.loopbackBaseUrl` plus `fetch` — the whole server API, around any
  wrapper on `patcher.sdk`;
- monkey-patching Patcher's own modules, which it shares a realm with.

So a plugin that wants what it did not declare can still take it. Saying
otherwise in a UI would be worse than saying nothing.

What the declaration is actually for, in the order the value arrives:

1. **It specifies the Phase 7 RPC surface.** Every entry names an operation
   that must cross a process boundary once plugins move out. A plugin host
   built without this list would isolate the plugin and then hand it back
   everything over RPC — the isolation would be real and pointless.
2. **It makes an under-declared plugin fail loudly.** An agent-generated plugin
   that reaches for something it did not ask for throws with the permission
   named and the fix in the message. That is what makes plan Phase 6's loop
   converge rather than silently do more than the user asked.
3. **It is something to show.** `patcher plugin list` prints it, and install prints
   it for a `path:` source. The app does not: `installedPluginSchema` carries
   the declared set — for a disabled plugin too, since the manifest is the
   record and that is exactly when someone wants to look — but nothing in the
   plugin detail renders it yet. Half of this goal is delivered, and the half
   that is not is a UI surface nobody has asked for rather than a missing
   mechanism.

## Undeclared means denied

There is no legacy "everything" mode, and no version gate that grants one to
older plugins. A default of "all" would leave the list describing intentions
rather than the boundary, and the boundary is the whole product of this work.

The migration cost of the strict default turned out to be low, which is why it
was affordable. Usage across the fourteen in-tree plugins is narrow: ten needed
one to three entries, four needed none at all, and the declarations were
derived from what each plugin already calls. Only `browser-tools` — the plugin
that backs the agent browser tools — declares the full browser set, which is
correct and is now visible rather than implicit.

## Where it is enforced

Two chokepoints carry all of it, and they were chosen because they are the
same two places the Phase 7 RPC will sit.

**`callBrowser` in `plugin-api.ts`** — every `patcher.browser` call that reaches a
page funnels through one function, so one `permissionForBrowserCommand` call
covers `tabs`, `page`, `navigation`, `storage`, `control` and `recording`.

**`applySdkPermissions` in `plugin-permission-gate.ts`** — `patcher.sdk` is handed
out by one wrapper, so an undeclared area is replaced by a proxy that throws on
the property read. Reaching it fails, not just calling it, which puts the
plugin's own line at the top of the stack.

Registration of a browser contribution is checked in the `register*` method
itself. That gives the two halves different failure shapes, and both are
intended: a contribution refused inside the factory puts the plugin in `error`
(it never half-registers), while a command or SDK area refused at call time
leaves a running plugin that fails one operation.

### The splits that are not obvious

Mapping a whole command type to one permission would have been wrong three
times, so three places split on the sub-operation instead:

- **`page.control`** groups its members by how much they hand over rather than
  by what they do. Coordinate input is what a user could do anyway
  (`page.interact`); arbitrary JavaScript is not (`page.inject`); a mocked or
  severed network is neither (`network.intercept`).
- **`page.observe`** is reading the page (`page.read`) except for the network
  log, which carries request and response headers (`network.observe`).
- **`sdk.subscribe`** is a single function whose argument picks the feed, and
  one feed is thread activity. Gating it as an area would have handed every
  `workspace` plugin a live view of the user's threads.

Both switches are exhaustive with no `default`, and the declared return type
excludes `undefined` — so adding a browser command or a control operation
without deciding what it costs fails to compile (TS2366). That is the only
place the decision can be forgotten, and it is closed.

### And one split that was deliberately not made

`history` covers reading the browsing history, writing to it, deleting from it
and seeing every visit before it is recorded — where the rest of the browser
set splits reading from acting.

A `history.read` / `history.modify` pair would read better and enforce nothing.
Neither gate sees the HTTP method: one keys on the `patcher.sdk` area, the other on
the URL prefix. A plugin holding a read-only variant would be refused
`sdk.browserHistory.remove` and then reach `DELETE /browser-history/:id` with
`fetch` and the same identity headers. A permission that names a boundary the
enforcement cannot draw is worse than a blunt one, because the manifest is what
the user is shown.

### And one split that was made rather than folded

`tabMenu.register` is its own permission beside `contextMenu.register`, where
folding the tab menu into "the browser's context menus" would have been shorter.
`siteInfo.register` is its own on the same terms.

Two reasons, and the second is the load-bearing one. A tab entry receives a tab —
its url, title, whether it is pinned, muted or active — where a page entry
receives what was clicked; those are different disclosures, and the manifest is
what the user reads. And every plugin already granted `contextMenu.register`
would have silently gained the ability to put entries in the tab strip, which is
a widening nobody re-consented to. The house rule the browser set holds: one
permission per contributed surface, the same way `omnibox.register` and
`find.register` are separate — each naming what its holder gets to see.

`toolbar.register` is the one where that rule stopped being a formality. Every
other browser surface is scoped to something the user did: a right-click, a picked
entry, an opened panel, a typed query. A toolbar control is asked what it looks
like **on navigation**, so its holder is handed the address of every page the user
opens without the user doing anything — closer to `omnibox.register` (which sees
everything typed) than to the menus it sits beside. Folding it into
`contextMenu.register` would have turned a click-scoped grant into a standing one
for every plugin that already had it.

`newTab.register` is the same rule at the opposite end: a new tab has no page, so
the section a plugin puts there is asked nothing about the user's browsing. It is
still its own permission rather than none, because _placement in Patcher's chrome_ is
what the user is agreeing to — but it is the cheapest of the browser's permissions
to reason about, and the manifest should read that way.

### And two whose answer is a list of sites

`pageStyle.register` is the first permission where "what may this reach" could not
be answered by the permission alone. Every other entry in the list names a
capability and the holder then reaches whatever that capability reaches. A page
style reaches _pages_ — so styling one site the user named and styling every site
they visit would have been the same grant, and a single flag covering both says
neither.

So the declaration is two fields, and the second one is not a permission:

```json
{ "permissions": ["pageStyle.register"], "sites": ["https://github.com/**"] }
```

`patcher.sites` is the _scope_ of the permission, not another one. Holding
`pageStyle.register` with no sites reaches no page at all, and declaring sites
without the permission reaches nothing either — which is the property worth having,
because it means neither field can be read as harmless on its own.

Three decisions inside that are worth keeping:

- **Membership, not containment.** A registration's `matches` must be one of the
  declared patterns, verbatim. "Is this glob inside that glob" is a question whose
  answer nobody should have to trust with a stylesheet in a signed-in page, and the
  manifest is what the user actually read.
- **`https` only, except loopback over plain http.** The same rule a registered
  search engine's template gets, and for a sharper reason: what a site pattern buys
  is _standing_ access, and plain http to another machine is a site anyone on the
  path can impersonate. An `http` pattern with a wildcard in its host is refused
  rather than optimistically resolved — `http://*.localhost/**` would have to be
  trusted to stay loopback, and it does not.
- **The manifest refuses before the install.** A bad pattern is not a loaded plugin
  in an error state; it is a `package.json` that never installs, because the line
  the user would have consented to is the broken one. A `matches` entry the manifest
  does not carry is refused later, at registration, where the plugin author is the
  one who can fix it.
- **A pattern that would match nothing is a bad pattern.** Matching is exact and
  Chromium never reports an upper-case host, so `https://GitHub.com/**` is refused
  with the lower-case spelling to use — rather than corrected quietly, because the
  declared string is what a registration's `matches` must equal verbatim, or
  accepted, which would show the user a site the plugin never reaches.

`https://**/**` is allowed — a dark-mode or declutter plugin legitimately wants
every site — so the honesty of this permission rests on the list being shown before
anyone agrees to it. `patcher plugin install` prints it above the confirmation ("It will
restyle pages on: …") and `patcher plugin info` lists it, both read from the manifest on
disk, which is the path an agent-generated plugin takes.

**The app does not show it, and does not show permissions either.** That gap
predates this permission — nothing in the SPA renders `patcher.permissions` today — but
it matters more here than for the others, because this is the one whose scope is a
list only the reader can judge. `sites` is on the wire (`InstalledPlugin.sites`)
ready for that surface; until it exists, a plugin installed through the app's own
dialog discloses its sites nowhere the user will look.

Not to be confused with `patcher.sdk.hosts`, which is enrolled machines.
These are websites.

#### Two permissions over one list

`pageScript.register` — the plugin's own code running in those same pages — is
scoped by the same `patcher.sites`, checked by the same membership rule, and refused in
the same three places. It is deliberately **not** the same permission as the styling
one.

The line is what the grant discloses. A stylesheet cannot read the page and cannot
carry anything back; a program can do both — the text, the form fields, whatever the
signed-in user can see — and it has a channel to the plugin's backend. A plugin the
user let declutter GitHub has not thereby been let read what they do there, and one
permission covering both would have made that distinction unsayable.

The disclosure follows the split: `patcher plugin install` prints "It will restyle pages
on: …" for one and "It will run its own code on pages of: …" for the other, each only
if the permission that grants it was declared. A site list nothing is allowed to use
grants nothing, and says nothing.

This is the shape to copy if a third site-scoped capability ever arrives: another
permission over the same list, never a wider reading of an existing one.

### And one that stayed ungated on purpose

`patcher.ui.registerCommand` — a command of the plugin's own, with a chord — costs
nothing, next to `registerKeybinding`, which also costs nothing. The reason is that
a chord which runs the plugin's own code discloses nothing that was not already the
plugin's, and the design keeps it that way: `run` receives **no context**. A command
that wants the page the user is on reads it through `patcher.browser.page.*` and pays
`tabs.read` there.

That is the shape to copy when a surface looks like it needs a new permission:
first check whether the capability can be _reached_ through a gate that already
exists. Handing the address to every chord and then inventing `command.register` to
cover it would have been a permission that exists to excuse a disclosure nobody
needed.

## What is ungated, and why

`log`, `settings`, `storage`, `http`, `rpc`, `realtime`, `background`, `cli`,
`agents`, `ui`, `events`, `hosts` reach the plugin's own resources — its
database, its routes, its logs. `patcher.browser.getStatus()` reports only whether
a browser window is connected, which is not the user's data.

`patcher.agents.registerTool` is ungated too, and that one is a judgement rather
than an obvious call: a plugin's agent tool runs with the plugin's own grants,
so the tool cannot exceed them. What it does add is reach into the agent's
turn, which `threads` does not cover.

## The API gates plugin traffic, not just the SDK object

`patcher.sdk` is an HTTP client for Patcher's own API, and every plugin is handed the
loopback base URL in `patcher.server.loopbackBaseUrl` — a supported thing to use, as
the tunnel plugin does. So a gate on the JavaScript object gated the polite way
in and nothing else: the same call, made with `fetch`, was never checked.

Requests now say who they are. Each plugin gets a key minted at load and kept
in memory, its SDK client sends `x-patcher-plugin-id` / `x-patcher-plugin-key`, and a
middleware on `/api/v1/*` looks up what that path costs and refuses with 403
when the plugin did not declare it. A request with no identity — the app, the
CLI, anything else local — is untouched.

**In-process this is cooperative and cannot be otherwise.** A plugin shares the
server's memory: it can read another plugin's key, or send no header and be
taken for the app. That is not a hole to be plugged here; it is what Phase 7
plugs, by making identity the only way traffic arrives. What exists now is the
mechanism, the header shape and the path→permission map — the parts a plugin
host has to be built against, tested before the split rather than invented
during it. And it is already load-bearing for the honest case: a plugin gets
the same answer whether it asks through `patcher.sdk` or through `fetch`.

Paths are classified by longest matching prefix, and an unmatched path is
**refused**, not allowed — a route nobody classified is a route nobody thought
about. `plugin-api-path-coverage.test.ts` reads the route table the server
mounts and fails on one that was never decided.

### Realtime, which the request gate cannot see

`/ws` is not under `/api/v1`, so the middleware never meets it — and a plugin
that opened the socket itself would have had an unpoliced route to exactly the
data a permission names.

It turned out simpler than feared. Subscriptions are **server-side**: a client
sends a subscribe message and the hub records who wants which key, so gating is
refusing a subscription rather than filtering a push. The same request shape,
one layer down.

Two pieces: the plugin's realtime socket now carries the identity headers its
`fetch` does, read once at the upgrade because that is the only moment a
socket's headers exist; and a subscribe from an identified socket is checked
against that plugin's grants. A refusal drops the subscription and leaves the
connection up — one feed a plugin may not have is not a reason to tear down
the others it is using.

One constraint is worth recording because it is not obvious: Node's global
`WebSocket` cannot set request headers. Only the `ws` package can, so a socket
that has to say who it is takes that path whatever the runtime.

Realtime is also the third place the same data gets a second name — feeds are
`thread:changed`, subscription targets are `thread-detail`. Both now reduce to
the entity in front and ask one function, because two spellings of one decision
are two decisions waiting to disagree.

### Three leaks the path map exposed

Classifying routes forced a comparison the area map never invited, and three
`patcher.sdk` members turned out to cost less than what they touch:

- **`environments.archiveThreads`** archives threads. Its path is a workspace
  route; its effect is a thread mutation. A `workspace` grant was archiving
  threads.
- **`threadSections.list`** reads `GET /sidebar-bootstrap`, which answers with
  every project _and its threads_. The SDK keeps only `.sections` — but the
  whole response had already crossed the boundary, and a plugin calling the
  route directly keeps all of it.
- **`status.get`** reads `GET /threads/:id`, its timeline and its children when
  it is given a `threadId`. Its area reads as workspace and most of what it
  answers with is thread content — and it swallows its own request failures, so
  the ungated version answered with silent nulls instead of a refusal.

All three are the same shape as the `subscribe` split: the area is the wrong
unit for a member that straddles two. They are named in
`PLUGIN_SDK_METHOD_EXTRA_PERMISSIONS` and charged by **both** gates, because a
plugin that passes one and is refused by the other is worse than either alone.

## Coarseness that was chosen, not overlooked

- **`patcher.sdk` is gated per area, not per method.** An area is the unit the SDK
  hands out; a permission naming methods would need re-checking against every
  SDK release. `workspace` therefore covers reads and writes alike, and covers
  nine areas at once.
- **`page.credentials` is one permission for reading and writing cookies.**
  Splitting them would suggest reading is the safe half.
- **Declaring is granting.** There is no separate consent state, so a plugin
  cannot be installed with a subset of what it asked for. The consent point is
  the install prompt, which is also why only a `path:` source can print its
  permissions before confirmation — it is the only source whose manifest is on
  the machine before the install runs, and it is the agent-generated case.

## Verified

- `packages/domain/src/__tests__/plugin-permissions.test.ts` — the command map
  is total against the wire schema, the three splits land where they should,
  and an unknown permission string is rejected by the manifest schema.
- `apps/server/test/services/plugins/plugin-permission-gate.test.ts` — a
  refusal names the permission and the fix; a denied SDK area throws on the
  property read; `workspace` does not buy `thread:changed`.
- `apps/server/test/services/plugins/plugin-permissions.test.ts` — the same on
  the real load path: an undeclared contribution fails the load, a declared one
  runs, and a plugin declaring one thing is still refused another.
- `packages/plugin-sdk/src/testing/__tests__/fake-browser-permissions.test.ts` —
  the fake host charges what the host charges, refuses without the permission
  and stops refusing with it, and leaves `getStatus` open.
- `apps/server/test/services/plugins/plugin-api-identity.test.ts` — an
  identified request is refused or admitted by the plugin's own grants, an
  unidentified one is untouched, a wrong key reads as no identity rather than
  as an error, and an unclassified path is refused.
- `apps/server/test/services/plugins/plugin-api-path-coverage.test.ts` — every
  path the server mounts, read from the route table, carries a classification.
- `apps/server/test/app/client-protocol.test.ts` — a plugin's socket is refused
  a feed it did not declare, keeps the ones it did, and a socket nobody claimed
  is left alone.
- `packages/domain/test/plugin-permissions.test.ts` — the feed name and the
  subscription target answer the same for every entity.

## The fake host enforces the same list

`@patcher/plugin-sdk/testing` refuses what the server refuses, because a harness
that grants everything turns every plugin suite into evidence for a claim it
never checked.

Three pieces make it one decision rather than two:

- **The `patcher.sdk` area map lives in `@patcher/domain`**, read by both hosts. The
  server keeps the compile-time check that its keys cover `keyof PatcherSdk`, which
  `@patcher/domain` cannot do without depending on `@patcher/sdk`.
- **The browser permission is named at each fake call site**, not in a table
  keyed by the fake's own labels. The fake speaks the SDK's vocabulary
  (`control.evaluate`) and the host charges the command it builds
  (`page.control` + `evaluate`), so a table would be a second set of decisions.
  At the call site the decision sits beside the method, and a new fake method
  cannot be added without making one.
- **`fake-browser-permissions.test.ts` pins the two together**: each row names
  the method, what the fake charges, and the command the real API sends. A row
  failing means one side moved — neither is automatically right, and that is
  the point.

Tests say what they need by reading the manifest, not by repeating it:

```ts
createFakePluginHost({
  permissions: pluginPermissionsFromManifest(import.meta.url),
});
```

A hand-written list in a test is a second declaration, free to drift — and the
drift that matters is the silent one, where the manifest drops an entry the
code still uses and the suite keeps passing.

**It found a real one immediately.** `plugins/connect` was declared as needing
nothing: it reaches `patcher.sdk` through `new ShareHostResolver(() => patcher.sdk)`, so
the grep that derived every other manifest never saw a `patcher.sdk.` literal. The
plugin swallows resolver failures, so the refusal did not surface as an error
either — its tests simply started reporting host ids where host names belong.
It really does need `threads` and `workspace`, and would have failed on
install. Deriving declarations by grep finds most of them; only the gate finds
the rest.

## Next

- **Pre-install consent for remote sources.** Only a `path:` install can show
  permissions before confirmation. Git, npm and catalog sources would need a
  two-phase install: resolve and read the manifest, then confirm, then
  activate.
- **No revocation.** Declaring is granting; a user who dislikes one entry can
  only disable the plugin.
- **The app does not show a plugin's permissions.** The data reaches it; the
  plugin detail does not render it.
- **Phase 7 is what makes any of this hold.** The list above is the RPC surface
  a plugin host has to expose, and the gate is where that boundary goes. The
  other direction — what the server calls _into_ a plugin — is described in
  [plugin-callbacks.md](plugin-callbacks.md).
