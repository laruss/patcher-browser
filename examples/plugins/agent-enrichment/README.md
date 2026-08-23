# patcher-plugin-agent-enrichment

The "agent enrichment" hero plugin: no UI bundle, no background services —
its entire surface is agent-facing. It demonstrates:

- **`patcher.cli.register`** — a `patcher docs` command. Agents run it through bash
  exactly like humans do (`patcher docs search <query...>`); the handler runs
  server-side and text-searches the bundled `docs/` folder of markdown files.
  Agents discover it through the server-generated `plugin-commands` skill.
- **`patcher.agents.registerTool`** — `docs_search`, the same search as a native
  dynamic tool. Parameters are a zod schema: validated per call (a model's
  bad arguments become a tool error, not a plugin error) and converted to the
  JSON schema providers see. The tool rides the session's `dynamicTools`, so
  it appears on the next thread/turn start.
- **`patcher.agents.configure`** — selects `docs_search` and the
  `repo-conventions` skill for standard projects at session resolution time,
  and adds short project/host-specific instructions. Personal-project
  sessions select neither registration.
- **`patcher.ui.registerMentionProvider`** — type `@` in the composer and search
  the bundled docs by title; picking one inserts a pill, and the doc's full
  body is resolved at send time and attached as agent-only context.
- **`patcher.settings.define`** — a boolean (`caseSensitive`) rendered in Patcher's
  settings UI and editable with `patcher plugin config agent-enrichment`.
- **`patcher.storage.kv`** — caches the last search (`patcher docs last` prints it;
  the CLI command and the native tool share the cache).
- **`skills/repo-conventions/`** — the conventional plugin skills directory;
  its static definition is conditionally selected by `patcher.agents.configure`.

Dependencies: only `zod`, for the tool parameters. When Patcher runs from a
source checkout the import resolves from Patcher's own dependencies, so the
plugin works as-is from `examples/`; if you copy it elsewhere, run
`npm install` in the plugin directory first.

## Install

```
patcher plugin install ./examples/plugins/agent-enrichment
patcher plugin list
```

## Try it

```
patcher docs search "conventional commits"
patcher docs last
patcher plugin config agent-enrichment set caseSensitive true
```

In a thread (next turn start after install): ask the agent to call the
`docs_search` tool, `@`-mention a doc (type `@testing` in the composer), or
just ask about repo conventions — the `repo-conventions` skill is already
available to it.

After editing sources, `patcher plugin reload agent-enrichment`.
