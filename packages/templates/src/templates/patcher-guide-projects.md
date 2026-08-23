---
kind: instruction
title: Patcher Guide — Projects
summary: Command reference for project CRUD, attachments, and sources.
intent: Provide complete project command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation.
---
Project commands

A project maps to a code repository. All threads belong to a project.

  patcher project list                         List ordinary projects
    --include-personal                    Also include the personal project
  patcher project history <id>                 List prompt history
  patcher project reorder <id>                 Reorder in the sidebar
    --after <id>                          Previous project, or omit for start
    --before <id>                         Next project, or omit for end
  patcher project create --name "..." [options]
    --root <path>                         Project source path
    --machine <id-or-name>                Bind the path to a connected machine
    --host <id-or-name>                   Alias for --machine

  An explicit machine/host selector accepts an exact ID or unambiguous name and
  binds --root to that machine. Omitting the selector preserves the existing
  local CLI machine fallback (normally the primary machine).

  patcher project show <id>                    Show project details
  patcher project update <id>                  Update a project
    --name <name>                         New name

  patcher project delete <id>                  Delete project and all threads
    --yes                                 Skip confirmation

Discovery:

  patcher project branches <id> --host <id>   List branches for a machine source
  patcher project paths <id>                   Search workspace paths
  patcher project files <id>                   List workspace files
  patcher project content <id> <path>          Read file content (binary is base64)
  patcher project commands <id> --provider <id>
                                          List commands and skills
    --machine <id-or-name>                Target project source machine
    --host <id-or-name>                   Alias for --machine
    --environment <id>                    Target environment workspace

  The machine/host and environment selectors are mutually exclusive. An
  environment selects its owning machine and workspace; otherwise an explicit
  machine selects that machine's project source. Omitting both intentionally
  falls back to the primary machine's project source.

Attachments:

  patcher project attachment upload <id>       Upload bytes from the CLI machine
    --client-file <path>                  Path read on this CLI machine
    --filename <name>                     Attachment filename override
    --mime-type <type>                    MIME override (otherwise inferred)
  patcher project attachment download <id> <attachment-path>
    --client-file <path>                  Destination on this CLI machine

  Uploads use multipart bytes and return a server-managed attachment DTO. Pass
  its relative `path` to thread --file/--image input. Those thread flags never
  read a client path: absolute values remain paths for the execution host.
  image/* uploads are limited to 10MB; other files are limited to 25MB.

Sources:

  Projects can have multiple machine-local path sources.

  patcher project source add <projectId>       Add a source
    --path <path>                         Local path
    --clone                               Clone the project's Git remote
    --remote-url <url>                    Git remote override for --clone
    --target-path <path>                  Destination override for --clone
    --machine <id-or-name>                Target machine (--host is an alias)
    --default                             Set as default source

  Explicit project source selectors must name a connected machine. Omitting
  the selector preserves the same local CLI machine fallback as project create.

  patcher project source update <projectId> <sourceId>
    --path <path>
    --default

  patcher project source delete <projectId> <sourceId>
