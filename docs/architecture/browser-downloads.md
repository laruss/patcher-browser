# Browser Downloads

The first Tier 1 item from [browser-gaps.md](browser-gaps.md): a download link
in the browser surface now produces a file.

Scope, deliberately: **downloading works, and there is no downloads screen.**
No page, no window, no persisted history, no progress bar, no pause or resume.
What there is: a toolbar button that appears once something has been
downloaded, and the ten most recent downloads behind it.

## What was denied, and what replaced it

`desktop-browser-view.ts` used to answer every download with

```ts
// Downloads are denied in v1 (lowest file-surface risk).
browserSession.on("will-download", (event) => event.preventDefault());
```

which is why every download link, "export CSV" button and
`Content-Disposition: attachment` response did nothing at all — silently, with
no error screen and no log. The denial was a real decision; the silence on top
of it was not.

Now the shell picks a path, lets the transfer run, and reports what happened on
its own IPC channel.

## The save dialog is not used, and that is the load-bearing choice

Electron's default, once the denial is removed, is to show a native save dialog.
It is rejected for two independent reasons:

- **It is owned by the app window.** A page could freeze the whole agent
  workspace by starting a download, which is the same defect JavaScript dialogs
  had before [browser-automation.md](browser-automation.md)'s Stage A took them
  over.
- **Nothing would answer it.** A download an agent triggers would wait on a
  modal with nobody there, which is exactly the failure mode this project's
  automation work exists to avoid.

So the shell calls `item.setSavePath()`, which is what suppresses the dialog —
and it only counts inside the `will-download` handler, because Electron reads
`savePath` as the event returns. That synchronous demand is also what shapes the
plugin API below.

Files go to the OS downloads folder (`app.getPath("downloads")`), read per
download rather than captured once, so a relocated folder is picked up without
restarting the app.

## Naming a file a page chose

Everything a download names is attacker-influenced. `desktop-browser-download.ts`
holds those rules, with the filesystem injected so they are testable directly:

| Rule                                   | Why                                                                                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep only the last path component      | `../../.ssh/authorized_keys` is a valid `Content-Disposition` filename, and joining it to a directory is how a download escapes that directory. This one is not a hardening measure, it is the correctness of the join. |
| Drop control characters, including NUL | A name that ends early at the filesystem layer is not the name we reported saving.                                                                                                                                      |
| Drop `<>:"\|?*`                        | Illegal on Windows.                                                                                                                                                                                                     |
| Strip leading dots                     | A page cannot drop an invisible file into the user's folder. `.gitignore` saves as `gitignore`; `.` and `..` collapse into the fallback rather than needing cases of their own.                                         |
| Strip trailing dots and spaces         | Windows removes them silently, leaving the file under a different name than the one reported.                                                                                                                           |
| Defuse Windows device names            | `CON.txt` cannot be created there, and the failure is obscure enough to be worth avoiding.                                                                                                                              |
| Truncate to 180, keeping the extension | Well under a filesystem's per-component limit, with room for the ` (12)` a collision adds.                                                                                                                              |

Collisions count up the way Chrome's do — `report.pdf`, `report (1).pdf` — and
split at the **last** dot, so a second `archive.tar.gz` is `archive.tar (1).gz`.
That looks wrong and it is what Chrome writes, which is what a user comparing
the two will expect.

Two limits are stated rather than hidden. The uniqueness check is a
check-then-write, so two downloads racing for one name can both resolve to it
and the second wins; owning the file handle instead would mean owning the
transfer, which `DownloadItem` does not hand over. And after 999 taken suffixes
the name falls back to a timestamp, because a thousand collisions is something
generating names, and the loop has to end somewhere other than overwriting.

## Rate limiting, and why a refusal is reported

A page can start downloads without a click, so they go through the same
sliding-window limiter the popup policy uses: five per ten seconds per tab. Past
that the download is refused and **the refusal is pushed to the renderer** — the
same cap catches a legitimate "download all" button, and a user whose files
stopped arriving needs to know it was Patcher that stopped them.

That is why `refused` is a state of its own rather than a failure: a caller must
be able to tell "the network failed" from "we said no", and only one of those is
worth retrying.

