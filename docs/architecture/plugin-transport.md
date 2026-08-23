# The plugin transport

The wire between the server and a plugin's process, and the peer that speaks
it.

The two catalogues describe the vocabulary — [the callback
protocol](plugin-callbacks.md) for server→plugin,
`plugin-host-calls.ts` for plugin→host. This is the envelope they travel in.
The plugin loader does not use any of it yet — it still loads plugins
in-process — but everything below that seam is built and tested against real
processes.

## One peer, both ends

`createPluginChannel` is what the server holds per plugin and what the plugin's
process holds. Neither end is the client.

That is a decision, not a convenience. Both directions need the same four
things — correlate a request with its answer, carry an error, cancel work in
flight, and fail everything outstanding when the other side disappears — and a
second implementation of those is a second place for them to be subtly
different. The repo has already paid that bill twice: the fake plugin host
against the real one, and the JS permission gate against the HTTP one. Both
drifted, and both were caught by accident.

So the message union has no notion of direction:

| Message   | Carries                                  |
| --------- | ---------------------------------------- |
| `request` | `callId`, `method`, `target?`, `payload` |
| `result`  | `callId`, `value`                        |
| `failure` | `callId`, `error`                        |
| `notify`  | `method`, `target?`, `payload`           |
| `cancel`  | `callId`, `reason`                       |

`method` is where the catalogues re-enter: the server sends a
`PluginCallbackKind`, the plugin sends a `PluginHostCallPath`, and the channel
is generic over both so neither end can invent one. `target` names the
registration within the plugin — the route, the tool, the menu item — which is
what routing needs once the closure is gone.

`cancel` is not new. `plugin-cancellation.ts` defined it before there was
anything to send it over, and its own comment marked the seam: "today a call,
tomorrow a write." This is the write.

## Errors cross by name

Reducing an error to data is usually lossy in a way that matters. Here it is
not, because this codebase had already decided that **error identity is the
name**: `@patcher/plugin-sdk`'s contract says so ("Runtime classes stay host-side.
NeedsConfigurationError in particular is matched by NAME"),
`isNeedsConfigurationError` tests `error.name`, and plugin authors are told to
throw `Object.assign(new Error(msg), { name: "..." })`.

So a rebuilt error is not an approximation. It carries the name, the message,
the far side's stack for logs, and the own enumerable fields some errors are
read for — `PluginPermissionError.permission`, a CLI limit error's byte counts.
A field that would not survive JSON is dropped; the error is not.

The one thing that cannot come back is `instanceof` against the original class,
which is why it was worth checking rather than assuming: the only `instanceof`
on a plugin error class in the repo is `PluginSettingsValidationError` in
`routes/plugins.ts`, thrown by host code inside the host, never crossing.

### And `Response` does not even cross a process to break

The same rule turned out to be load-bearing one layer down, for a reason that
has nothing to do with this transport. `@hono/node-server` replaces
`globalThis.Response` with a lightweight class of its own
(`getRequestListener`, unless `overrideGlobalObjects: false`), and it does it
more than once — importing the package installs one class, `serve()` installs
another. In a listening server:

```js
Response.json({}) instanceof Response; // false
new Response("x") instanceof Response; // true
```

because the inherited static still builds with whichever class was global when
it was captured. Both plugin-route dispatchers checked `response instanceof
Response`, so a plugin answering with `Response.json(...)` — the obvious way to
return JSON — was rejected as "not a Response" by a running server, and only by
a running server. In the suite it appeared as an intermittent failure that
never reproduced alone: whether a test worker had started a server first
depended on which files it happened to run.

Both dispatchers and the SDK's fake host now ask structurally
(`isResponseLike`). **Nothing on either side of the boundary may test a value's
class**, and that includes classes the platform appears to own.

## What the channel owes its callers

- A request resolves with the far side's result, or rejects with the far side's
  error.
- A request made under an `AbortSignal` cancels work in the other process. The
  signal is rebuilt there as a `DOMException` named `AbortError` — the one
  visible difference from an in-process call, and what `fetch` produces anyway.
- **When the channel closes, every in-flight request rejects.** A plugin
  process can die at any moment, and the failure worse than a crash is a crash
  nobody is told about: an agent tool call that never settles hangs the turn.
  This is the property most of the tests are about.
