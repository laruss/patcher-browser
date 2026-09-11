# The browser, and agents that are not Patcher's

`patcher browser` drives the user's real, signed-in browsing session. Until this
landed, the only thing standing in front of it was the `browser-tools` plugin
toggle — and that toggle answers a question about *Patcher's own agents*, while
the command it gates can be run by anything on the machine.

This document is about the other caller: Claude Code, Codex, a script, a person
at their own terminal. What they now have to get through, what they get when they
do, and — the part worth reading before the rest — what this does not close.

## The hole, stated plainly

Three facts, each fine on its own:

- **`patcher browser` executes in the server process**, as a plugin CLI command
  proxied over `POST /api/v1/plugins/browser-tools/cli`
  ([agent-browser-tools.md](agent-browser-tools.md) explains why the CLI exists
  at all).
- **Every local client presents the app key**, a `0600` file in the data
  directory that any process running as the user can read
  ([security.md](../security.md)).
- **A turn presents something narrower** — a thread credential derived for its
  thread, which is what lets `plugin-consent.ts` raise a prompt when an agent
  asks to enable a plugin.

Put together: an agent *inside* Patcher asking to turn the browser on raises a
question in its thread, and an agent *outside* Patcher — with no thread to
declare — was treated as the app and asked nobody. It read the key file, enabled
the plugin without a prompt, and drove the browser. Measured on 2026-09-05: a
foreign shell reached `patcher plugin enable browser-tools` with no interaction
of any kind.

So the gate an agent could not walk around was, for the caller most likely to
walk around it, the one that was not there.

## What was built

### A level, not a switch

`browserExternalAccess` in `appSettingsSchema`, `off` by default:

| Level      | What a caller outside Patcher may do                                         |
| ---------- | ---------------------------------------------------------------------------- |
| `off`      | Nothing.                                                                     |
| `read`     | `tabs.read`, `page.read`, `network.observe`                                  |
| `interact` | plus `tabs.modify`, `page.interact`                                          |
| `full`     | plus `page.credentials`, `page.inject`, `network.intercept`, `page.record`   |

The levels are groups of permissions the browser commands **already** cost, so
this adds no second vocabulary: `permissionForBrowserCommand` in
`@patcher/domain` prices a command, and `browser-external-access.ts` beside it
files that price under a level. `LOWEST_LEVEL_FOR_PERMISSION` is a `Record` over
`BROWSER_COMMAND_PERMISSIONS`, so a browser permission added later does not
compile until somebody decides what it costs an outside agent — the same
property `permissionForBrowserCommand` has one layer down.

Why a ramp rather than a flag: reading the page the user is looking at and
copying the cookies for it are not the same act. One is on their screen already;
the other is a login that can leave the machine. A single "allow the browser"
would have had to price itself at the higher of the two, which means either
refusing the common case or granting the rare one by default. That is the same
argument `patcher.sites` makes about *where* a plugin reaches, applied to *how
far*.

### The gate is the host's, and it is per command

Two pieces, and the split matters:

- **`routes/plugins.ts`** establishes an `AsyncLocalStorage` scope on
  `POST /plugins/:id/cli` when the request resolves to no thread.
- **`services/browser/browser-bridge.ts`** — the one funnel every server-side
  browser command passes through — asks `browserExternalAccessRefusal` before it
  sends anything.

An ambient scope rather than a parameter, because the two ends are far apart: the
route knows the caller, and the command is built forty call sites away inside
plugin code. Threading a parameter through `patcher.browser`'s surface would put
the gate in the plugin SDK, where a plugin could decline to pass it. The scope
keeps the decision on the host's side of the boundary, which is the same position
`plugin-host-call-server.ts` takes about permissions generally.

Charged **before the send**, so a refusal means the page was never touched — and
the message is allowed to say "Nothing happened", which is the thing a caller
actually needs to know.

Three details worth keeping:

- **The verified thread id decides, not the header beside it.** `declaresThread`
  reads `x-patcher-thread-id`, which any holder of the app key can write; the
  middleware's resolved id has been checked against a credential. Keying the
  exemption on the header would have made the header the thing to forge.
- **Only the plugin CLI route is scoped.** The app invokes plugin rpc and http
  routes with the same credential and no thread, so scoping those would refuse a
  plugin toolbar action the user just clicked. Nothing the user is looking at is
  a caller from outside Patcher.
- **`patcher browser status` had to change.** It read `getStatus()`, which is a
  local snapshot and never leaves the process, so it happily reported a connected
  window to a caller that may not touch it. It now reads the refusal off the tab
  list it already asks for, and exits non-zero — "a window is up" and "I may use
  it" stopped being the same question.

### Its own route, because of who may ask

`POST /api/v1/browser/external-access`, carrying the same consent gate a plugin
change carries.

A field on `PUT /settings/general` would have been simpler and would not have
worked. Every route under `/settings` is refused to a turn by
`agent-route-policy.ts`, deliberately, so that the next setting is closed on
arrival — and the one thing an agent inside Patcher legitimately wants here is to
**ask**, which needs a prompt rather than a write. So this is a route with a
question on it, not a hole in that rule: no thread declared behaves as it always
has, a declared thread raises a prompt naming the level and what it allows, and
nothing is written unless the user says yes.

It also enables `browser-tools` — **but only when nobody is being asked**, and
that asymmetry is the thing review caught. A person choosing a level in Settings,
or at their own terminal, plainly means both, because a level with nothing
serving it is a setting that silently does nothing. A *turn* asking is a
different question with a different beneficiary: the prompt describes what agents
outside Patcher may do and says in as many words that this thread is unaffected,
while enabling the plugin hands **that thread** everything the plugin declares —
cookies, recording, interception. Measured on 2026-09-05: a turn refused
`cookie-list` before the prompt ran it afterwards, having asked for "Read pages".
A user who would decline the plugin's own prompt can plausibly accept that one.

