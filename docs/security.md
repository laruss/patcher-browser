# Security

Patcher is experimental software whose entire point is running code an agent
wrote. This page says what that code can reach, what stands between it and your
machine, and what does not.

The short version is in the README's [Security model](../README.md#security-model).
This is the reasoning behind it. For the full argument, see
[plugin-permissions.md](architecture/plugin-permissions.md).

## A patch is not sandboxed

A patch's backend is a Node module loaded into the Patcher server process
(`plugin-runtime.ts`, via `jiti.import`). It runs with the process's own
capabilities. Nothing in the `patcher` object it is handed closes that:

- `import("node:child_process")` and `node:fs` are reachable directly;
- `patcher.server.loopbackBaseUrl` plus `fetch` reaches the whole server API,
  around any wrapper on `patcher.sdk`;
- it shares a realm with Patcher's own modules and can monkey-patch them.

So a patch that wants what it did not declare can still take it. Treat
installing a patch as running a local script with your account's privileges,
because that is what it is.

Isolating plugins into their own process is planned work — Phase 7 of the
project plan — and both
[plugin-permissions.md](architecture/plugin-permissions.md) and
[plugin-callbacks.md](architecture/plugin-callbacks.md) exist to specify the
boundary before it can be enforced.

## What the permission declaration is actually for

Every patch declares `patcher.permissions` and, for anything that touches a
page, `patcher.sites`. Since that declaration is not enforced against hostile
code, it buys three other things:

1. **It specifies the future RPC surface.** Every entry names an operation that
   must cross a process boundary once patches move out of the server process.
2. **It makes an under-declared patch fail loudly.** A patch that reaches for
   something it did not ask for throws with the permission named and the fix in
   the message — which is what makes an agent's build loop converge instead of
   silently doing more than you asked.
3. **It is something to show you.** `patcher plugin list` prints it, install
   prints it, and the consent prompt prints it at the one moment it decides
   something.

## An agent's install pauses for you

The consent prompt is what stands in for the permission model that does not
exist yet. It is a consent and audit boundary rather than a barrier: it works on
an agent taking Patcher's normal CLI path, and the sections above are why
nothing stronger is available yet. What it needs to be useful is that the person
at the machine is the one answering.
The local API could not tell an agent's `patcher plugin enable` from yours:
both arrive on the same loopback server with the same credentials.

Now the caller says. Patcher sets `PATCHER_THREAD_ID` in the environment of the
processes a turn spawns, and the CLI forwards it as `x-patcher-thread-id`. No
declared thread means a person at their own terminal, and that behaves as it
always did. A declared thread means an agent mid-turn, and `enable`, `disable`,
`install`, `update`, `remove` and a settings write each raise a prompt in that
thread — the patch's name, its declared permissions, its declared sites — and
block on the answer for up to four minutes. The change happens only if you
allow it.

Every outcome where nobody could have seen the prompt refuses, because a prompt
nobody saw is not consent: an archived or destroying thread is refused before a
prompt is raised, an unknown thread or one already holding a question is a
`409`, a refusal or a timeout is a `403`.

## The browser runs your real sessions

Browsing happens in a persistent Chromium session with your real cookies and
logins. A patch that declares a site and registers a page script runs on that
site while you are signed in to it. That is what makes patches useful and it is
also the whole risk: read the site list on the consent prompt, not just the
permission list.

Popups are real windows for the browser surface's tabs, which is what makes
"Sign in with…" flows work — see
[browser-surface.md](architecture/browser-surface.md) for the popup policy and
the rate limiter that survived that change.

## The local API is unauthenticated

The server binds to loopback by default. Direct tailnet or LAN access to port
`38986` requires the explicit `--server-bind-host 0.0.0.0` option, and a trusted
network boundary in front of it, because the public API has no authentication.
For remote access, publish the loopback listener with Tailscale Serve instead —
see [`packages/patcher-app/README.md`](../packages/patcher-app/README.md#configuration).

## Telemetry

Patcher currently sends none. It ships with an empty PostHog key, and an empty
key disables the sender.

The code path is still there. If a key is ever configured, production runs — the
desktop app and the packaged launcher — would send anonymous usage telemetry:
app starts, thread creation counts, and user message counts. Identification
would be a random per-install id stored in your data directory. No user, host,
project, workspace, or message content is ever attached. Development and source
runs never send.

Opt out of any run with `PATCHER_TELEMETRY=false`. The code is
[`apps/server/src/services/system/telemetry.ts`](../apps/server/src/services/system/telemetry.ts).

## Reporting a vulnerability

Open an issue if it is not sensitive. If it is, contact the maintainer privately
rather than filing publicly.
