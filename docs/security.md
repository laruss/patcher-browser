# Security

Patcher is experimental software whose entire point is running code an agent
wrote. This page says what that code can reach, what stands between it and your
machine, and what does not.

The short version is in the README's [Security model](../README.md#security-model).
This is the reasoning behind it. For the full argument, see
[plugin-permissions.md](architecture/plugin-permissions.md).

## A plugin runs in its own process, and that is not a sandbox

A plugin you installed — anything that did not ship with Patcher — runs in its
own process, one process per plugin (`plugin-placement.ts`;
`PATCHER_PLUGIN_PROCESS=false` puts them all back in the server). Built-in
plugins stay in the server, because they are the same code as the server,
released and reviewed with it.

The process boundary is worth having and it is not a security boundary. It is a
plain `fork` with no sandbox: the plugin's process has `node:fs`,
`node:child_process` and the network, runs as you, and inherits the server's
environment. A plugin that declared nothing can read your files, run commands and
reach the internet, because that is what any program you start can do.

What moving out of the server did buy: the plugin no longer shares a realm with
Patcher's own modules, cannot monkey-patch them or read what the server holds in
memory, and cannot take the server down when it crashes. It also put the
permission gate somewhere a plugin cannot reach past — every
`patcher.browser` command is charged on the host's side of the pipe, what a
plugin reports having _registered_ is parsed and charged there too (a page
script still has to name a site the manifest declared, whoever wrote the
reply), every `/api/v1` request is charged by the middleware, and a request
that identifies itself as nothing is now refused rather than taken for the
app. One plugin per
process is part of that: two in one process would share a pipe and a V8 realm,
which is one trust domain however carefully the pipe is keyed.

What none of it buys is containment. The gate is in the right place and the
plugin can still walk around the building:

- it can read your files, including the app's own key file and another
  plugin's secrets, because it has `node:fs` and runs as you;
- it can run commands and reach the network;
- so a plugin that wants what it did not declare can still take it.

Treat installing one as running a local script with your account's privileges,
because that is what it is. The missing half is a sandbox, not another gate —
[plugin-permissions.md](architecture/plugin-permissions.md) and
[plugin-callbacks.md](architecture/plugin-callbacks.md) describe the boundary as
it now stands.

## What the permission declaration is actually for

Every patch declares `patcher.permissions` and, for anything that touches a
page, `patcher.sites`. It is enforced on every path Patcher owns, and a plugin
with the filesystem can still go around those paths, so besides the enforcement
it buys three things:

1. **It specifies the RPC surface.** Every entry names an operation that crosses
   the process boundary for a plugin that runs outside the server — which is
   now the default for anything you installed.
2. **It makes an under-declared plugin fail loudly.** A plugin that reaches for
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

Now the caller proves it. A turn's processes no longer receive the app key.
They receive a key derived from it and from the thread id, which verifies for
that one thread and cannot be turned back into the app key, and the CLI presents
it as `x-patcher-thread-key` beside the `x-patcher-thread-id` it always sent. No
thread identity means a person at their own terminal, and that behaves as it
always did — but an agent cannot become that person by dropping the header,
because the key verifies against the id and a request with neither identifies
as nothing, which is refused. A verified thread means an agent mid-turn, and
`enable`, `disable`, `install`, `update`, `remove` and a settings write each
raise a prompt in that thread — the plugin's name, its declared permissions, its
declared sites — and block on the answer for up to four minutes. The change
happens only if you allow it.

## An agent cannot reach the routes that would undo its sandbox

A thread key is a narrower credential than the app key, so the server can charge
it a policy. These route families are refused outright for a caller that is an
agent mid-turn, because each one hands back exactly what the sandbox took away:

- **File mutation** — `files/write`, `mkdir`, `move`, `remove`. `rootPath` is
  optional on these, and without it the daemon writes wherever it is told, on
  whichever machine the request names. A sandbox that confines writes to the
  workspace means nothing beside a write-anywhere RPC.
- **Terminals.** Opening one is a PTY on the host, outside any sandbox, running
  as you.
- **A machine's permission ceiling, machine enrolment, and provider-CLI
  installs.** Raising the ceiling is how a sandboxed turn would arrange to stop
  being one; an install runs an installer on the host, outside the sandbox, as
  you.
- **Allowing its own permission prompt.** A turn that can resolve its own
  approval interaction can approve its own unsandboxed retry, and the timeline
  then records you as having allowed it. Refused in the interactions handler
  rather than by route, so that denying, answering a question, and a plugin's
  form submit all keep working from inside a turn — only _allowing_ does not.

Generic reads are not on the list: an agent reads files through its own tools
anyway, so gating `files/read` would gate the polite path and nothing else. The
one read that did matter is closed a layer down instead — see below.

**The app key file is denied to a sandboxed turn.** Not handing the key over
would mean little while the file sat there to be read: a sandbox restricts
writes and the network and leaves reads open, and Bash is auto-approved
_because_ it is sandboxed, so one `cat` would have handed the turn back the
credential it is deliberately not given, without a prompt. Claude Code's
sandbox can protect a path, so Patcher names five: the app key, the machine
auth secret, this daemon's own bearer token (`auth.json`, which `/internal/*`
accepts and which the `/api/v1` route policy therefore never sees), and the
database with its write-ahead sidecars — the database because it holds host
keys, plugin storage and every other thread. A read of one is refused inside
the sandbox, and the only way onward is running the command unsandboxed, which
is a permission request the person in the thread sees and an escalation-denied
turn has refused for it.