- A request the far side has no handler for gets a failure, not silence.
- A malformed message is reported and dropped. The far side is a separate
  process that can be a different version, so what arrives is untrusted input —
  `send` is typed, `onMessage` is `unknown`, and `parseMessage` is the border.
- Nothing is silent. Unreadable frames and answers to calls nobody is waiting
  for go to `onProtocolError`, because a plugin whose calls vanish is the worst
  thing this layer could do.

## Ports

The channel moves no bytes. A `PluginPort` does, and there are three:

- `createLinkedPorts()` — two ports wired to each other in one heap.
  **Delivery is asynchronous on purpose**: a synchronous pair would let a test
  pass on re-entrancy no real pipe permits.
- `createChildProcessPort(child)` — the server's end. Node's IPC does its own
  framing and JSON, which is why there is no codec here. It owns the several
  ways a child ends — `exit`, `close`, `disconnect`, `error` — which all mean
  one thing to a channel, plus the case of a child that died before it was
  wired up, whose `exit` has already been and gone.
- `createParentProcessPort()` — the plugin process's end, which throws when
  there is no IPC channel rather than starting a host that talks to nobody.

## Verified against a real process

`plugin-channel.test.ts` is 27 tests. Most run over a linked pair, but six fork
an actual Node process running `fixtures/echo-plugin-child.ts` — which uses the
same `createParentProcessPort` + `createPluginChannel` the real host will — and
check that a request round-trips, an error comes back by name, a cancel reaches
work running in the other process, an unprompted notification arrives from the
child, and a `process.exit(7)` mid-request rejects the caller instead of
hanging it.

## The plugin process

`plugin-child-runtime.ts` is a plugin running in its own process, and the
decision that shapes it is what it does **not** contain: a second `patcher`.

`createPluginApi` already took every host-facing capability as an injected
function. That was always the seam — it just pointed at the server. So the
plugin's process builds the _same_ object with those functions pointed at the
channel, and there is one copy of what `patcher.storage.kv.set` means, of the 256KB
limit, of every error string. A hand-written plugin-side `patcher` would have been
the third time this repo paid for two descriptions of one thing.

Making that possible took one narrow change: `createPluginApi` took a
`db: DbConnection` and used it in exactly two places — the kv rows and reading
settings values. Those are now injected as `kvStore` and `readSettingsValues`.
The server passes db-backed implementations, the plugin process passes channel
calls, and everything else about those members is unchanged and shared. The
whole plugin suite passed before and after, unmodified.

`plugin-host-entry.ts` is the process itself, and is deliberately tiny: the
process's IPC channel demultiplexed into one port per plugin, a runtime per
port, and an unhandled-rejection reporter. Everything worth testing is in the
runtime, which runs over a linked pair.

The host's first request is `bootstrap`, carrying the config that turns a
process into a particular plugin — as a message rather than argv or the
environment, because the API key is in it. Its result is the registration
snapshot: what the plugin registered, minus the functions. After that the host
sends `PluginCallbackKind` requests and the runtime dispatches them to what the
plugin registered.

Two kinds are refused with a message naming why: `http` and
`backgroundService`, whose written-but-unapplied shapes are
`plugin-http-message.ts` and `plugin-service-message.ts`. The dispatcher's
`switch` is exhaustiveness-checked, so a new kind cannot become a silent gap —
though not the way the first draft claimed. Dropping `default` does not check
anything when the function returns `unknown`: `undefined` is a perfectly good
`unknown`. Deleting a case compiled clean until an explicit
`const unhandled: never = kind` was added.

### A second axis of obstacle

Building it surfaced something the catalogue had no field for.
`createPluginApi` takes three capabilities as **synchronous** functions, and
the `patcher` members behind them do not await:

| Path                  | Why it cannot be a request                                 |
| --------------------- | ---------------------------------------------------------- |
| `browser.getStatus`   | read from `patcher.agents.configure()`, which cannot await |
| `agents.registerTool` | rejects a name another plugin took, at registration        |

Their arguments and results serialise perfectly, which is exactly why they were
easy to miss. `synchronousHostState` marks them, and both get a pushed copy: a
stale copy can only produce a worse error message, never a wrong decision, and
the host stays authoritative for tool names because it is the only process that
sees every plugin.

