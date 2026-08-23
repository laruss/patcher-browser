# Real-Provider CLI/API E2E Manual Runbook

This runbook covers the thorough non-app end-to-end validation pass for Patcher's
server, host daemon, CLI, API, database state, and real provider paths. It is
written against the current standalone persistent-host setup and intentionally
does not claim generic "Full QA" or release readiness by itself.

Use this when you need to validate real-provider CLI/API behavior with
standalone server + daemon infrastructure: prompts, follow-ups, managed
worktrees, thread lifecycle, restart/reconnect behavior, API responses, DB
state, and logs. This pass does not cover app UI, Electron, or browser behavior.

## QA Gate Taxonomy

- **CI validation** runs Turbo/build/typecheck/lint/unit/integration/package
  smoke checks. It is automated validation, not manual product QA.
- **Regression validation** reruns targeted or broad checks after a specific
  change. Its verdict is scoped to the changed behavior.
- **Real-provider CLI/API E2E** is this non-app provider gate. The automated
  companion is `bunx turbo run test:integration`, including real-provider
  coverage under `tests/integration/real/**` and `@patcher/agent-runtime`; this
  manual runbook adds operator-driven CLI/API, standalone server + daemon,
  restart, lifecycle, API, DB, and log checks.
- **Smoke QA** is a shallow liveness check on a running app or surface. It is
  useful for quick confidence but does not establish release readiness.
- **Release QA / Full QA** combines CI/regression validation, Real-provider
  CLI/API E2E where applicable, and app-driven manual/browser/Electron product
  flows with an explicit pass/fail/NA matrix. Any required release row that is
  not run makes the release verdict incomplete.

## Not Covered By This Runbook

Pair this runbook with app QA whenever a release or change needs product-flow,
visual, or shell confidence. App QA should cover the rich prompt editor,
mentions, sidebar pinning/collapse/drag-and-drop, settings/provider UI,
Electron shell behavior, browser routing, visual layout, and other in-app flows.

This runbook can find server/daemon/provider/CLI/API regressions that app QA may
miss, but it will not catch visual regressions, broken browser interactions,
Electron packaging or window behavior, or UI-only provider-selection issues.

## CLI/API Surface Matrix Scope

Treat the CLI matrix as a product-surface check, not a wishlist of possible
commands.

- Thread recovery is validated with the existing lifecycle commands:
  `patcher thread stop`, `patcher thread tell`, `patcher thread spawn`, archive/unarchive, and
  the recovery checks below. There is no current product contract for
  `patcher thread retry`; do not mark its absence from `patcher thread --help` as blocked.
  When a failed or interrupted thread should continue, inspect it first and send
  a fresh turn with `patcher thread tell`, or create a replacement with
  `patcher thread spawn` when a new thread is the right recovery path.

## Prerequisites

Build the server, daemon, and CLI:

```bash
bun run build
```

Verify provider CLIs are installed before running real-provider checks:

```bash
codex --help
claude --help
pi --help
jq --help
sqlite3 --version
```

Default-path QA must not use generic OpenAI API-key routes. Clear ambient
`OPENAI_API_KEY` before a normal pass. To intentionally validate API-key routes,
set `PATCHER_QA_OPENAI_API_KEY` and record that the pass is opt-in.

```bash
if [ -n "${OPENAI_API_KEY:-}" ] && [ -z "${PATCHER_QA_OPENAI_API_KEY:-}" ]; then
  echo "OPENAI_API_KEY is set. Unset it for default-path QA, or set PATCHER_QA_OPENAI_API_KEY for an explicit API-key route pass."
  false
fi
```

## Standalone Setup

Before starting, clear any leftover standalone QA processes or temp roots from a prior run:

```bash
bun run qa:standalone:cleanup
```

Start an isolated server + daemon pair and load the exported QA environment:

```bash
eval "$(bun run --silent qa:standalone:start --format env)"
jq . "$STATE_PATH"
SERVER_DB_PATH=$(jq -er '.server.dataDir + "/patcher.db"' "$STATE_PATH")
SERVER_LOG_DIR=$(jq -er '(.paths.serverDataDir // .server.dataDir) + "/logs"' "$STATE_PATH")
DAEMON_LOG_DIR=$(jq -er '(.paths.daemonDataDir // .daemon.dataDir) + "/logs"' "$STATE_PATH")

Patcher() { node apps/cli/dist/index.js "$@"; }
```

