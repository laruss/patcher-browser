# Backend core: logging, settings, storage, host facts, events, lifecycle

The parts of `PatcherPluginApi` a plugin uses regardless of which surface it
contributes.

- [patcher.log](#patcherlog)
- [patcher.settings](#patchersettings)
- [patcher.storage](#patcherstorage)
- [patcher.server](#patcherserver)
- [patcher.events.on](#patchereventson--thread-lifecycle-events)
- [patcher.status](#patcherstatus)
- [patcher.onDispose and the reload lifecycle](#patcherondispose-and-the-reload-lifecycle)

## patcher.log

`patcher.log.debug|info|warn|error(message: string)` — goes to the server log
(prefixed `[plugin:<id>]`) and to the per-plugin JSONL file behind
`patcher plugin logs <id> [-n N] [-f]`.

## patcher.settings

`patcher.settings.define(descriptors)` declares plain-data descriptors (rendered
in Extensions → Plugins and editable via `patcher plugin config <id> set <key>
<value>`). Four descriptor types:

```ts
const settings = patcher.settings.define({
  apiKey: { type: "string", label: "API key", secret: true }, // 0600 file, never in db or frontend
  teamKey: { type: "string", label: "Team", default: "" },
  mode: {
    type: "select",
    label: "Mode",
    options: ["fast", "slow"],
    default: "fast",
  },
  verbose: { type: "boolean", label: "Verbose", default: false },
  project: { type: "project", label: "Project" }, // project picker, stores a proj_* id
});
const { apiKey, teamKey } = await settings.get(); // load-safe; re-read inside handlers for freshness
settings.onChange((next, prev) => {
  /* fires after a settings save */
});
```

Typing rule: a descriptor **with** `default` yields a non-optional value
from `get()`; without one the value is `string | boolean | undefined` — so
give non-secrets defaults and handle missing secrets explicitly.

## patcher.storage

- `patcher.storage.kv` — namespaced JSON key-value rows in the plugin's own
  database:
  `get<T>(key)`, `set(key, value)`, `delete(key)`, `list(prefix?)`. Values
  are capped at **256KB each** — kv is for cursors, links, and small state;
  caches and datasets go in the plugin database.
- `patcher.storage.database()` — the plugin's own better-sqlite3 database at
  `<dataDir>/plugins/<id>/data.db` (WAL, busy_timeout 5000). Handles are
  host-tracked and closed on reload; a closed handle throws.
- `patcher.storage.migrate(db, statements)` — statement index = migration id;
  unapplied statements run in one transaction. **Append-only**: never
  reorder or edit shipped statements, only push new ones.

```ts
const db = patcher.storage.database();
patcher.storage.migrate(db, [
  `CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
]);
```

## patcher.server

Read-only facts about the running server. `patcher.server.loopbackBaseUrl` is the
server's own loopback base URL (e.g. `http://127.0.0.1:38986`), which serves
the SPA + `/api` + `/ws` — for plugins that proxy or relay traffic back to
the server itself. **Bind-gated** like `patcher.sdk`: reading it before the server is
listening throws, so prefer reading it from handlers, services, and timers.

## patcher.events.on — thread lifecycle events

```ts
patcher.events.on("thread.created", ({ thread }) => { ... });
patcher.events.on("thread.active", ({ thread }) => { ... });
patcher.events.on("thread.idle", ({ thread, lastAssistantText }) => { ... });   // lastAssistantText: string | null
patcher.events.on("thread.failed", ({ thread, error }) => { ... });             // error: string | null
patcher.events.on("thread.archived", ({ thread }) => { ... });
patcher.events.on("thread.deleted", ({ thread }) => { ... });
```

Exactly six events. `thread.active` fires when an applied lifecycle
transition enters the running `active` state. `thread.archived` fires after a
thread is archived, including cascade archives (archiving a parent archives
its children too, each with its own event). Observe-only handlers run
fire-and-forget after the transition and can never block or veto it. `thread`
is the same DTO `GET /api/v1/threads/:id` serves. Errors are caught, logged,
and counted in the plugin's handler stats (`patcher plugin list`).

Lifecycle events are broadcast to all loaded plugins regardless of sidebar
visibility.

`thread.created` fires on row creation, so the first user message is not
always in the timeline yet. To react to a thread's content, listen on
`thread.active` or `thread.idle`, then read the messages with
`patcher.sdk.threads.timeline`. Because handlers are fire-and-forget, work you do
in a handler — including `patcher.sdk.threads.update({ threadId, title })` —
cannot delay or interrupt the thread's turn.

## patcher.status

`patcher.status.needsConfiguration(message)` — mark the plugin
`needs-configuration` (shown in `patcher plugin list` and the UI) instead of
failing. Cleared on the next load.

## patcher.onDispose and the reload lifecycle

`patcher.onDispose(hook)` registers cleanup; hooks run **LIFO**. On
reload the host first runs the factory against a candidate registration set.
If it throws, the complete previous set stays live. Once the candidate
succeeds, the host aborts old background services and awaits them (bounded),
runs dispose hooks LIFO (each isolated), drains in-flight http/rpc/event
handlers, closes every `storage.database()` handle, invalidates the old `patcher`
handle, and replaces the registration set wholesale. Disable/shutdown perform
the same cleanup without a replacement. A
captured `patcher` from a previous load throws `PluginContextStaleError` on use
— never stash the API object in module-level state that outlives a load.
