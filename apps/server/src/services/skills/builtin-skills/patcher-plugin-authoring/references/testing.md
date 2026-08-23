# Testing a plugin, and the plugins worth reading

The vitest harness for backend and frontend, the live loop against a running
Patcher, and the shipped plugins to copy patterns from.

## Unit tests with `@patcher/plugin-sdk/testing`

`@patcher/plugin-sdk/testing` is the official vitest harness for workspace and
standalone plugins. The packed package ships runtime JavaScript and portable
declarations for both testing subpaths. A scaffold still vendors the root/app
types, so add `@patcher/plugin-sdk` as a devDependency when tests import the
testing harness (plus its optional peers: `better-sqlite3` for backend tests;
React, React DOM, Testing Library, and jsdom for frontend tests).

The fake plugin host's `patcher` satisfies `PatcherPluginApi` with host-faithful
semantics: real better-sqlite3 temporary storage (never mock the db), the kv
256KB cap, schema-RPC validation/error/strict-JSON behavior, additive events,
keyed registration failures, atomic reload, conditional agent configuration,
request input, and `threads.spawn` plugin attribution.

`patcher.permissions` is enforced too, and it defaults to the host's default —
**declared nothing, reaches nothing gated**. Pass
`pluginPermissionsFromManifest(import.meta.url)`, which reads your own
`package.json`: a hand-written list would be a second declaration, free to
drift from the one that ships, and a suite that grants itself more than the
manifest does is a suite that passes where the install fails.

Backend (`server.ts`) — `createFakePluginHost()`:

```ts
import {
  createFakePluginHost,
  makeThreadResponse,
  pluginPermissionsFromManifest,
} from "@patcher/plugin-sdk/testing";
import plugin from "./server";

const { patcher, harness } = createFakePluginHost({
  pluginId: "my-plugin",
  permissions: pluginPermissionsFromManifest(import.meta.url), // what ships
  settings: { apiToken: "tok" }, // pre-seeded stored values (secrets included)
  sdk: { threads: { spawn: async () => ({ id: "th_1" }) } },
});
await plugin(patcher);

await harness.behavior.callRpc("list", { q: "x" }); // JSON round-trip like the wire
await harness.behavior.fetchHttp("POST", "/events", { body }); // real Hono context; auth not enforced
await harness.behavior.runCli(["search", "x"]); // { exitCode, stdout, stderr }
const svc = harness.behavior.runService("watcher"); // start now; svc.controller.abort(); await svc.done
await harness.behavior.runSchedule("sync"); // no timers, no cron sweep
await harness.behavior.setSettings({ apiToken: "next" }); // validates + fires onChange like a host save
await harness.behavior.emitThreadEvent("thread.idle", {
  thread: makeThreadResponse({ id: "th_1" }), // complete ThreadResponse fixture
  lastAssistantText: "done",
});
await harness.behavior.callAgentTool("lookup_doc", { query: "x" }); // parse (zod) + execute
await harness.behavior.resolveAgentConfiguration(context); // validated tools/skills/instructions
await harness.lifecycle.dispose(); // abort services, hooks LIFO, close database; stale Patcher throws
```

New tests should use the named views: `harness.behavior` drives host inputs,
`harness.inspection` exposes observable state, and `harness.lifecycle` owns
atomic reload/disposal. Direct members remain aliases for compatibility.
`lifecycle.reload(factory)` preserves settings/KV/database state; a throwing
replacement leaves the current registrations and API live.

Inspect: `harness.inspection.sdk.calls` /
`harness.inspection.sdk.callsTo("threads.spawn")` (every
`patcher.sdk` call is recorded; unstubbed methods throw naming the path to stub —
`harness.sdk.stub("projects.list", fn)` adds one late), `harness.logEntries`,
`harness.realtimeSignals`, `harness.needsConfigurationMessages`, and
`harness.registrations` (http routes, rpc methods, services, schedules, cli,
agent tools/configure provider, mention providers). Pass
`agentSkillIds` to `createFakePluginHost` to declare the manifest skill names
available to the configure driver.

Frontend (`app.tsx`) — `@patcher/plugin-sdk/testing/app` (vitest + jsdom):

