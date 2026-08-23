# Optional plugin commands

Each of these `patcher` subcommands comes from a plugin that is not installed or
enabled by default. Install or enable it first; `patcher plugin list` shows what is
running.

- [Memory](#memory)
- [Tasks](#tasks)
- [Docs](#docs)
- [Automations](#automations)
- [Secrets](#secrets)
- [Ask User Question](#ask-user-question)
- [Workflows](#workflows)

## Memory

- Memory is an opt-in official plugin bundled with the app. Install it with
  `patcher plugin install memory` before using `patcher memory ...`.
- Use `patcher memory catalog` to inspect the compact index, `patcher memory search
<query>` to find candidates, and `patcher memory get <id>` to progressively
  disclose a full record.
- Use `patcher memory add --scope project ...` for repository-specific knowledge.
  Global writes require an explicit `--scope global` and should be reserved
  for durable preferences or facts that apply across projects.
- Mutations use optimistic concurrency: pass the current record version to
  `patcher memory update <id> --expected-version <n>` or `patcher memory forget <id>
--expected-version <n> --reason <text>`.

## Tasks

- Tasks is an opt-in official plugin bundled with the app. Install it with
  `patcher plugin install tasks` before using `patcher tasks ...`.
- Start tracked work with `patcher tasks show <key-or-id> --json`. Fetch relevant
  files with `patcher tasks attachment get <attachment-id> --out <path>`.
- Leave substantive milestone updates with `patcher tasks comment <key-or-id>
--body <markdown>` and attach result artifacts with `patcher tasks attachment
add <key-or-comment-id> --file <path>` (task key = task-level; comment ID
  = that comment). Avoid progress spam.
- Delegated threads are attached automatically. For work started independently,
  run `patcher tasks attach <key-or-id>` from the working thread.
- When implementation is ready for review, run `patcher tasks update <key-or-id>
--status in_review`; if blocked, leave the status accurate and explain the
  blocker in a comment.
- Change task hierarchy with `patcher tasks update <key-or-id> --parent
<parent-key-or-id>` or promote a subtask with `--no-parent`. The flags are
  mutually exclusive, and both task keys and IDs are accepted.
- Add `--json` when command output will drive follow-up work. Run `patcher tasks
--help` for project, folder, task, label, attachment, preset, delegation,
  attached-thread, and demo-data commands.
- `patcher tasks list` defaults to 100 rows and accepts `--limit 1-500` plus the
  opaque `--cursor` returned as `nextCursor` in JSON (or printed after a human
  page). Keep the same filters and sort. A task-list mutation makes the cursor
  stale; restart without it.

## Docs

- Docs is an opt-in official plugin. Keep read-only discovery small with
  `patcher docs vaults`, `list`, and `read`.
- Edit through a sync workspace: `patcher docs pull <path> --into <dir>` for one
  file, add `--folder` for a subtree, or use `patcher docs pull --all`. Edit the
  resulting ordinary files, inspect `patcher docs status <dir> --diff`, then run
  `patcher docs push <dir>`.
- `.patcher-docs-state.json` is versioned identity/concurrency state; do not edit it.
  Concurrent local and remote changes fail closed with exit 3. Pull and merge,
  then retry.
- Local deletions are ignored unless `push --delete` is explicit. Use
  `push --dry-run --diff` before destructive mirroring. Standalone callers can
  select the local workspace machine with `--workspace-host <id>`.
- Direct `write`, `mkdir`, `move`, and `remove` commands are deprecated and
  retained temporarily for compatibility. Agents should use pull/edit/push.

## Automations

- Use `patcher automation ...` to manage scheduled tasks. This command is provided
  by the builtin `automations` plugin. When due, an automation runs in one of
  two modes: `agent` (spawns a thread running a prompt — uses tokens) or
  `script` (runs a stored command and captures stdout/exit — no agent, no
  tokens).
- Choosing a mode: pick `script` when the output is fully determined by code
  (watchdogs, threshold alerts, health checks, pollers with a fixed output) —
  write the check so it prints nothing when there's nothing to report, so quiet
  ticks stay silent. Pick `agent` when the run needs reasoning (summarize,
  triage, draft for a human, branch on content).
- For a "watch X and alert me when Y" request, prefer a script automation:
  author the check script (inline `--script` or a file via `--script-file`) so
  its stdout IS the alert, then create it — no model spend per tick.
- Script automations may be disabled by the plugin setting; fall back to an
  `agent` automation if script creation is rejected.
- Create an agent automation with
  `patcher automation create --project <id> --name "..." --cron "0 9 * * 1-5" --timezone "America/New_York" --provider <id> --model <model> --prompt "..."`.
- Create a one-shot agent automation with
  `patcher automation create --project <id> --name "..." --in "30m" --provider <id> --model <model> --prompt "..."`,
  or use `--at "2026-07-03T09:00:00-07:00"` for an absolute run time.
- Create a script automation with
  `patcher automation create --project <id> --name "..." --cron "..." --timezone "..." --script-file ./watch.sh`
  (or `--script "<inline>"`). A script that exits 0 with empty stdout, or whose
  last non-empty line is `{"wakeAgent": false}`, stays silent.
- Script automations run on the server with cwd set to the plugin data
  directory. They have no environment/workspace. Injected variables are
  `PATCHER_SERVER_URL`, `PATCHER_PROJECT_ID`, `PATCHER_AUTOMATION_ID`, and
  `PATCHER_AUTOMATION_RUN_ID`.
- A script run's status IS its exit code: exit 0 = succeeded; a non-zero exit is
  recorded as failed even if the script already produced a visible side effect
  (e.g. posted a message via `patcher thread tell`). Make scripts exit 0 on success
  and check the exit status of each `patcher` call. Captured stdout+stderr is stored
  on failed runs (see `--output <run-id>`).
- Cron accepts standard 5-field expressions, including step values like
  `* * * * *`, `*/2 * * * *`, and `*/5 * * * *`. Cron granularity is one
  minute. One-shot automations use `--at` or `--in` and fire once.
- Pass `--project <id>` explicitly for every automation command.
- Use `patcher automation list`, `patcher automation show <id>`, and
  `patcher automation runs <id>` to inspect; `--output <run-id>` prints a script
  run's captured stdout.
- Partially update an existing agent automation in place by omitting
  `--provider` and `--model` and using `patcher automation update <id> --project <id>
--prompt "..."`, `--permission-mode accept-edits|auto|full`, or exactly one
  target option:
  `--target-thread <id>`, `--environment <id-or-path>`, or
  `--new-environment worktree [--base-branch <branch>]`. Omitted execution
  fields are preserved; target options are mutually exclusive.
- Use `patcher automation pause <id>` / `patcher automation resume <id>` to toggle,
  `patcher automation run <id>` to trigger now, and `patcher automation delete <id> --yes`
  to remove.
- Use `patcher automation update <id> --project <id>` with `--name` or schedule
  flags for metadata changes. To change what runs, provide a complete
  replacement execution: `--prompt` + `--provider` + `--model` for an agent,
  or `--script`/`--script-file` for a script. Script replacements also accept
  `--interpreter`, `--timeout`, and `--env-json '{"KEY":"value"}'`.
- Use `patcher plugin list` if `patcher automation ...` is unavailable; the builtin
  automations plugin should be installed and running.

## Secrets

- Use `patcher secret request <NAME...> --write-env <path>` when credentials are
  needed. Batch known names and add `--purpose <text>` plus one
  `--describe <NAME> <text>` per variable.
- The user enters values in a secure plugin form; values are written directly
  to the dotenv file and never returned in CLI output or chat. Relative paths
  resolve from the CLI working directory; absolute paths may point anywhere on
  the thread's host.
- Treat the returned path and added/updated/unchanged counts as verification.
  Do not inspect the completed file with `cat`, `sed`, `env`, or similar tools.

## Ask User Question

- The builtin `ask-user-question` plugin gives providers that lack a native
  one an `AskUserQuestion` tool — multiple-choice questions answered in a
  composer form. It is disabled on fresh installations; enable it under
  Extensions → Plugins or with `patcher plugin enable ask-user-question`.
- It contributes no CLI command. Once enabled the tool appears in the agent's
  own tool list, and only for providers without a native equivalent: Claude
  Code threads keep using Claude's built-in `AskUserQuestion`, so the plugin
  withholds its copy there.
- Answering is UI-only. `patcher thread interactions list <thread-id>` shows the
  request as kind `plugin`, but `patcher thread interactions answer` resolves
  provider questions only, so a pending plugin question cannot be answered
  from the CLI.

## Workflows

- The builtin `workflows` plugin runs durable provider-independent JavaScript
  orchestration and is disabled on fresh installations. Enable it under
  Extensions → Plugins or with `patcher plugin enable workflows` before using its
  command.
- Author and check sources with `patcher workflows validate (--script <javascript>|
--source <javascript>|--file <path>|--name <name>)`; start a background run
  with the same selector via `patcher workflows run ... [--args <json>] [--resume
<run-id>]`.
- Poll compact progress with `patcher workflows status <run-id>` and list compact
  run summaries with `patcher workflows list [--limit <1-50>]`. For details,
  redirect one bounded
  `patcher workflows history <run-id> [--cursor <call-index>] [--limit <1-100>]`
  JSONL page into `$PATCHER_THREAD_STORAGE`, inspect it with file tools, and continue
  from the final page record's `nextCursor`. This shell redirection writes on
  the thread's execution host, including remote hosts; do not print the raw
  history into the agent transcript. Cancel with `patcher workflows stop <run-id>`.
- Before choosing an explicit provider/model/reasoning tuple, run `patcher provider
list --environment "$PATCHER_ENVIRONMENT_ID" --json`, then query only the chosen
  provider with `patcher provider models <provider-id> --environment
"$PATCHER_ENVIRONMENT_ID" --json`. Never guess ACP model IDs. Run every Workflows
  command from a Patcher project thread.
- Configure its six settings with `patcher plugin config workflows set <key>
<value>`: `maxActiveRuns` (default 4, range 1–32), `maxConcurrentAgents` (8,
  1–64), `maxAgentCalls` (100, 1–1000), `totalRunTimeoutMs` (86400000,
  60000–604800000),
  `retentionDays` (30, 1–3650), and `maxNotificationBytes` (16384,
  1024–262144). `maxActiveRuns` applies live; the other five are snapshotted per
  run. No plugin reload is needed after changing them.