The machine-facing contract is the exported env block. The state file at `$STATE_PATH`
is the diagnostics contract for humans and debugging.

Basic health checks:

```bash
curl -fsS "$PATCHER_SERVER_URL/api/v1/system/config" | jq
curl -fsS "$PATCHER_SERVER_URL/api/v1/hosts" | jq
patcher status
patcher provider list
```

Resolve current provider models before spawning real-provider threads:

```bash
CODEX_MODEL=$(patcher provider models codex --json | jq -er '([.[] | select(.isDefault)][0].model // .[0].model)')
CLAUDE_MODEL=$(patcher provider models claude-code --json | jq -er '([.[] | select(.model == "claude-haiku-4-5")][0].model // [.[] | select(.isDefault)][0].model // .[0].model)')
PI_MODELS_JSON=$(patcher provider models pi --json)
# Keep Pi preference order in sync with packages/test-helpers/src/provider-models.ts.
PI_MODEL=$(printf '%s\n' "$PI_MODELS_JSON" | jq -er '
  [.[] | select(.model == "openai-codex/gpt-5.5")][0].model
  // [.[] | select(.model == "openai-codex/gpt-5.4")][0].model
  // [.[] | select(.model == "openai-codex/gpt-5.4-mini")][0].model
  // [.[] | select(.model == "openai-codex/gpt-5.3-codex")][0].model
  // [.[] | select(.model == "anthropic/claude-haiku-4-5")][0].model
  // [.[] | select(.model | startswith("anthropic/")) | select(.isDefault)][0].model
  // [.[] | select(.model | startswith("openai-codex/")) | select(.isDefault)][0].model
  // [.[] | select(.model | startswith("openai-codex/"))][0].model
  // [.[] | select(.model | startswith("anthropic/"))][0].model
  // [.[] | select(.isDefault)][0].model
  // .[0].model
')

printf 'codex: %s\nclaude-code: %s\npi: %s\n' "$CODEX_MODEL" "$CLAUDE_MODEL" "$PI_MODEL"

case "$PI_MODEL" in
  openai/*)
    if [ "${PATCHER_QA_ALLOW_OPENAI_API_KEY_MODELS:-}" != "1" ]; then
      echo "Pi resolved to generic OpenAI API-key model $PI_MODEL. Pick a subscription-backed model or set PATCHER_QA_ALLOW_OPENAI_API_KEY_MODELS=1 for an explicit API-key route pass."
      false
    fi
    ;;
esac
```

## API Prompt Attachments

Public API `localFile` and `localImage` prompt parts use one of two path
forms:

- Absolute or URI-like paths are passed through to the runtime as already
  readable paths.
- Relative paths are project attachment references returned by
  `POST /api/v1/projects/:id/attachments`. They are not workspace-relative file
  paths. Do not submit `{ "type": "localFile", "path": "alpha.txt" }` for
  `$PROJECT_ROOT/alpha.txt`; upload the file first and use the returned `path`.

Validate the upload-and-reference flow before any prompt/timeline attachment QA:

```bash
ATTACHMENT_JSON=$(
  curl -fsS \
    -X POST "$PATCHER_SERVER_URL/api/v1/projects/$PATCHER_PROJECT_ID/attachments" \
    -F "file=@$PROJECT_ROOT/alpha.txt"
)
echo "$ATTACHMENT_JSON" | jq

PROMPT_TEXT='Review @alpha.txt and reply exactly ATTACHMENT OK.'
MENTION_TEXT='@alpha.txt'
THREAD_CREATE_BODY=$(
  jq -n \
    --arg projectId "$PATCHER_PROJECT_ID" \
    --arg hostId "$HOST_ID" \
    --arg model "$CODEX_MODEL" \
    --arg text "$PROMPT_TEXT" \
    --arg mention "$MENTION_TEXT" \
    --argjson attachment "$ATTACHMENT_JSON" '
      ($text | index($mention)) as $start |
      {
        origin: "app",
        projectId: $projectId,
        providerId: "codex",
        model: $model,
        input: [
          {
            type: "text",
            text: $text,
            mentions: [
              {
                start: $start,
                end: ($start + ($mention | length)),
                resource: {
                  kind: "path",
                  source: "workspace",
                  entryKind: "file",
                  path: "alpha.txt",
                  label: "alpha.txt"
                }
              }
            ]
          },
          (
            if $attachment.type == "localFile" then
              {
                type: "localFile",
                path: $attachment.path,
                name: $attachment.name,
                sizeBytes: $attachment.sizeBytes
              } + (if $attachment.mimeType then { mimeType: $attachment.mimeType } else {} end)
            else
              { type: "localImage", path: $attachment.path }
            end
          )
        ],
        environment: {
          type: "host",
          hostId: $hostId,
          workspace: {
            type: "unmanaged",
            path: null
          }
        }
      }
    '
)
THREAD_JSON=$(
  curl -fsS \
    -H 'content-type: application/json' \
    -d "$THREAD_CREATE_BODY" \
    "$PATCHER_SERVER_URL/api/v1/threads"
)
THREAD_ID=$(echo "$THREAD_JSON" | jq -er '.id')
curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$THREAD_ID/timeline" |
  jq '.rows[] | select(.kind == "conversation" and .role == "user") | {mentions, attachments}'
```

