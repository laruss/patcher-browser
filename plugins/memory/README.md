# patcher-plugin-memory

Patcher's official plugin for durable, progressively disclosed agent memory. It
provides:

Because this memory store works across providers, we recommend turning off
provider-native memory under Settings → Providers while using it. That avoids
duplicated or conflicting memories split between Codex, Claude Code, and Patcher.

- plugin-private SQLite storage with append-only migrations;
- global and current-project memory scopes;
- an automatically injected, 3,900-character summary catalog through
  `patcher.agents.contributeInstructions`;
- CLI-only agent access through `patcher memory` (no native agent tools);
- FTS5 search followed by full-record reads;
- explicit provenance, tags, kinds, importance, pinning, and version history;
- optimistic update/forget operations and soft deletion;
- basic prompt-injection and secret-pattern rejection;
- a bundled `memory` skill that teaches agents retrieval and write policy.
- a Settings → Memory table for reviewing, editing, and deleting every stored
  global or project memory.

## Install

Install Memory from the Patcher Official catalog:

```bash
patcher plugin install memory
patcher plugin list
```

## Try it

```bash
patcher memory add \
  --scope project \
  --name turbo-validation \
  --summary "Use Turbo for builds and typechecks" \
  --details "Run bunx turbo run typecheck --filter=@patcher/<pkg>." \
  --kind procedure \
  --tag build \
  --tag testing \
  --importance 80 \
  --reason "Durable repository validation convention" \
  --json

patcher memory search "Turbo typecheck" --scope all --json
patcher memory get <id> --scope all --json
```

Project writes take the invoking CLI's Patcher project context. Global writes must
explicitly pass `--scope global`. The injected catalog refreshes at every
thread start / turn submission, so a successful CLI write is visible on the
next turn.

## Limitations

- CLI calls require loopback access to the local server. Claude's macOS
  workspace sandbox permits this; Linux and other provider sandboxes may
  still block it.
- Retrieval is FTS5 keyword search in this first version; embeddings and
  background reflection are deliberately deferred.
- The safety scanner is a guardrail, not a substitute for avoiding sensitive
  memory content.

## Develop

```bash
bunx turbo run test typecheck --filter=patcher-plugin-memory
patcher plugin dev ./plugins/memory
```