There was a third, `hosts.declareSharedPorts`, and it was the one place this
boundary was not transparent: a port policy is a decision rather than a fact, so
the host validated what it was told and a refusal reached the plugin as a log
line rather than a throw. Shared ports went with the cloud, and the asymmetry
went with them — recorded here because the shape will come back the first time a
plugin needs a decision rather than a value.

## Topology, decided by measurement

The transport left "how many processes" open on the grounds that the protocol
does not depend on it. The supervisor had to answer it, and the answer came
from measuring rather than arguing:

|                                                | resident |
| ---------------------------------------------- | -------- |
| bare Node process                              | 50 MB    |
| bundled plugin host, before loading any plugin | 67 MB    |
| the same host, first pass                      | 84 MB    |
| the same host before any of this               | 204 MB   |
| × 13 bundled plugins, one process each         | ~870 MB  |

So **plugins share a process by default.** Process-per-plugin is the better
failure model and only cost rules it out, which made the 204 MB worth
attacking — twice. `apps/server/scripts/measure-plugin-host.mjs` reproduces
every number here: it builds the host the way the release does, forks it, and
reads resident memory from the outside, because what a package costs is what it
_runs_, not how many bytes of it were bundled. (A bundle-size breakdown says
zod is 551 KB and luxon 258 KB; the memory says `@patcher/sdk` is 149 MB and hono is
0.5 MB.)

### What the 120 MB was

**`@patcher/sdk`: ~100 MB.** It pulls `createApiClient`, which constructs the whole
public API surface — every route, every schema — at import time, in every
plugin process, whether or not the plugin ever touches `patcher.sdk`. It is now
loaded on first use. The awkward part is that `getSdk()` is synchronous and
must stay so: `patcher.sdk.guide.render()` answers without awaiting anything. A
literal `require()` is what makes a synchronous deferral possible — the bundler
keeps the module in the bundle and initialises it on the first call, so the
process stays self-contained; under tsx there is no `require` in scope and
`createRequire` resolves it instead. Both branches are exercised: the source
one by a forked `plugin-host-entry.ts`, the bundled one by
`plugin-host-bundle.test.ts`, which builds the real bundle.

**`@patcher/domain`'s index: ~57 MB.** Importing one constant from it runs every
schema in the package. `plugin-api.ts` and `plugin-permission-gate.ts` take
subpaths now (`@patcher/domain/browser-control`, `/plugin-permissions`,
`/app-keybindings`, `/pending-interactions`, `/json-value`, `/browser-history`)
— the same files, without the rest of the package. Same file means one copy in a
process that also loads the index, so nothing is duplicated.

The budget in `plugin-host-bundle.test.ts` is what keeps this honest, and it has
already caught a barrel import walking back in: a history filter took one length
cap from `@patcher/domain`, and every host process went from ~67 MB to ~105 MB. A file
this list does not mention can still be in the graph — check before importing
into anything `plugin-child-runtime.ts` reaches.

**`@patcher/db`: gone from the graph.** `plugin-api.ts` imported
`registerSettingDescriptors` from `plugin-settings.ts`, and that module also
reads and writes values — so every plugin process loaded drizzle and
better-sqlite3 to get a validator. Describing settings and storing them are now
separate modules. It bought little memory (~1 MB; `better-sqlite3` itself is
2 MB and stays, for `patcher.storage.database()`) and one real thing: the bundle no
longer needs the native module resolvable just to start.

What is left is ~34 MB over bare Node: browser-control's schemas (~22 MB) and
cron-parser's luxon (~11 MB). Both are deferrable the same way if
process-per-plugin ever becomes worth it — and 13 × 84 MB is ~1.1 GB, which is
not yet a reason to change the default.

The bundled host is also **built** now (`apps/server/package.json`), which it
was not: `defaultSpawn` looks for `plugin-host-entry.js` next to the server
bundle and would have found nothing in a packaged release.

`placement` keeps that a one-line policy rather than a shape the code is built
around: `SHARED_PLACEMENT` is the default, `ISOLATED_PLACEMENT` gives a plugin
its own process, and anything in between is a function. Reproduce the numbers
by bundling `plugin-host-entry.ts` with esbuild and reading RSS; the analysis
above is `--analyze=verbose` on the same bundle.