**And the daemon refuses to serve those same files at all.** The sandbox deny
covers a read from inside the sandbox; the host file RPC is a second way to the
same bytes, and it is the _daemon_ that reads — `rootPath` is optional and
`files/read` is deliberately reachable by an agent. So the refusal also lives at
the daemon, for every caller, in
`command-handlers/daemon-credential-paths.ts`. Nothing legitimate reads
Patcher's own credentials back through Patcher's own file API.

Two edges remain, and they are edges rather than the default:

- **Codex.** Its sandbox leaves reads open with nothing to say otherwise, so a
  Codex turn can still read these files. Closing it needs a boundary Patcher
  owns rather than one its provider offers.
- **Full Access.** It builds no sandbox, so there is nowhere for the denial to
  live. That is what the mode means.

Per-plugin secrets under the data directory's `plugins` are deliberately not
denied wholesale: that directory also holds installed plugin code an agent has
reason to read.

### What this does not yet close

Named here rather than left to be rediscovered:

- **Another thread.** The thread key proves _which_ thread is calling, but the
  server does not compare that with the `:id` a request acts on, so an agent can
  drive another thread — including one running at Full Access. Narrowing it
  would take away `patcher thread spawn`, which agents are meant to have.
- **Choosing the next turn's sandbox.** `permissionMode` on thread
  create/send/fork is bounded only by the machine ceiling, and
  `workspace: { type: "unmanaged", path }` decides where the next turn's
  workspace — and so its sandbox — points. A managed worktree also runs the
  repository's own `.patcher-env-setup.sh`, outside any sandbox.
- **A machine enrolled before this release.** The sandbox ceiling is written when
  a machine is enrolled; there is no migration, so an existing install's
  machines stay at `full` until their owner lowers the limit.
- **Plugin code.** `plugins/:id/cli` and `plugins/:id/rpc/:method` execute
  plugin code with no consent prompt, unlike the install/enable/settings routes
  beside them.
- **The daemon's own loopback API.** It has no credential check at all, and a
  turn is handed its port.
- **`.git` is inside the agent's writable roots.** Patcher's git runs with a
  hardened config (see `GIT_HARDENED_CONFIG`), but `filter.<driver>.smudge` is
  looked up by a name a tracked `.gitattributes` chooses, so no fixed list can
  pre-empt it. The durable fix is keeping `.git` out of those roots.

Every outcome where nobody could have seen the prompt refuses, because a prompt
nobody saw is not consent: an archived or destroying thread is refused before a
prompt is raised, an unknown thread or one already holding a question is a
`409`, a refusal or a timeout is a `403`.

## The browser runs your real sessions

Browsing happens in a persistent Chromium session with your real cookies and
logins. A plugin that declares a site and registers a page script runs on that
site while you are signed in to it. That is what makes plugins useful and it is
also the whole risk: read the site list on the consent prompt, not just the
permission list.

Popups are real windows for the browser surface's tabs, which is what makes
"Sign in with…" flows work — see
[browser-surface.md](architecture/browser-surface.md) for the popup policy and
the rate limiter that survived that change.

**Being the browser is a claim, and a plugin cannot make it.** One `/ws`
message says "this socket is the browser window", and whoever holds that role
answers every browser command the server routes — the agent's tools and every
plugin's `patcher.browser` call alike, which means reading the urls, the
`evaluate` sources and the cookie values on their way into the session, and
deciding what the model is told the page said. So it is gated the way the
subscription beside it is: a socket carrying a plugin's identity is refused,
because a plugin _makes_ those calls and is charged the permission for them
rather than answering them. A claim also no longer displaces a live one — the
window that claimed first keeps the role, and only that window takes it back,
by presenting again the id it registered with. What is left is what the section
below is about: a local process holding the app key is not a plugin as far as
this gate can see, so it can still claim the role while no window holds it.

## The local API takes a key, and the key is only as private as your disk

Every request to `/api/v1` and every `/ws` socket has to say who it is. A plugin
signs with its own per-run key and is charged the permissions it declared; every
other local client — the app, the CLI, the launcher, the QA harness — presents
the key in `app-api-key` in your data directory, written `0600` when the server
first starts. A request carrying neither is refused.

Two routes stay open to an unidentified caller, on purpose: a plugin's own
`/api/v1/plugins/<id>/http/...` routes, which exist so a webhook can call a
plugin and which carry their own `auth` mode, and its frontend assets, which
your browser loads with no headers at all.

`PATCHER_APP_KEY` overrides the file, which is how a shell, a container, or a
desktop pointed at a remote server is given a key it cannot read from disk.

The key never goes on a command line. The desktop shell hands it to its own
window in the URL it navigates to, and the app takes it out of `location`
before anything else reads it — a launch argument would have arrived sooner and
would also be visible in `ps` to every process running as you, which is the
same reason a plugin's key travels in a message rather than in argv. Open a
plain browser at `<server>/?appKey=<key>` once and it is remembered for that
tab; the server will not hand it to a caller that has not already got it,
because a plugin is such a caller.

**A plugin can read that file.** Its process is not sandboxed and runs as you,
so the key the CLI reads is a key it can read. What the gate buys is that
skipping the permission map is no longer _free_ — there is no unidentified
caller left to imitate, so going around it means going around Patcher
altogether. Closing the rest needs the sandbox described in the first section.

The server still binds to loopback by default. Direct tailnet or LAN access to
port `38986` requires the explicit `--server-bind-host 0.0.0.0` option and a
trusted network boundary in front of it; the app key is a local-client check,
not a substitute for one. For remote access, publish the loopback listener with
Tailscale Serve instead — see
[`packages/patcher-app/README.md`](../packages/patcher-app/README.md#configuration).

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
