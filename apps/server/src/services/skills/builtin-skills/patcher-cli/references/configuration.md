# Configuring patcher: settings, agent instructions, skills

Server-backed configuration an agent can read and change from the CLI.

- [App settings](#app-settings)
- [Agent instructions](#agent-instructions)
- [Skills](#skills)

## App settings

- `PATCHER_INFERENCE` selects the shared model for server-side helper completions,
  including thread titles and commit subjects. It defaults to
  `codex/gpt-5.6-luna`; set an override with
  `patcher-app config set PATCHER_INFERENCE <provider/model>`.
- `PATCHER_INFERENCE_FALLBACK` selects the helper model used after a transient
  primary timeout, rate limit, or service-unavailable failure. It defaults to
  `codex/gpt-5.4-mini`; set it with
  `patcher-app config set PATCHER_INFERENCE_FALLBACK <provider/model>`.
- `PATCHER_TRANSCRIPTION` selects the voice transcription model. It defaults to
  `codex/gpt-transcribe`; set an override with
  `patcher-app config set PATCHER_TRANSCRIPTION <provider/model>`.
- `patcher-app config` and `patcher-app env` reload runtime settings in a running server,
  but the CLI identifies server and launcher settings that are startup-only,
  including binding/ports, data and the dev-app port, telemetry, inherited skill
  roots, and `PATCHER_FF_*` flags. `PATCHER_LOG_LEVEL` is also startup-only. Use
  `patcher-app config`, not `patcher-app env`, to change `PATCHER_APP_URL`, `PATCHER_INFERENCE`,
  `PATCHER_INFERENCE_FALLBACK`, or `PATCHER_TRANSCRIPTION` live. After a startup-only
  change, run `patcher-app stop && patcher-app start` or restart the desktop app. Until
  then, a server previously bound to `0.0.0.0` remains exposed even if
  `PATCHER_SERVER_BIND_HOST` was changed or unset.
- Settings → General holds server-backed app-wide preferences, such as the
  macOS-only "Caffeinate" toggle. For details, read
  [app-settings.md](app-settings.md).
- The `showUnhandledProviderEvents` General preference defaults to false and
  exposes raw provider events that Patcher does not yet understand in packaged
  builds. Development builds always show those diagnostic rows. Update it with
  `patcher settings general showUnhandledProviderEvents <true|false>`.
- The `steerActiveThreadOnEnter` General preference defaults to false. Outside
  an open composer typeahead menu, enable it to make Enter steer a running
  thread and Command+Enter queue a follow-up; when disabled, those actions are
  reversed. Shift+Enter inserts a newline, while zen mode also makes
  unmodified Enter insert one. On coarse-pointer touch devices, the software
  keyboard keeps Return as a newline; iPadOS WebKit preserves the Enter
  shortcuts for a connected Magic Keyboard. Update the preference with
  `patcher settings general steerActiveThreadOnEnter <true|false>`.
- Settings → Keyboard records server-backed per-command shortcut overrides.
  The `showKeyboardHints` preference controls the delayed badges shown while
  holding Command or Control and defaults to true; update it with
  `patcher settings keyboard hints <true|false>`.
  Reset returns to Patcher's current default; Clear disables the command. Non-native
  actions apply in browser and desktop clients, and desktop menu accelerators
  use the same resolved bindings. For details, read
  [app-settings.md](app-settings.md).
- Use `patcher settings show`, `patcher settings general`, `patcher settings experiment`,
  `patcher settings keyboard`, `patcher settings usage`, and `patcher settings version` to
  inspect or change these server-backed values from agents. Pass
  `patcher settings usage --machine <id-or-name>` to read provider limits from a
  specific connected machine instead of the primary machine.
- The default-off `toolsHub` experiment exposes the unified Skills, Plugins,
  and Automations management UI. Change it with
  `patcher settings experiment toolsHub <true|false>`. It does not load or unload
  tools.
- The default-off `newOnboarding` experiment exposes the first-run agent and
  project setup guide. Change it with
  `patcher settings experiment newOnboarding <true|false>`. Use
  `patcher settings replay-onboarding` to enable it and show the guide again.
- The default-off `editMessages` experiment allows completed user messages in
  Codex, Claude Code, and Pi threads to be replaced and rerun. Change it with
  `patcher settings experiment editMessages <true|false>`.
- Thread timeline windows are capped by event count as well as by user-message
  count (`PATCHER_FF_TIMELINE_WINDOW_EVENT_BUDGET`, default 1500), because a thread
  with few user messages but many events would otherwise reproject its whole
  history on every timeline request, blocking the server event loop and
  delaying the daemon endpoints the agent awaits between tool calls. A turn
  still running is cut at the budget as well, so a very long turn costs the
  budget per update rather than growing without limit; a finished turn is
  rendered whole. Older activity loads automatically as you scroll toward the
  top; nothing becomes unreachable.

## Agent instructions

- Add `AGENTS.md` to the Patcher data dir (usually `~/.patcher/AGENTS.md`) to inject
  user-level default instructions for every provider-backed thread across all
  projects.
- Add `.patcher/AGENTS.md` at a workspace root to inject repo-specific instructions
  into every thread that runs there. Track the workspace file with git so fresh
  managed worktrees include it.
- Patcher appends data-dir instructions first, then workspace instructions, to the
  thread system prompt for all providers when a provider session starts.
- Only the plural `AGENTS.md` is read, only from those exact locations (no
  parent-directory walk); an empty file is ignored. Run
  `patcher guide agent-configuration` for details (it also covers project
  `.patcher/skills/`).

## Skills

- Use `patcher skill list` to inspect installed and discovered skills. It defaults to
  `PATCHER_PROJECT_ID`, then the personal project; pass `--project` or
  `--environment` to select another workspace.
- Copy the opaque ID from `patcher skill list`, then use `patcher skill show <skill-id>`
  or `patcher skill files <skill-id>` to read that exact skill.
- `patcher skill show <skill-id> --json` returns the revision. Pass that revision,
  plus `--file`, to `patcher skill update <skill-id>`. Use update or delete only when
  the list says editable.
- Use `patcher skill search [query]` for live skills.sh results. Inspect metadata and
  the bounded file preview with `patcher skill registry detail <registry-skill-id>`.
  Install with `patcher skill install <registry-skill-id>`; never infer an install
  source from a display name.
- `patcher skill install-cli-skills` copies Patcher's built-in CLI skills into a machine's
  global agent skill roots (`~/.agents/skills` and `~/.claude/skills`) so agents
  outside Patcher can drive Patcher. It targets every connected machine unless you pass
  the repeatable `--machine <id-or-name>`, and reports each machine's outcome.
  Settings → Skills has the same action; it confirms first, and asks which
  machines only when more than one is enrolled.
- `patcher skill cli-skills-status` reports per machine whether the installed copy is
  `installed`, `outdated`, `missing`, or `unknown` (disconnected or unreachable).
