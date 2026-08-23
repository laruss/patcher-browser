# Threads: spawning, permissions, inspection, recovery

Everything `patcher thread` and `patcher terminal` do beyond the essentials in SKILL.md.

- [Spawning threads](#spawning-threads)
- [Permission modes and parents](#permission-modes-and-parents)
- [Opening threads and files in the app](#opening-threads-and-files-in-the-app)
- [Files and voice](#files-and-voice)
- [Long-running commands](#long-running-commands)
- [Failures and interruptions](#failures-and-interruptions)

## Spawning threads

- Use `patcher thread spawn --project <project-id> --prompt "..."` to create another
  thread. Pass the intended project explicitly; the CLI does not infer it from
  context variables. Omitted execution flags use remembered project defaults;
  without a remembered model, Patcher uses the explicitly requested provider or
  Codex and resolves its provider-reported default model on the target machine.
- Add repeatable `--file <path>` / `--image <path>` flags for structured prompt
  attachments, and `--section <id>` to add the new thread to a section. These
  flags pass host-readable absolute paths (or relative server-upload tokens)
  through to the runtime; they do not read files on the CLI machine.
- Spawn creates a root thread unless you pass `--parent-thread`.
- Use `patcher thread fork <source-thread-id>` to clone a provider session. It
  creates an idle fork by default; add `--prompt`, select `--workspace
isolated|reuse`, or anchor with `--source-seq-end`. Permission mode inherits
  the source thread unless explicitly overridden.
- Pass `--visibility hidden` for background/plugin workers that should remain
  out of sidebar organization without contributing unread/pending favicon
  attention. `patcher thread list` excludes them by
  default; pass `--include-hidden` when a hidden worker must be discovered.
  Direct-ID lifecycle and messaging operations remain available. A root thread
  is visible by default; a child thread inherits its parent's visibility, so a
  hidden thread's subagents are hidden too. Pass `--visibility` to override the
  inherited value. A hidden child still reports its turns and blockers to its
  parent thread; only forks and side chats stay silent. Promote or hide an
  existing thread with `patcher thread update <id> --visibility visible|hidden`.

## Permission modes and parents

- Spawned child threads inherit permission from explicit flags, then the
  parent thread's last execution, then project defaults.
- Public permission modes are `accept-edits`, `auto`, and `full`.
  `accept-edits` keeps workspace sandboxing and asks the user to review
  escalations. `auto` keeps the same workspace sandbox while using the
  provider's automatic reviewer. `full` explicitly bypasses sandbox and
  approval protections. Plan mode remains separate. The product default is
  `auto` when no inherited or project default applies.
- Subagents inherit the parent's permission mode by default; pass
  `--permission-mode full` only when the user or task needs unsandboxed
  execution.
- Use `--parent-self` inside a thread to parent the new thread to the current
  thread.
- Use `--parent-thread <thread-id>` to choose another specific parent.

## Opening threads and files in the app

- Use `patcher thread open <path>` inside a Patcher thread to open a Markdown, HTML, or
  other workspace file for the user in the Patcher IDE's thread panel.
- Use `patcher thread open <thread-id> --split right|down|left|top|replace` to open
  or focus a thread in the current app split layout. `replace` is the default;
  an already-open thread is focused. Edge splits create panes through the
  eighth pane; at eight panes, they replace the focused pane.
- A file path is optional when a thread ID is explicit:
  `patcher thread open <thread-id> [path] [--split <placement>]`.
- Paths can be thread-relative workspace paths, or absolute paths inside the
  target thread workspace.
- Absolute paths under `PATCHER_THREAD_STORAGE` open as thread-storage files for the
  current thread.
- Use `patcher thread pane maximize|restore|toggle [thread-id]` to change a matching
  already-open pane in every connected Patcher app window. Inside a Patcher thread, omit
  the id to use `PATCHER_THREAD_ID`. The command reports how many connected clients
  received the ephemeral action. The SDK equivalent is
  `sdk.threads.paneAction({ threadId, action })`.
- Users can also toggle the focused pane from its header or with the configurable
  `pane.maximize.toggle` app command (default `Mod+Shift+E`).

## Files and voice

- Use `patcher file read|write|list|paths|mkdir|move|remove` for SDK-equivalent host
  file access. `--host` targets another machine; `--root` confines mutations.
- Use `patcher voice transcribe <file>` to invoke the configured voice transcription
  service without the app composer.

## Long-running commands

- Use `patcher terminal ...` for long-running commands the user may need to inspect
  or stop later: dev servers, watch tasks, REPLs, database consoles, and similar
  processes. The terminal is a real persistent PTY shown in the Patcher UI.
- `list` and `create` require exactly one explicit scope: `--thread <id>`,
  `--environment <id>`, or `--machine <id-or-name>` (`--host` is an alias).
  Add `--cwd <path>` only to a machine scope. Machine targets resolve to an
  explicit host ID; terminal commands never silently fall back to primary.
- Start a server with
  `patcher terminal create --thread <thread-id> --title "bun run dev" --command "bun run dev"`.
- All existing-session operations need only the terminal ID. Use
  `patcher terminal wait <terminal-id> --contains "Local:" --timeout 120` to wait
  for readiness from new output. Pass `--from-start` only when matching existing
  scrollback is intentional.
- Use `patcher terminal output <terminal-id> --json` to read bounded output, then
  continue with `--since-seq <nextSeq>` when polling. Use
  `patcher terminal send <terminal-id> --text "..." --enter` for interactive input,
  `patcher terminal rename <terminal-id> <title>` to rename, and
  `patcher terminal close <terminal-id>` when the process is no longer needed.
- `patcher terminal restart <terminal-id>` replaces the session with a shell in the
  same scope, size, and title. It does not replay the original launch command.

## Failures and interruptions

- For failed threads, inspect `patcher thread show <id> --json` and
  `patcher thread log <id>` before deciding whether to retry, clarify, or update the
  user.
- The opt-in Provider retry plugin automatically waits for structured Codex and
  Claude Code subscription-window resets when the failed turn was accepted and
  its execution settings remain available. Prior output or tool activity does
  not block recovery. Enable it with
  `patcher plugin enable provider-retry` or under Extensions → Plugins. Its timers
  last only while the current Patcher server/plugin process is running. Inspect it
  with `patcher provider-retry status [thread-id]`, or cancel one with
  `patcher provider-retry cancel <thread-id>`. Automatic waits default to six hours;
  configure longer waits with
  `patcher plugin config provider-retry set maximumWait "24 hours"` or select
  `No limit` in the plugin settings. Resets beyond the configured horizon are
  not scheduled.
- Use `patcher thread retry [id] [--request-id <id>]` for the same core
  continuation when no plugin timer remains. It sends agent-only “Please
  continue.” on the existing provider conversation and declines when input was
  not accepted, execution settings are unavailable, a newer request exists, or
  the provider still owns the retry.
- For interrupted or stopped threads, inspect first. If the user stopped the
  thread, treat that as intentional unless they ask you to continue.
- Use `patcher thread stop <id>` when a thread is stuck or no longer needed.
- Use `patcher thread compact <id>` to send the built-in `/compact` command to an idle or errored thread. Completion or failure appears in the timeline. Codex, Claude Code, Pi, and OpenCode ACP support it; Cursor ACP does not expose compatible compaction through ACP.
- Use `patcher thread cancel-plan <id>` to exit an active Plan turn without
  optimistically clearing its banner. Use `patcher thread clear-goal <id>` to clear
  a Codex thread's durable active Goal. Both wait for provider confirmation.