For exact-output checks, use prompts in the form `Say exactly: <EXPECTED TEXT>`.
Avoid phrasing like "reply only in chat with..." because providers can interpret that
as a behavioral constraint rather than the expected response text.

For Pi checks, prefer subscription-backed `openai-codex/...` models from Codex
subscription auth first, then `anthropic/...` models from Claude/Anthropic auth,
over generic `openai/...` API-key models. Generic `openai/...` Pi models are
only acceptable in an explicitly recorded API-key route pass.

Teardown:

```bash
bun run qa:standalone:stop --state "$STATE_PATH"
bun run qa:standalone:cleanup
```

## CLI/API Thread Smoke Pass

Spawn an unmanaged Codex thread and wait for it to finish:

```bash
SMOKE_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --prompt "Say hello from the smoke pass" \
  --json | jq -r '.id')

patcher thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
patcher thread show "$SMOKE_THREAD_ID"
patcher thread output "$SMOKE_THREAD_ID"
patcher thread log "$SMOKE_THREAD_ID" --format json | jq '.[-10:]'
```

Send a follow-up after idle:

```bash
patcher thread tell "$SMOKE_THREAD_ID" "Now say goodbye from the smoke pass"
patcher thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
patcher thread output "$SMOKE_THREAD_ID"
```

Create a parent thread and child thread, then verify the first bootstrap reaches
idle without protocol disconnect symptoms. This is a user-facing smoke check;
malformed host-RPC message invariants require automated boundary tests.

```bash
THREAD_PROTOCOL_STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M")
PROTOCOL_PARENT_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --title "QA protocol smoke parent" \
  --prompt "Say hello from the parent protocol smoke check." \
  --json | jq -r '.id')

patcher thread wait "$PROTOCOL_PARENT_ID" --status idle --timeout 240

PROTOCOL_CHILD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --parent-thread "$PROTOCOL_PARENT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --title "QA protocol smoke child" \
  --prompt "Say hello from the child protocol smoke check." \
  --json | jq -r '.id')

patcher thread wait "$PROTOCOL_CHILD_ID" --status idle --timeout 240
patcher thread show "$PROTOCOL_PARENT_ID" --json | jq '.thread | {id, parentThreadId, providerId, status}'
patcher thread show "$PROTOCOL_CHILD_ID" --json | jq '.thread | {id, parentThreadId, providerId, status}'
patcher thread output "$PROTOCOL_CHILD_ID"
if patcher manager list; then
  echo "expected patcher manager list to fail"
  exit 1
fi
patcher manager list 2>&1 | rg "Managers were replaced by parent threads|patcher thread"
printf 'thread protocol smoke started at UTC minute: %s\n' "$THREAD_PROTOCOL_STARTED_AT"
rg -n "invalid-message|1008|host_unavailable|command_result_type_mismatch|Ignoring host RPC response" \
  "$SERVER_LOG_DIR" "$DAEMON_LOG_DIR" || true
```

Expected result:

- the parent and child threads reach `idle`
- the child thread reports the parent thread ID
- `patcher manager list` exits non-zero with a parent-thread replacement message
- server and daemon logs have no matching protocol disconnect or host-RPC
  mismatch entries at or after `$THREAD_PROTOCOL_STARTED_AT`