```tsx
// @vitest-environment jsdom
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@patcher/plugin-sdk/testing/app";

// The thunk matters: app.tsx binds the plugin runtime at module load, so
// loadPluginApp installs the test runtime BEFORE importing it. (For static
// imports, call installTestPluginRuntime() in a vitest setup file instead.)
const app = await loadPluginApp(() => import("./app"));
const contentScripts = await mountPluginContentScripts(app, {
  pluginId: "my-plugin",
  generation: 1,
});

const slot = renderSlot(
  app.navPanels[0]!,
  { subPath: "" },
  {
    rpc: {
      listNotes: () => ({ root: "/notes", notes: [], error: null }),
    }, // method → handler, calls logged
    settings: { greeting: "hi" }, // useSettings() values
    context: { projectId: "p1", threadId: null }, // usePatcherContext()
    realtimeConnectionState: "reconnecting", // useRealtimeConnectionState()
  },
);
await slot.findByText("…"); // Testing Library queries
await slot.behavior.setRealtimeConnectionState("connected");
await slot.behavior.setComposerScope(
  { kind: "queued-message", threadId: "t1", queuedMessageId: "q1" },
  "queued draft",
);
slot.inspection.rpcCalls;
slot.inspection.navigateCalls;
slot.inspection.composer; // text, visuals, quotes, mentions, and focus activity
slot.lifecycle.unmount();
await contentScripts.lifecycle.dispose();
```

`loadPluginApp` validates registrations with the host's own rules (slot id
patterns, settingsSection optional title, navPanel path,
fileOpener extensions, and content-script ids/mount functions) and returns
them typed with defaults filled. `mountPluginContentScripts` mirrors ordered
mount, abort-before-cleanup, reverse rollback, exact-once disposal, and
per-window instances. Working examples:
`examples/plugins/slack-bot/server.test.ts` (webhook → kv → recorded spawn →
`thread.idle` reply), `plugins/docs/app.test.tsx` (nav
panel list over rpc + create/open navigation assertions).

Fidelity boundaries: HTTP auth is recorded but not enforced; services and
schedules run only when driven (no restart timers or cron sweep); storage is
process-local and secrets stay in memory; `patcher.sdk` is always bound and
unstubbed calls throw; cross-plugin collisions are outside one fake host. The
frontend harness validates registrations and JSON/composer behavior but does
not reproduce Patcher layout/CSS, persistence, routing, crash boundaries, or
multi-plugin arbitration. Use a live loop for those host boundaries.

## Live loop against a running Patcher

- `patcher plugin dev` is the loop: save → rebuild (if `patcher.app`) → reload; open
  app pages pick new UI up live. Build/reload failures print and keep
  watching.
- `patcher plugin list` shows status, services, schedules (with last_error),
  handler stats, and the CLI command; `patcher plugin logs <id> -f` follows
  `patcher.log` output. Add `--json` to any plugin command for machine output.
- Exercise wire surfaces directly: `curl -X POST -H "content-type:
application/json" -d '{}' <server>/api/v1/plugins/<id>/rpc/<method>`,
  `patcher <command> …` for the CLI, `patcher plugin run <id> …` as the explicit form.
- Keep pure logic in plain functions/modules so it is unit-testable without
  a Patcher server; the factory file should mostly wire registrations.

Patcher Official plugins in `plugins/` (a Patcher checkout):

- `github` — a gh-CLI-backed issue/PR browser in a single navPanel (with
  `headerContent`), subPath-based sub-navigation, shared-ui
  Tabs/Select/DropdownMenu/Badge/Skeleton + sonner toast throughout (in-repo
  plugins import `@patcher/shared-ui`; out-of-repo authors vendor the same
  components from the registry), background sync service, rpc + realtime,
  project setting, a `patcher github` CLI command, and agent-spawn buttons.
- `docs` (stable plugin id `simple-notes`) — multi-host Docs vaults over
  `patcher.sdk.files`, with a Tiptap
  markdown WYSIWYG, nested navigation, images and sandboxed HTML, CLI/HTTP
  operations, autosave with CAS conflicts, native local-vault watching with
  remote polling fallback, a markdown `fileOpener`, message directives, and
  side-panel-only `useComposer()` quote/mention actions.
- `memory` — provider-independent durable agent memory with global/project
  scopes, progressive disclosure, CLI commands, and a Settings editor.

Remaining reference examples in `examples/plugins/`:

- `slack-bot` — headless webhook bot: `auth: "none"` route with signature
  verification, kv thread mapping, `thread.idle` handler, spawn/send,
  needsConfiguration.
- `agent-enrichment` — agent surfaces: CLI command, zod-schema native tool,
  docs mention provider, boolean setting, bundled `skills/` directory.
- `cascade` — the big host-component example: a scrollable-tiling strip where
  every column is a `ThreadChat` and the draft column is
  `experimental_NewThreadComposer`, plus a thin index backend (kv layout
  state, background service + realtime), pure row projection, and a
  bare-letter keymap that coexists with a dozen live composers.
- `t3sidebar` — an inbox-style replacement for the sidebar thread list, with
  header chips for child threads and plugin-owned settled and snoozed state.
