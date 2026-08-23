---
kind: instruction
title: Patcher Guide — Agent Configuration
summary: User and workspace files that customize agent instructions and skills.
intent: Document the user and workspace files that shape agent behavior for threads.
editingNotes: Keep accurate against the server's agent-instructions reader and skill loader.
---
Agent configuration

Patcher reads agent configuration from the app data dir and from a project's .patcher/
directory. These files shape how agents behave in provider-backed threads.

User instructions (<dataDir>/AGENTS.md):

  Add an AGENTS.md file to the Patcher data dir (usually ~/.patcher/AGENTS.md) to give
  every provider-backed thread across all projects default user-level
  instructions. Patcher reads <dataDir>/AGENTS.md and appends its contents to the
  thread system prompt for all providers when a provider session starts.

Workspace instructions (.patcher/AGENTS.md):

  Add a .patcher/AGENTS.md file to a workspace to give every thread that runs there
  repo-specific instructions. Patcher reads <workspace>/.patcher/AGENTS.md and appends its
  contents to the thread system prompt for all providers, after any
  <dataDir>/AGENTS.md instructions, when a provider session starts. Track it with
  git so fresh managed worktrees include it.

  Only the plural AGENTS.md is read, only from the exact data-dir and
  workspace-root .patcher/ locations above (Patcher does not walk parent directories), and
  an empty file is ignored. This is Patcher's own provider-agnostic instruction
  injection, separate from provider-native files such as CLAUDE.md or a
  repo-root AGENTS.md.

Skills (.patcher/skills/):

  A skill is a reusable instruction file that Patcher injects into a thread and
  exposes to the agent as a slash command. Place project skills under
  .patcher/skills/<name>/SKILL.md in a workspace. Each SKILL.md has YAML frontmatter
  with `name` (lowercase, hyphenated, matching the directory) and `description`,
  followed by the instruction body.

  Patcher resolves skills from three sources, in increasing precedence:

    builtin    Skills bundled with Patcher.
    user       <dataDir>/skills (e.g. ~/.patcher/skills).
    project    <workspace>/.patcher/skills.

  A project skill overrides a user or builtin skill with the same name. Two
  skills with the same name within one source collide and are both dropped.

  Use `patcher skill list` to inspect installed and discovered skills and copy the
  opaque skill ID. `patcher skill show|files <skill-id>` reads that exact skill;
  `patcher skill show <skill-id> --json` returns the revision required by `patcher skill
  update <skill-id> --revision <sha256>`. `patcher skill delete <skill-id>` and
  update are restricted to editable, user-owned skills. These workspace-scoped
  commands default to `PATCHER_PROJECT_ID`, then the personal project; pass
  `--project` or `--environment` when a different workspace is required.

  Use `patcher skill search` to browse skills.sh, `patcher skill registry detail
  <registry-skill-id>` to inspect metadata and the bounded file preview, and
  `patcher skill install <registry-skill-id>` to install that canonical registry
  identity into Patcher user skills. Registry commands are server-wide and do not
  accept workspace selectors.

  Use `patcher skill install-cli-skills` to copy Patcher's built-in CLI skills into a
  machine's global agent skill roots (`~/.agents/skills` and
  `~/.claude/skills`) so agents running outside Patcher can drive it. It installs on
  every connected machine unless you pass `--machine <id-or-name>`, which is
  repeatable. Settings → Skills exposes the same action; it asks which machines
  only when more than one is enrolled. Machines install independently, so the
  command reports each machine's outcome and exits non-zero if any failed. The
  install replaces a previously installed copy of the same skill and leaves
  other skills alone. `patcher skill cli-skills-status` reports whether each machine
  is installed, out of date, missing, or unknown (disconnected or unreachable);
  the settings row shows the same as a badge.

  Use the skill-creator skill to author and iterate on skills.