Create a managed worktree thread and inspect workspace status:

```bash
WORKTREE_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Create a file named smoke.txt and briefly confirm it" \
  --json | jq -r '.id')

patcher thread wait "$WORKTREE_THREAD_ID" --status idle --timeout 120
WORKTREE_ENV_ID=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$WORKTREE_THREAD_ID" | jq -r '.environmentId')

patcher thread show "$WORKTREE_THREAD_ID"
patcher thread output "$WORKTREE_THREAD_ID"
patcher thread show "$WORKTREE_THREAD_ID" --work-status
patcher thread show "$WORKTREE_THREAD_ID" --git-diff --diff-target uncommitted
patcher thread show "$WORKTREE_THREAD_ID" --git-diff --diff-target branch_committed
patcher thread show "$WORKTREE_THREAD_ID" --git-diff --diff-target all
curl -fsS "$PATCHER_SERVER_URL/api/v1/environments/$WORKTREE_ENV_ID" | jq
curl -fsS "$PATCHER_SERVER_URL/api/v1/environments/$WORKTREE_ENV_ID/status" | jq
curl -fsS "$PATCHER_SERVER_URL/api/v1/environments/$WORKTREE_ENV_ID/diff/branches" | jq
```

Verify Codex-backed helper inference for environment commit. This catches
regressions where the default helper path accidentally falls back to generic
OpenAI API-key inference.

```bash
WORKTREE_ENV_PATH=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/environments/$WORKTREE_ENV_ID" | jq -er '.path')
printf 'helper inference commit smoke\n' > "$WORKTREE_ENV_PATH/helper-inference-smoke.txt"

patcher environment commit "$WORKTREE_ENV_ID" --json | jq -e '.action == "commit" and (.commitSha | type == "string")'
```

Verify merge-base environment metadata:

```bash
MERGE_BASE_BRANCH=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/environments/$WORKTREE_ENV_ID" | jq -er '.defaultBranch // "main"')

patcher environment update "$WORKTREE_ENV_ID" --merge-base-branch "$MERGE_BASE_BRANCH"
patcher environment show "$WORKTREE_ENV_ID" --json | jq -e --arg branch "$MERGE_BASE_BRANCH" '.mergeBaseBranch == $branch'
patcher thread show "$WORKTREE_THREAD_ID" --work-status --git-diff --diff-target all

patcher environment update "$WORKTREE_ENV_ID" --clear-merge-base-branch
patcher environment show "$WORKTREE_ENV_ID" --json | jq -e '.mergeBaseBranch == null'
```

Archive and unarchive the smoke thread:

```bash
patcher thread archive "$SMOKE_THREAD_ID"
curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$SMOKE_THREAD_ID" | jq

if patcher thread tell "$SMOKE_THREAD_ID" "This should fail while archived"; then
  echo "expected archived thread tell to fail"
  false
else
  echo "archived thread tell was blocked"
fi

patcher thread unarchive "$SMOKE_THREAD_ID"
patcher thread tell "$SMOKE_THREAD_ID" "Say something after unarchive"
patcher thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
patcher thread output "$SMOKE_THREAD_ID"
```

Verify archive cleanup for a dirty managed worktree:

```bash
DIRTY_ARCHIVE_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Say exactly: dirty archive setup" \
  --json | jq -r '.id')

patcher thread wait "$DIRTY_ARCHIVE_THREAD_ID" --status idle --timeout 120
DIRTY_ARCHIVE_ENV_ID=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$DIRTY_ARCHIVE_THREAD_ID" | jq -r '.environmentId')
DIRTY_ARCHIVE_ENV_PATH=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/environments/$DIRTY_ARCHIVE_ENV_ID" | jq -er '.path')
printf 'dirty archive safety\n' > "$DIRTY_ARCHIVE_ENV_PATH/dirty-archive.txt"
patcher thread show "$DIRTY_ARCHIVE_THREAD_ID" --work-status

patcher thread archive "$DIRTY_ARCHIVE_THREAD_ID"

curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$DIRTY_ARCHIVE_THREAD_ID" | jq -e '.archivedAt != null'
for i in $(seq 1 60); do
  DIRTY_ARCHIVE_ENV_STATUS=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/environments/$DIRTY_ARCHIVE_ENV_ID" | jq -r '.status')
  test "$DIRTY_ARCHIVE_ENV_STATUS" = "destroyed" && break
  sleep 1
done
test "$DIRTY_ARCHIVE_ENV_STATUS" = "destroyed"
test ! -e "$DIRTY_ARCHIVE_ENV_PATH"
```