So a turn's approval writes the level and stops, and the reply says the plugin is
not serving. `patcher plugin enable browser-tools` is the honest second question,
and it already exists with a prompt that lists what it really grants. Two grants,
two questions.

The reverse is deliberately not true either way: turning the level back to `off`
leaves the plugin alone, since threads inside Patcher use it too and nobody asked
about those.

In the plugin permission map the route is `null` — classified, and refused to
every plugin at any price. A plugin's call carries no thread, so it would raise
no prompt; there is no permission that should let one widen this.

### The road to it

A gate is no use to a caller that cannot find the command. Measured from a shell
with no `PATCHER_*` in its environment, there were four steps and help on none:

| Step                  | What it did                                    | What it does now                                                  |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Find the binary       | `which patcher` → nothing                      | The daemon writes `<dataDir>/bin/patcher` at startup              |
| Find the server       | already good                                   | unchanged                                                          |
| Get past the 401      | already good — names both env vars and the file | unchanged                                                          |
| `patcher browser`     | `unknown command 'browser'`                    | names the plugins that are off, and how to look at one            |

The shim is a short `sh` script that `exec`s the real binary. Not a copy, which
goes stale on the next upgrade; not a symlink, because `import.meta.url` is
symlink-resolved and `argv[1]` is not, and this repository has already lost a
release script to exactly that disagreement. It is **not** a PATH entry: writing
into somebody's shell rc file is not this program's business, so the line is
shown rather than written — and an agent handed the absolute path needs no PATH
at all, which is the case it exists for.

**It also carries the install it belongs to, and the first version did not.** A
shim that only `exec`s hands the CLI whatever environment the caller had, which
for an outside agent is nothing — so the CLI falls back to `127.0.0.1:38986` and
`~/.patcher`. On a source checkout, whose port is derived from the checkout path,
that is a different install, and the command reports "Patcher is not running"
while Patcher is running. Review found it on 2026-09-05; it had been invisible
because every by-hand check of this feature exported `PATCHER_SERVER_URL` and
`PATCHER_DATA_DIR` itself, so the tests and the measurements were both blind to
the case they existed for. The shim now exports the server URL, the data
directory and the daemon port — each deferring to a value the caller already set,
so pointing a shell at another install still works — and deliberately **not** the
app key, which stays a `0600` file the CLI reads for itself.

Which also settles what the skill can say. `~/.patcher/bin/patcher` is not a
universal path: it moves with `PATCHER_DATA_DIR` and it is `~/.patcher-dev/…` in
a checkout. So the skill carries a one-line `ls` over both, and says that more
than one answer means more than one install rather than picking.

`unknown command 'browser'` deserves its own note, because the fix is smaller
than the obvious one. `browser-tools` provides `patcher browser`, and the CLI's
lookup matched the unknown command against plugin **ids**. Making it match the
command name is not possible: a disabled plugin's factory never ran, so it has
registered no CLI command and *the server does not know the name either*. So the
message answers the question it can — which plugins are off, and that a plugin's
command is served only while its plugin is enabled.

### And the skill

`patcher-browser` now installs to `~/.agents/skills` and `~/.claude/skills`
alongside `patcher-cli`, because the browser is the one capability an outside
agent cannot discover for itself: not in its tool list, behind a plugin, gated by
a setting nothing else mentions.

Its first question changed with it. It used to be "check whether your tools
include one that lists tabs", which is the right question for a thread and
meaningless for a terminal. It is now "are you a thread inside Patcher, or a
terminal beside it", because **the two cases have different gates** — the plugin
toggle and this setting — and sending somebody to change the wrong one costs them
a round trip and the user an interruption.

`bb-cli` was removed at daemon startup rather than only on a skills install, for
the same reason it was removed at all: it lives outside the data directory, so
the rename never reached it, and it tells agents to run a binary this fork does
not ship.

### Advice a level can afford

