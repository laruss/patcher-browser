# The callback protocol

Every call the server makes _into_ a plugin, described so it can one day be a
message instead of a closure.

This is plan Phase 7's other half. [plugin-permissions.md](plugin-permissions.md)
describes what a plugin may reach; this describes the opposite direction, which
is where the process split is actually blocked: what the server holds is a
function the plugin registered, and a function is exactly what cannot cross.

## What was already fine

- **`patcher.sdk`** is a loopback HTTP client that now identifies itself. In a
  plugin host it stays exactly that. Nothing to migrate.
- **`patcher.browser`** is already a serialisable command union on a message bus.
- **`patcher.storage.database()`** hands back a native better-sqlite3 handle, which
  cannot cross — but does not have to: the file is per-plugin under
  `<dataDir>/plugins/<id>/`, so the host opens it locally. The consequence is
  worth stating early: a plugin host needs filesystem access to its own
  plugin's directory, so "no filesystem" is not an available sandbox.

## What this step did

Twenty server→plugin calls are now **described** rather than anonymous.
`invokeCallback(pluginId, { kind, target, payload }, run)` replaced
`invokeWrapped(pluginId, label, closure)` at every site, and `invokeWrapped` is
no longer exported — a new call site cannot skip the description.

Nothing changed about how a call runs. The closure is still invoked in-process,
and the point is not the indirection but the two properties it buys:

1. **The description and the argument are one value.** `run` receives the
   declared payload rather than closing over its own copy, so they cannot
   disagree. Every other place in this codebase where two descriptions of the
   same thing were allowed to exist, they drifted — the fake host against the
   real one, the JS gate against the HTTP gate.
2. **The declaration is checked against reality.** Under `NODE_ENV=test`,
   `assertCallbackCrosses` walks the real payload and result and fails when
   what actually crossed disagrees with what the entry claims. The existing
   suite becomes the fixture: 513 plugin tests exercise real values, and no
   hand-written sample can agree with a wrong table.

## What the check found, and what became of it

Running it over the suite surfaced exactly three obstacles, all invisible while
everything was in-process. All three are now gone — not excused, fixed.

**`AbortSignal`, twice.** `agentTool` payloads carried `ctx.signal`, and CLI
contexts carried one too. The fix is not to take cancellation away from plugins
but to stop pretending a signal is data: the described payload now carries only
the values (`threadId`, `projectId`, `cwd`), and the closure rebuilds the
plugin-facing context by adding the signal back. Today that far side is the
same process; tomorrow it is the plugin host, building a signal from a cancel
message. The plugin-facing API did not change at all.

A payload that serialises cleanly looks identical whether or not the call can
be cancelled, so the fact did not just disappear with the exception: `agentTool`
and `cli` are marked `cancellable`, which is a requirement _on the transport_ —
a cancel message travelling alongside the request.

**A `Map`.** `agentConfigure` answered with `toolParameterOverrides` as a Map,
the dangerous kind: `JSON.stringify` turns it into `{}` without complaining, so
across a boundary it would have lost data silently rather than failed. It is
now a plain record — and specifically an `Object.create(null)` one, because
tool names match `[a-zA-Z0-9_-]+`, which admits `__proto__`. On a normal object
that assignment sets the prototype instead of storing an entry, so the override
would be lost _and_ every other tool's lookup would start inheriting from it.
The type was internal to the server, so no plugin contract moved.

**There is no escape hatch left.** The first pass added a per-field exception
list, and removing it once all three were fixed was deliberate: an unused way
to excuse a field is the thing someone reaches for instead of fixing the value.
The check is now strict by construction, and 533 plugin tests pass under it.

Everything else — every browser contribution, rpc, mentions, schedules, thread
events, and the rest of the CLI and agent payloads — crossed unchanged from the
start. That is the useful headline: the protocol is mostly a matter of naming
what already happens.

## The two that are not request/response

Everything above is a call with an argument and an answer. Two are not, and
each now has a shape of its own, written and tested — but deliberately **not
applied in-process**. Both conversions cost something real, and paying it while
the handler is a function call away buys nothing. What is worth having before
the transport exists is the conversion itself, proven against the cases that
break a naive version.

### `http` — `plugin-http-message.ts`