Sharing means plugins in one process die together. That is bounded and
honest: `plugin-port-multiplexer.ts` propagates the pipe's close to every
virtual channel, so **one crash rejects every in-flight call in every plugin
that shared the process** rather than leaving promises pending, and the
supervisor restarts the process and re-bootstraps everyone who was in it.

Restart backoff caps at five consecutive crashes. The crash budget resets on
**uptime, not on a successful bootstrap** — the first version used the latter
and the escalation test caught it immediately: a process that bootstraps fine
and dies a moment later resets the counter every time, which is a crashloop
with the backoff switched off.

### And what the next 17 MB was

The first pass took out the two biggest imports. The second took out the idea
that a plugin process should load an area of `patcher` the plugin never calls, and
it is worth stating as a rule because it is what the numbers kept saying:

> Nothing in `plugin-api.ts`'s startup path should be there for a corner of
> `patcher` this plugin has not touched.

- **cron-parser (luxon), ~11 MB** — one call, validating a cron expression at
  `patcher.background.schedule`. A plugin with no schedules paid for a date library.
- **The browser-control schemas, ~23 MB** — argument checks for `patcher.browser.*`,
  of which ~9 MB is zod itself. A plugin that never drives a tab paid for all
  of it.
- **zod, ~9 MB, three more ways in.** The interesting ones were not deferrals
  but splits: `@patcher/domain/plugin-permissions` is in every process (the gate
  reads its tables) and needed zod for a single `z.enum(PLUGIN_PERMISSIONS)`,
  and `plugin-api.ts` imported one number out of `pending-interactions.ts`'s 500
  lines of schemas. Both are now their own module — `plugin-permission-schema.ts`
  and `plugin-interaction-limits.ts` — and the file the host loads is zod-free.
  What was left (the settings-descriptor schema, `z.toJSONSchema` for agent
  tools, the keybinding id) is built on first use.
- **better-sqlite3, ~2 MB and a dlopen** — deferred to `patcher.storage.database()`.
  This one is the exception to the mechanism: natives are external to the
  bundle, so it resolves from disk in both branches rather than out of the
  bundle. `plugin-host-bundle.test.ts` opens a database in the real bundle,
  because that difference is invisible under tsx.

What is left is ~17 MB over a bare Node process, and most of it is the bundle
itself — the deferred packages are still _in_ it, and V8 parses what it loads.
Getting past that means making the host not self-contained, which is a worse
trade than the megabytes are worth.

## The host's half

`plugin-host-call-server.ts` receives a `PluginHostCallPath` and performs it
against the server's real dependencies — the other end of every call the
plugin's `patcher` makes.

It takes **the same options object `createPluginApi` does**. The loader builds
those capabilities once and hands the same object either to `createPluginApi`
(in-process) or to this (out-of-process), so there is no second place where
`publishSignal` or `requestBrowserCommand` could be wired to something slightly
different.

Every one of the 41 catalogue paths is classified as served here, one-way, or
answered inside the plugin's process — and the test does not check the
classification by spelling: it invokes each path it calls "served" and fails on
any that falls through as unknown. Receiving a path the plugin process owns is
its own error message, because that means the two sides disagree rather than
that something is missing.

The handlers are standalone consts, not object methods. The channel calls them
detached (`handler({...})`), so a `this.onNotify` inside `onRequest` — which
the first draft had — would have been a TypeError the first time a plugin sent
a notification as a request.

## The loader swap

`runPluginOutOfProcess(row)` decides where a plugin loads. Everything after the
branch is shared: services, schedules and the registration commit read one
`PluginApiHandle` and cannot tell the two placements apart.

### Which plugins actually move

Every mechanism above shipped while nothing turned it on: the hook was supplied
by tests and by nobody else, so a released server still loaded a plugin an agent
had just written into the process that holds the database handle, the machine
keys and the host daemon's credentials. `plugin-placement.ts` is the file that
ends that, and the rule is one line:

> A plugin we did not ship runs in a plugin process.