Expected result:

- The unmanaged thread reaches `idle`, shows output, and accepts a follow-up.
- The worktree thread reaches `idle`, the environment reports `isWorktree: true`, and workspace status/diff routes return data for uncommitted, branch-committed, and combined targets.
- `patcher environment commit` succeeds with helper-generated commit text without requiring `OPENAI_API_KEY`.
- Environment merge-base metadata can be set, reflected by `patcher environment show`, used by thread status/diff output, and cleared.
- Archiving blocks `patcher thread tell`; unarchiving restores normal operation.
- Dirty isolated managed worktree archive succeeds, destroys the environment, and removes the worktree even while uncommitted or unmerged work remains.

## Multi-Thread and Shared Environment

Create thread A and capture its environment:

```bash
THREAD_A_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --prompt "Say exactly: THREAD A HELLO" \
  --json | jq -r '.id')

patcher thread wait "$THREAD_A_ID" --status idle --timeout 120
THREAD_A_ENV_ID=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$THREAD_A_ID" | jq -r '.environmentId')
patcher thread output "$THREAD_A_ID"
```

Create thread B in the same project source path and let the server reuse the ready direct-workspace environment implicitly:

```bash
THREAD_B_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --prompt "Say exactly: THREAD B WORLD" \
  --json | jq -r '.id')

patcher thread wait "$THREAD_B_ID" --status idle --timeout 120
THREAD_B_ENV_ID=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$THREAD_B_ID" | jq -r '.environmentId')

printf 'thread A env: %s\nthread B env: %s\n' "$THREAD_A_ENV_ID" "$THREAD_B_ENV_ID"
patcher thread output "$THREAD_B_ID"
```

Alternate follow-ups across the two sibling threads:

```bash
patcher thread tell "$THREAD_A_ID" "Say exactly: FOLLOW UP A"
patcher thread wait "$THREAD_A_ID" --status idle --timeout 120

patcher thread tell "$THREAD_B_ID" "Say exactly: FOLLOW UP B"
patcher thread wait "$THREAD_B_ID" --status idle --timeout 120

patcher thread output "$THREAD_A_ID"
patcher thread output "$THREAD_B_ID"
patcher thread log "$THREAD_A_ID" --format json | jq '.[-8:]'
patcher thread log "$THREAD_B_ID" --format json | jq '.[-8:]'
```

Archive thread A and verify thread B still works:

```bash
patcher thread archive "$THREAD_A_ID"
patcher thread tell "$THREAD_B_ID" "Say exactly: STILL WORKING"
patcher thread wait "$THREAD_B_ID" --status idle --timeout 120
patcher thread output "$THREAD_B_ID"
patcher thread unarchive "$THREAD_A_ID"
```

Run a mixed-provider pass in separate environments:

```bash
CLAUDE_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider claude-code \
  --model "$CLAUDE_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Say exactly: CLAUDE THREAD" \
  --json | jq -r '.id')

PI_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider pi \
  --model "$PI_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Say exactly: PI THREAD" \
  --json | jq -r '.id')

patcher thread wait "$CLAUDE_THREAD_ID" --status idle --timeout 120
patcher thread wait "$PI_THREAD_ID" --status idle --timeout 180
CLAUDE_ENV_ID=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$CLAUDE_THREAD_ID" | jq -r '.environmentId')
PI_ENV_ID=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$PI_THREAD_ID" | jq -r '.environmentId')

printf 'claude env: %s\npi env: %s\n' "$CLAUDE_ENV_ID" "$PI_ENV_ID"
patcher thread output "$CLAUDE_THREAD_ID"
patcher thread output "$PI_THREAD_ID"
```

Expected result:

- Thread A and B share the same environment ID via implicit same-path reuse.
- Alternating follow-ups complete and return the requested exact outputs.
- Archiving one sibling does not break the other.
- Mixed-provider threads succeed without event cross-contamination.

## Recovery

Graceful daemon restart:

