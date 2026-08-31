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
- **A machine's permission ceiling, machine enrolment, and provider-CLI
  installs.** Raising the ceiling is how a sandboxed turn would arrange to stop
  being one; an install runs an installer on the host, outside the sandbox, as
  you.
- **Allowing its own permission prompt.** A turn that can resolve its own
  approval interaction can approve its own unsandboxed retry, and the timeline
  then records you as having allowed it. Refused in the interactions handler
  rather than by route, so that denying, answering a question, and a plugin's
  form submit all keep working from inside a turn — only _allowing_ does not.

Terminals were on this list, and the reason was true: opening one is a PTY on
the host, outside any sandbox, running as you — the shortest way out there was.
They came off it when the terminal changed rather than the judgement, which is
its own section below.

Generic reads are not on the list: an agent reads files through its own tools
anyway, so gating `files/read` would gate the polite path and nothing else. The
one read that did matter is closed a layer down instead — see below.

**The app key file is denied to a sandboxed turn.** Not handing the key over
would mean little while the file sat there to be read: a sandbox restricts
writes and the network and leaves reads open, and Bash is auto-approved
_because_ it is sandboxed, so one `cat` would have handed the turn back the
credential it is deliberately not given, without a prompt. Both sandboxing
providers can protect a path, so Patcher names five: the app key, the machine
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

**The files that decide what git executes are denied as well.** `.git` sits
inside the workspace, so the workspace being writable is what made `.git/config`
writable — and git reads that config in the daemon, outside the sandbox, as you.
`GIT_HARDENED_CONFIG` narrows which keys are reachable and cannot close the
class: `filter.<driver>.smudge` is looked up by a name a tracked `.gitattributes`
chooses. So a sandboxed Claude Code turn now has `.git/config`,
`.git/config.worktree`, `.git/hooks` and `.git/info/attributes` denied, together
with the `.git` pointer file of a worktree or a `--separate-git-dir` checkout,
which would otherwise aim git at a gitdir the turn owns outright.
`resolveProtectedRepositoryPaths` in @patcher/host-workspace is the list.

