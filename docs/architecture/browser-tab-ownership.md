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

The two "no"s are about *acting*. A tab's address and title are answered for
every tab, to every caller, because that is what the listing already hands over
— see "A listing still lists everything" below.

And "until handed over" has two answers now, not one — see "Look, don't touch"
below. A tab the person lent for reading is not in this table because it is not
a fourth kind of caller: it is the person's tab, with one caller allowed to read
it.

**The asymmetry is the point.** A turn is a conversation the person is having in
the same window, and "read the page I am looking at" is the case the in-app
tools were built for ([agent-browser-tools.md](agent-browser-tools.md)). A
caller outside Patcher has no thread to be visible in and nothing on screen
announced it; the tabs it gets are its own, and none of its defaults take the
window — though `tabs.activate`, and an explicit `--new-tab`, still bring its
own tab to the front, which is how an agent shows the person something. The last
row is not a gap: it is the app's own browsing, a page script, a toolbar item's
handler and the work a plugin does by itself — nobody asked, so there is no
caller to own a tab on behalf of, and the behaviour that predates ownership is
the right one.

A plugin running in its own process used to land in that "nothing named it" row
for everything it did, and now lands there only for the work nobody asked for:
the caller crosses the plugin channel
([browser-external-access.md](browser-external-access.md)), so a command that
plugin runs *for* somebody takes that somebody's row, while its own timers and
pumps stay in the last row exactly as before — the crossing carries a caller,
not a plugin. Which row a served command takes matters, and two review rounds
each caught a version of this paragraph getting it wrong:

- a plugin a **turn** invokes takes the *turn* row. It may still use the
  person's tab and still falls back to the one in front; what it loses is
  another **agent's** tab — which it previously reached two ways, by inheriting
  whatever was active and by naming that tab's id, since with no issuer neither
  path was checked at all;
- a plugin invoked from **outside** takes the *grant / anything outside* row,
  and that is the one refused the person's tabs until they hand one over.

"Its newest tab" is the one it most recently opened or was handed, not the one
it last touched: a rule an agent can hold in its head, where "whichever you used
last" depends on history it cannot see.

## What a caller is told

- **A listing still lists everything.** Ownership is about acting, not about
  seeing: `tabs.list` answers with every tab's address and title as it always
  has — that is the `tabs.read` permission, and it is how a caller finds the tab
  to ask for. What it cannot do is read *into* a page that is not its own.
- **`page.get_url` and `page.get_title` follow the listing, not the refusal.**
  They answer from the same record of a tab, at the same `tabs.read` price, so
  naming a tab for them is not acting and is not refused. Until #116 it was:
  one permission answered two ways, and the stricter way interrupted the person
  with a handover question about a field the caller could already read off
  `tabs.list`.
- Every tab in a listing carries `owner`, relative to whoever asked: `you`,
  `person`, `agent`. Relative rather than named, so a grant does not learn the
  label of every other grant, and a turn's thread id does not travel to a shell.
  The `patcher browser tabs` listing shows it as `owner:you`.
- Every tab a caller was lent carries `owner: shared` — see below — and nobody
  else is told about the lending at all: to every other caller that tab still
  answers `person`, which is what it still is.