That is `provenance !== "builtin"` — installed and generated plugins move,
builtins stay. Builtins stay not because they are more trustworthy in some
abstract sense but because they _are_ the server: same release, same review. So
moving them would buy isolation from ourselves and cost the one thing the
boundary cannot carry (a streaming HTTP response). Catalog plugins are the
opposite case on both counts and move like any other install.

`PATCHER_PLUGIN_PROCESS=false` loads everything in the server again. It exists as a
way back if the boundary breaks something in the field, not as a per-plugin
knob; deciding placement per plugin would need somewhere to keep the decision,
and no one has asked for that yet.

The hook takes the plugin's row rather than its id because the policy reads
`provenance` and the loader has the row in hand. Omitting the hook still means
"load everything here", which is what the plugin tests want.

Where a plugin ended up is then **reported, not inferred**: `placement` on the
list entry is `"process"`, `"server"`, or null for a plugin that is not loaded,
and `patcher plugin list` prints it. Intent and outcome differ here — the move is
best effort — so a policy that says "process" and a plugin that fell back to the
server is a state an operator has to be able to see. The reason for the fallback
is already in `statusDetail`.

### Placement is best effort; the server is the floor

Every way the move fails ends the same way: the plugin loads in the server.
There is no longer a category of plugin that _may not_ move — see below — so
what is left is the process not working out.

- **The process failed**: it would not spawn, it died, or the factory threw out
  there. This used to leave the plugin in `error`, which is the wrong answer to
  "your plugin host is broken" — nothing is wrong with the plugin.
- **The process never answered.** A plugin process adds a second place plugin
  code can hang, and it had no deadline, so the most likely failure did not
  fall back — it wedged the loader. Bootstrap now takes the same time box as
  the in-process factory call, from one `withLoadTimeout`.

Giving up has to reach the plugin process, not just the loader:
`supervisor.start` takes an `AbortSignal`, and a start that lands anyway is
stopped by the handler waiting on it. Otherwise a factory that was merely slow
finishes into a live instance nobody holds while the same plugin runs here —
one plugin, two live copies, one of them invisible.

A fallback costs a second run of the factory, which is survivable only because
a factory has always had to be re-runnable (`patcher plugin reload` re-runs it on
every reload).

And every fallback is **named in the plugin's status detail**, not just logged.
A silent fallback is the dangerous kind: an operator who moved a plugin for
isolation would have no way to see that it did not move.

### Reload needs two instances of one plugin

`loadOne` builds a load's new handle **before** disposing the previous one: a
single map replacement is the registration commit point, which is what makes a
failed reload keep the old plugin serving. Out of process that ordering means
one plugin briefly has two live instances — and the supervisor's first version
keyed a running plugin by its id, so it refused the second with "already
started". Reload was simply broken for any moved plugin.

So the supervisor's unit of identity is the **instance**, not the plugin:
`SupervisedPlugin.instanceId` keys `started`, the process's member list, and
the multiplexed channel, while `pluginId` remains what placement and log lines
use. The loader mints `<id>#<n>` per load and `LoadedPlugin.remoteInstanceId`
carries it, so disposal names the instance it means. Capabilities are keyed the
same way: until the predecessor is disposed it keeps calling the host it was
loaded with, not its successor's.

The id is caller-minted and stable across a restart — the supervisor revives a
crashed process by re-starting the same `SupervisedPlugin`, so whoever holds
the id can still stop what came back.

There is deliberately no `reload` on the supervisor. From that side reload
could only be stop-then-start, which is the ordering that drops a plugin's
registrations when the new load fails.

### Surviving a crash, and the end of a crashloop

A restart has to be visible on the server's side, and it was not. The
supervisor revives a crashed process by re-bootstrapping the same instance,
which mints a **new channel** — while the handle the server holds had captured
the old one. So recovery worked and the plugin was unreachable anyway: every
call came back `plugin channel … closed`. The remote handle holds the instance
id and looks the channel up per call now. (What a restart does not refresh is
the registration snapshot: the reinstated process runs the same entry file, and
picking up an edited plugin is what `patcher plugin reload` is for.)

When the crash budget runs out, the supervisor stops trying — and that used to
be the whole story. The plugins in that process stayed registered with shut
channels: every call rejected, and nothing about their status suggested
anything was wrong, which is worse than a plugin that failed to load. So
`onGaveUp` tells the loader, which is the only party that can do anything:

