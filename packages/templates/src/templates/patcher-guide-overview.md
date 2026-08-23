---
kind: instruction
title: Patcher Guide Overview
summary: System overview and chapter index for the Patcher CLI guide.
intent: Orient agents to Patcher core concepts and help them find the right guide chapter.
editingNotes: Keep this concise. Concepts only — command details belong in chapter files.
---
Patcher is an agent orchestration tool for managing multiple agents.

Core concepts:

- Project — maps to a repository. All threads belong to a project.
- Thread — a single agent conversation. The fundamental unit of work.
- Environment — where a thread runs. Kinds: project checkout or isolated worktree. Multiple threads can share an environment.
- Machine — an execution host where project sources and thread environments live.
- Terminal — a persistent PTY session scoped to a thread, environment, or machine path. Use terminals for long-running commands such as dev servers.
- Provider — the agent backend powering a thread (e.g., codex, claude-code). Each provider supports different models.

Threads can have a parent-child relationship. The parent coordinates the child and receives lifecycle notifications when it completes, fails, or is interrupted. Threads without a parent are managed directly by the user.

Context variables set automatically inside a thread environment:

- PATCHER_PROJECT_ID — current project
- PATCHER_THREAD_ID — current thread
- PATCHER_ENVIRONMENT_ID — current environment
- PATCHER_CLI — absolute path to the daemon-managed `patcher` executable (prefer this if bare `patcher` is wrong; official entrypoints also re-exec to it)

Run `patcher status` to see your current context (resolved project and thread IDs).

All commands support --json for machine-readable output.

To make a repo work with Patcher worktrees, run `patcher guide environments` for the
repo-level `.patcher-env-setup.sh` setup hook. Run `patcher guide agent-configuration` for
the data-dir and workspace files that customize agent behavior.

Run `patcher guide <chapter>` for command details:

  threads              Spawning, inspecting, messaging, and managing threads
  environments         Environment setup hooks, operations, commits, and merges
  agent-configuration  AGENTS.md and skills files that shape agents
  providers            Discovering providers and models
  projects             Project CRUD and sources
  machines             Listing and targeting execution machines
  terminals            Persistent PTY sessions across all supported scopes
  customization        Theming the app palette
  plugins              Installing plugins and their contributed Patcher commands
  automations          Scheduling and editing recurring or one-shot work