- Naming a tab that is not yours, for anything but those two reads, is
  `tab_not_yours`, which says whose it is. It is not `unknown_tab`: the id is
  right, and a fresh listing changes nothing. The sentence also says what to do
  instead, and that half is written by the executor rather than by the layer
  explaining it to a caller — because the answer turns on whether the ask has
  already been raised, which only the executor knows (#116).
- An unqualified command from a caller with no tab of its own is `no_active_tab`
  with a different sentence — there *is* a tab, it is not yours, open one. Which
  it says only to a caller that may: opening a tab costs `tabs.modify`, so at the
  `read` external-access level that advice named the one command the reader is
  forbidden, and the sentence is now the route that level does have — name one of
  the person's tabs, which is what asks them for it (#120). Not for the two
  priced `tabs.read`: an address and a title answer for any tab that is named, so
  theirs says that instead of describing an ask that never happens. And where
  there is no route at all — nothing open, nothing lent, nothing openable — it
  says so rather than inventing one.

## Look, don't touch

Handing a tab over was the only way to say yes, and it says a great deal: the
tab becomes that agent's, at whatever its grant allows — clicking, typing,
navigating, and at `full` injecting script and filming it. "Read the page I am
on" had to be answered with all of that or with nothing.

So a claim has a **mode**. `drive` is the old answer. `look` lends the page and
not the browsing: the caller may read — the page's text, its structure, a
screenshot, what it logs and what it requests — and everything that would change
it is refused. Which prices those are is a `Record` in `tab-owners.ts` over
every browser permission, so a permission added later does not compile until
somebody decides whether "look, don't touch" covers it. It is the same line the
`read` external-access level draws, written out again on purpose: that one is
how far a caller may reach into this browser at all, and this one is what the
person said about one tab.

**A look claim leaves the tab the person's**, and that is the load-bearing half.
`browserTabOwnerFor` answers `person` for it to everybody except its holder,
who gets `shared`. Answering `agent` instead — which is what falls out of a map
that only knows *who* — would take the person's own page away from the thread
they were discussing it in, refuse it to every other caller entitled to their
tabs, and offer them "Take back" on a tab nobody took. And a lent tab is never
what a null `tabId` means, so "let them look at this page" cannot quietly
redirect the rest of that agent's unqualified commands into it.

**What it costs the person, which the button cannot say.** Reading a page's
structure attaches the browser's debugger, and from then on that tab's
JavaScript dialogs are drawn by Patcher rather than by Chromium
(`BrowserPageDialog.tsx`). They still answer them; the box looks different. It
is the same cost a turn already puts on a tab it reads for them, which is why a
lent tab is not held to a stricter standard than the in-app path.

**It is on the tab, not on the page.** The claim follows that tab through every
later navigation the person makes, and it ends only when the agent releases it
or the person takes it back — deliberately not on a timer, because an access
that expires mid-read is a failure an agent cannot tell from a refusal.

## Handing a tab back

`tabs.close` was the only agent-facing path that ended a claim, and it destroys
the page — the one outcome somebody who lent their tab does not want. Taking
over a page from exactly the state the person left it in works and works well,
because a handover is a write to a map rather than a reload; giving it back did
not exist.

`patcher browser release <tab-id>` is that write without the destruction. It
works on any claim of the caller's own — one handed over, one lent for reading,
or a tab it opened itself and means to leave the person. A claim that is not the
caller's is `tab_not_yours`, in one sentence that does not say whose it is: that
would be a cheap way to learn about another agent, and the way forward is the
same either way.

It costs `tabs.read`, the cheapest bucket there is, because it is the one
command that only ever *narrows* the caller's own access. At `tabs.modify` with
the other tab-state changes, a caller lent a tab at the `read` level could not
give it back, and the lending would be a one-way door.

**And it takes back the question the agent asked.** A look holder that tried to
act has an upgrade ask waiting, and a waiting ask is not replaced while its tab
is open — so one left standing after a release would block every later ask about
every tab, and its **Hand it over** would still work, minting a claim on a tab
the caller had just given up. That is the failure release exists to stop,
arriving through the row instead. Withdrawing is keyed on the caller *and* the
tab, because the ask that is waiting may be somebody else's live question. Found
by review.

**And the tab stops being an automated tab.** Route mocks, offline emulation, a
running recording and the dialog interception that replaces Chromium's own modal
live with the tab's *debugger session*, not with the claim — so a tab released
while mocked stayed mocked, and its former holder could no longer clear it,
having given the tab up. The person's **Take back** had the identical hole from
the day ownership shipped. Both doors now call one shell command,
`endAutomation`, which drops the session; Chromium undoes the interception, the
emulation and the screencast when its client goes, so dropping it *is* the undo.

Two things that command deliberately does not do, and they are the whole reason
it is a command of its own rather than a `route-clear` and an `offline false`
sent from the renderer:

- **It never attaches a session.** Every `page.control` operation goes through
  `ensureCdpSession`, which creates one if there is none — so sweeping a tab
  nobody had driven would have attached a debugger to it and taken the person's
  dialogs over. The sweep meant to hand a tab back would have been the change it
  was there to undo. Asking first is no way out either: `route-list` attaches
  the same way.
- **It waits out an open dialog rather than skipping it.** The page is blocked
  on the dialog, only that client can answer it, and a dialog open when the
  client goes most likely stands — so dropping the session there would hand
  back a page nothing can unblock. The teardown is written on the tab instead
  and runs as the dialog clears, which is where the first version of this was
  wrong: it skipped, and by then the claim was already gone, so nothing would
  ever have asked again. That is the whole bug in a narrower doorway, and
  review caught it. A fresh client taking the tab's dialogs cancels the waiting
  teardown, because what is set on the tab then belongs to whoever has it.

An older desktop shell does not have the command, and the renderer feature-tests
for it: there the state outlives the claim, as it did everywhere before this.

## Handing a tab over, and taking it back

The refusal is a dead end on its own: an agent says "ask them to hand it over"
and the person has nothing to press. So the refusal itself raises the ask —
once per command: placing a command in a tab's queue resolves its tab too, and
that resolve used to ask again. The
executor records it (`browserTabHandoverAskAtom`), and the browser chrome draws
a row under the address bar — *Claude Code is asking to work in "…"* —
with two answers beside it: **Let them look**, which lends the page, and **Hand
it over**, which lends the browsing. It stays in the page chrome, where the
driving indicator no longer is, because this one is about the tab in front of
you. Either answer claims the tab for that agent, in the mode it names; the
agent's next command works, or its next *read* does.

An agent that holds a look claim and tries to act is refused, and that refusal
raises this row again — which is how a look becomes a handover. Then only **Hand
it over** is offered, and the row says the agent is asking to work in the tab
*and not just read it*: a second **Let them look** would grant what was already
granted and read as having answered.

**And the refusal says so**, rather than sending the agent off to ask for what
it has already asked for (#116). What it promises is deliberately small:
naming the tab is what asks, and the ask does not survive a reload of their
window, so naming it again after a wait is what asks again. It does *not*
promise a row on screen, for two reasons. The row rides the page chrome, which
is mounted only over a web tab, so a person sitting in Settings, an extension
page or a plugin's panel — the routes that take a tab of their own — has an ask
recorded and nothing drawn until they come back to a web tab. (A thread is not
one of those: it paints in the side panel, so the row is on screen beside it.)
And an ask that arrives while another is still answerable is dropped rather
than shown, so naming a tab again does not necessarily put a row up — it asks
again, and the answer waits behind whoever asked first.

The ask carries both halves of the question, which is why it comes from the
agent rather than from a menu: a menu would have to list every grant on the
install so the person could pick the one they were already talking to.

The other direction is on the tab's own context menu, where the tab is the thing
being pointed at: **Take back from Claude Code** on a tab an agent holds, and
**Stop Claude Code reading this** on one it was only lent — "take back" would be
an offer to undo something nobody did. The strip's mark tells the two apart for
the same reason: a stale look claim wearing the driving mark would read as an
agent with the run of a page the person is still working in, which is the
objection that ruled out keeping the two relations apart in the first place.

The agent's own way out is `patcher browser release` above.

The agent chooses which tab it names, so it also chooses what the ask is *about*
— which is why the row names the tab it would be given, with its address, rather
than saying "this tab". And a later ask does **not** replace the one waiting:
otherwise an agent could show a harmless page, wait for the person to commit to
pressing, and swap in the tab it actually wanted. The waiting one stands until
they answer or dismiss it — or until its tab is closed, which leaves nothing to
answer.

## Where it lives

`apps/app/src/lib/browser-agent/tab-owners.ts`, as a map from tab id to the
`issuer` the server put on the command and the mode the person answered — the
issuer is the same value the driving indicator draws, keyed the same way (kind
and id, never the label, so a renamed grant is still itself). A claim stored
before there were modes is read as a `drive` claim, which is what it meant; a
new storage key would have handed every agent's tab back to the person on the
upgrade and then refused the agent its own next command, which is the failure
persistence is here to prevent. The trade is the other direction: an older build
reading a map this one wrote drops every claim in that window. `resolveTab` in `execute.ts` is the one place every tab-targeted
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
- **Not the whole of ordering.** Browser commands now take turns on a tab
  (`tab-queue.ts`) and each caller has its own trace (`traces.ts`), so two
  *callers* no longer split each other's reads or share a log. Three things
  that is not: the person's own clicking and a page's own navigation reach the
  page by their own paths and are sequenced against nothing; and two shells
  holding the app key are one caller here, so they still share a trace, as they
  share everything else. A ref, which was the third of these, now carries the
  snapshot that minted it (`refs.ts`), so acting on an element another caller's
  snapshot moved is refused without anybody having to ask for the check — as
  long as the ref is passed back as it was printed. A bare `eN`, stripped or
  typed by hand, is still accepted and still unchecked.
- **Not a per-process identity.** Everything holding the app key is one
  `outside` caller, so two shells share one set of tabs and can read each
  other's — and a tab handed to `outside` is handed to all of them. That is what
  the identity means, not a leak in this rule — a grant is the narrower answer,
  and it is per agent
  ([browser-external-access.md](browser-external-access.md)).
- **Not undone by revoking.** A revoked or paused grant keeps its claims: it can
  do nothing with them, and the tabs stay out of every *other* agent's way until
  the person takes them back from the tab menu. Sharper for a look claim, which
  sits on a tab the person is *using*: a revoked grant's stale look mark stays in
  their strip until they clear it, saying an agent may read a page when nothing
  can. Same fix, same menu. The alternative — returning them
  to the person on revoke — would quietly make a page an agent had been working
  in the default target of the next caller's unqualified command.
- **Not a window-level signal.** A tab an agent holds carries a mark in the
  strip, named after the agent, and its menu offers the tab back. Both are drawn
  from this window's own tab state, so a person reading a thread in another
  window still sees nothing. The driving indicator had the same gap and no
  longer does — the server tells the app's other windows who is driving
  ([browser-external-access.md](browser-external-access.md)) — which is also the
  shape of the fix here, and a bigger one: *who* is driving is one line, while
  *which tabs whose* is a second window's whole strip.