A download from a `webContents` the manager no longer tracks is refused with no
event at all — there is no tab to attribute it to and nobody to tell.

## The wire, and the two events

A new channel plus an optional `onDownload` on `PatcherDesktopBrowserApi`, which is
invariant 2 of [bb-migration.md](bb-migration.md) and the same shape favicons,
scoped popups and page reads used. Feature detection is the negotiation, and it
is unusually clean here: a shell that predates downloads has no channel _and_
denied every download, so a caller finding no `onDownload` is correctly told
there is nothing to report.

Each download produces a `started` event and exactly one terminal event under
the same id. Two events rather than one, for a reason that is not polish: with
only a completion event, a user clicking a 200MB file sees nothing for two
minutes and clicks again — producing a second download and, eventually, the rate
limiter. The id is what lets the renderer replace its own message in place
rather than stack a second one.

There is no progress between them. The shell reports starting and finishing and
nothing else, so the message says "Downloading…" without a bar; a determinate
bar over an unknown quantity would be a lie.

The payload also carries `url` and `mimeType`, which nothing in the browser uses.
They are there for plugins — a handler deciding where a file belongs needs to
know where it came from and what it is, and the shell is the only place that
knows.

## The button, and the list behind it

The browser's whole download UI is one toolbar button, immediately right of the
address bar, plus a list it opens.

**It is absent until something has been downloaded.** Not disabled, not empty —
absent. The state behind it is in memory only, so a freshly launched app has no
button at all, which is the honest thing to show: there are no live downloads
after a restart, and a persisted history is a different feature with storage and
pruning of its own.

Four states, and the reason they differ is what each one is _for_:

| State       | Look               | Cleared by           |
| ----------- | ------------------ | -------------------- |
| idle        | default foreground | —                    |
| downloading | bouncing icon      | finishing on its own |
| finished    | green              | opening the list     |
| failed      | red                | opening the list     |

Green and red persist until the list is opened because a download finishes while
the user is reading a page, and the toast that announced it is gone seconds
later. The animation is the exception: it describes something still happening,
so it needs no acknowledgement.

Two ordering rules fall out of that, and both are the kind of thing that is
obviously right only after seeing the alternative:

- **A download in flight outranks an unseen outcome.** The animation is the only
  progress signal there is, and it is about something still changing.
- **An unseen failure outranks a later success.** Otherwise a background
  download finishing would quietly clear the only sign that an earlier one
  failed.

The list holds ten, newest first, and a download is **one row for its whole
life**: the `started` event creates the row and the terminal event updates it in
place, so a finishing download does not jump to the top of a list being read.
Cancelled, interrupted and refused all render as one `error` status, because a
row has one status icon and they differ only in why nothing arrived.

### It floats over the page, which costs a frozen page

A native `WebContentsView` composites above the DOM, so React cannot draw over a
live page at all. [omnibox.md](omnibox.md) answers that by giving the suggestion
list layout space, and this list shipped the same way first — which was wrong
for a dropdown, because a dropdown that shoves the page down is not a dropdown.

The way over a page is the one JavaScript dialogs already use: **freeze the page
to a bitmap, hide the native view, and draw on the DOM that is left.**
`setOverlay` is that sequence as a command — capture, push the bitmap on the
snapshot channel, hide; and on close, reveal first and drop the bitmap second,
so the swap never flashes an empty panel.

Two things follow, and the second is the point:

- **The page is a still image while the list is open.** Video stops, animation
  stops. Acceptable for something opened and closed in seconds; not something to
  leave on, which is why the overlay is released when the panel closes _and_
  when the chrome unmounts. The chrome asks for both (`onPageOverlayChange`) and
  the surface makes the call — one owner per window, for the reason in
  [browser-surface.md](browser-surface.md).
- **The whole window is DOM again, so clicks land.** That is what makes
  close-on-outside-click work over the page area — the thing that is impossible
  while a live view is composited there.

One deliberate difference from the dialog path: dialogs hide the view
immediately and let the capture catch up, because the page is already blocked
and cannot wait. This captures _first_ and hides when the bitmap is in hand, so
opening the menu never flashes. A capture that fails hides anyway — a live page
under a panel already drawn over it is worse than a bare one.