```bash
kill -TERM "$DAEMON_PID"
curl -fsS "$PATCHER_SERVER_URL/api/v1/system/config" | jq
curl -fsS "$PATCHER_SERVER_URL/api/v1/hosts" | jq

eval "$RESTART_DAEMON_COMMAND"
DAEMON_PID=$!

curl -fsS "$PATCHER_SERVER_URL/api/v1/hosts" | jq
patcher thread tell "$SMOKE_THREAD_ID" "Check recovery after daemon restart"
patcher thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
patcher thread output "$SMOKE_THREAD_ID"
```

Server restart during environment provisioning:

```bash
SERVER_RESTART_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Say exactly: server restart provisioning recovery" \
  --json | jq -r '.id')

SERVER_RESTART_ENV_ID=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$SERVER_RESTART_THREAD_ID" | jq -er '.environmentId')
for _ in $(seq 1 60); do
  ENV_STATUS=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/environments/$SERVER_RESTART_ENV_ID" | jq -r '.status')
  [ "$ENV_STATUS" = "provisioning" ] && break
  sleep 1
done
test "$ENV_STATUS" = "provisioning"

kill -TERM "$SERVER_PID"
while kill -0 "$SERVER_PID" 2>/dev/null; do sleep 1; done

PATCHER_DATA_DIR=$(jq -er '.server.dataDir' "$STATE_PATH") \
PATCHER_SERVER_PORT=$(jq -er '.server.port' "$STATE_PATH") \
node apps/server/dist/index.js >> "$(jq -er '.server.logPath' "$STATE_PATH")" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  curl -fsS "$PATCHER_SERVER_URL/api/v1/system/config" >/dev/null && break
  sleep 1
done

eval "$RESTART_DAEMON_COMMAND"
DAEMON_PID=$!

curl -fsS "$PATCHER_SERVER_URL/api/v1/environments/$SERVER_RESTART_ENV_ID" | jq
patcher thread show "$SERVER_RESTART_THREAD_ID"
patcher thread log "$SERVER_RESTART_THREAD_ID" --format json | jq '.[-12:]'
```

Expected result:

- The server restarts with the same data directory and the daemon reconnects.
- The in-flight environment provision is not replayed from a durable queue.
- If the live RPC result was lost, the environment/thread reaches an honest
  `error` or retryable interrupted state, with a system error explaining that
  the server restarted before live provisioning completed.
- The operator can retry by sending a new turn after the host is connected.

Host offline before send:

```bash
kill -TERM "$DAEMON_PID"
for _ in $(seq 1 60); do
  HOST_STATUS=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/hosts" | jq -r --arg host "$HOST_ID" '.[] | select(.id == $host) | .status')
  [ "$HOST_STATUS" != "connected" ] && break
  sleep 1
done
test "$HOST_STATUS" != "connected"

if patcher thread tell "$SMOKE_THREAD_ID" "This should fail while the host is offline"; then
  echo "expected offline host send to fail"
  false
else
  echo "offline host send failed fast"
fi

eval "$RESTART_DAEMON_COMMAND"
DAEMON_PID=$!
patcher thread tell "$SMOKE_THREAD_ID" "Say exactly: offline retry ok"
patcher thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
patcher thread output "$SMOKE_THREAD_ID"
```

Expected result:

- Sending while the host is offline fails fast.
- No new host command/request queue row is inserted. Upgraded large databases may
  retain retired queue tables as inert migration debris, but the live-RPC path
  must not write to them.
- Retrying after the daemon reconnects works as a fresh live RPC request.

Daemon hot-replace mid-RPC:

```bash
HOT_REPLACE_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --prompt "Write 80 detailed bullet points about the history of operating systems." \
  --json | jq -r '.id')

patcher thread wait "$HOT_REPLACE_THREAD_ID" --status active --timeout 30
OLD_DAEMON_PID=$DAEMON_PID
eval "$RESTART_DAEMON_COMMAND"
DAEMON_PID=$!
test "$DAEMON_PID" != "$OLD_DAEMON_PID"

curl -fsS "$PATCHER_SERVER_URL/api/v1/hosts" | jq
patcher thread show "$HOT_REPLACE_THREAD_ID"
patcher thread log "$HOT_REPLACE_THREAD_ID" --format json | jq '.[-12:]'
```

Expected result:

- The old live waiter is rejected or settled when the old daemon session drops.
- Any late response from the old session is ignored and is not mis-routed to the
  replacement daemon session.
