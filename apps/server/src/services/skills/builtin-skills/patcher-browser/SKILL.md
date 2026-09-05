---
name: patcher-browser
description: See and drive the browser inside Patcher — the page the user is looking at, their tabs, page text and selection, screenshots, clicks, typing and navigation. Use whenever you are asked whether you can see the user's page, browser, tab or site, what they are looking at, to read or screenshot a page, to click or type in one, or to open a URL for them. Works from inside a Patcher thread and from any other terminal on the machine; also covers the default case, where access is off and the user has to turn it on.
---

# The browser inside Patcher

Patcher has its own browser, with the user's real logins in it. Reaching it is
gated, and by default you cannot: **the browser is closed until the user opens
it.** So "can you see my page" is not answered by "no" — it is answered by which
of the two cases below you are in.

## Which case are you in

**Are you a thread inside Patcher, or a terminal beside it?** The answer decides
everything below, and you can tell without asking: a thread inside Patcher has
`PATCHER_THREAD_ID` set in its environment.

### Inside Patcher

Check whether your own tools include one that lists the browser's tabs.

Match on what a tool does, not on an exact name. The same tool reaches Codex
under its bare name and Claude Code behind an `mcp__patcher-bridge__` prefix, so
a prefixed name is the tool you are looking for, not a different one.

- **You have it** — the plugin is enabled. Use it.
- **You do not** — the plugin is off. See [Access is off](#access-is-off).

Answer from your tool list. Do not go reading Patcher's source to find out, and
do not run `patcher plugin list`: your tool list already answers it.

### Outside Patcher

You have no browser tools and never will — they are served to Patcher's own
threads. What you have is the CLI, and it reaches exactly the same browser:

```bash
patcher browser status
```

That one command answers everything at once — whether Patcher is running, whether
a browser window is open, whether you are allowed, and which tab is in front. Run
it first and read what it says rather than guessing from a later failure.

**If `patcher` is not on your PATH**, this install keeps one at
`~/.patcher/bin/patcher`, which is the same path on every machine. Use it
directly, or put that directory on PATH. A different data directory moves it:
`PATCHER_DATA_DIR` names one, and a source checkout uses `~/.patcher-dev/`
instead.

Two failures are worth telling apart before you conclude anything:

- **`Patcher is not running at …`** — nothing is listening. Ask the user to open
  Patcher; nothing you can run will fix it.
- **a refusal naming a permission and a level** — Patcher is running and the user
  has not allowed you this far. That is a decision, not a fault. See
  [Access is off](#access-is-off).

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
been the active tab at some point while the browser surface was open, or have
been opened in the background on purpose. A tab restored from an earlier session
does not have one yet.

- **Always work** — listing tabs; opening, closing, activating one; and a tab's
  URL and title. These read renderer state rather than the page.
- **Refuse with `tab_not_live`** — page text and selection, snapshot,
  screenshot, click, fill, press, and back/forward/reload. Activating the tab
  first is what clears it.
- **Opening a URL is the exception** — with no live view it stores the URL and
  loads it when that tab is next shown.
- **Opening one in the background is live** — `activate: false` (or
  `patcher browser open <url> --background`) loads the page without moving the
  user's focus, so you can read it straight away. That is the flag to reach for
  in a browser someone is also working in; without it, your first navigation
  drags their window onto your page.

## A loaded page is not a ready page

The single most expensive mistake here is reading a page once, finding nothing,
and reporting that there is nothing. On any site that renders itself the
document finishes loading before its content is fetched, so the first read
returns the frame around the page.

- The `patcher browser` acting commands wait for the page to stop fetching
  before they answer, so a read straight after one of them is safe.
- For anything else — content that arrives on its own, a redirect you expect —
  `patcher browser wait --text "…"`, `--selector <css>`, `--url <pattern>` or
  `--network-idle`. It exits 124 when the condition never came, which is not the
  same as the page failing.
- Never sleep instead. Acting on an element already waits for it to be visible
  and settled.

Every subcommand of `patcher browser` has its own `--help` — that is where the
exact argument forms are, and the options that command actually reads. A flag it
does not read is refused by name rather than ignored, so `--help` is cheaper than
guessing.

Every refusal carries a code and a sentence saying what to do next; read it
instead of retrying the same call. `desktop_unavailable` means this Patcher runs
as the web build with no desktop shell, and no retry will change that.
`no_active_tab` means activate one first.

## Access is off

This is the default, and it is deliberate rather than an oversight. Whoever
drives this browser reads and acts inside the user's real, signed-in session. So
it is closed until they open it, and there are **two different gates** depending
on which case you are in above. Do not confuse them: opening one does not open
the other, and telling the user to change the wrong one wastes their time.

### You are a thread inside Patcher

Your gate is the `browser-tools` plugin. Say plainly what turning it on grants —
the pages they are signed in to, and the traffic those pages make — and give them
the two ways:

- **Extensions → Plugins → Browser tools**, or
- `patcher plugin enable browser-tools`

You can run that command yourself, and it enables nothing on its own: run from
inside a thread it raises a prompt naming the plugin and its permissions, and the
plugin changes only if the user allows it. So run it when they have asked for the
browser, and say plainly that you are asking for access.

Once it is on, the next message normally carries the tools — they are resolved
per message. If they are still missing, a new thread will have them.

### You are a terminal beside Patcher

Your gate is a setting, **Agents outside Patcher**, and it has four positions:

| Level      | What it allows                                                          |
| ---------- | ----------------------------------------------------------------------- |
| `off`      | Nothing. The default.                                                    |
| `read`     | Tabs, page text and structure, screenshots, console and network logs.    |
| `interact` | The above, plus opening tabs, navigating, clicking and typing.           |
| `full`     | The above, plus cookies and site storage, page JavaScript, and recording. |

Ask for the lowest one that does the job — most requests are `read`, and asking
for `full` to read a page is asking for the user's logins to answer a question
that did not need them. The two ways to change it:

- **Settings → General → Agents outside Patcher**, or
- `patcher settings browser-access <level>`

**You may run that command, and from a plain terminal it takes effect
immediately** — the server cannot tell your shell from the user's own, so
running it is you acting as them. That makes it something to ask for rather than
to do: say which level you need and why, and let them run it or tell you to.
Raising it yourself, unasked, is the one outcome this must never produce.

If you are a thread inside Patcher and you run it, it raises a prompt on your
thread instead, and changes nothing unless the user allows it — the same shape
the plugin toggle has. Do not run it to find out whether they would say yes: the
prompt takes the thread's one interaction slot, and a refusal is an answer.

### Either way

The refusal you get carries the permission it needed, the level that would admit
it, and the exact command that changes it. Relay that rather than retrying the
same call — retrying asks the same person the same question, or nobody at all.

## Do not substitute something worse

If access is off and the user does not want it on, that is an answer, not
an obstacle to route around. Screen capture and accessibility-tree drivers are no
fallback here: a browsed page is an opaque layer to them, so they hand back
pixels where you wanted text, and they read the user's whole screen instead of
the one page you were asked about — more access, less information.

Fair fallbacks: ask for the URL, ask them to paste the part that matters, or ask
what they are trying to get done. Often the answer does not need the page at all.