A Hono `Context` in, a `Response` out; neither is data. They reduce to
`{ method, url, headers, body }` and `{ status, statusText, headers, body }`,
with three decisions that a first attempt gets wrong:

- **Headers are entries, not a record.** `accept` and `set-cookie` legally
  repeat, and a record keeps the last one. Worse, `Headers`' own iterator joins
  repeated `set-cookie` values into one string — two cookies become one
  unusable header — so they are read back out with `getSetCookie()`.
- **Bodies are base64.** A body is bytes; JSON has no other way to hold them,
  and treating it as text corrupts anything that is not valid UTF-8.
- **No body and an empty body are different**, and a 204 must not acquire one.

The price is stated as a test rather than as prose: a streaming response
arrives whole on the far side. Nothing in-tree streams one, which is what makes
that an acceptable price rather than a blocker — but it is a contract change
for plugin authors, and it belongs in the release notes of whichever version
turns it on.

### `backgroundService` — `plugin-service-message.ts`

Not a call at all. `service(name, { start(signal) })` runs until its signal
aborts; nothing returns, and everything interesting happens in between. So it
gets commands one way (`start`, `stop`) and events the other (`started`,
`exited`, `crashed`, `needs-configuration`).

The decision worth recording is **who owns the state machine**, and the answer
is the host: restart, capped backoff, the crash counter, the healthy-long-
enough-to-reset rule. A plugin host with its own restart policy would be a
second policy, and two policies for one thing is how they disagree. The plugin
reports only what it observed; it does not decide.

Writing that down caught an error in my own model. `reduceServiceEvent` first
mapped a crash to "restart with backoff" unconditionally — but the runner
already has a second branch: a crash while the plugin is still _activating_ is
a failed load, so the service stops and the plugin goes to `error` with no
restart at all. The same reported crash, two answers, told apart by state the
plugin cannot see. That is the ownership argument in one case, and it is now a
parameter (`stabilizing`) rather than an omission.

## Cancellation, which is live rather than described

Two calls hand the plugin an `AbortSignal` — `agentTool` and `cli`. A signal is
the one thing in those payloads that could never be sent, so the payload
carries the data and cancellation travels as its own message
(`plugin-cancellation.ts`): the host watches the signal the call was made
under and emits `{ kind: "cancel", callId, reason }`; the plugin side holds a
controller per call and aborts it when the message arrives.

**Unlike the http and service shapes, this one runs today.** Both halves are
wired to each other directly because they are in the same process, so every
agent tool and CLI call in the suite exercises the path a transport will use.
What changes at the boundary is one function — `send`.

Three things the design has to get right, each of them a test:

- **A call needs an id.** Nothing correlated a cancel with a call before,
  because the closure was the correlation. A cancel for another call must be
  ignored.
- **An abort that already happened fires no event.** Waiting for one would
  start a call that can never be cancelled, so an already-aborted source sends
  immediately.
- **The listener has to come off.** A source signal outlives the calls made
  under it — one CLI request, many calls — so a relay that forgets to detach
  accumulates listeners on it for as long as it lives. That is the ordinary way
  this kind of code leaks, and `invokeCallback` detaches in a `finally`.

One observable difference remains, and it is inherent: a reason cannot cross as
an object, so the far side rebuilds one. It is rebuilt as a `DOMException`
named `AbortError` — the shape `fetch` produces and the one that
`error.name === "AbortError"` branches expect — and an end-to-end test asserts
a plugin reads exactly that name back.

## One regression, caught by the tests it broke

The first version made the log label the protocol kind, so a plugin's status
detail started reading `threadEvent thread.deleted failed` where it had said
`thread.deleted handler failed`. That is this file's vocabulary leaking into
text a user reads in `patcher plugin list`. The kind and the label are now separate
fields, every prior string is restored, and `plugin-callbacks.test.ts` pins
them so the next rename cannot leak either.

## Next

- **The transport now exists** — see [plugin-transport.md](plugin-transport.md)
  for the envelope these kinds travel in and the peer that speaks it. It is not
  yet wired into the loader; swapping each closure for a send is per-kind work
  with a test for each.
- **Applying the two shapes.** They are written and tested but nothing calls
  them, which is the right state until a plugin actually runs in another
  process — and the wrong state to leave them in indefinitely.