Narrow rather than all of `.git`, and that is measured rather than assumed:
denying the whole directory takes `git add` with it, because `index.lock` is
inside, so a sandboxed turn could no longer commit its own work — and a more
specific `allowWrite` does not win the deny back. `.git/modules` and
`.git/worktrees` stay writable for the same reason from the other side. Config
planted under either runs only for a git process that recurses into it, which
Patcher's plumbing never does, while denying them would take `git submodule
update` and `git worktree add` from every sandboxed turn.

The deny holds for the agent's own Write tool as well as for Bash, and it holds
through symlink, hardlink, `cp`/`tar`/`rsync` and rename indirection — measured
attempt by attempt against a live session. Where Bash gets a plain "operation not
permitted", the Write tool raises a permission request instead, so on a turn
whose escalation is _ask_ the person in the thread decides; a turn whose
escalation is denied is refused outright.

**A terminal an agent opens runs inside its turn's boundary.** This one is a
sandbox Patcher builds rather than one a provider offers, which is what makes it
the same for every provider — a Pi or ACP turn, whose own tools are confined by
nothing, still gets a confined terminal. The policy is the turn's own, path for
path: the workspace and the git roots beside it are writable, the four
git-execution files are read-only, and Patcher's credential files cannot be
read. macOS composes it from Seatbelt, Linux from bubblewrap, and a machine that
can build neither is refused the terminal rather than handed an unconfined one —
the same answer a sandboxed Claude turn already gets there.

Measured on both backends, not asserted: a login shell on a real PTY under the
macOS profile, and `bwrap` in a Linux container, each writing inside the
workspace and refused outside it, reading `.git/config` and refused a write to
it, committing through `.git/index`, and refused the credential file — "Operation
not permitted" under Seatbelt, "Permission denied" under the `/dev/null` bind
that replaces the file on Linux. The paths are resolved through `realpath`
before they are named, because both backends match what a lookup resolves to,
and a rule about `/var/folders/...` is a rule about nothing on a machine where
that is a symlink.

The terminal websocket is not part of this: it takes the app key or a plugin
holding `shell`, and a turn holds neither — so an agent reads and writes its
terminal through the HTTP routes, which are the ones scoped below.

Whose terminal it is, is the other half. A turn drives the terminals of its own
thread and of the threads it spawned, and only the confined ones: a terminal a
person opened for the same thread is refused it, because that shell is theirs
and runs outside the boundary. A restart keeps the confinement of the terminal
it replaces, whoever asks for it — otherwise "please restart my terminal" would
be a way out of the turn. The row records which kind it is, and `patcher
terminal list` prints it.

**The network is not confined, and that is a decision.** A blocked connection in
a terminal has nowhere to raise a prompt — there is no permission request for a
shell somebody is typing into — so confining it would turn `npm install` and
`git push` into silent failures. What the boundary closes is the filesystem
class, which is what made the route a hole.

**And the repository's own setup script asks before it runs.** A managed
worktree runs `.patcher-env-setup.sh` from the repository it was created from —
`env bash`, on the host, outside every sandbox, as you. The script is a tracked
file, so it is something an agent can commit, and the thing that runs it is not
the agent's turn but Patcher's own provisioning. Narrowing who may ask for a
worktree would not close it either: the person who creates one by hand after an
agent's commit runs the same script.

So the question is asked about the script's content. The daemon hashes the
script it has actually checked out and holds its request open while the person
in the thread answers; an allow is remembered against the project and that
hash, so later worktrees from the same repository ask nothing until the script
changes. Every outcome that is not an allow — a decline, four minutes of
silence, a thread that cannot show a prompt, a machine with no server to ask
through — leaves the script unrun and says which it was in the provisioning
transcript. Provisioning itself still succeeds: the worktree is what was asked
for, and only the script was in question.

**What the hash does not cover.** It is the hash of that one file. A setup
script whose body is `make setup` or `bash scripts/bootstrap.sh` never changes,
while the Makefile or the script it calls — tracked files an agent can write
just as easily — decide what actually runs. So one allow of an indirecting
script is a standing channel, and "the script changed" is a weaker statement
than "what it runs changed". Closing that needs a boundary around the run
rather than a fact about the file, which is the same answer the rest of this
section keeps arriving at.

**A Codex turn is held to the same list, through a policy of its own shape.**
Codex's older `workspace-write` says only which roots are writable, and could
not say "not this path inside them" — so this section used to end at Claude
Code. Its permission profiles can: `filesystem` maps a path to `read`, `write`
or `deny`, and Patcher builds one per thread in
`codex/permission-profile.ts`. The credential files are `deny` and the git
execution files are `read`, and the difference is not decoration — Codex's
`deny` is a level rather than a verb, so it takes the read with the write, and
a denied `.git/config` stops git from running at all.

The shape of it is measured, against codex-cli 0.150.1 and then against a live
turn built by Patcher's own adapter: a `cat` of the app key through a symlink
inside the workspace answers "Operation not permitted", `.git/config` still
reads and no longer takes a write, and `git commit` works. That last one is new
rather than preserved. Codex excludes `.git` from the workspace grant by itself,
in every sandbox mode, so a Codex turn in a plain checkout could not stage its
own work — `git add` failed on `index.lock` — and only a managed worktree
escaped it, because its gitdir lives outside the workspace and Patcher grants
that as a writable root. The profile grants `.git` back and marks the four
files inside it read-only, which is both halves at once.

Two things about the profile are load-bearing and easy to undo by accident.
`thread/start`'s own `sandbox` field and a turn's `sandboxPolicy` each switch
the profile off — `activePermissionProfile` comes back null and the grants
revert — so a workspace turn sends neither, and the tests assert their absence.
And `sandbox_mode` travels in the same config map as a floor: an unknown config
key is not an error, so a Codex that did not understand `default_permissions`
would otherwise fall back to whatever the machine's own `config.toml` says,
which may well be `danger-full-access`.

One edge remains, and it is an edge rather than the default:

- **Full Access.** It builds no sandbox, so there is nowhere for the denial to
  live. That is what the mode means.

Per-plugin secrets under the data directory's `plugins` are deliberately not
denied wholesale: that directory also holds installed plugin code an agent has
reason to read.

### The daemon's loopback API takes a key of its own

The daemon on your machine serves a small HTTP API on loopback, and one route on
it runs something: `POST /open-in-target`, an `execFile` that opens a path in
your editor, on the host, outside the sandbox of whatever turn is running. An
agent mid-turn is handed that port in its environment and its sandbox permits
loopback, so the route needs a credential, and CORS is not one — it is a browser
control and does nothing to a `curl`.

It used to take the app key, and that was the wrong credential in both
directions at once. A machine enrolled from another one has no `app-api-key`
file — nothing writes one into its data dir — so the app was refused on exactly
the machine it was running on, and opening a file in an editor was simply
broken there. And the key _is_ a file, so the closing paragraphs above only
reach the turns whose provider can deny a path: a Full Access turn, or one on Pi
or ACP, could read it and present it.

So the daemon mints its own, 32 random bytes per process, and writes it nowhere.
It travels to the server when the daemon opens its session
(`localApiKey` on `POST /internal/session/open`, which is what
`HOST_DAEMON_PROTOCOL_VERSION` 112 is for), the server keeps it in memory for as
long as that session lives, and the app reads it back through
`GET /api/v1/host-daemon-keys/:hostId` — the server it is already talking to
being the only party that has it. A restarted daemon mints a new one, so a 401
makes the app refetch once rather than ask you to reload.

Three things follow, and they are the point of the change rather than side
effects. A machine with no app key works. There is no file for a turn to read,
whatever its provider allows — the credential exists only in two processes'
memory. And the read that hands it over is the one read on the whole API an
agent mid-turn is refused: reads are otherwise left open on purpose, because an
agent reads through its own tools anyway, but this one answers with a way out of
the turn rather than with information about it, so `agent-route-policy.ts` names
it. The path is its own family rather than a sub-route of `/hosts` for the same
reason from the plugin side: a plugin's reach is a path→permission map, `/hosts`
costs `workspace`, and this path is entered in that map as `null` — never a
plugin's to call, at any price, rather than left unclassified and refused by
accident.

`/status`, `/health` and the editor list stay open to any caller on loopback,
as before: every readiness probe reads the first two — the launcher,
`install-machine.sh`, the SDK's local-host lookup, the app's reachability
check, the dev restart — and none of the three has a side effect.

### What this does not yet close

Named here rather than left to be rediscovered:

- ~~**Another thread.**~~ Closed: the thread key proves which thread is calling,
  and `agent-thread-scope.ts` now compares that with the `:id` the request acts
  on. A turn may act on its own thread and on the ones it spawned — delegation
  is what `patcher thread spawn` is for, and a grandchild is the same
  relationship one link further — and anything else is refused. Reads are not
  scoped: learning what another thread says is a smaller thing than making it
  act, and the app's own views are built from those routes.
- ~~**Asking for a more privileged turn.**~~ Closed: a requested
  `permissionMode` is now bounded by the asking turn's own mode as well as by
  the machine's ceiling, so a turn cannot arrange more privilege than it has —
  for a thread it spawns or for its own next turn. The bound is applied in
  `clampPermissionModeToHost`, and every path that resolves a turn's options
  has to name who asked, so a new one cannot inherit "nobody" by leaving it out.
- **Choosing where the next turn's workspace points.** Still open, and a
  decision rather than an oversight: `workspace: { type: "unmanaged", path }`
  takes any path the collision checks allow, so a turn can ask for the next
  one's workspace to be `/` — and a sandbox whose writable root is `/` bounds
  nothing, even at the mode it was clamped to. Binding the path to the
  project's own sources is the shape that would close it. A managed worktree
  also runs the repository's own `.patcher-env-setup.sh` outside any sandbox,
  though that now asks first — see above.
- ~~**A machine enrolled before this release.**~~ Closed: migration `0095`
  lowers every machine still at `full` to the sandbox ceiling, so the default
  reaches installs that already exist. A machine whose owner wanted Full Access
  says so on its next turn, with a message naming the limit and whose it is to
  change — the reversible direction, since the other one leaves the sandbox off
  in silence.
- **A plugin can answer a consent prompt.** The self-approval gate on
  `interactions/:id/respond` is the declared-thread header, which an agent's
  `patcher` sends and a plugin does not: a plugin authenticates with its own
  id and key, and `/threads/*` maps to the `threads` permission. So a plugin
  holding it can allow a prompt raised for somebody else, and the timeline
  records the user as having allowed it. That was true before the setup-script
  consent existed — a plugin could allow another plugin's install, which also
  runs unsandboxed code — but this widens what one click of it buys. Closing it
  needs the caller's identity at that route rather than the absence of a header.
- **A remembered setup-script allow is keyed to a project, not a repository.**
  `project_sources.path` is mutable through a route no policy denies an agent,
  and nothing invalidates an approval when a source is repointed: a repository
  with a byte-identical script inherits the allow. The key carries no host
  either, so a project spanning two machines is allowed on both by one answer,
  and there is no list, revoke or expiry — only deleting the project forgets it.
- **Nobody to ask.** A scheduled automation or a delegated child thread
  provisions a worktree on a thread no one is watching, so the prompt times out
  and the script is skipped — every run, because a timeout is deliberately not
  remembered. The answer is allowing ahead of time rather than in the four
  minutes the prompt stands, which is a surface that does not exist yet.
- **A terminal's network.** Named above and repeated here because it is the
  shape of what is left: an agent's terminal is confined on the filesystem and
  not on the network, so `curl` inside one reaches whatever the machine can. It
  is no wider than the turn's own shell under Codex, which also has the network,
  and narrower than what the route gave before — but it is not nothing, and the
  answer is the same one the rest of this section keeps arriving at.
- **The app does not say which terminals are confined.** The row records it and
  the API returns it; `patcher terminal list` has a column for it and the app's
  terminal tabs do not. Somebody typing into an agent's terminal in the app
  meets "operation not permitted" with nothing on screen explaining why.
- **Plugin code, by decision rather than by omission.** `plugins/:id/cli` and
  `plugins/:id/rpc/:method` execute plugin code with no consent prompt, and
  that is the model rather than a gap in it: the grant happens at install and
  enable, which _are_ gated for an agent, and invoking a plugin command is
  using what was granted. What follows from that is worth saying plainly — a
  plugin is an unsandboxed process running as you, so enabling one is trusting
  its code with everything this document describes, and an agent that can call
  it inherits that trust for the arguments it passes. A prompt per invocation
  would put the question where the answer cannot be informed by anything the
  install prompt did not already say.
- **The daemon's own loopback API.** Narrowed again, and now narrow enough to
  say what is left in one sentence: the credential is the daemon's own and lives
  only in memory (see above), so what remains is that _asking the server for it_
  needs the app key — and a caller that is not confined can still read that file
  off disk. A Full Access turn, a turn on Pi or ACP, and any plugin process can
  therefore reach `/host-daemon-keys/:hostId` as the app and go on to open an
  editor. For a sandboxed turn both halves are closed: it cannot read the app
  key, and its thread key is refused on that route by name. Closing the rest is
  the same shape as everything else here — a boundary Patcher owns for the two
  providers that have none, and there is no version of it where an unsandboxed
  process running as you is held to a credential check.
- **`.git` and the credential files, for a turn that is Pi's or ACP's.**
  Narrowed, not closed. Claude Code and Codex both hold the list now, each
  through its own sandbox; Pi and ACP build no OS sandbox at all, so for them
  the class stands as it did. The answer for those two is the one this section
  keeps arriving at — a boundary Patcher owns rather than one a provider offers.
- **Codex's network is open, and it is the local API that keeps it open.**
  Restricting it is one field in the profile, and Codex 0.150.1 now turns a
  blocked connection into an approval request rather than a silent failure — so
  the cost is no longer "the command dies with nothing to grant it back". The
  cost that remains is the `patcher` CLI: it reaches the local server over a
  loopback TCP port, and Codex's restricted mode takes loopback with it, so
  every CLI call inside a turn would become a prompt. Taking the local API off
  a TCP port comes first — a unix socket, which Codex can be told to allow, or
  the tool surface as an MCP server, which the app-server runs outside the
  command sandbox the way Claude Code's bridge already is.

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

`PATCHER_APP_KEY` overrides the file, which is how a container, a host daemon on
another machine from the server, or a desktop pointed at a remote server is
given a key it cannot read from disk. A turn's processes are not among them:
they get a thread-scoped key instead, and the section above says what that does
and does not buy.

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