Escape closes it from anywhere in the chrome, and focusing the address bar
closes it too.

### Opening a file, and the check that makes it safe

Each row offers open and show-in-folder, both disabled when there is no file (a
refused download never wrote one). They go through one channel, and the shell
**only acts on a path it wrote itself this session**.

That check is the design, not a precaution. Without it the channel is "open any
file on this machine", reachable from the renderer, with a path a page had a
hand in naming. The manager keeps the paths it wrote in an insertion-ordered set
bounded at 100 — comfortably more than the ten the list shows, so a row can
never name a path the shell has forgotten.

The failure worth reporting is the ordinary one: the user moved or deleted the
file after downloading it. Electron reports that as a non-empty string rather
than by rejecting, and it surfaces as a toast. `unknown-path` is kept separate
because it means a bug on our side rather than anything the user did.

## Rewriting downloads in a plugin

`patcher.browser.registerDownloadHandler(handler)` — the plan's
`browser.downloads.handlers`. A handler receives each finished download and may
do anything with the file: move it by media type, rename it, hand it to an
agent, upload it, delete it.

**A handler cannot prevent the write, and that is a platform limit rather than a
policy.** Chromium demands the save path synchronously, inside the
`will-download` handler, while a plugin lives in the Patcher server process behind a
WebSocket and an HTTP hop. No cross-process answer can arrive in time. So Patcher
writes first and hands the result over; a plugin that wants files elsewhere
moves them, and one that wants them gone deletes them.

The alternative that _would_ allow prevention is worth recording since it was
considered: write into a shell-owned staging directory, then let a handler
decide the final home asynchronously. It costs a second move (with a copy
fallback across volumes), partial files visible in a directory the user does not
expect, and cleanup after a crash — for the ability to stop a write that a
handler can already undo. Not worth it now; the seam that would change is
`resolveDownloadDirectory`, which is one injected function.

The chain, mirroring the omnibox contribution point exactly:

| Step                                      | Where                                         |
| ----------------------------------------- | --------------------------------------------- |
| `patcher.browser.registerDownloadHandler` | `packages/plugin-sdk/src/backend-contract.ts` |
| Registration, runtime record              | `apps/server/.../plugins/plugin-api.ts`       |
| Fan-out, time box, isolation              | `apps/server/.../plugins/plugin-service.ts`   |
| `POST /plugins/browser/downloads`         | `apps/server/src/routes/plugins.ts`           |
| Reporting the download                    | `apps/app/src/lib/browser-downloads.ts`       |

Three properties follow the omnibox's discipline rather than inventing their
own: handlers are additive (several per plugin, several plugins), each is
time-boxed and failure-isolated so a throwing one changes nothing for the
others, and the route takes the same local-origin guard as every other route
that runs plugin code.

Two decisions specific to downloads:

- **Terminal states only.** A handler never sees `started`, because a handler
  that moved a half-written file would truncate the download it was trying to
  help with. It does see `cancelled`, `interrupted` and `refused`: a plugin
  syncing downloads elsewhere needs to know one did not arrive.
- **A 30s time box**, not the omnibox's 2s. A handler is doing filesystem work
  on a file that already exists, and nothing waits on it — the file is written
  and the user has already been told.

The route validates its payload with its own schema and its own caps rather than
importing the desktop contract: the server does not depend on the desktop
boundary, and the route has to defend itself against any caller, not only
against our own shell.

## Verified

- `desktop-browser-download.test.ts` — every sanitizing rule, including the
  path-escape case that makes the join safe, NUL, the Windows device names, and
  truncation that keeps the extension (and the absurd-extension case that
  cannot); collision counting, the last-dot split, and the timestamp fallback.
- `desktop-browser-view-manager.test.ts` — a download saved under a sanitized
  name with **no `preventDefault`** (the dialog suppression is the feature), the
  terminal event arriving under the id the start used, a failed transfer passed
  through as its own state, the rate limit refusing and saying so, a download
  from an untracked view refused silently, and a name already on disk stepped
  around.
