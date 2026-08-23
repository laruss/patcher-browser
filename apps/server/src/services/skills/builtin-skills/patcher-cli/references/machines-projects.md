# Machines, projects, environments, and providers

Where a thread actually runs: enrolled machines, project sources,
environments, and the provider/model catalog.

- [Environment setup script](#environment-setup-script)
- [Remote client](#remote-client)
- [Execution machines](#execution-machines)
- [Projects and environments](#projects-and-environments)
- [Providers, models, and ACP agents](#providers-models-and-acp-agents)

## Environment setup script

- To make a repo work with Patcher worktrees, run `patcher guide environments`. It
  documents the repo-level `.patcher-env-setup.sh` setup hook and the
  `.worktreeinclude` file.
- A new worktree checks out tracked files only. Commit a `.worktreeinclude`
  file at the repo root to list untracked files, such as `.env`, that Patcher must
  copy from the source checkout. It uses gitignore pattern syntax. Patcher copies
  the matches before it runs `.patcher-env-setup.sh`.

## Remote client

- `patcher-app client ssh-target set <server-origin> <ssh-target>` configures the
  local helper to open files from a remote Patcher server in local editors. The SSH
  target is the value that works after `ssh`, such as `devbox` or
  `user@devbox`.
- These mappings live on the client machine in `<dataDir>/client.json`;
  the CLI resolves the server's host ID when writing the mapping, and the remote
  server does not read the file.
- Use `patcher-app client ssh-target list --json` to inspect mappings.

## Execution machines

- Add remote execution machines from Settings → Machines. The one-line
  installer uses
  the server's exact `/install/patcher-app.tgz` artifact (npm only on a 404) and
  enables daemon `--auto-update`; newer protocol mismatches update from that
  artifact with a persisted exponential retry backoff from 5 seconds to 5
  minutes, then let launchd/systemd restart the daemon. Auto-update never
  downgrades. Use `patcher machine retry-update <id-or-name>` to bypass the current
  backoff after a transient failure. Remove `--auto-update` from the service
  definition and reload it to opt out.
- Run `patcher machine list` to see machine names, IDs, connection status, and last
  seen time (`--json` returns the raw host list). Use `--machine <id-or-name>`
  (alias `--host`) on `patcher thread spawn` to run in a personal or unmanaged
  workspace, or combine it with `--new-environment worktree`. Do not combine a
  machine selector with an existing environment ID, which already owns its
  machine.
- Each machine carries a permission limit (`maxPermissionMode`, default
  `full`): the highest permission mode a thread on that machine may run with.
  The server resolves any higher request down to it, and refuses a provider
  that supports no mode under it. Only the owner can change it, on the machine
  page at Settings → Machines → the machine — there is no CLI, SDK, or API
  surface that sets it, and machine credentials are refused — so read it from
  `patcher machine list --json` or `patcher machine show` and ask the user to change it
  in the app.
- `patcher machine show`, `join-code`, `rename`, `retry-update`, and `remove` cover
  the Settings → Machines lifecycle. Use `patcher machine provider-cli
status|install` to inspect or install provider CLIs on a selected machine.
- `patcher updates` (alias for `patcher updates status`) aggregates patcher-app and provider
  CLI update state across every machine — the CLI counterpart of Settings →
  Updates. `patcher updates apply [--machine <id-or-name>]` runs every available
  provider CLI install/update sequentially; update patcher-app itself with the
  printed upgrade command or the desktop relaunch.

## Projects and environments

- Use `patcher project create --name <name> --root <path> --machine <id-or-name>`
  to bind a new project's local path to a connected enrolled machine. Use
  `--host` as an alias. Omitting both selectors preserves the existing local
  CLI machine fallback (normally the primary machine).
- `patcher project list` preserves the ordinary-project-only default. Pass
  `--include-personal` when the singleton personal project must be discoverable.
- Use `patcher project source add <project-id> --machine <id-or-name> --path <path>`
  to register a path on another connected machine. It uses the same selector
  resolution and fallback as project create. Use `--clone` instead of `--path`
  to clone the project's remote there; `--remote-url` and `--target-path` are
  optional clone overrides.
- `patcher project paths|files|content|commands` accept `--machine <id-or-name>`
  (`--host` alias) or `--environment <id>`, but not both. An environment uses
  its owning machine and workspace; an explicit machine uses that machine's
  project source; omitting both intentionally uses the primary machine source.
  `patcher project content --json` returns UTF-8 text or base64 binary content with
  an explicit `contentEncoding`.
- Use `patcher project attachment upload <project-id> --client-file <path>` when the
  bytes live on the CLI machine, including when the CLI and Patcher server are on
  different hosts. It reads locally and sends multipart bytes through the
  configured `PATCHER_SERVER_URL` (and its enrolled-machine authentication proxy),
  returning the stable server attachment DTO. Optional `--filename` and
  `--mime-type` override inferred metadata. Pass the returned relative `path`
  to thread `--file` or `--image`; image MIME types are capped at 10MB and
  other files at 25MB. `patcher project attachment download <project-id>
<attachment-path> --client-file <path>` writes existing attachment bytes on
  the CLI machine. There is no project-attachment list or per-file remove API.
- `patcher project history|reorder` exposes project prompt recall and sidebar order.
- Direct environment inspection accepts any environment ID: use `patcher environment
status|branches|paths|diff|diff-files|diff-file|diff-patch <id>` and `patcher
environment pull-request show <id>`. Diff commands require an explicit target
  and the matching merge-base or commit flags; all support `--json`.
- `patcher environment pull-request ready|draft|merge` manages pull-request state;
  `patcher environment archive-threads` bulk-archives an environment's threads.

## Providers, models, and ACP agents

- If provider or model choice matters, inspect options with `patcher provider list`
  and `patcher provider models <provider-id>`. Both accept `--machine <id-or-name>`
  (alias `--host`) or `--environment <id>` to inspect the machine where work
  will run; the selectors cannot be combined. With neither selector they
  intentionally inspect the primary machine.
- Known ACP agents can appear automatically when their CLI is installed on the
  host; for example `opencode`, `omp`, Grok Build's `grok` CLI, or Hermes'
  `hermes` CLI on PATH appears as provider `acp-opencode`, `acp-omp`,
  `acp-grok`, or `acp-hermes-agent`.
- Cursor ACP threads discover project skills from `.cursor/skills`. This root
  can link to `.agents/skills`. `patcher skill list` shows linked Cursor skills under
  `cursor-project` and keeps them read-only.
- Custom ACP agents can be registered in the app data-dir `config.json` under
  `customAcpAgents`. The user supplies a slug `id`; Patcher exposes it as provider
  id `acp-<id>`. Custom config wins if it uses the same provider id as a known
  ACP agent, so overriding `acp-opencode` uses `"id": "opencode"`. This list
  has no set/unset CLI surface, so edit the JSON and run `patcher-app config refresh`
  or restart Patcher. The configured command is local code execution and only works
  with a co-located daemon. Optional `logo` accepts an SVG, PNG, or WebP path;
  relative paths resolve from the Patcher data dir. Custom ACP agents can use
  `modelCli` for CLI model listing/selection, `reasoningCli` for launch-time
  reasoning flags, and `nativeReasoning` for ACP `session/set_config_option`
  reasoning. Optional
  `nativeSkillRoots.user` paths resolve from the target
  host home directory. Optional `nativeSkillRoots.project` paths resolve from
  the selected workspace. The composer lists skills from these roots.
- Top-level `customModels` in the same `config.json` registers extra picker
  models. `providerId` accepts a built-in provider id or any `acp-*` provider
  id. The provider must still accept the id: `claude-code` and `codex` accept
  unlisted ids, while an ACP agent can reject an unknown id at session start.
  OpenCode rejects unlisted ids; add the model to the OpenCode config instead
  and Patcher discovers it automatically. An OpenCode agent is a session mode, not
  a model, and cannot be selected through Patcher. This list also has no set/unset
  CLI surface; edit the JSON and run `patcher-app config refresh` or restart Patcher.
- Top-level `sharedSkillRoots` uses the same relative `user` and `project`
  paths. Patcher lists these skills as read-only. Patcher injects them into each provider,
  so one physical skill collection can support Patcher and standalone provider CLIs.
