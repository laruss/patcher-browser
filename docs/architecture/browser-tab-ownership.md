# Whose tab is whose

Two agents can drive this browser at the same time, and so can the person using
it. Nothing stops them, and until now nothing separated them either: every
tab-targeting command takes a `tabId` that may be null, null meant "the active
tab", and the active tab is the one the human is looking at. Two agents that
both omitted it — the documented, recommended thing to do — worked in the same
tab as each other and as the person.

The failures that came of it were not exotic. A snapshots a page while B opens
something else in it; A's refs are correctly invalidated and A's task is
finished off anyway, and the person's page has been replaced under them. Or B
snapshots the same tab, the generation moves, and A's `click e2` now names
something else on a page it never saw.

So a tab has an owner.

## The rule

A tab an agent opened is that agent's. Every other tab is the person's — the
strip is mostly those. Ownership binds agents only: everything reachable from
the strip, the omnibox and the page is the person's regardless of who opened
the tab.

| The caller                         | A null `tabId`                               | Its own tab | The person's tab          | Another agent's |
| ---------------------------------- | -------------------------------------------- | ----------- | ------------------------- | --------------- |
| A turn inside Patcher              | its newest tab, else the person's active tab | yes         | **yes**                   | no              |
| A grant / anything outside Patcher | its newest tab, else refused                 | yes         | **no**, until handed over | no              |
| Nothing named it                   | the active tab, as before                    | —           | yes                       | yes             |

**The asymmetry is the point.** A turn is a conversation the person is having in
the same window, and "read the page I am looking at" is the case the in-app
tools were built for ([agent-browser-tools.md](agent-browser-tools.md)). A
caller outside Patcher has no thread to be visible in and nothing on screen
announced it; the tabs it gets are its own, and none of its defaults take the
window — though `tabs.activate`, and an explicit `--new-tab`, still bring its
own tab to the front, which is how an agent shows the person something. The third row is the honest
consequence of the `issuer` not reaching a plugin in its own process — the same
gap the access level has, listed in [../TODO.md](../TODO.md) — and it keeps the
behaviour that predates ownership rather than guessing.

"Its newest tab" is the one it most recently opened or was handed, not the one
it last touched: a rule an agent can hold in its head, where "whichever you used
last" depends on history it cannot see.

## What a caller is told

- **A listing still lists everything.** Ownership is about acting, not about
  seeing: `tabs.list` answers with every tab's address and title as it always
  has — that is the `tabs.read` permission, and it is how a caller finds the tab
  to ask for. What it cannot do is read *into* a page that is not its own.
- Every tab in a listing carries `owner`, relative to whoever asked: `you`,
  `person`, `agent`. Relative rather than named, so a grant does not learn the
  label of every other grant, and a turn's thread id does not travel to a shell.
  The `patcher browser tabs` listing shows it as `owner:you`.
- Naming a tab that is not yours is `tab_not_yours`, which says whose it is. It
  is not `unknown_tab`: the id is right, and a fresh listing changes nothing.
- An unqualified command from a caller with no tab of its own is `no_active_tab`
  with a different sentence — there *is* a tab, it is not yours, open one.

## Handing a tab over, and taking it back

The refusal is a dead end on its own: an agent says "ask them to hand it over"
and the person has nothing to press. So the refusal itself raises the ask. The
executor records it (`browserTabHandoverAskAtom`), and the browser chrome draws
a row under the driving indicator — *Claude Code is asking to work in "…"* —
with **Hand it over** beside it. Answering it claims the tab for that agent; the
agent's next command works.

The ask carries both halves of the question, which is why it comes from the
agent rather than from a menu: a menu would have to list every grant on the
install so the person could pick the one they were already talking to.

The other direction is on the tab's own context menu, where the tab is the thing
being pointed at: **Take back from Claude Code** on a tab an agent holds.

The agent chooses which tab it names, so it also chooses what the ask is *about*
— which is why the row names the tab it would be given, with its address, rather
than saying "this tab". And a later ask does **not** replace the one waiting:
otherwise an agent could show a harmless page, wait for the person to commit to
pressing, and swap in the tab it actually wanted. The waiting one stands until
they answer or dismiss it — or until its tab is closed, which leaves nothing to
answer.

## Where it lives

`apps/app/src/lib/browser-agent/tab-owners.ts`, as a map from tab id to the
`issuer` the server put on the command — the same value the driving indicator
draws, keyed the same way (kind and id, never the label, so a renamed grant is
still itself). `resolveTab` in `execute.ts` is the one place every tab-targeted
command passes through, which is what makes one rule enough.

It is persisted in local storage beside the tabs, because the strip survives a
reload and a restart: session-scoped ownership would quietly return every
agent's tab to the person on a Cmd+R and then refuse the agent its own next
command. A claim is dropped when its tab closes — by the agent, and by the
person from the strip, because a closed tab can be reopened with the same id and
should come back theirs. Every write prunes claims whose tabs are gone anyway,
which is the backstop for any path that forgets.

## What this is not

- **Not a security boundary.** An agent allowed to drive the browser at all can
  open its own tabs and read what a signed-in session gives them; cookies, web
  storage and a saved session state are the session's or the origin's, not the
  tab's, and cannot be partitioned this way. What ownership buys is that two
  callers stop landing on one page by accident, and that the page the person is
  reading is not the default target of an agent nobody in the room announced.
- **Not the whole of ordering.** Commands now take turns on a tab
  (`tab-queue.ts`) and each caller has its own trace (`traces.ts`), so the two
  ways two callers used to corrupt each other's work — a read split by
  somebody else's navigation, and a log that mixed them — are closed. What is
  left is the ref: a snapshot's generation is a version rather than an owner,
  and passing it is optional, so a caller can still act on a ref another
  caller's snapshot has moved. That is the next item in
  [../TODO.md](../TODO.md).
- **Not a per-process identity.** Everything holding the app key is one
  `outside` caller, so two shells share one set of tabs and can read each
  other's — and a tab handed to `outside` is handed to all of them. That is what
  the identity means, not a leak in this rule — a grant is the narrower answer,
  and it is per agent
  ([browser-external-access.md](browser-external-access.md)).
- **Not undone by revoking.** A revoked or paused grant keeps its claims: it can
  do nothing with them, and the tabs stay out of every *other* agent's way until
  the person takes them back from the tab menu. The alternative — returning them
  to the person on revoke — would quietly make a page an agent had been working
  in the default target of the next caller's unqualified command.
- **Not visible in the strip.** A tab an agent holds looks like any other until
  its menu is opened. The signal that something is driving at all is the
  indicator row ([browser-external-access.md](browser-external-access.md)).
