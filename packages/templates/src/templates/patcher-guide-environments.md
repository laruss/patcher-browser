---
kind: instruction
title: Patcher Guide — Environments
summary: Command reference for environment setup, inspection, commits, and merges.
intent: Provide complete environment command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation.
---
Environment commands

Environments determine where threads run. Multiple threads can share an environment
(e.g., a coding thread and a review thread in the same worktree).

Making your repo work with patcher:

  Commit a .patcher-env-setup.sh script at the repo root when new Patcher worktrees need
  repo-specific setup. After Patcher creates a new managed worktree environment, it
  looks for .patcher-env-setup.sh inside that new workspace. If the file is absent,
  provisioning continues with no error.

  The script must be tracked by git. A fresh worktree only checks out tracked
  files, so an untracked .patcher-env-setup.sh in your source checkout will not be
  present and will not run.

  Patcher runs the hook as `env bash .patcher-env-setup.sh` with cwd set to the new
  workspace. POSIX shell setup scripts are not supported on Windows. The hook
  inherits the host daemon's sanitized environment: NODE_ENV and every PATCHER_*
  variable are removed, and Patcher does not inject PATCHER_PROJECT_ID, PATCHER_ENVIRONMENT_ID,
  or PATCHER_SOURCE_PATH.

  The hook runs only for newly-created managed worktree environments. It does
  not run for direct/project-checkout environments, personal scratch workspaces,
  or reconnecting an existing managed worktree.

  A non-zero exit, timeout, signal, or cancellation fails provisioning and Patcher
  removes the new worktree. Keep optional setup steps non-fatal inside the
  script if the environment should still open. Provisioning progress reports
  "Running .patcher-env-setup.sh" and then ".patcher-env-setup.sh finished",
  ".patcher-env-setup.sh failed", or ".patcher-env-setup.sh cancelled".

  New worktrees do not contain untracked files such as .env.local. To copy
  them from the source checkout, commit a .worktreeinclude file at the repo
  root. It uses gitignore syntax: one pattern per line, # for comments, ! to
  negate an earlier pattern. Patcher copies each untracked file in the source
  checkout that matches a pattern:

    .env
    .env.*
    !.env.example
    certs/

  Patcher copies files only. It follows no symlinks, and it replaces nothing that
  the worktree already has. The copy runs after `git worktree add` and before
  .patcher-env-setup.sh, so the setup script can read the copied files. A pattern
  that matches nothing, or a file Patcher cannot read, is reported in the
  provisioning transcript and does not fail provisioning.

  Large directories such as node_modules are copied file by file. Install
  dependencies in .patcher-env-setup.sh instead of listing them here.

  For files that customize agent instructions and skills (AGENTS.md,
  .patcher/AGENTS.md, .patcher/skills/), run `patcher guide agent-configuration`.

  patcher environment show <id>                Show environment details (path, branch, status)

  patcher environment status <id>              Show workspace status
    --merge-base-branch <branch>          Include merge-base status

  patcher environment branches <id>            List local and remote branches
    --query <query>                       Filter branch names
    --limit <count>                       Limit local and remote results

  patcher environment paths <id>               Search workspace paths
    --query <query>                       Fuzzy path query
    --limit <count>                       Maximum results
    --files                               Include only files unless combined with --directories
    --directories                         Include only directories unless combined with --files

  patcher environment diff <id>                Show file summary and full git diff
  patcher environment diff-files <id>          List changed-file metadata
    --target <target>                     uncommitted, branch_committed, all, or commit (required)
    --merge-base-branch <branch>          Required for branch_committed and all
    --sha <sha>                           Required for commit

  patcher environment diff-file <id>           Read one side of a changed file
    --target <target>                     Diff target (required)
    --path <path>                         Repository-relative path (required)
    --side <old|new>                      File side (required)
    --merge-base-ref <sha>                Required for branch_committed and all
    --sha <sha>                           Required for commit

  patcher environment diff-patch <id>          Fetch selected file patches
    --target <target>                     Diff target (required)
    --path <path>                         Changed path; repeat for multiple files (required)
    --merge-base-branch <branch>          Required for branch_committed and all
    --sha <sha>                           Required for commit

  patcher environment update <id>              Update environment metadata
    --merge-base-branch <branch>          Set merge-base branch override
    --clear-merge-base-branch             Clear merge-base override
    --name <name>                         Set display name
    --clear-name                          Clear display name

  patcher environment commit <id>              Create a commit in the environment

  patcher environment squash-merge <id>        Squash-merge into a target branch
    --merge-base-branch <branch>          Target branch (required)

  patcher environment archive-threads <id>     Archive all threads in an environment

  patcher environment pull-request show <id>   Inspect a pull request
  patcher environment pull-request ready <id>  Mark a pull request ready
  patcher environment pull-request draft <id>  Convert a pull request to draft
  patcher environment pull-request merge <id>  Merge a pull request
    --method <method>                     merge, squash, or rebase

Every inspection command accepts an arbitrary environment ID and supports
`--json`. Non-git status/diff responses are reported explicitly. `diff-file`
prints UTF-8 content directly and labels base64 binary content; diff and patch
truncation markers are preserved.