- The thread remains inspectable and records a `thread_command_failed` system
  error, or an equivalent explicit interruption/error event, for the interrupted
  RPC.

Kill the daemon during active work:

```bash
patcher thread tell "$SMOKE_THREAD_ID" "Write 80 detailed bullet points about the history of computing."
patcher thread wait "$SMOKE_THREAD_ID" --status active --timeout 30

kill -TERM "$DAEMON_PID"
patcher thread show "$SMOKE_THREAD_ID"

eval "$RESTART_DAEMON_COMMAND"
DAEMON_PID=$!

THREAD_STATE=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$SMOKE_THREAD_ID" | jq -r '.status')

if [ "$THREAD_STATE" = "active" ]; then
  patcher thread wait "$SMOKE_THREAD_ID" --status idle --timeout 180
else
  patcher thread tell "$SMOKE_THREAD_ID" "Say exactly: recovery ok"
  patcher thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
fi

patcher thread output "$SMOKE_THREAD_ID"
patcher thread log "$SMOKE_THREAD_ID" --format json | jq '.[-12:]'
patcher thread log "$SMOKE_THREAD_ID" --format json \
  | jq -e 'any(.[]; .type == "system/error" and (.data.code // .code // null) == "thread_command_failed")'
```

Inspect logs and state:

```bash
tail -n 200 "$LOGS_DIR/server.log"
tail -n 200 "$LOGS_DIR/host-daemon.log"
curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$SMOKE_THREAD_ID" | jq
```

Expected result:

- The server stays up while the daemon is restarted.
- Threads remain inspectable during and after daemon loss.
- After an interruption mid-turn, the thread records a `thread_command_failed`
  system error, or an equivalent explicit interruption/error event, and then
  reaches `idle`/`error` and accepts a short new turn after restart.

## Provider-Specific Pass

Repeat this section for `codex`, `claude-code`, and `pi`:

Use the resolved model for each provider:

- `codex`: `--model "$CODEX_MODEL"`
- `claude-code`: `--model "$CLAUDE_MODEL"`
- `pi`: `--model "$PI_MODEL"`

```bash
PROVIDER_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider <provider-id> \
  --model <provider-model> \
  --reasoning-level low \
  --prompt "Say exactly: hello world" \
  --json | jq -r '.id')

patcher thread wait "$PROVIDER_THREAD_ID" --status idle --timeout 120
patcher thread output "$PROVIDER_THREAD_ID"

patcher thread tell "$PROVIDER_THREAD_ID" "Repeat the previous answer in uppercase"
patcher thread wait "$PROVIDER_THREAD_ID" --status idle --timeout 120
patcher thread output "$PROVIDER_THREAD_ID"

patcher thread tell "$PROVIDER_THREAD_ID" "Write a very long essay about computing history"
patcher thread wait "$PROVIDER_THREAD_ID" --status active --timeout 30
patcher thread stop "$PROVIDER_THREAD_ID"
patcher thread wait "$PROVIDER_THREAD_ID" --status idle --timeout 120
patcher thread show "$PROVIDER_THREAD_ID"
patcher thread log "$PROVIDER_THREAD_ID" --format json | jq '.[-10:]'
```

For workspace interaction, repeat on a worktree thread:

```bash
PROVIDER_WORKTREE_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider <provider-id> \
  --model <provider-model> \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Create hello.txt containing hello world" \
  --json | jq -r '.id')

patcher thread wait "$PROVIDER_WORKTREE_THREAD_ID" --status idle --timeout 120
PROVIDER_WORKTREE_ENV_ID=$(curl -fsS "$PATCHER_SERVER_URL/api/v1/threads/$PROVIDER_WORKTREE_THREAD_ID" | jq -r '.environmentId')

patcher thread output "$PROVIDER_WORKTREE_THREAD_ID"
curl -fsS "$PATCHER_SERVER_URL/api/v1/environments/$PROVIDER_WORKTREE_ENV_ID/status" | jq
```

Run a pending-interaction pass with permission-restricted turns:

