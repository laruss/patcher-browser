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
| `browse`   | plus `tabs.modify`                                                           |
| `interact` | plus `page.interact`                                                         |
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

### The rung between reading and acting

`browse` is `read` plus `tabs.modify`: opening, closing and navigating tabs of
its own. It was split out of #120 as a question and answered as #128.

**What it is for.** `read` cannot reach a page on its own — every page read
resolves a tab first, a caller outside Patcher has no default tab but its own,
and opening one costs `tabs.modify`. So until this rung, an agent asked to look
something up in the person's browser had to be granted `interact`, which also
lets it click and type on a site they are signed in to. The rung is the smaller
thing to hand over for a job people were already doing at the larger one.

**The objection, and where it lands.** `tabs.modify` is not the power to change
something — ownership keeps this level off every tab the person opened
(`resolveTab`, and [browser-tab-ownership.md](browser-tab-ownership.md)) — it is
the power to *choose which signed-in page gets read*. Cookies belong to the
session and not to a tab, so an agent that can name an address can read the mail,
the bank, the admin console. That is real, and it is an argument about the
sentence the person reads rather than about whether the step exists: `read` keeps
its own invariant — everything it admits is already on their screen — precisely
because the rung is not `read`. What the rung's own line has to say is that it
reads whatever the logins reach and picks the page itself.

**And an address is not only a read.** A GET in a signed-in session is an action
on plenty of sites: a one-click unsubscribe, a confirmation link out of a mail, a
logout, a `?delete=` in a query string. So "it cannot click or type" is not the
same claim as "nothing can change", and the level's line does not make the second
one.

**Two things it touches that pricing could not withhold.** `tabs.activate` brings
its own tab to the front of the person's window, and `tabs.pin`, `tabs.move` and
`tabs.mute` land in the strip they are looking at. Neither can be priced away:
`tabs.open` carries `activate: boolean` and costs the same `tabs.modify`, so
withholding activation would take a new member of the permission vocabulary —
which is mirrored into the generated plugin `.d.ts` — and refusing it in the
window instead would answer one permission two ways, which is the defect #116
was. Both are in the level's own sentence rather than in a promise it cannot
keep.

**A grant may be issued at it**, because grant levels are derived from the ramp
rather than listed again. And nothing about a *lent* tab moves:
`LOOK_CLAIM_ADMITS` still draws `read`'s line, which is what the person is saying
yes to about one tab — though what lending is *worth* changes, since a caller
that can open its own tab is being lent the page's live state rather than access
to the page at all.

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

