---
kind: instruction
title: Patcher Guide — Machines
summary: Command reference for listing and targeting execution machines.
intent: Explain execution-machine discovery and selection from the CLI.
editingNotes: Keep the user-facing noun machine; internal APIs and types use Host.
---
Machine commands

A machine is a host daemon that can run thread environments. Add remote
machines under Settings → Machines.

The server listens on loopback by default. Remote execution machines need a
server URL they can actually reach — a private Tailscale Serve URL, for example;
generate their installer while using that reachable server URL.

The Settings installer first uses the exact `patcher-app` tarball served by that Patcher
server at `/install/patcher-app.tgz`; only servers that do not implement the route
(HTTP 404) fall back to npm. Installed launchd/systemd services pass
`--auto-update`. On a newer server protocol mismatch, the daemon downloads that
same artifact, installs it globally with npm, and exits for the service manager
to restart. Failed attempts use a persisted exponential backoff that starts at
5 seconds and caps at 5 minutes. A daemon never auto-downgrades to an older
server protocol. Use Settings → Machines or `patcher machine retry-update` to bypass
the current backoff after a transient failure.

To opt out, remove `--auto-update` from the launchd plist or systemd user unit
and reload that service. Foreground/manual `patcher-app host-daemon` runs leave it off
unless you pass `--auto-update` explicitly.

  patcher machine list                         List machines with ID, connection
                                          status, and relative last-seen time
    --json                                Print the raw host list
  patcher machine show <id-or-name>            Show machine details
  patcher machine join-code                    Create a machine pairing code
  patcher machine rename <id-or-name> <name>   Rename a machine
  patcher machine retry-update <id-or-name>    Retry a pending daemon update now
  patcher machine remove <id-or-name> [--yes]  Revoke and remove a machine
  patcher machine provider-cli status <machine>
  patcher machine provider-cli install <machine> <claudeCode|codex|cursor>
    --action <install|update>

Each machine has a permission limit: the highest permission mode any thread on
that machine can run with. The default is Full Access. A thread that asks for
more resolves down to the limit, and a provider that supports no mode under the
limit cannot run there. Set it in Settings → Machines → the machine → Permission
limit; that page also shows the machine's projects, provider CLIs, update state,
and rename/remove. There is no CLI or SDK command to set it, and a paired
machine cannot set it for any machine, so a sandbox machine can stay at Full
Access while your laptop stays lower. `patcher machine list --json` and `patcher machine
show` report the current limit.

Updates commands

One consolidated view of Patcher and provider CLI updates across machines — the
CLI counterpart of Settings → Updates and the sidebar Updates badge.

  patcher updates [status]                     Show patcher-app and provider CLI update
                                          status for every machine
    --machine <id-or-name>                Limit to one machine
    --json                                Print the aggregate as JSON
  patcher updates apply                        Run every available provider CLI
                                          install/update, one at a time
    --machine <id-or-name>                Limit to one machine
    --json                                Print per-target results as JSON

`patcher updates apply` covers provider CLIs only. Update patcher-app itself with the
printed upgrade command (`npx patcher-app@latest`) or the desktop app's relaunch;
connected daemons then follow the server version automatically.

Machine selectors accept either an exact machine ID or an unambiguous machine
name. `--host` is an alias for `--machine`.

  patcher thread spawn --project <id> --machine <id-or-name> --prompt "..."
  patcher project create --name "..." --root <path> --machine <id-or-name>
  patcher project source add <projectId> --machine <id-or-name> --path <path>

For thread spawning, machine targeting works with an unmanaged workspace path,
a new managed worktree, or the personal workspace. Do not combine it with an
existing environment ID: the reused environment already selects its machine.

For project creation and sources, `--root`/`--path` refers to a path on the
selected connected machine. Omit the selector to keep the existing local CLI
machine fallback (normally the primary machine). Pass `--clone` to source add
instead of `--path` to clone the project's Git remote there; `--remote-url` and
`--target-path` optionally override the clone inputs.
