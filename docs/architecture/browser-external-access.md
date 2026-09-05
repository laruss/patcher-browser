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

It also enables `browser-tools`, because a level with nothing serving it is a
setting that silently does nothing. The reverse is deliberately not true: turning
the level back to `off` leaves the plugin alone, since threads inside Patcher use
it too and nobody asked about those.

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

The shim is a two-line `sh` script that `exec`s the real binary. Not a copy,
which goes stale on the next upgrade; not a symlink, because `import.meta.url` is
symlink-resolved and `argv[1]` is not, and this repository has already lost a
release script to exactly that disagreement. It is **not** a PATH entry: writing
into somebody's shell rc file is not this program's business, so the line is
shown rather than written — and an agent handed the absolute path needs no PATH
at all, which is the case it exists for.

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

## What this does not close

Named here rather than left to be rediscovered.

- **A caller holding the app key can write this setting as easily as read it.**
  The key is a `0600` file readable by any process running as the user. What this
  buys is what not handing a turn the app key bought: the browser is closed by
  default, opening it is the user's act, and going around that is a deliberate
  act rather than the way the product works. Making it a boundary needs a
  credential that opens the browser and nothing else, which is deliberately not
  in this change.
- **The scope does not reach an installed plugin in its own process** — measured,
  not reasoned about, because a claim about async context is exactly the kind
  that is wrong in a way nothing notices. The host charges an out-of-process
  plugin's browser call on a *channel message*, which is a fresh async context,
  so the level does not reach it and it is charged what it declared, as before.
  The same probe that is refused in-process at level `off` reaches the hub when
  its plugin runs in its own process. Nothing hides behind that gap — the same
  caller can install a plugin — and it closes with the same credential.
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