- `preload-browser-api.test.ts` — `onDownload` on the exposed surface.
- `browser-downloads.test.ts` (app) — the wording and tone for every state, the
  id carried through so the message updates in place, the directory read from a
  posix and a Windows path, and that the reported name is the one written.
- `browser-downloads.test.ts` (app) — the button's states: absent until
  something is downloaded, progress outranking an unseen outcome, an unseen
  failure surviving a later success, acknowledgement returning it to idle, a
  download updated in place rather than added twice, the ten-row cap, and every
  unfinished state collapsing to one failure outcome.
- `BrowserDownloads.test.tsx` — the same states through the real chrome, driven
  by a shell download event: the button appearing and clearing on click, the
  list's rows and their order, open and show-in-folder reaching the shell with
  the right action and path, both disabled for a download with no file, the page
  frozen while the list is open and revealed when it closes **or when the chrome
  unmounts**, and the list closing on an outside click, on Escape, and on the
  address bar taking focus — while a click inside it changes nothing.
- `desktop-browser-view-manager.test.ts` — the overlay sequence: the page still
  showing while the capture is in flight and hidden only once the bitmap is
  pushed, the reveal-then-clear ordering on close, and the page hidden anyway
  when the capture fails.
- `desktop-browser-view-manager.test.ts` — the path allowlist: a file Patcher
  downloaded opens and reveals, **a path it did not write is refused and
  nothing is touched** (including a plausible one inside the downloads folder),
  and the OS refusal passed through as a failure.
- Full suites: `@patcher/desktop` 44 files / 472 tests, `@patcher/app` 357 files / 2770
  tests. Repo typecheck 59/59, `bunx turbo run lint` clean.

**Written but not executed:** `plugin-browser-downloads.test.ts` (fan-out to two
handlers, isolation of a throwing one, failure and refusal states, a malformed
payload refused, the cross-origin guard). No `@patcher/server` test runs on this
machine — its forked workers are killed before they report, and the
pre-existing `plugin-omnibox-providers.test.ts` fails identically, so this is
the environment rather than the change. `bun run ensure-native-modules` is the
documented fix (`bb-migration.md`, finding 9) and its native rebuild is also
killed here. Run the file on the `.nvmrc` Node before trusting the plugin half.

**Not verified against a real browser at all.** Every test above runs against a
fake `session`/`DownloadItem`, so what nothing here proves is that Electron
behaves as documented:

- that `setSavePath()` inside `will-download` really does suppress the save
  dialog (the whole design rests on it);
- that `item.getFilename()` carries the `Content-Disposition` name rather than a
  URL-derived one, and that a page can influence it at all;
- that `done` fires with `interrupted` for a dropped connection rather than
  hanging;
- that `shell.openPath` and `shell.showItemInFolder` do what the row's two
  buttons claim, on a real file;
- that the freeze reads as instant — `capturePage` is fast, but nothing here
  measures it, and a slow capture would show as a menu that lags its click;
- that a PDF link now downloads instead of doing nothing — the PDF entry in
  [browser-gaps.md](browser-gaps.md) was a _consequence_ of this denial, so
  removing it should change that behaviour too, in a way nothing here checks.

The shortest way to find out:

```bash
bun run dev            # and, in another shell, bun run dev:desktop
# open /browser, then click a download link on any site
ls -lt ~/Downloads | head
```

## Next

**Progress** is the obvious next one, and the only one with real work behind it:
it needs `item.on("updated")`, a rate-limited push, and a determinate bar in the
row — at which point the button could show progress rather than a bounce.

Beyond that: **persistence**, which turns the session list into a history and
belongs with whatever surface ends up owning browser data (the same place the
24-entry navigation history cap should be revisited); **pause, resume and
cancel**, which need a handle on the `DownloadItem` the shell currently drops;
and a **dangerous-file warning** before opening an executable, which is the one
thing a browser does here that this does not.

Worth deciding at the same time: the toasts now overlap the button. A finished
download announces itself twice — once as a toast, once as a green icon that
persists. Dropping the success toast and keeping the failure one is the likely
answer, but it is a product call rather than a cleanup.
