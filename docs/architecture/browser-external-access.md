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

Accepted while the grant exists and `revokedAt` is null. That is the property a
stamped expiry could not have given: the agent keeps the *string* forever — it is
in its MCP config — and what stops it is a person clicking Revoke, after which
the very next request is refused. Nothing to expire, nothing to refresh, nothing
an agent can extend for itself. It is the same shape a terminal credential's
lifetime has, chosen for the same reason.

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
- **Neither the level nor a grant covers every plugin.** The scope does not
  reach an installed plugin running in its own process — measured,
  not reasoned about, because a claim about async context is exactly the kind
  that is wrong in a way nothing notices. The host charges an out-of-process
  plugin's browser call on a *channel message*, which is a fresh async context,
  so the level does not reach it and it is charged what it declared, as before.
  The same probe that is refused in-process at level `off` reaches the hub when
  its plugin runs in its own process. Nothing hides behind that gap — the same
  caller can install a plugin — but a *user* can, and a third-party plugin with
  browser permissions and a CLI command of its own is then a door neither closes.
  Every user-facing description says so rather than promising the browser is
  shut. `docs/TODO.md` carries the two ways to close it; with the credential now
  built, the second of them — carrying the scope over the plugin channel — is the
  next thing worth doing here.
- **The server cannot tell a person's terminal from an agent's.** Both are
  "no thread", so both are charged the level. The cost is real and small: the
  diagnostic path in [agent-browser-tools.md](agent-browser-tools.md)
  (`bun run patcher:dev browser tabs`) needs the setting on, and
  `patcher settings browser-access` from a plain terminal takes effect with no
  prompt, because a person at their own terminal *is* the user.
- **Nothing shows that an outside agent is driving.** Electron draws no "this
  browser is being controlled" banner, so what the app shows is the only signal
  there is, and today it shows nothing. That is the next thing worth building.

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
  when the request carries only a thread header nobody verified**, and **not
  refused at all when the plugin runs in its own process** — which is the
  boundary above, pinned so it is a measured limit rather than a sentence.
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
  of the window count, and exits non-zero.

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

That pass is also what found the two defects the tests could not: a refusal
quoting `patcher browser-tools`, a command that does not exist, as the obvious
next thing to try; and the shim, skill install and `bb-cli` prune all firing
correctly on a real daemon start.
