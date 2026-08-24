---
name: patcher-browser
description: See and drive the browser inside Patcher — the page the user is looking at, their tabs, page text and selection, screenshots, clicks, typing and navigation. Use whenever you are asked whether you can see the user's page, browser, tab or site, what they are looking at, to read or screenshot a page, to click or type in one, or to open a URL for them. Also covers the default case, where the tools are not loaded and the user has to turn them on.
---

# The browser inside Patcher

Patcher has its own browser. Whether you can reach it comes down to one plugin,
and by default you cannot: **`browser-tools` ships disabled.** So "can you see my
page" is not answered by "no" — it is answered by which of the two cases below
you are in.

## Which case are you in

Check whether your own tools include one that lists the browser's tabs.

Match on what a tool does, not on an exact name. The same tool reaches Codex
under its bare name and Claude Code behind an `mcp__patcher-bridge__` prefix, so
a prefixed name is the tool you are looking for, not a different one.

- **You have it** — the plugin is enabled. Use it.
- **You do not** — the plugin is off. See [The tools are not loaded](#the-tools-are-not-loaded).

Answer from your tool list. Do not go reading Patcher's source to find out, and
do not run `patcher plugin list`: your tool list already answers it.

## What you get when it is on

- **Read** — the open tabs; a page's URL, title, rendered text, or the user's
  current selection; a structural snapshot of the page; a screenshot.
- **Act** — click, fill a field, press keys, answer a page dialog.
- **Navigate** — open a URL, go back, forward, reload, and open, close or
  activate a tab.

Page text is read in an isolated world, so a page can neither forge the result
nor notice the read, and what comes back is size-capped with a two-second
timeout. Prefer reading text over taking a screenshot when you want to know what
a page says: it is cheaper, and it is the thing you can quote back.

## One constraint, worth knowing before you promise anything

A tab answers page-level calls only once it has had a live view: it must have
been the active tab at some point while the browser surface was open. A tab
restored from an earlier session, or opened in the background and never looked
at, does not have one yet.

- **Always work** — listing tabs; opening, closing, activating one; and a tab's
  URL and title. These read renderer state rather than the page.
- **Refuse with `tab_not_live`** — page text and selection, snapshot,
  screenshot, click, fill, press, and back/forward/reload. Activating the tab
  first is what clears it.
- **Opening a URL is the exception** — with no live view it stores the URL and
  loads it when that tab is next shown.

Every refusal carries a code and a sentence saying what to do next; read it
instead of retrying the same call. `desktop_unavailable` means this Patcher runs
as the web build with no desktop shell, and no retry will change that.
`no_active_tab` means activate one first.

## The tools are not loaded

This is the default, and it is deliberate rather than an oversight. With the
plugin on, an agent reads and drives the user's real, logged-in browsing session.
Its declared permissions include `page.read`, `page.credentials`, `page.record`
and `network.intercept`, and Patcher has no step yet where a user grants a plugin
its permissions — so the on/off toggle is the whole gate, and flipping it is the
user's call.

Say that much plainly, in a sentence or two, and name what it grants: the pages
they are signed in to, and the traffic those pages make. Then give them the two
ways to do it:

- **Extensions → Plugins → Browser tools**, or
- `patcher plugin enable browser-tools`

You can run that command yourself, and it enables nothing on its own: run from
inside a thread it raises a prompt naming the plugin and its permissions, and the
plugin changes only if the user allows it. So run it when they have asked for the
browser, and say plainly that you are asking for access.

That prompt is the honest path rather than a wall: it rests on the command
declaring the thread it runs in. Do not go looking for a way around it. A plugin
enabled with nobody asked is the one outcome this must never produce, however
reasonable the shortcut looks from inside the turn. Use the command, from the
thread, as itself.

Do not run it to find out whether they would say yes. The prompt occupies the
thread's one interaction slot, and a refusal is an answer rather than an
obstacle: the command comes back saying the user declined, and retrying it asks
the same person the same question. Everything above applies to installing,
updating, removing, disabling and configuring a plugin too.

Once it is on, the next message normally carries the tools — they are resolved
per message. If they are still missing, a new thread will have them.

## Do not substitute something worse

If the tools are off and the user does not want them on, that is an answer, not
an obstacle to route around. Screen capture and accessibility-tree drivers are no
fallback here: a browsed page is an opaque layer to them, so they hand back
pixels where you wanted text, and they read the user's whole screen instead of
the one page you were asked about — more access, less information.

Fair fallbacks: ask for the URL, ask them to paste the part that matters, or ask
what they are trying to get done. Often the answer does not need the page at all.