```bash
APPROVAL_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --permission-mode readonly \
  --prompt "Run this exact shell command: printf 'APPROVED' > approval-smoke.txt. If approval is needed, request approval. After the command finishes, reply with exactly DONE." \
  --json | jq -r '.id')

APPROVAL_INTERACTION_ID=
for _ in {1..60}; do
  APPROVAL_INTERACTION_ID=$(patcher thread interactions list "$APPROVAL_THREAD_ID" --json | jq -r '.[0].id // empty')
  if [ -n "$APPROVAL_INTERACTION_ID" ]; then
    break
  fi
  sleep 2
done
test -n "$APPROVAL_INTERACTION_ID"

patcher thread interactions show "$APPROVAL_INTERACTION_ID" "$APPROVAL_THREAD_ID"

if patcher thread tell "$APPROVAL_THREAD_ID" "This should be blocked while an interaction is pending"; then
  echo "expected tell to be blocked while the interaction is pending"
  false
else
  echo "tell was blocked while the interaction was pending"
fi

patcher thread interactions approve "$APPROVAL_INTERACTION_ID" "$APPROVAL_THREAD_ID"
patcher thread wait "$APPROVAL_THREAD_ID" --status idle --timeout 180
patcher thread output "$APPROVAL_THREAD_ID"
patcher thread interactions list "$APPROVAL_THREAD_ID" --json | jq
```

Verify denial handling with a separate interaction:

```bash
DENY_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --permission-mode readonly \
  --prompt "Run this exact shell command: printf 'DENIED' > denied-smoke.txt. If approval is denied, reply with exactly DENIED." \
  --json | jq -r '.id')

DENY_INTERACTION_ID=
for _ in {1..60}; do
  DENY_INTERACTION_ID=$(patcher thread interactions list "$DENY_THREAD_ID" --json | jq -r '.[0].id // empty')
  if [ -n "$DENY_INTERACTION_ID" ]; then
    break
  fi
  sleep 2
done
test -n "$DENY_INTERACTION_ID"

patcher thread interactions show "$DENY_INTERACTION_ID" "$DENY_THREAD_ID"
patcher thread interactions deny "$DENY_INTERACTION_ID" "$DENY_THREAD_ID"
if patcher thread wait "$DENY_THREAD_ID" --status idle --timeout 180; then
  patcher thread output "$DENY_THREAD_ID"
else
  patcher thread show "$DENY_THREAD_ID"
fi
patcher thread log "$DENY_THREAD_ID" --format json | jq '.[-12:]'
```

For `claude-code`, also verify grant semantics with a permission-grant interaction:

```bash
GRANT_THREAD_ID=$(patcher thread spawn \
  --project "$PATCHER_PROJECT_ID" \
  --provider claude-code \
  --model "$CLAUDE_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --permission-mode workspace-write \
  --prompt "Use the Read tool to read /etc/hosts, then reply with exactly the first non-empty line from the file and nothing else." \
  --json | jq -r '.id')

GRANT_INTERACTION_ID=
for _ in {1..60}; do
  GRANT_INTERACTION_ID=$(patcher thread interactions list "$GRANT_THREAD_ID" --json | jq -r '.[0].id // empty')
  if [ -n "$GRANT_INTERACTION_ID" ]; then
    break
  fi
  sleep 2
done
test -n "$GRANT_INTERACTION_ID"

patcher thread interactions show "$GRANT_INTERACTION_ID" "$GRANT_THREAD_ID"
patcher thread interactions grant "$GRANT_INTERACTION_ID" "$GRANT_THREAD_ID" --scope turn
patcher thread wait "$GRANT_THREAD_ID" --status idle --timeout 180
patcher thread output "$GRANT_THREAD_ID"
```

Expected result:

- Permission-restricted turns surface pending interactions through `patcher thread interactions list/show`.
- `patcher thread tell` is rejected while the thread is awaiting user interaction.
- `approve`, `deny`, and `grant` resolve their matching interaction kinds.
- Approved/granted threads continue to `idle`; denied threads either reply with the denial handling text or clearly record the denied approval in the log.

## Recording Results

Record each pass with:

- Date and operator
- Gate name: Real-provider CLI/API E2E
- Standalone state path
- Provider(s) used
- Credential mode: default subscription-backed path, or explicitly opt-in API-key route path
- Thread IDs and environment IDs
- Whether smoke, multi-thread, and recovery passed
- Any unexpected output, missing events, or log findings
- Whether this pass was paired with app QA; if not, state that app UI,
  Electron, and browser behavior were not covered