**The install itself is asked for, once (#141).** Daemon startup writes the shim
and prunes `bb-cli`; it installs nothing, so for as long as installing was a
button in Settings → Skills, an agent asked to use Patcher found neither skill
and went searching the disk — measured on a machine with the packaged app, it
found a source checkout and ran `bun run patcher` from it. So the app asks when
it opens on a primary machine that holds none of the skills: install them into
both roots there, or not now. Either answer is recorded in
`app_settings.outside_agent_setup` and never asked again, and the first answer
wins over a second window's; a successful install on the primary machine from
anywhere — the question, the Settings button, the CLI — records a yes, and so
does any status read that finds a copy already there (at daemon connect, or the
window's own read before it asks). That last one is a write a turn can cause by
reading the status, which the route policy otherwise leaves open to it; what it
records is a fact about the disk, not a choice made for the person.

**And kept current without being asked again (#142).** An installed copy used to
stay whatever it was installed as, so after an upgrade an agent outside Patcher
followed a skill written for an older CLI. Now each daemon records, in
`<dataDir>/global-skills-installed.json`, the tree it wrote at each copy path,
and when a machine connects the server updates the copies that still hold what
that record says — only those, and only through a conditional install the daemon
checks against its record and on disk just before the swap. A copy edited by hand, removed, installed
before the record existed, or written by another install sharing the home is
left alone and shows in Settings as modified, partly installed or out of date;
Install replaces it. That last case is the owner's machine: a release and a
source checkout have separate data directories over one `~/.claude/skills`, so
neither's copy is ever the other's own and they never take turns rewriting it.
A write the window announces once, per machine, as a toast. The rule is
"unchanged since this install wrote it", not "differs from this server's tree":
the second rewrites a person's edit on every launch, and flips between the two
builds on every connect of either.

**A skill that ships later is asked about, not assumed.** Its name is new to
`GLOBAL_CLI_SKILL_NAMES`, so no machine has a copy and none is "ours" to
update: without a question it would never arrive, and every machine would read
"Partly installed" until somebody pressed Install — which replaces every skill,
including one they had edited. So a machine that holds this install's other
skills and has never had the new one raises an offer, the window asks once, and
the answer is kept per skill name in `app_settings.cli_skills_answered`. "Never
had" is both hashes null: a copy somebody removed keeps its entry in the
machine's record, and removing a skill is not an invitation to offer it back. An
accept outlives the question — a machine that was offline installs that skill
when it next connects — which is what keeps the answer one question rather than
one per machine.

One install location is not followed: Claude Code's skills move with
`CLAUDE_CONFIG_DIR`, which skill discovery honours
(`command-handlers/list-commands.ts`), while the install writes
`~/.claude/skills` regardless. Pre-existing, and most likely moot for the
daemon, whose environment is launchd's rather than a shell's. Not a field of the general settings object, which every
window writes back whole and would put `unasked` back; and not a step in
first-run onboarding, which is behind an experiment that is off by default.

The install is refused to a turn (`/system/cli-skills` in
`agent-route-policy.ts`) and to plugins (`null` in the plugin API map): it writes
into the user's home outside any sandbox, into roots every agent on the machine
loads, which is the argument that already closed provider-CLI installs.

### Advice a level can afford

**No refusal for want of a tab recommends work the caller's level forbids.** The
five that decide *whose* tab a command lands on, which is where the defect was —
not every refusal in the browser; `tab_not_live` still says "Activate it" to
everybody, and "What this does not close" says why. It is one sentence and it was
broken in all five places, because the level that exists to read pages cannot
reach a page on its own: every page read resolves a tab first, a caller outside
Patcher has no default tab but its own, and *opening* one of its own costs
`tabs.modify`, which `read` does not admit — it started at `interact`, and since
#128 it starts at `browse`. (Being handed one costs nothing, and that is the
route below.) So the window's answer for want of a
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

That rung now exists and is `browse` — see "The rung between reading and acting"
above. The advice was wrong either way, which is why #120 fixed it without
waiting for the answer: a plain `read` grant still cannot open a tab, and what
the rung adds is an agent that chooses which signed-in page it reads, which was
the line between `read` and `interact` rather than a detail of it.

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

### Derived, so the server stores nothing

`pa1.<grantId>.<HMAC(appKey, "patcher-agent-access:v1:" + grantId)>`, the same
construction a thread credential uses one module over (`agent-access-key.ts` in
`@patcher/config`). The server needs no table of live keys and has none to leak:
given the id in the credential it re-derives what the credential must be and
compares in constant time. Losing the app key file rotates every grant at once,
which is the correct behaviour for a key derived from it. The one place a key is
written down is its delivery: `patcher agent-access grant` puts it in a `0600`
file for the agent it is for and hands over that path (see
[Getting it to the agent](#getting-it-to-the-agent)) — a file the server never
reads.

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

Whichever it names, it names as a command that runs as written: the shim's
absolute path, since `patcher` is usually not on PATH, with a label and the level
the command needed — and for a grant, the `revoke` beside it. The refusal for a
caller with no grant offers `agent-access request` first, as the one command the
reader may run itself (see [Asking in the window](#asking-in-the-window)), then
says not to run `grant` or the setting from that shell and names both as the
person's, with `<your name>` for the label it cannot know — and, for the request,
`--reason "<what you need it for>"` already in place before the `--`, because a
reason appended to the end of the line would be read as more label. The sentence before
#134 offered the setting with a level and a `grant` with no label, which
`grant <label>` refuses. The commands come from `agentAccessRequestArgv` and
`agentAccessGrantArgv` in `cli-shim.ts`, and the CLI's own test feeds both to the
command's definition, so a suggestion that stops parsing fails a test rather
than a person. `patcher browser status` at `off`
lists the levels by name once, because nothing else the reader was shown says
what they are.

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

The request routes below are held to the same three rules by the same three
policies — `agent-route-policy.ts` refuses a turn the three POSTs, the grant
allow-list admits none of them, and the plugin map has them `null` — because
what a request ends in is the same credential.

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

`patcher agent-access grant <label> [--level] [--for] [--print-key]`. The key is
written to `<dataDir>/agent-keys/<grantId>.key`, `0600` — the data dir of the
machine the CLI runs on, where the agent reading it runs, which is the server's
own unless the CLI was pointed at a server elsewhere — and what is handed over
is that file's path in `PATCHER_AGENT_KEY_FILE` — the key goes to stdout only
when `--print-key` asks for it, `--json` included. It used to be printed, and
walked through on 2026-09-14 from an agent's own session, that put it in the
agent's transcript and its session log (#134). The CLI reads the file when
`PATCHER_AGENT_KEY` is unset, and a file that is named and cannot be read still
counts as holding a grant: it presents nothing rather than falling back to the
app key, and its 401 says which file. If the file cannot be written once the
grant is minted, the grant is revoked on the spot, so nothing live is left that
nobody holds.

`--for shell` prints that one export and names the shim to call, which carries
the server URL itself. `--for claude-code` and `--for codex` run **that agent's
own** `mcp add` — never editing their config files here, because
`~/.claude.json` is rewritten by a running Claude Code and `~/.codex/config.toml`
is a hand-kept file with comments in it that a TOML round-trip would silently
reformat. Both ship a command for this, so the safe path is also the short one;
when the binary is not on PATH the command is printed for the person to run, and
nothing is half-done because nothing was written. Either way it ends by saying
to restart that agent, because the server shows up in a session started after
it.

What those commands receive is the key file's path, not the key, so neither
their argv — printed, and visible in `ps` while it runs — nor the config it lands
in carries the credential. Until #134 both did: not a new exposure, since the app
key file beside it is readable by the same processes, but a window a
`--env-file` would not have had, and neither vendor offers one. A config written
before then holds `PATCHER_AGENT_KEY` and keeps working.

The MCP server it points at is the CLI shim from the phase before
(`<dataDir>/bin/patcher mcp-serve`) — a stable absolute path that survives an
upgrade, which matters because an agent's config outlives any particular build
directory.

`patcher mcp-serve` notices the grant in its own environment and changes what it
offers: one command, `browser`, with a description that says so. Without that it
would advertise "Patcher's API commands" and then have the server refuse all but
one of them with a paragraph about credentials — which is the failure mode that
module was written against, since a model told only "no" tries the neighbour.

### Asking in the window

Everything above ends with a person typing a command an agent told them to,
and — with `--for shell` — the key's path travelling back through that agent's
reply. #135 moves the decision to where the person already is:
`patcher agent-access request <label> --level <level> [--reason]`, run by the
agent itself, raises a row under the tab strip — beside the driving indicator,
the one row on screen for every desktop route — and a list in Settings → General
→ Agents outside Patcher. *A program on this machine that calls itself "…" asks
for browser access*, the level in the settings screen's words and its detail
line, the reason as the program's own words, and **Allow**, **Read pages only**
(above `read`) or **Deny**.

**It adds no reach.** The CLI asking holds the app key, and the app key can
already mint a grant with no prompt. What changes is that the supported path puts
the decision in front of the person, attributed, before a credential exists —
which is also why the refusal can now tell an agent to run something itself.

Four routes under `/browser/access-requests`: `POST` asks, `GET` lists what is
waiting, `POST /:id/decide` answers, and `POST /:id/outcome` is how the asker
learns the answer. The outcome is a POST although it reads, because collecting
an approval hands over a key and ends the request, and the turn policy leaves
reads open.

**Held in memory** (`browser-access-requests.ts`), because a request lives for
minutes and the tab handover ask set the precedent of not persisting a question.
A restart drops what is waiting; the asker is told the request is gone and asks
again.

**Allow mints; collecting only derives the key.** Minting at collection was the
first design and review took it apart: between the click and the pickup the grant
would be invisible in Settings and impossible to take back, the plugin would be
turned on at the poller's moment rather than the person's, and two collections
racing past an `await` could mint two grants. So the grant exists on the click,
the entry records its id, collecting re-reads the row — a grant revoked in
between is not handed over — and an approval nobody collects within the request's
ten minutes is revoked, the same move `grant` makes when it cannot write the key
file. A restart inside that window leaves a named grant that was never used,
visible and revocable.

**No pickup token**, though the issue proposed one. Everything that can reach the
outcome route holds the app key and could mint its own grant under any label,
so a token would guard nothing — and it would have made a wait cut short
unrecoverable, since the token dies with the process that was killed.

**The CLI polls, briefly.** Every second and a half, for ninety seconds, then it
exits non-zero saying the request is still open and to run the same command
again. The caller is an agent's shell tool, and Claude Code's and Patcher's own
MCP tool both stop a command at 120 seconds; killed mid-wait, it would have
reported nothing. Asking again under the same label at the same level answers
with the open request rather than raising a second one, which is what makes the
re-run a resume; the same label at another level is refused while one is open.
Polling rather than holding a request open, because the answer is a person's
click and nothing about loopback makes a poll expensive.

**Limits**, because a looping agent must not fill the person's window: five open
requests across the install, ten minutes each, and after a no that label is
refused for ten minutes with a sentence saying the person already answered and
not to route around it. The label is chosen by the asker, so a program that
renames itself is not stopped by the cooldown; what it stops is the loop that
needs no intent.

**The row's buttons wake up 600 ms after it appears.** It arrives in the chrome
and moves what is under the pointer, and a click meant for something else — or
the second half of a double-click on the request before — must not answer it. The
oldest request is shown with a count of the rest, so the row changes only when
one is answered or expires.

Asking, answering and a request expiring each broadcast `config-changed`, which
the grants list already refreshes on — a poll and a collection change nothing
the window shows, so they do not — and no `SystemChangeKind` was added and the server ↔ SPA socket
(invariant 7 in `bb-migration.md`) is untouched. The cost is that asking,
answering and expiring also re-read the other queries hanging on that kind in
every window; bounded by the limits above.

A grant holder cannot use this to widen itself — the allow-list admits none of
these routes — and a shell holding a grant presents it instead of the app key,
so `request` from there is a 403. The skill says to ask the person in words
rather than unset the variable, and the refusal a grant holder reads still names
`grant` as the person's.

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
command was sent, and said back to the caller itself only when what it is
running is `patcher browser`, since `ctx.caller` carries it for that plugin's CLI
alone. The window is told either way, because the window writes the refusals, one
of which used to advise opening a tab to a caller whose level forbids it (#120).

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

- **One refusal still recommends what a `read` caller cannot do.** A page read of
  a tab with no live view answers `tab_not_live`, and the sentence a caller reads
  for that code is the browser-tools plugin's own fixed one, which opens with
  "Activate it" — and `tabs.activate` is priced `tabs.modify`. Reachable, if
  narrowly: a tab lent or handed over while it has never been the active tab with
  the Browser surface mounted. It was left alone with #120 rather than fixed
  there, because the sentence is written in the plugin layer, which cannot ask
  the ladder — the plugin depends on the SDK and zod, and the SDK exports no
  level predicate — so the plugin would have to keep its own copy of which levels
  can activate a tab, and that copy is what goes stale the day a level is added.
  #128 added one and the warning held: activation is admitted from `browse` up,
  so this sentence is now wrong for `read` alone. That copy was never written, so
  nothing went stale — the other one in the same file, the words
  `patcher browser status` says for each level, is now typed over
  `PluginCliCaller["level"]` and cannot be forgotten again. The window's own
  message for the same code names no command; passing it through, the way
  `no_active_tab` and `page_stalled` already are, is the shape of the fix, and it
  costs a `browse` or `interact` caller the one hint it could act on. Found by
  review.
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
- **A request's name is the asker's claim, and an app-key holder can answer its
  own.** The row says "calls itself" and shows the reason as the program's words
  because nothing verifies either. And `decide` is open to the app key, which
  every CLI asking holds, so a program can approve its own request — nothing it
  could not do by minting a grant directly, and the reason the answer is a
  decision in the window rather than a boundary around it.
- **A collection whose reply is lost leaves a grant nobody holds.** Collecting
  an approval ends the request before the reply leaves, so a CLI killed in that
  instant — or one whose reply never arrived — asks again as a new request, and
  the grant the person allowed is not revoked by the expiry that covers an
  approval nobody collected. It is a named grant that was never used, in the
  person's list, which is the state a restart between Allow and collection
  already leaves. Keeping collected answers around to hand over twice would trade
  it for a re-run that finds the key file already written and revokes a grant that
  is in use.
- **An asked question reaches only an open window.** The row is in the app's
  chrome and the list in its Settings; with no window open nobody sees it, and
  the request expires unanswered after ten minutes. The CLI says where to look
  rather than refusing to ask.
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
  and admits `browser`. A key in `PATCHER_AGENT_KEY_FILE` is presented, the
  variable wins over it, and a file that cannot be read presents no app key, is
  named by the hint, and still puts `mcp-serve` in grant mode.
- `apps/cli/src/__tests__/command-output/agent-access.test.ts` — the key lands in
  a `0600` file and not on stdout, `--json` included, unless `--print-key`; a key
  file that cannot be written revokes the grant; `--for claude-code` is handed
  the file's path and never the key, and told to restart; and every grant command
  a refusal suggests parses with the command's own definition, a label that looks
  like an option included. For `request`: it waits, then writes the key to a file
  and never prints it; a lower level is said; a no exits non-zero and says not to
  go round it; the wait gives up well inside a 120-second tool timeout saying the
  request is still open; `--level` is required; and every request command a
  refusal suggests parses.
- `apps/server/test/services/browser/browser-access-requests.test.ts` — on a fake
  clock: an unanswered request goes away and tells the windows, an approval
  nobody collected is revoked, a grant minted while its request expired is
  revoked, a grant revoked before collection is not handed over, a second Allow
  is refused, the install-wide cap, and the cooldown ending.
- `apps/app/src/components/browser-surface/BrowserAccessRequestRow.test.tsx` — the
  name as the program's own claim, the level's words, the reason as its words and
  the count behind it; no click taken in the moment it appears; **Read pages
  only** answers `read` and is not offered at `read`.
- `apps/server/test/security/agent-access.test.ts` — over a real socket with no
  app key on it: the two routes answer, six others 403 with the offer in the
  message, another plugin's CLI is refused, the grant cannot mint a second grant
  or raise the level, a revoked grant is refused **naming the revocation**, a
  grant from another install is refused, both websockets refuse the upgrade, a
  turn cannot mint one while it can still read the list, and — the two that say
  the level is the grant's own — a `read` grant drives the browser while the
  install-wide setting is `off`, and a `read` grant is still refused
  `page.credentials` while that setting is `full`. And a request (#135): asked,
  listed, answered with less, minted on the click, collected as a key that
  reaches the plugin table, and a second collection 404; a turn refused asking,
  collecting and answering while it can read the list; a grant refused asking; no
  credential 401; the same label resumed and another level refused; a no refusing
  the label; and an answer above what was asked refused.
- `packages/config/test/cli-shim.test.ts` — executable, quotes a path with a
  space in it, unchanged on the next start, rewritten when the install moves, the
  execute bit restored, Windows skipped, failure reported rather than thrown.
- `apps/cli/src/__tests__/plugin-cli-proxy.test.ts` — an unknown command names
  the plugins that are off, says nothing when they are all running, and caps the
  list.
- `plugins/browser-tools/src/cli.test.ts` — `status` reports the refusal instead
  of the window count, exits non-zero, and tells a caller from outside how far it
  reaches — at `off`, with the levels by name — while saying nothing at all to a
  caller inside Patcher.
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
patcher browser open https://example.com # refused, naming "tabs.modify" and `browse`
patcher browser cookie-list              # refused, naming "page.credentials" and `full`
patcher settings browser-access full
patcher browser cookie-list              # reaches the browser
```

And, with a grant and a browser window open, the half no test can reach — that
the indicator appears in the chrome with the label a person typed, that Pause
stops the next command with the paused reason, and that Resume puts it back:

```bash
patcher agent-access grant "Claude Code" --level read   # prints the key's file, not the key
PATCHER_AGENT_KEY_FILE=<that file> patcher browser status   # names the grant and "read pages"
PATCHER_AGENT_KEY_FILE=<that file> patcher browser text     # indicator appears; then click Pause
PATCHER_AGENT_KEY_FILE=<that file> patcher browser text     # 401, "is paused", not "was revoked"
patcher agent-access resume <id>
```

And asking in the window, which no test spans either — the row under the tabs in
a real window, answered with a real click, collected by a CLI waiting on it:

```bash
patcher agent-access request "Claude Code" --level browse --reason "try it"   # row appears; press Allow
PATCHER_AGENT_KEY_FILE=<the file it names> patcher browser open --background https://example.com   # works; indicator shows the label
patcher agent-access request "Other" --level interact   # press Read pages only: "lower than the interact asked for"
patcher agent-access request "Third" --level read       # press Deny; run it again: "answered no"
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
next thing to try; and the shim and the `bb-cli` prune both firing correctly on
a real daemon start. (That start installs no skills — see "And the skill".)