**No refusal recommends work the caller's level forbids.** It is one sentence and
it was broken in five places, because the level that exists to read pages cannot
reach a page on its own: every page read resolves a tab first, a caller outside
Patcher has no default tab but its own, and getting one of its own costs
`tabs.modify` — which starts at `interact`. So the window's answer for want of a
tab ended by telling a `read` caller to open one, and `patcher browser open` then
told it the level does not allow that. Measured against the packaged
0.1.1-alpha.4 and reproduced in `tab-ownership.test.ts` (#120).

The route that level *does* have arrived with #116 and #117 and is what the
sentences now name: **naming one of the person's tabs is what asks them for it**,
and they can hand it over or lend a look at it — reading answers on a lent tab,
and `tabs.release` gives it back at `tabs.read`, so the lending is not one-way.
Measured: with a `read` grant, naming the person's tab raises the ask, and the
lent tab then reads.

**Except where naming a tab is the answer rather than the ask.** A tab's address
and its title are priced `tabs.read`, which `resolveTab` lets past for any named
tab because the listing hands both over to every caller anyway (#116) — so those
two get a sentence that says to name one, and no sentence about consent. Getting
that wrong would have been #116's own defect one case over: a refusal describing
a row that never appears on the person's screen. The first review pass of #120
caught it.

Two of the five have no route to name — nothing open, or a tab that is another
agent's, which the person can take back but has no way to hand on — and those say
that nothing happened and who to ask, rather than inventing one.

What made this decidable in the window is the level on the issuer, which is the
one field `outside` carries. Asked of the **permission** rather than of the
level's name (`browserExternalAccessAllows(level, "tabs.modify")`), so a rung
inserted between `read` and `interact` answers it correctly without being
remembered in the window.

Not fixed here, and deliberately: whether that rung should exist (#128). The
advice was wrong either way — a plain `read` grant still cannot open a tab — and
what the rung would add is an agent that chooses which logged-in page it reads,
which is the line between `read` and `interact` rather than a detail of it.

## The credential, which is what makes it a boundary

Everything above decides what an agent outside Patcher may do. The section below
used to open by saying the same caller could rewrite that decision, because it
holds the app key — a `0600` file any process running as the user can read, which
opens threads, terminals, the file RPC and the settings. So the level was a
default rather than a boundary, and the honest way to describe it was "opening
the browser is the user's act", not "the browser is shut".

A **browser access grant** is the fourth caller identity, beside a plugin
(`plugin-api-identity.ts`), a turn (`thread-identity.ts`) and the app
(`app-identity.ts`).

### Derived, so nothing stores it

`pa1.<grantId>.<HMAC(appKey, "patcher-agent-access:v1:" + grantId)>`, the same
construction a thread credential uses one module over (`agent-access-key.ts` in
`@patcher/config`). The server needs no table of live keys and has none to leak:
given the id in the credential it re-derives what the credential must be and
compares in constant time. Losing the app key file rotates every grant at once,
which is the correct behaviour for a key derived from it.

The id rides in the clear, unlike the terminal id in `thread-api-key.ts`, which
is base64url'd because it comes from elsewhere and has no charset anything pins.
A grant id is minted by `createBrowserAccessGrantId` from an alphabet with no `.`
in it, so it survives the split unencoded and stays legible — a person reading a
config file can see which grant they are looking at and go revoke it. It is
inside the MAC as well, so it cannot be moved onto a grant with a level somebody
would rather have.

### Its lifetime is a row, not a deadline

Accepted while the grant exists, `revokedAt` is null and `pausedAt` is null. That
is the property a stamped expiry could not have given: the agent keeps the
*string* forever — it is in its MCP config — and what stops it is a person
clicking, after which the very next request is refused. Nothing to expire,
nothing to refresh, nothing an agent can extend for itself. It is the same shape
a terminal credential's lifetime has, chosen for the same reason.

**Two ways to stop, because they are two different decisions.** Revoking ends a
credential somebody should not hold any more. Pausing is what a person does while
*watching* an agent do the wrong thing: the browser comes back now, the
credential stays valid, and resuming is one click rather than a new grant and a
re-run of `claude mcp add` in the agent's own configuration. The refusals say
which of the two happened, because "ask them to resume it" and "ask them for a
new one" are different instructions and a holder told the wrong one wastes a
person's time. A revoked grant cannot be paused or resumed — the route answers
409 rather than pretending — because revoking is the decision with no undo.

Revoked rather than deleted, so the list can say what was taken back and when,
and so the id is never reissued. `lastUsedAt` is written on the way through the
request gate — including on a *refused* request, since the question it answers is
"is anything still using this" — at a minute's resolution, because a screenshot
loop is dozens of requests a second and none of them is a different answer.

### Two routes, as an allow-list

`agent-access-route-policy.ts`, and it is an allow-list where
`agent-route-policy.ts` next door is a deny list. That module argues for its own
shape and the argument inverts cleanly: there a forgotten entry is a 403 in front
of a person mid-task, and the caller is a turn the user started and is watching.
Here the caller is a program the user allowed to touch *the browser*, nothing
else was ever part of the offer, and a forgotten entry means a grant holder is
told to go use the app key it can already read.

| Route | Why |
| --- | --- |
| `GET /plugins/contributions` | Without it `patcher browser` is not a command: the CLI reads the plugin CLI table before it can route the argv. |
| `POST /plugins/browser-tools/cli` | The command. Spelled with the plugin id rather than `/plugins/:id/cli`, because that route runs plugin code — a plugin with `shell` or `files` and a command of its own would otherwise be reachable with a credential issued for the browser. |

`GET /plugins` is deliberately out, though the CLI asks for it when a command is
unknown: it answers with every installed plugin's metadata, and the case it
serves cannot arise for a grant holder, since issuing a grant turns
`browser-tools` on. `/ws` and `/ws/terminals/:id` are not under `/api/v1` and
take the app key or a plugin's header pair on their own, so a grant is refused
there where any unidentified caller is — measured, because an upgrade is a
different code path from a request.

### Its level is its own, and that is the reverse of the scope's sketch

The scope proposed the install-wide setting as a **ceiling** over grants. Built
that way it would have been worth nothing: to use a `read` grant you would first
have to set the level to at least `read`, which opens the browser to every
process on the machine — and then the grant closes nothing that was not already
open.

So they are independent. `browserExternalAccess` answers "how far may an outside
caller holding no credential of its own go", and a grant carries its own level.
The shape this is built for is the setting left `off` and one grant issued to the
agent that needs it. `routes/plugins.ts` picks which of the two applies from the
caller, and the refusal names whichever one the reader can actually get changed.

### Only the app and a person's own terminal can mint one

- **A turn cannot**, and this is the one place the grant route and the level
  route differ. The level route raises a consent prompt inside a turn, because
  the answer is about *other* agents and costs the asking thread nothing. This
  route answers with a credential, and a credential is not a setting: a thread
  key stops working when the turn ends and a grant does not, so a turn that could
  call it would have minted itself a browser credential that outlives its own.
  `agent-route-policy.ts` refuses the mutation; reading the list stays open,
  since a list carries labels and dates and never a credential.
- **A grant cannot**, because the allow-list admits two routes and this is not
  one of them. No self-widening, no second grant.
- **A plugin cannot**: `null` in the API path map, the same classification the
  level route has and for a stronger version of the same reason. A plugin already
  declares the browser permissions it wants and is charged those, so a plugin
  minting a grant would only ever be minting one for something that is not it.

That heading is exact rather than absolute, and the difference is the app key:
anything holding it can mint a grant with no prompt, the same way it can write
the setting. Which is the sentence under "What this does not close", said here
so the list above is not read as a boundary it is not.

### What a grant reaches that is not an API route

The allow-list is about `/api/v1`. Two things sit inside the one route it
admits, and both are `patcher browser`'s own doing:

- **Files, at paths the caller names, on the machine the *server* runs on.**
  `screenshot <path>`, `pdf`, `state-save`, `state-load`, `upload`. For an agent
  in a shell on the same machine that is nothing new — it has its own
  filesystem — but it is not "the browser", and on a remote server it is that
  machine's filesystem rather than the caller's. Review found `state-load`
  reading the file *before* the first charged command, which made it an unpriced
  existence-and-parse oracle for a caller allowed only `read`; it now charges
  first, so the refusal still means nothing happened.
- **State that belongs to the session or the origin, not to a tab.** Cookies,
  site storage and zoom, so a command naming one tab changes what another shows.
  Revocation is the same shape: it stops new commands, and a network mock or a
  recording the holder started stays until the tab is closed.

And one thing that used to sit inside it and no longer does. `install-ffmpeg`
runs Homebrew on the server's machine and sends no browser command, so the gate —
which charges browser commands — never saw it: measured on 2026-09-05, a `read`
grant ran it to completion with the install-wide level at `off`, a line away from
a `tabs` that was refused. It is now refused to every caller from outside
Patcher, at any level, because no point on a ramp about the user's *browsing
session* should admit installing software. A thread inside Patcher still has it,
gated by the plugin toggle as before, and a person at their own terminal installs
ffmpeg the way they install anything else — which the refusal says.
`browser-tools-surface.test.ts` runs every command in the plugin's own table and
fails if a new one runs to completion, so the next such command is caught rather
than discovered.

### Getting it to the agent

`patcher agent-access grant <label> [--level] [--for]`. `--for shell` prints the
two environment variables. `--for claude-code` and `--for codex` run **that
agent's own** `mcp add` — never editing their config files here, because
`~/.claude.json` is rewritten by a running Claude Code and `~/.codex/config.toml`
is a hand-kept file with comments in it that a TOML round-trip would silently
reformat. Both ship a command for this, so the safe path is also the short one;
when the binary is not on PATH the command is printed for the person to run, and
nothing is half-done because nothing was written.

One thing that path costs, said rather than hidden: the credential goes to those
commands as an argv, so it is visible in `ps` for as long as the call runs. It
is not a new exposure — the config file it lands in, and the app key file beside
it, are readable by the same processes — but it is a window that a `--env-file`
would not have, and neither vendor offers one.

The MCP server it points at is the CLI shim from the phase before
(`<dataDir>/bin/patcher mcp-serve`) — a stable absolute path that survives an
upgrade, which matters because an agent's config outlives any particular build
directory.

`patcher mcp-serve` notices the grant in its own environment and changes what it
offers: one command, `browser`, with a description that says so. Without that it
would advertise "Patcher's API commands" and then have the server refuse all but
one of them with a paragraph about credentials — which is the failure mode that
module was written against, since a model told only "no" tries the neighbour.

## The window says who is driving

> The same `issuer` decides which tabs a caller may work in, which is what keeps
> an agent outside Patcher off the page the person is reading:
> [browser-tab-ownership.md](browser-tab-ownership.md).


A gate that decides and then forgets leaves the person it was protecting with
nothing on screen. Electron draws no "a program is controlling this browser"
banner, a native `WebContentsView` cannot be decorated from the page side, and a
`patcher browser` command is indistinguishable from the user's own click — a tab
navigates, a form fills in, and nothing says who did it. So the fact travels.

**`issuer` on the command, not a second lookup.** The server knows whose request
it is answering at the route, and the socket that carries the command is forty
call sites away, so the caller rides the same `AsyncLocalStorage` shape the
access scope uses (`browser-command-issuer.ts`) and the bridge attaches it to
`browser-command-request`. Three answers — a `thread`, a `grant` with the label
and level a person gave it, and an `outside` that names nobody — and *absent*,
which is
usually the app's own browsing and must stay silent. A caller holding the app key
gets `outside` with the level it is charged and nothing else, because that is
exactly as identified as the app key is; naming it would be an invention. The
level is not a name — it is this install's own setting, decided before the
command was sent and already said back to that same caller on its CLI frame —
and the window is told because the window writes the refusals, one of which used
to advise opening a tab to a caller whose level forbids it (#120).

**It reaches exactly what the access scope reaches** — which, since the caller
crosses the plugin channel, is both kinds of plugin. Commands issued on the
caller's own async stack cover every built-in plugin, so all of
`patcher browser`; an installed plugin running in its **own process** calls back
on a channel message, in a fresh async context, and gets the caller put back
there. See "Across the plugin boundary" below for how, and for the one thing it
still does not settle.

That wire is the server → app one, which ships with the server, and the
inbound schema on the app side is lenient — so this is an optional field added to
a schema that strips what it does not name, not a break. The desktop-shell IPC
next door is the frozen one; nothing here touches it.

## Across the plugin boundary

Both halves of "who is this" — the level a caller is charged and the name the
window is shown — ride an `AsyncLocalStorage`, and neither survives a pipe. An
installed plugin runs in its own process: the host sends it a `cli` request, the
plugin's code calls `patcher.browser`, and that arrives back at the host as a
*channel message*, in an async context with nothing of the request that started
it. So for as long as that was where it stopped, a third-party plugin with
browser permissions and a CLI command of its own was a door the setting did not
close, and its commands reached the window anonymous.

**The correlation is the host's own call id.** `plugin-channel.ts` already mints
one per outbound request, and it already sends that request on the caller's async
stack — inside both scopes, when there are any. So:

1. the host records the pair under that id before the frame goes out
   (`onOutboundRequest` → `rememberBrowserCaller`);
2. the plugin's channel stamps the id it is currently serving onto anything it
   sends back, as `origin` — the same stamping on both ends, because the envelope
   is symmetric;
3. the host looks the id up and runs the whole dispatch under both scopes again
   (`runAsRememberedBrowserCaller`), then drops the record when its request
   settles — including when the plugin process dies under it.

Nothing about the caller travels. What travels is an opaque id the host issued,
and the channel passes an `origin` on **only if it names a request that channel
still has in flight** — so a settled call, an id from another channel and an
invented string are the same thing from here, and all three read as
unattributed, which is exactly the behaviour that predates this. "Another
channel" is what that check separates, and separate *plugins* only because they
are separate processes; the qualifier is under "What this does not close".

**What it deliberately does not settle.** Every id the host mints for a plugin is
visible inside that plugin's process, so *any* of its work — not only another of
its served calls, but a background service, an HTTP route, a timer — can quote
any id the host has in flight for it and be charged and named as that caller. The
in-flight check bounds which ids those are; what it cannot bound is how long a
call stays in flight, because that is the plugin answering. So a plugin can hold
a turn's agent-tool call open and act as that thread long after the turn moved
on. That is a plugin lying about its own invocations, not an outsider forging
anything, and it is not a way in: plugin code is a Node module with `node:fs`,
`child_process` and the loopback base URL
([plugin-permissions.md](plugin-permissions.md)), so a plugin that wanted the
browser uncharged has a shorter path than this one. What this closes is the case
that needed no malice at all — an honest plugin, driven from a terminal, reaching
the browser because the scope could not follow it.

**And "the caller's own async stack" still means that, on both sides.** The id is
stamped from an `AsyncLocalStorage` entered around the plugin's handler — which
reaches further than the handler's own lifetime, because Node binds the store to
async work created inside it: a promise the command started keeps the id after
the command returned, and is attributed while the host still has that call in
flight. What carries no origin is work whose *invoking* async resource was created
outside the served call — a `setInterval` started in the factory, a queue pump
ticking on its own — and any frame arriving after its call settled. The line sits
where Node draws it rather than where the code was written: a queue built in the
factory whose job the handler schedules runs under the handler and is attributed.
Uncharged and anonymous exactly as before, no malice needed, and not decidable
from the host's side — [../TODO.md](../TODO.md) carries it.

**A consequence worth expecting.** A plugin's browser commands now land in
whoever's tabs the caller owns ([browser-tab-ownership.md](browser-tab-ownership.md)),
and the two callers differ:

- one a **turn** invokes now acts as that thread. It may still use the person's
  tab and still falls back to the one in front — that is the turn row of the
  ownership table, unchanged — but it prefers a tab of its own and can no longer
  touch *another agent's*, which it previously reached both by inheriting
  whatever was active and by naming that tab's id, neither of which was checked
  while it had no issuer;
- one invoked from **outside** gets its own tabs only, and is refused the
  person's until they hand one over. That is the change with teeth: before this,
  such a plugin acted on the tab the person was looking at.

**The indicator is a row of the chrome, not an overlay.** A native view
composites above the DOM, so anything drawn over the page area is invisible in
the desktop app — the same constraint the omnibox suggestions live under. It
names the driver, says how far a grant reaches in the words the settings screen
uses, and lingers a few seconds after the last command so a burst of short
commands does not read as stopping once a second. Two agents at once is not
something this product supports yet, so it shows whoever moved last rather than a
list implying the rest is handled.

**Under the tab strip, which is what makes it the window's row rather than a
page's.** On desktop the browser surface holds the whole main area for every
route — Patcher's own screens open *in a tab* and the agent screens in the side
panel — so the page chrome below the strip (the address bar and everything with
it) is not rendered at all while a person is in Settings, on an extensions page
or in a plugin's panel. The indicator lived in that chrome and went away with
it, in a case the whole thing exists for. (A thread is *not* one of those: it
paints in the side panel, so the chrome stays mounted beside it. This sentence
said otherwise until #117; the corrected version was already in
[browser-tab-ownership.md](browser-tab-ownership.md).) The strip is the one row on screen for every desktop route, so that
is where it goes; the handover prompt stays below the address bar, because that
one *is* about the tab in front of you.

**And the fact reaches the app's other windows.** The command is sent to one
socket, because it must be performed once and answered once, so the window
serving it was the only one that learned anybody was driving — a second window
showed nothing, and the only trace was a line in the server log. The hub now
also sends a `browser-driving` signal, `started` and `settled`, to every
*other* registered browser host: the app's own windows, which is exactly the set
that registers there (a plugin is refused that registration, so the grant's
label goes nowhere it was not already going). Those windows feed it into the
same tracker their own commands would, so the linger and the handover between
two drivers have one implementation rather than two that drift, and they say
"in another window" rather than "this browser" — a window that cannot show the
tab must not send a person looking for it. Never sent to the window performing
the command, which is what keeps one window from counting a command twice.

The audience is resolved by *excluding* the performer rather than by counting
windows, and the difference is load-bearing: on the path where the serving
window's socket goes away, its registration is already out of the map, so
"fewer than two windows" would skip the settle that a still-open sibling needs
to take its indicator down.

**The `requestId` on the signal is what the window's bookkeeping is keyed on**,
and both reasons are the same shape. A window that registers — or reconnects —
part-way through a command is in the audience for that command's `settled`
without ever having heard its `started`; and *one caller* can have a command in
this window and another in a different one at the same time — this window was
the primary, its socket blipped, the next command went to the window that got
promoted while the first command carried on here. Counting per caller collapses
both cases: the stray settle ends a command that is still running, and the two
commands share one "where", so the row says "in another window" about a tab in
this one. Keyed by command, an end with no beginning is nothing to end, and each
command carries its own place.

On a reconnect the window forgets what it was *mirroring* — a settle sent while
the socket was down is never resent — while keeping what it is performing
itself, because that settles locally whatever the socket did. Clearing both
would be the same lie from the other side: no row while a tab is visibly being
driven.

**And it says what, not only who.** A name and a level say something is
driving; the line beside them says it is filling in the form the person is
looking at. It is the same rendering the caller's own trace keeps — the trace
recorder's private function moved to `@patcher/domain` and both use it, so what
a person reads in the chrome and what a trace says about that command cannot
disagree. Keys are named and their values are not: a cookie write is
`cookies-set 3`, a `localStorage` write names the items and not their contents.
Typed text *is* kept, because a record that will not say what was filled in is
not a record of what happened. Commands whose rendering is empty — a snapshot,
a read of the whole page — fall back to naming the command, which is the whole
of what happened.

That is also why the signal became a union of its two phases rather than one
object with optional halves: a `started` names the command and cannot know how
it ended, a `settled` reports how it ended — `ok`, a failure's own code, or
**null**, which is "nobody answered" and is a third state rather than a
failure. The command timed out or the window performing it went away; whether
the browser did the thing is not known, and a record claiming either would be
inventing news. What never travels is the outcome's `value`: the answer to a
read is the page, and it goes to the caller that asked for it and nowhere else.

**And the record outlives the row.** The indicator is gone four seconds after
the last command, and "what did that agent do" is asked afterwards — usually
while deciding whether to pause the grant. So each window also keeps what it
heard (`browser-agent/activity.ts`): the last 200 commands with who, when, the
same rendered line, and where each got to, fed by the same two feeders as the
indicator and read in Settings under the grants and the level, which are the
levers the answer informs. This is the automatic trace for outside callers the
scope sketch called the optional half of saying "what" — it needs nobody to
start it, which matters because the party who would have to start it is the one
whose behaviour is in question. On a reconnect, commands another window was
performing are marked as having no answer rather than left saying "running" for
the rest of the session; what this window performs itself is untouched, since
that settles locally whatever the socket did.

**The button is the one that fits the caller.** A grant gets **Pause**, which is
the whole reason pausing exists. A caller from outside with no grant gets a link
to Settings, because the install-wide level is the only lever that reaches it. A
turn gets no button: it is stopped in the thread it belongs to, and a second
worse way to do that helps nobody.

**And `patcher browser status` says it from the other side.** The route hands the
command the same scope it charges it against (`PluginCliContext.caller`), so the
first thing an agent runs answers both halves of "can I act" — is there a
browser, and how far do I reach — instead of costing a refusal per guess. It is
the host's decision said out loud; nothing is enforced there, and a plugin that
ignored it is refused a command later exactly as before.

## What this does not close

Named here rather than left to be rediscovered.

- **A caller holding the app key can write the install-wide setting as easily as
  read it.** The key is a `0600` file readable by any process running as the
  user, so that setting is a default rather than a boundary — which is why the
  grant above exists and why the recommended shape leaves the setting `off`. What
  a grant does *not* do is make the app key unreadable: an agent that goes
  looking can still find it and be the app, the same sentence `thread-api-key.ts`
  writes about itself. What changes is that the supported path is the narrow one,
  so reaching past the browser is a deliberate act rather than the way the
  product works.
- **A plugin can still name any of its own in-flight calls, and can keep one
  open.** The caller crosses as an id the host minted and the channel refuses one
  it does not have in flight, so nothing an outsider holds can forge one — but a
  plugin sees every id the host has open for *it*, and decides when to answer.
  "Across the plugin boundary" above says why that is not a way in. One plugin
  cannot reach another's *because the channels are separate processes*: two
  plugins sharing one (`SHARED_PLACEMENT`) can write frames on each other's
  channel keys, and are one trust domain for that reason and several others
  ([`plugin-supervisor.ts`](../../apps/server/src/services/plugins/plugin-supervisor.ts)
  says which) — which is why one process per plugin is the default rather than a
  preference.
- **A plugin's browser work off the served call's stack is still uncharged.**
  Same paragraph: the id is stamped from an ambient scope, so work invoked from
  a resource created outside that call — a `setInterval` from the factory, a
  pump ticking on its own — carries none. Where the code was *written* decides
  nothing; a job the handler schedules is on the stack wherever its queue came
  from. What is closed is the case that
  needed no malice and no unusual code: a plugin's CLI command awaiting its own
  browser call, run from a terminal, is charged the level like anything else —
  measured through a real forked plugin process rather than reasoned about,
  because a claim about async context is exactly the kind that is wrong in a way
  nothing notices.
- **A plugin's own work is charged what it declared, not the level.** A
  schedule, a background service, an HTTP route the app called: none of those is
  a caller from outside Patcher, and installing the plugin is what agreed to
  them. Every user-facing description says this rather than promising the
  browser is shut to everything.
- **The server cannot tell a person's terminal from an agent's.** Both are
  "no thread", so both are charged the level. The cost is real and small: the
  diagnostic path in [agent-browser-tools.md](agent-browser-tools.md)
  (`bun run patcher:dev browser tabs`) needs the setting on, and
  `patcher settings browser-access` from a plain terminal takes effect with no
  prompt, because a person at their own terminal *is* the user.
- **The indicator is only visible where the app is.** It is a row of the app's
  own chrome in every window now, but it is still inside the app: a person with
  Patcher behind another application, or minimised, sees nothing until they come
  back to it. A tray item or a dock badge is the surface that would reach them,
  and it is a different one again rather than a wider version of this row. The
  web build keeps the older limit for a different reason — it hosts no browser
  surface off `/browser`, so there is nothing there to draw a window row in.
- **The record is one window's memory, not an audit log.** It says who, what
  and how it went now, and the caller's own trace is still the better log: this
  one is what *this window* heard, so a window that was closed or whose socket
  was down has a hole there, it is held in memory (a reload starts an empty
  list), it keeps no screenshots — a picture per command is megabytes held
  forever in a renderer — and it records no read sizes, so "it read the page"
  does not say how much came back. Making it durable means a table, a retention
  policy and a route, for a record whose complete form already exists as
  `patcher browser trace-start`.
- **Pausing stops new commands, not what is already installed.** A network mock
  or a page script the holder put in place before the pause is still there; so is
  a command already in flight — and since commands now take turns on a tab
  ([browser-tab-ownership.md](browser-tab-ownership.md)), "in flight" includes
  one waiting its turn, which can run well after the pause and after its own
  caller was told it timed out. Revoking has the same shape, and for the same
  reason: the credential is checked at the request.

## Verified

- `packages/domain/test/browser-external-access.test.ts` — the levels are a ramp
  (each admits everything below it and more), `off` admits nothing, `full` admits
  exactly the browser command permissions, the credentials group sits above
  acting, and every level has a sentence a person can answer.
- `apps/server/test/services/browser/browser-external-access.test.ts` — a caller
  with no scope is charged nothing; each level's boundary; the scope survives the
  awaits between the route and the command; and a refused command is **never
  sent to the browser**, which is what makes "nothing happened" true.
- `apps/server/test/services/browser-external-access-route.test.ts` — the route
  writes without asking when no thread is declared, raises a prompt naming the
  level and its permissions when one is, changes nothing on a decline, enables
  `browser-tools` and does not disable it; and, through the real plugin CLI
  route, a browser command refused while off, allowed at `read`, **still refused
  when the request carries only a thread header nobody verified**, and — through
  a plugin in a **real forked process** — refused there too, with the window
  told `outside` for a terminal's call and the thread id for a turn's.
- `apps/server/test/services/browser/browser-caller-handoff.test.ts` — both
  scopes come back together or not at all, an id the host never minted finds
  nothing, two callers of one plugin stay apart, and a settled call is forgotten.
- `apps/server/test/services/plugins/plugin-channel.test.ts` — a frame sent while
  serving names the *exact* call it came out of and two concurrent calls each
  get their own id (not merely different ones — review caught that a swap would
  have passed); a frame sent outside any call names none; an origin whose call
  has settled, and one another channel minted, are both dropped; the record
  exists before the frame leaves, observed from inside the port's `send`
  because both ports defer delivery; and it is released on success, on failure,
  and when the channel dies under it.
- `packages/config/test/agent-access-key.test.ts` — a credential names one grant
  and verifies for no other, is not the app key and does not contain it, does not
  verify under another install's key, and — the attack the clear-text id invites —
  does not verify when the id beside the mac is swapped for a wider grant's.
- `packages/db/test/data/browser-access-grants.test.ts` — a revoked grant is kept
  rather than deleted, a second revoke does not move the date, and `lastUsedAt`
  is written at most once a minute.
- `apps/server/test/security/browser-tools-surface.test.ts` — every command in
  the plugin's own registration, run under a `read` grant with the setting at
  `off`: none runs to completion, and the one that used to is named in its own
  case. The list comes from the registration rather than from a copy, so a
  command added tomorrow is in the test the day it exists.
- `apps/cli/src/__tests__/client.test.ts`, `app-credential-hint.test.ts`,
  `mcp-tool-surface.test.ts` — the CLI half: a grant is presented, the app key is
  not presented beside it, a thread credential wins over one, the 401 hint names
  the grant, and `mcp-serve` in grant mode refuses every command the program has
  and admits `browser`.
- `apps/server/test/security/agent-access.test.ts` — over a real socket with no
  app key on it: the two routes answer, six others 403 with the offer in the
  message, another plugin's CLI is refused, the grant cannot mint a second grant
  or raise the level, a revoked grant is refused **naming the revocation**, a
  grant from another install is refused, both websockets refuse the upgrade, a
  turn cannot mint one while it can still read the list, and — the two that say
  the level is the grant's own — a `read` grant drives the browser while the
  install-wide setting is `off`, and a `read` grant is still refused
  `page.credentials` while that setting is `full`.
- `packages/config/test/cli-shim.test.ts` — executable, quotes a path with a
  space in it, unchanged on the next start, rewritten when the install moves, the
  execute bit restored, Windows skipped, failure reported rather than thrown.
- `apps/cli/src/__tests__/plugin-cli-proxy.test.ts` — an unknown command names
  the plugins that are off, says nothing when they are all running, and caps the
  list.
- `plugins/browser-tools/src/cli.test.ts` — `status` reports the refusal instead
  of the window count, exits non-zero, and tells a caller from outside how far it
  reaches — while saying nothing at all to a caller inside Patcher.
- `apps/server/test/services/browser-command-issuer.test.ts` — read off a
  stand-in browser host's socket rather than off the bridge, because the field
  has to survive the route, the ambient scope, the bridge and the hub, and the
  schema makes omitting it valid at every step: a grant's command names the
  grant, a turn's names the thread, an app-key caller's names nobody and carries
  the level it is charged, and a `threadId` in the request *body* does not change
  the answer.
- `apps/server/test/services/browser/browser-bridge.test.ts` — the app's own
  browsing carries no issuer at all, and the field is absent rather than null.
- `apps/app/src/lib/browser-agent/driving.test.ts` — the indicator stays up
  between one agent's commands, stays up while a slow one is still in the air,
  counts overlapping commands rather than the last to answer, does not blink
  `inactive` between two of one caller's, and shows whoever is driving now
  rather than whoever answered last. Plus which window, in the three states the
  reviews found: a settle reads its place from what its own start recorded — so
  the row does not flip to "this browser" for the four seconds it lingers — one
  caller's two windows are told apart as they settle, and a reconnect keeps that
  caller's local command while dropping its mirrored one. And what it names, in
  the three places the command and the caller come apart: the row names the
  command still running rather than the one that just answered, keeps naming
  the one it just finished while it lingers, and moves both the name and the
  line together on a handover.
- `apps/app/src/lib/browser-agent/useBrowserAgentBridge.test.tsx` — the
  subscription a non-serving window's whole indicator hangs on: a signal from
  another window is shown as being elsewhere, each phase's own command id
  reaches the tracker, a reconnect stops the row claiming a command that ended
  while the socket was down *and* keeps one this window is still performing
  (its executor stubbed to never answer, which is the state the rule is about),
  and unmounting stops both listeners. Plus the record's two feeders, each of
  which can be wired wrong invisibly: a command this window performs is written
  down as *this window* renders it, a settle's outcome is taken off the frame
  rather than guessed, no answer is recorded as no answer, and a reconnect ends
  the other window's open rows while leaving this window's running. And how a
  command *this* window performed ends, which no frame can stand in for since
  the server tells the performer nothing: a refusal keeps its own code, a
  success reads done, and a bug in the executor is recorded as the
  `invalid_command` the agent is sent.
- `apps/app/src/views/BrowserSurfaceView.test.tsx` — the placement, in the state
  that used to lose it: with a Patcher screen holding the tab there is no
  address bar, and the row is on screen anyway.
- `apps/server/test/app/hub-browser-command.test.ts` — *two* other windows are
  told and the performer is not (one watcher would accept a loop that stopped
  after the first), one start and one settle rather than a last frame that
  happens to be right, a command with nobody to name is not announced, a send
  that threw announces neither phase — the guarantee that rests on recording the
  issuer only after a successful send — and the settle reaches the window still
  open when the command times out and when the one doing the work vanishes,
  carrying **no** outcome in both of those, because nobody answered. Plus what
  the frame says and does not: the command's rendered line in the trace's own
  words, a storage write's key without its value, a refusal's code without the
  message written for the agent, and a read's answer nowhere at all — asserted
  against the raw frames, which is what actually leaves the server.
- `apps/app/src/components/browser-surface/BrowserDrivingIndicator.test.tsx` —
  the label a person typed rather than the grant id, the level in the settings
  screen's words, **Pause** rather than revoke, Settings for a caller with no
  grant, and no button at all for a turn. Plus what it is doing: the command's
  line, the command's own name when that line is empty, and who is driving even
  when the frame carried no command at all.
- `apps/app/src/lib/ws.test.ts` — the issuer survives the app's lenient parse,
  which is the one place dropping it would look exactly like a server that never
  sent it; and `browser-driving` reaches its own subscribers rather than the
  command ones, which would have a window perform an action nobody sent it —
  including the two places the strict and lenient schemas disagree on purpose: a
  frame missing the command or the outcome is still shown for who is driving
  rather than dropped, and so is one where a newer server has added a field
  *inside* either of them — which a strict nested schema would have rejected
  whole, leaving a `settled` nobody else can deliver and an indicator on until
  the next reconnect.
- `packages/domain/test/browser-command-description.test.ts` — the words both
  records use: what was typed is kept, a storage write names its keys and not
  their values, a cookie write is not spelled out at all, and a command that
  renders longer than a record's line is cut to it — which is what keeps the
  server's own strict parse on the send path from ever throwing.
- `apps/app/src/lib/browser-agent/activity.test.ts` — the record's own rules:
  nothing about the person's own browsing, each settle paired with the command
  it belongs to rather than the newest, a failure's code kept, no answer told
  apart from done, an end with no beginning ignored, the oldest dropped at the
  cap, a reconnect ending the other window's open commands and only those, and
  the changed row replaced rather than mutated — which is what makes it
  re-render.
- `apps/app/src/components/settings/BrowserActivitySettingsControl.test.tsx` —
  newest first, the caller's own label, the command and its line, the time, a
  refusal's code, "no answer" for the ones nobody answered, and an empty state
  that says so rather than an empty box.
- `apps/app/src/views/SettingsView.browserAccessGrants.test.tsx` — three states
  that are not interchangeable: a pending read is not "no grants", a live grant
  offers both ways to stop it, a paused one says so and offers Resume, and a
  revoked one offers nothing.

Run by hand against a dev instance from a shell with no `PATCHER_*` set, since
nothing above exercises the daemon → shim → CLI → server path end to end:

```bash
patcher settings browser-access          # off, with what that means
patcher browser tabs                     # refused, naming "tabs.read" and `read`
patcher settings browser-access read
patcher browser open https://example.com # refused, naming "tabs.modify" and `interact`
patcher browser cookie-list              # refused, naming "page.credentials" and `full`
patcher settings browser-access full
patcher browser cookie-list              # reaches the browser
```

And, with a grant and a browser window open, the half no test can reach — that
the indicator appears in the chrome with the label a person typed, that Pause
stops the next command with the paused reason, and that Resume puts it back:

```bash
patcher agent-access grant "Claude Code" --level read
PATCHER_AGENT_KEY=<the key> patcher browser status   # names the grant and "read pages"
PATCHER_AGENT_KEY=<the key> patcher browser text     # indicator appears; then click Pause
PATCHER_AGENT_KEY=<the key> patcher browser text     # 401, "is paused", not "was revoked"
patcher agent-access resume <id>
```

`text` exits 1 both times it runs, and that is not the recipe failing: a `read`
grant with no tab of its own is refused `no_active_tab` by the window, which is
after the command has reached it — `page.read` is a price this level pays, so the
gate passes it, the row is drawn before the command is performed, and the
indicator is what these three lines are for. Swap in `patcher browser tabs` for a
line that draws the same row and exits 0.

The row's line and the record are the other half no test spans, because the
rendering crosses the route, the hub, a socket and two windows: with two
windows open, one command should put the same line in both chromes — the
window performing it renders its own, the other reads the frame — and both
Settings screens should then list it under the grant's label with what became
of it.

That pass is also what found the two defects the tests could not: a refusal
quoting `patcher browser-tools`, a command that does not exist, as the obvious
next thing to try; and the shim, skill install and `bb-cli` prune all firing
correctly on a real daemon start.