1. **Quarantine** the plugin — this server will not try to move it again.
   Without that the recovery is a loop of its own, walking straight back into
   the same crashloop.
2. **Say so**: `error` with the crash count while it is down, then the
   quarantine reason as its status detail once it is back.
3. **Load it in the server**, under the lifecycle lock and only if the dead
   instance is still the one registered — a reload may have replaced it while
   the process was dying, and reloading again would drop a live plugin.

The quarantine is memory-only, so a restarted server is a fresh chance, and
`POST /plugins/reload` lifts it — the only caller, always a person, and
otherwise the way back out would be a server restart.

### A plugin process resolves imports exactly as the server does

Worth recording because it was written down here as a defect and was not one.
A fixture importing `zod` failed to load in a plugin process with
`Cannot find module 'zod'`, which read as the plugin process resolving
differently. It does not: the same fixture fails the same way **in-process**.
A bare source tree in a temp directory has no `node_modules` and nothing along
its parent chain to find, and only `PLUGIN_SERVER_EXTERNALS` — `@patcher/plugin-sdk`
and `better-sqlite3` — is aliased to the server's copy. Real plugins have their
dependencies installed in their own tree or inlined into `dist/server.js` at
build time.

The fixture that needs a validator hand-rolls a Standard Schema, which is a
shape rather than a class, so it needs no dependency at all.

### Validation lives with the handler

The last two registrations that kept a plugin in the server were `rpc.register`
and `agents.registerTool`, for one reason: **a schema is a function**. The
contract's Standard Schema validators and a tool's zod `parameters` cannot be
sent anywhere, and the host was the one running them.

So they are not sent. What an rpc call _is_ — validate the input, run the
handler, validate the output, normalize the result to JSON — now lives in
`plugin-rpc-call.ts`, and **the side holding the handler runs it**. The server
runs it for an in-process plugin; the plugin process runs the same function for
one of its own. The host keeps the method name, which is all routing needs, and
a rejected value comes back as the same `PluginRpcBoundaryError` — matched by
name, with its code and issues intact, because errors cross by name.

Normalization has to happen on the handler's side of any boundary, not after:
it rejects `undefined`, cycles, class instances and `toJSON` hooks, all of
which a transport would have quietly resolved on the way over.

Agent tools split the same way, and half of it was already done: the
registration derives the JSON Schema the model is shown (`z.toJSONSchema`), and
that half is data. The validator stays with `execute` and runs beside it
(`plugin-agent-tool-call.ts`), so the _parsed_ value — defaults applied,
coercions done — is what the tool receives, out of process exactly as in.
Both sides refuse bad arguments through one `invalidAgentToolArguments`, so the
answer the model gets does not depend on where the tool runs.

With those two closed there is nothing a plugin can register that keeps it
here, and `pluginProcessEligibility` is gone rather than left returning
"eligible" forever. The parity suite loads one fixture both ways and compares
the two on the same zod schemas, valid and invalid, down to the issue lists.

### Host facts have to be pushed, because a copy goes stale

Two things a plugin reads are the server's to know: whether a browser window is
connected, and which plugin owns each agent-tool name. In the server they are a
function call away and always current. One process out they are a **copy**, sent
with the bootstrap — and a copy is wrong the moment the thing it copied changes.

So the hub took a listener (`onBrowserHostsChanged`), the bridge exposes it
(`onStatusChange`), and the loader subscribes when it first spawns a process,
pushing `host.browserStatus` and `host.agentToolOwners` to every live instance.
The subscription is dropped in `disposeAll` — the hub outlives the runtime, and
a listener left behind pushes into a supervisor that is gone.

The listener carries no payload on purpose: it says "read it again", and the
snapshot stays the single answer rather than being copied into an event that
could disagree with it.

## Next

- **Nothing in this file's own path.** The remaining ~17 MB of a host process is
  mostly V8 parsing the bundle, which is the price of the host being
  self-contained.
- **Process-per-plugin** is now ~870 MB for thirteen rather than ~2.7 GB, which
  makes `ISOLATED_PLACEMENT` a policy question rather than an affordability
  one. What it needs before it becomes the default is somewhere to keep a
  per-plugin decision.
