# Changelog

## 0.1.1-alpha.3

alpha.2 made a sandboxed turn the default. This build is what came of taking
that seriously: a review went looking for ways out of the sandbox and found
them — the app key sitting in a terminal's environment, a rename that walked
around a deny, a CLI a turn spawned outside its own boundary — and each one was
measured before and after rather than reasoned about. Beyond that, a sandboxed
turn's network can be held to a list, an ACP agent and Pi run inside the
boundary their mode promises, and a repository's own setup script asks before it
runs.

Still macOS on Apple Silicon, still ad-hoc signed, and still without
auto-update: the first launch needs one explicit approval in System Settings,
and a newer alpha has to be downloaded rather than offered. On Linux the sandbox
is `bubblewrap`, and a machine that cannot build one refuses the turn instead of
running it unconfined.

### What a sandboxed turn no longer reaches

- **The files git executes.** A clone whose config, hooks or `.gitattributes`
  name a program no longer runs it inside Patcher's git — for Codex turns as
  well as Claude ones, on Linux as well as macOS, and no longer only where the
  path is spelled the way the rule expected. Renaming `.git`, editing the file
  and renaming it back walked around every one of those denies; each directory
  on the way to a protected path is now protected as a name.
- **Other threads.** A turn drives its own thread and the ones it spawned. A
  thread it creates can only name the caller's own thread as its parent and the
  caller's own project — a parent is not a filing label, it is a turn dispatched
  on that thread when the child finishes, at that thread's own permission mode.
- **A more privileged next turn.** A turn cannot ask for more privilege than it
  has, and it can no longer write the app settings it is running under: three
  fields of that object decide what network the next turn gets. Appearance and
  keyboard stay writable, because a documented agent workflow ends in one of
  them.
- **A workspace outside the project's sources.** Refused when the thread is
  created, and asked for through `update_environment_directory` instead.
- **The app key.** Out of a terminal's environment, and out of the ACP bridge —
  which runs outside the sandbox its agent runs inside and used to answer
  `fs/readTextFile` and `fs/writeTextFile` for any path at all. The bridge now
  carries the same denied credential files, the same protected repository
  entries, and the same write roots as the profile.
- **A key that outlives its turn.** A thread has two credentials with two
  lifetimes, so `nohup` from a turn's shell loses the API when the turn ends.
- **The CLI, except as an API.** `patcher mcp-serve` is spawned by Codex rather
  than by a sandboxed shell, and ran whatever argv the model passed — one
  command wrote a file through a positional path with no server involved at all.
  It now runs only the commands whose whole effect is a request to the API, and
  answers the rest by naming the turn's own shell, where the sandbox says which
  paths exist.

### Consent

- A repository's own `.patcher-env-setup.sh` asks before it runs. The answer is
  remembered per machine, checkout and file contents, and is revocable in
  Project Settings; allows made before this build are dropped, so the question
  is asked once more.
- A terminal can answer a consent prompt, so a headless host is no longer a
  thread nobody can unblock.
- A plugin cannot answer one — in either direction. Allowing and dismissing are
  a person's, not something a plugin holding `threads` settles while a turn
  waits.
- An MCP server's tool in a Codex turn asks, instead of being refused.
- A host nobody put on the list asks, instead of failing as a network error.

### Terminals

- An agent's terminal runs inside its turn's boundary, and is refused where
  bubblewrap cannot build a namespace rather than opening unconfined.
- The tab says `sandboxed`, the panel names what is refused, and
  `patcher terminal list` has a `Sandbox` column.
- A terminal you open from a thread view keeps your own credential. It used to
  be handed the turn's, which refused you `patcher terminal restart|close|input`
  on the terminal you were sitting in and left your own consent prompts
  unanswerable from that shell.
- `patcher terminal create --self` and `list --self`, so a turn does not have to
  go find its own thread id before it can open a terminal.

### Providers and the network

- **Settings → General → "Confine the network of sandboxed turns"**, with an
  allow-list of hosts. Off by default, and built on macOS and on Linux.
- **Settings → Codex → "Take the network from sandboxed turns"**, off by
  default.
- ACP agents — Cursor, OpenCode, Grok and Hermes — run inside the boundary their
  mode promises, with the state directories and hosts each one needs measured
  rather than guessed, and a registered agent can declare its own.
- Pi has a mode besides Full Access. Its network is not confined there, and
  Patcher says so rather than implying otherwise: its client ignores the proxy.
- The `patcher` CLI reaches a Codex turn as a tool, not only over the network.

### The daemon

- A loopback API credential of its own.
- A config write survives a reload the running server refuses.
- The offline reload endpoint is pinned, not just its port.

### Browser tools

- Nine things an agent trips over in `patcher browser`, including a scoped page
  read, and four more a later review found: `wait --url` matches a pattern with
  a `?` in it, so a redirect ending in a query string is waitable at all;
  `--tab` takes a URL or title substring rather than only something shaped like
  an id; a scoped read has a deadline of its own instead of hanging on the
  page's; and `wait --text` searches the whole page rather than the first 20 000
  characters of it.
- A browser action that refuses says which check refused it, instead of
  sometimes reporting a deadline that expired while it was asking.

### Fixes and polish

- A turn can fork a thread again. The scope check read `fork` as a thread id and
  refused every turn that tried; the fork is now held to the same relationship
  as any other thread a turn drives.

### Docs

- Installing on Linux says what it needs: `bubblewrap`, and the
  unprivileged-user-namespace sysctl Ubuntu 24.04 restricts — where `bwrap` is
  installed and still answers `Permission denied` to everything.
- [Security](https://github.com/laruss/patcher-browser/blob/main/docs/security.md)
  is corrected where it had drifted, and names what this build still leaves
  open: how long a turn's credential really lives, and two ways around the
  Linux network boundary.

## 0.1.1-alpha.2

Agents now run sandboxed by default, and stepping outside the sandbox is a
choice you make on purpose. Plus a round of browser fixes, tighter plugin
isolation, and a start-up that no longer lands on a white screen.

Still macOS on Apple Silicon, still ad-hoc signed, and still without
auto-update: the first launch needs one explicit approval in System Settings,
and a newer alpha has to be downloaded rather than offered.

### Agents are sandboxed by default

A thread runs inside the operating system's own sandbox: the agent writes in its
workspace and nowhere else. macOS ships that sandbox; on Linux Patcher needs
`bubblewrap` installed.

- A machine that cannot sandbox refuses the turn and names what to install,
  instead of running the turn without one.
- A provider that does not offer the mode you picked now resolves **down** to
  the sandbox instead of up to Full Access.
- Every machine still set to Full Access is lowered to the sandbox ceiling when
  you update. Raise it again in Settings if that is what you want — the message
  a refused turn shows names the limit and whose it is to change.
- **Full Access** is no longer the third item in a menu. Choosing it opens a
  dialog that says what it turns off, and waits for you to confirm.

### What a sandboxed turn no longer reaches

- **Patcher's own secrets.** The app key, the machine auth secret, the daemon's
  bearer token, and the database that holds every thread are denied to the turn
  inside the sandbox — and the daemon refuses to serve those same paths through
  its file API, to any caller.
- **The app key itself.** A turn's processes are handed a key scoped to that one
  thread instead. It answers for that thread, and the routes that would undo a
  sandbox refuse it: writing files anywhere, opening a terminal, raising a
  machine's ceiling, enrolling a machine, installing a provider CLI, and
  approving the turn's own permission prompt.
- **A repository's own git config.** A clone whose config or `.gitattributes`
  names a hook, a filter, or an external diff no longer runs it inside Patcher's
  git.

[Security](https://github.com/laruss/patcher-browser/blob/main/docs/security.md) names what this does not close yet, Codex reads and
`.git` inside the writable roots among them.

### Plugins

- Each plugin runs in its own process, so one plugin's key and channel never
  meet another's.
- A plugin is held to what it declared it registers, not only to what it calls.
  A page script matching every site needs the sites to say so.
- A plugin cannot reach a browser command it never declared by writing to its
  channel instead of calling the API it was handed.
- A second connection can no longer take the browser role off the window that
  holds it.

### The browser

- Cmd-click opens a link as a background tab instead of crashing the shell.
- The address bar keeps a half-typed address, selects the whole address on the
  click that focuses it, and stops offering to switch tabs while you type one.
- A hovered omnibox row no longer decides what Enter does.
- Closing a tab no longer closes the popup it opened.
- The selected tab is a shade you can find.

### Start-up

The app no longer opens on a white screen. A Node builtin reaching the app
bundle fails the build instead of warning, and CI opens the packaged app and
fails the build when the start-up errors.

## 0.1.1-alpha.1

The first downloadable Patcher desktop build: macOS on Apple Silicon, published
as a prerelease on the releases page.

It is ad-hoc signed rather than signed with an Apple Developer ID, so macOS asks
for one explicit approval the first time you open it — the release notes carry
the steps. For the same reason it does not update itself: `electron-updater`
installs only a Developer ID-signed update, so this build leaves the
`desktop-latest` feed alone rather than offering installed apps an update that
cannot apply. Check the releases page for a newer alpha.

## 0.1.0

The first Patcher release, and the first published `patcher-app`. Version
numbering restarts here: the entries below are the inherited bb release notes,
kept for history, and their numbers belong to bb rather than to Patcher.

## 0.37.0

A much faster app on your phone, message editing, manual context compaction, shared skills, and a long list of fixes.

### Mobile is much faster

Every tap used to make Patcher measure the whole page before it could respond. On a phone, that froze the app for seconds at a time. This release removes that work.

- Taps answer at once. The sidebar, the right panel, and the timeline all open without a stall.
- The sidebar keeps its scroll position when you close it and open it again.
- A long thread stays smooth while an agent streams into it.
- A remote session over Patcher connect no longer lags behind your typing.
- The prompt box no longer collapses while you scroll.

### Edit a message you already sent

Turn on **Edit messages** in Settings → Experiments. You can then edit any message you already sent. Nothing changes until you submit the edit. Patcher then rewinds the conversation to that point and runs the turn again, and your workspace keeps its changes. Codex, Claude Code, and Pi support it. Agents can do the same with `patcher thread edit-message`.

### Compact a long thread

Type `/compact` in the composer to compact a thread that has grown too long. Codex, Claude Code, Pi, and OpenCode support it. Cursor and other custom ACP agents do not. Agents can do the same with `patcher thread compact`.

### Skills

- Patcher now looks for skills in the places each agent already reads, so your existing skills appear without a copy.
- Cursor project skills in `.cursor/skills` are found, including a link to a shared folder such as `.agents/skills`.
- You can point every agent at one shared skill folder instead of a copy for each provider.
- A custom ACP agent can declare its own skill folders.

### An archive you can undo

An accidental archive no longer destroys your worktree. Patcher waits five minutes before it removes the worktree. The archive toast offers **Undo**, and **Unarchive** on the thread brings back the same environment. A thread you delete still cleans up at once.

### Threads and turns

- Threads no longer freeze at "waiting" until you restart the app.
- Background tasks, workflows, and agents survive a settings change or a memory write. They used to stop.
- A very large finished turn opens instead of restarting the server.
- The first turn of a new thread no longer dies in silence.
- Claude Code asks for your approval before it leaves Plan mode.
- Codex reopens an archived session and tries again instead of failing the turn.
- A thread that moves to another folder keeps its history. Side chats and forks still work.
- A thread title retries instead of staying empty.

### Models and providers

- ACP agents such as OpenCode and Kimi now show context window usage.
- An agent with no reasoning levels no longer offers a false one.
- A custom model entry works for any ACP agent, and one bad entry no longer breaks the rest.
- Cursor starts the right CLI even when another `agent` command comes first on your `PATH`.
- Patcher finds the Claude CLI where you installed it, and it explains the problem when it cannot.
- A required Codex update is now hard to miss, with an **Update Codex** button.
- A Pi thread no longer sticks on "Working…" because an extension printed a message.
- Provider chatter no longer shows up as unknown events in the timeline.
- Voice transcription retries on the transcription model, so a hiccup no longer loses your words.

### Faster elsewhere

- A desktop sidebar with many threads uses much less memory.
- Patcher no longer stalls on a cold start with a large history.
- A very large thread list loads instead of failing.
- Plugin pages load faster.
- The Keyboard settings page stays responsive while you record a shortcut.

### Plugins and automations

- A plugin turns on as soon as you install it, including a reinstall.
- You can paste a plain repository URL to install a plugin from Git.
- An automation script can call the `patcher` CLI.
- The GitHub plugin loads pull requests for a repository with Issues turned off, finds pull requests on a renamed fork branch, and no longer counts a superseded check as a failure.
- The GitHub plugin fits a phone screen.

### Fixes and polish

- The slash command menu puts an exact match first.
- A stale terminal tab closes instead of coming back.
- A new terminal no longer steals focus from a new thread.
- A long message expands in full when you select **Show more**.
- A split thread view no longer goes blank.
- An agent can call the `patcher` CLI from a sandboxed shell.
- Add Project reuses the project you already have for that folder.
- File previews refresh in a large workspace with many changes.
- The sidebar badge no longer offers an update for a CLI you never installed.
- The macOS Dock icon, the iOS home-screen icon, and notification badges follow dark mode.
- Sidebar shortcut hints stay visible, and a child thread name no longer shows through the row above it.
- The iPad landscape sidebar clears the safe area, and Enter on a Magic Keyboard sends the prompt.
- The browser panel lines up with the page when you zoom the window.
- Queued message actions and worktree new-thread buttons have tooltips.
- The New project tooltip no longer appears after you dismiss the picker.
- An error message names the real cause instead of a bare `fetch failed`.
- Log timestamps show the correct local time.

### Thanks

Twenty of the changes in this release came from outside the core team. Thank you:

- **[@tymonTe](https://github.com/tymonTe)** found the bug that froze every thread on a host, traced it to a single event, and shipped the fix.
- **[@sholub-dev](https://github.com/sholub-dev)** shipped four changes. Background tasks now survive a settings change. Agents can reach the `patcher` CLI from a sandboxed shell. Errors now name their real cause.
- **[@patleeman](https://github.com/patleeman)** kept a thread's history when it moves to another folder, made Codex reopen an archived session, and stopped the false update badge.
- **[@smsunarto](https://github.com/smsunarto)** fixed the browser panel at window zoom, aligned the built-in plugin icons, and documented scoped plugin package names.
- **[@vburojevic](https://github.com/vburojevic)** fixed the error that broke ACP thread timelines. They also made the app icons and notification badges follow dark mode.
- **[@ratulsarna](https://github.com/ratulsarna)** fixed the crash that blanked a split thread view.
- **[@ryanbbrown](https://github.com/ryanbbrown)** added the rename and archive shortcuts.
- **[@wjin17](https://github.com/wjin17)** removed the hidden refresh that made a remote session lag on a phone.
- **[@DevVig](https://github.com/DevVig)** made Cursor start the right CLI.
- **[@raincodes64](https://github.com/raincodes64)** fixed the Pi thread that stuck on "Working…".
- **[@salemsayed](https://github.com/salemsayed)** made Enter on a Magic Keyboard send the prompt in the iPad app.
- **[@charpeni](https://github.com/charpeni)** added the worktree new-thread tooltips.

Thank you also to everyone who reported an issue that this release fixes: **[@amadad](https://github.com/amadad)**, **[@andreasmcdermott](https://github.com/andreasmcdermott)**, **[@arunsathiya](https://github.com/arunsathiya)**, **[@bighitbiker3](https://github.com/bighitbiker3)**, **[@DarrenTsung](https://github.com/DarrenTsung)**, **[@davekilleen](https://github.com/davekilleen)**, **[@fabianlindfors](https://github.com/fabianlindfors)**, **[@fabricioereche](https://github.com/fabricioereche)**, **[@Joesirven](https://github.com/Joesirven)**, **[@jshph](https://github.com/jshph)**, **[@o98k-ok](https://github.com/o98k-ok)**, **[@rohit-simile](https://github.com/rohit-simile)**, **[@sudoHackIn](https://github.com/sudoHackIn)**, **[@tekumara](https://github.com/tekumara)**, and **[@vaayne](https://github.com/vaayne)**.

## 0.36.0

A faster web app, a more reliable terminal, steadier model catalogs, and a long list of fixes.

### The server now default binds to loopback

The server used to listen on every network interface, which exposed its unauthenticated API to any host that could reach the machine. It now binds `127.0.0.1`. Use `--server-bind-host 0.0.0.0` or `PATCHER_SERVER_BIND_HOST` to opt back in, only behind a trusted network boundary.

- **Action needed before you upgrade** if a browser or an enrolled machine reaches Patcher at a direct address such as `http://<LAN-IP>:38986` or `http://<machine>.<tailnet>.ts.net:38986`. Move the route first, then upgrade. This release also raises the host daemon protocol, so every enrolled daemon must update itself — and a daemon that lost its route cannot.
- Move to Patcher connect, or put Patcher behind Tailscale Serve, then remove and re-add each machine in Settings → Machines so its installer records the new route. Setup steps: https://github.com/laruss/patcher-browser/blob/main/docs/multiple-devices.md
- The desktop app, the `patcher` CLI, agents, plugins, and the host daemon on the same machine reach the server over loopback. They need no change.

### Machines and threads

- An enrolled host daemon no longer collides with another daemon over its local API port.
- Background tasks survive a daemon reconnect.
- Provider subscription rate limits now retry instead of failing the turn.
- New threads pick up the connected provider defaults. A thread that names no model now resolves one from the provider catalog on the target host, instead of a hard-coded default. The thread fails to start when that host cannot list models.
- Provider usage limits normalize correctly.

### Pi and ACP

- A broken extension no longer empties the Pi model list.
- A bare Pi model name resolves through the sole authenticated provider.
- An aggregator model ID keeps its provider prefix.
- The bundled runtime loads your own Pi configuration.
- ACP plugin tools work in packaged Electron builds.
- An ACP agent may send a null model or config-option string without breaking the session.

### Models

- Codex re-reads its model list after a CLI update, and it finds project skills again.
- Voice transcription moves to GPT Transcribe. Helper inference moves to GPT-5.6 Luna.

### Performance

- The web app boot payload is 60% smaller.
- The built-in terminal is more reliable, replays faster over a remote connection, and the terminal panel loads faster.

### Plugins and extensions

- Official plugins now live with the rest of the plugins in one place.
- Plugin installs report progress, the build toolchain downloads on demand, and git plugin dependencies install before bundling.
- Plugin SDK type declarations stay current, so agents read the declarations instead of the bundles.
- Browse is the default Extensions tab.
- Interactive plugin tools stay alive past the Connect timeout.
- The GitHub plugin syncs pull requests for repositories with Issues disabled, finds pull requests on fork branches, renders GFM tables in descriptions, and refreshes status when a turn completes.

### Fixes and polish

- New keyboard shortcuts cycle the model and the reasoning level.
- A `.worktreeinclude` file controls what a new worktree copies in.
- Sandbox network permission prompts are grantable.
- App shortcuts and Escape work in the chat input, and sidebar search resets after you open a thread.
- Cmd+W no longer crashes the About window.
- Git status is correct for a newly initialized repository, and a workspace path claim is scoped to its project.
- Long filenames fit in the Add Project dialog, tab overflow controls are back, and right panel resize is less sensitive.
- File links work in side chat timelines.
- The mobile PWA shell tracks the iOS keyboard, and mobile voice recording controls work again.
- Patcher connect relays DELETE request bodies.
- First-run onboarding is behind an experiment while it settles.
- New `pnpm dev:status` command for source development.

### Thanks

Much of this release came from outside the core team. Thank you:

- **[@ben-vargas](https://github.com/ben-vargas)** reported the wildcard bind and shipped the loopback default, the `PATCHER_SERVER_BIND_HOST` setting, and its migration guide.
- **[@Diffuzmetall](https://github.com/Diffuzmetall)** made the built-in terminal more reliable and much faster to replay over a remote connection.
- **[@kschrader](https://github.com/kschrader)** fixed GitHub pull request sync for a repository with Issues disabled.
- **[@toasterman234](https://github.com/toasterman234)** helped cut the web app boot payload by 60%.

## 0.35.0

Plugins ship in this release, enabled by default. Much of Patcher is already built with them — and an agent inside Patcher can now write one for you.

### Plugins

- **Plugins leave experiments and are on by default.** Browse and install them in Settings → Plugins, from the store or from a git URL, an npm package, or a local path.
- **Patcher can extend itself.** A built-in plugin-authoring skill and the `patcher plugin` commands let an agent in a thread scaffold, build, install, and reload a plugin without leaving the conversation. Ask Patcher for something it does not do, and it can write the plugin that does it.
- A plugin can add agent tools and skills, a `patcher` CLI subcommand, sidebar pages and panels, homepage and settings sections, thread header controls, message actions, @-mention providers, background services and scheduled jobs, HTTP and RPC endpoints with realtime push, and its own SQLite storage. New this release: a plugin can render Patcher's full new-thread composer, and it can **replace the sidebar thread list** outright.
- **Much of Patcher is already a plugin.** Automations, Side chat, Patcher connect, Custom instructions, Inline visualizations, and Secrets ship built-in and enabled. Workflows and Ask User Question ship built-in and off by default. GitHub, Docs, Memory, and Tasks install from the store.
- Side chat is now entirely the plugin. Existing side chats migrate over and gain their own permission mode and worktree.
- Plugin pages sit in flat sidebar rows you can reorder or hide, and **Automations** is now separate from **Extensions**, which manages Skills and Plugins.

### A permission limit for every machine

- Each machine now carries a **permission limit** — the highest permission mode any thread on it may run with. A sandbox VM can stay at Full Access while a personal laptop stays lower. Every machine ships at Full Access, so nothing changes until an owner lowers one.
- Only an owner can change a limit, from the new per-machine page. Agents can read the limit but can never raise it. The same page collects that machine's projects, provider versions, update status, rename, and remove.

### Performance

Long thread timelines no longer stall while scrolling, streaming stays stable and unclipped inside a long turn, and threads load faster over Patcher connect.

### Nightly builds

- New automated nightly channel. Install `patcher-app@nightly`, or the separate **Patcher Nightly** desktop app, which sits beside stable Patcher and updates from its own feed. A nightly build never moves a stable release pointer.

### Fixes and polish

- The iOS standalone PWA fills the screen again, instead of leaving a dead band at the bottom and pushing content under the status bar.
- Browser tab shortcuts are preserved on web: `Mod+number` stays with the browser, and Patcher uses `Control+number` on macOS and `Ctrl+Shift+number` on Windows and Linux. Desktop is unchanged.
- A host daemon that fails to shut down now force-exits after 15 seconds so the service manager can restart it. This frees machines that stranded on an old protocol version after a self-update.
- The desktop app asks before it attaches to a Patcher that is already running, and it can stop that copy for you. `npx patcher-app stop` gives agents the same ability.
- Settings → Updates is redesigned around a quieter hierarchy, and updates keep running when you navigate off the page.
- The New thread surface sits flush with the window edges.
- The mobile landing page header no longer overflows.
- Sticky launcher headers, the thread detail header separator, and keyboard shortcut pills line up.

## 0.34.0

This release refreshes the model catalogs behind Pi and Claude, gives every provider a way to ask you a multiple-choice question, and lets workflows run without holding up the composer.

### Models

- The Pi provider moves to Pi 0.82. Model resolution, authentication, and catalog refresh now share one runtime, so the picker reflects each model's real reasoning levels — including `max` — and newly published models appear without waiting for a Patcher release.
- Opus 5 (1M) is available in the curated Claude Code model list.
- Patcher's curated Claude models are always offered, and the picker preloads so it opens with the list already populated.
- The Claude Code bridge no longer silently drops requests.
- **Node.js 22.19 is now the minimum.** 22.19, 24, and 26 are the tested lines. Node 20 is no longer supported.

### Asking and answering

- New cross-provider Ask User Question plugin (builtin, off by default): agents on Codex, Pi, and Cursor can now ask you a real multiple-choice question with option previews instead of guessing or asking in prose. Claude threads keep using their native tool.
- Threads show the pending-question glyph while their runtime is active, so it is clearer when an agent is waiting on you.

### Workflows and plugins

- Claude workflows run without blocking the composer, and every concurrently running workflow is shown there.
- Hidden workflow completion notifications can be steered.
- New experiment-gated Tools Hub brings Skills, Plugins, and Automations into one place with consistent layouts, detail provenance, and safe registry installs.
- Plugins gained thread panel navigation, lifecycle-managed content scripts, compact plugin-owned icons, and banners that render above queued messages.

### Fixes and polish

- The split workspace layout is scoped to one tab, and split-view maps moved into sidebar status slots.
- The mobile submit tap now lands ahead of keyboard dismissal.
- The served patcher-app artifact refreshes after a restart.
- Sidebar rows no longer stay greyed out after a section drag.
- Ordered lists keep their starting number when rendered.
- Skills show as bolt icons in the composer typeahead, and the automations panel regained its page frame.
- Docs YAML frontmatter is only treated as frontmatter when it parses as YAML, so a document opening with a thematic break keeps its first section.
- The project machine picker gates on connected machines rather than every enrollment, so one long-offline machine no longer replaces the native folder picker.
- Thread title generation prompt refined.

## 0.33.0

This release brings updates into one quiet place, simplifies approval settings, and improves reliability across threads and connected machines.

### Clearer updates and approvals

- Permission modes are now clearer approval presets: Accept Edits, Approve for me, and Full Access. Codex and Claude use their native automatic-review behavior while keeping workspace sandboxing in place.
- A quiet Updates badge replaces stacked notifications. Settings → Updates now brings together Patcher, desktop, connected-machine, Codex, and Claude Code updates, with clearer progress and retry actions.
- Connected machines recover from failed updates faster and can be retried from Settings or with `patcher machine retry-update`.

### Experiments

- Try the new Side Chat experiment, rebuilt on Patcher's plugin system. Side chats are lightweight hidden forks that inherit the source thread's execution settings, can be opened as full threads, and can send useful results back to the main conversation.
- Quiet Workflows workers no longer fail just because they have not produced output; they wait until the overall run timeout, cancellation, or a real failure.

### Fixes and polish

- `patcher thread tell` now steers an active turn by default, while `--mode queue` remains available for non-urgent follow-ups.
- Plan and Goal activity are now tracked independently, so either can be stopped without disturbing the other.
- Threads recover cleanly when a previously selected Claude model is no longer available to the signed-in account.
- Active turns are less likely to be interrupted when a connected machine's daemon encounters a lock or update problem.
- Daemons now shut down cleanly after a startup failure instead of leaving a broken process behind.
- Adding a machine now works correctly when Patcher Connect is not paired.
- Assistant-authored thread mentions render as navigable thread-title pills.
- The model and reasoning picker stays open so both settings can be changed together.
- Removed misleading Codex timeline errors and polished keyboard hints and queued messages.
- Source installs now repair native modules correctly when running on Node.js 26.

## 0.0.31

This release brings split views to everyone and redesigns queued messages in the composer.

### Features

- Split views are now available: arrange up to eight chats side by side, drag threads in from the sidebar, and move between panes with keyboard shortcuts.
- Queued messages in the composer got a redesign: a compact drawer that scales to long queues, with fullscreen editing.

### Improvements

- New compact composer on mobile.
- Sidebar sections are unified and drag-reorderable, with drag-to-pin; archived threads moved into Settings.
- Usage limits now show which account email each provider is signed in with, and Cursor usage limits are now supported.

### Experiments

- New Tasks plugin: Linear-style task tracking with agent dispatch — assign agents to tasks, follow their progress in comments, and attach files and GitHub PRs.
- Official plugins are now bundled with the app and update alongside it.
- New Workflows plugin renders live multi-agent workflow runs in chat, across providers.
- Docs gained table editing, easier file management, and a pull/push-based CLI.

### Fixes and polish

- Fixed Claude model fallbacks not being surfaced immediately.
- Fixed `patcher secret request` destinations in multi-machine setups.
- Fixed desktop light/dark switching when following the system theme.
- Fixed scrolling of long agent questions and sidebar safe-area coverage on mobile.
- Fixed a performance issue with animations.
- Improved Patcher Connect reliability.
- Worktree setup now runs with your resolved shell PATH.

## 0.0.30

This release introduces multi-machine workflows and Patcher Connect, adds more ways to customize how Patcher works, and gives you clearer visibility into what agents are doing.

### Work across threads and machines

- Multi-machine support lets you add computers to Patcher and choose which machine runs each task.
- Patcher Connect lets you securely access Patcher from other devices and share previews or local servers from any enrolled machine.

### New features

- Custom instructions now have a dedicated Settings editor and are automatically included in future agent turns.
- Agents can securely request API keys and other credentials without exposing their values in the conversation or transcript.

### Faster navigation and more control

- Customize, disable, or reset keyboard shortcuts from Settings → Keyboard.
- Shortcut hints appear contextually and can be delayed or hidden entirely.
- Sidebar organization and sorting now live in one streamlined display menu, including a new By machine view when multi-machine mode is enabled.
- Thread groups are now called Sections consistently across the app, CLI, and SDK; existing group assignments and sidebar preferences migrate automatically.
- Provider settings can disable native Codex or Claude Code subagents, along with Claude Code's Workflow tool.

### Clearer agent activity

- Codex subagents now appear as nested delegations, and Claude Code child threads remain visibly active while their subagents run.
- Background command activity is shown directly in the sidebar.
- Skills and slash-command autocomplete are more consistent across local and remote sessions.

### Experiments

- Split views let you arrange up to four chats in one workspace. Drag threads from the sidebar, resize and rearrange panes, or use keyboard shortcuts to move between them.
- The new plugin ecosystem includes the Patcher Official catalog, compatibility-aware updates, richer chat and panel experiences, plugin themes, and consistent icons throughout Patcher.
- Install Docs for filesystem-backed documents with folders, images, Markdown editing, and HTML previews in an editable side panel.
- Install Memory to carry durable global or project-specific context across Codex and Claude Code.

### Fixes and polish

- Fixed microphone input in signed macOS desktop builds.
- Fixed app and Settings navigation resetting as you move between pages and threads.
- Fixed subagent token usage inflating the parent thread's context report.
- Local images now render in assistant Markdown, queued prompts preserve formatting, and file previews refresh reliably.
- Improved narrow and short thread layouts, including the composer, Docs sidebar, split indicators, and inactive-pane contrast.
- Sped up production startup when running Patcher from source.
- Refined plugin icons, theme behavior, menu alignment, and sidebar drag interactions throughout the app.

## 0.0.29

This release expands agent and model support, introduces a redesigned Settings experience, and includes workflow improvements and reliability fixes across Patcher.

### More agents, models, and skills

- Added support for Grok Build and Hermes Agent.
- Codex now supports 5.6-Sol, Terra, and Luna.
- Skills and `/` autocomplete now work across Pi and ACP providers, including OpenCode, omp, Grok, Hermes, Cursor, and custom ACP agents.
- Side chats can now use a different model, reasoning level, or service tier while remaining safely read-only.

### Redesigned Settings

- Settings now uses dedicated pages with sidebar navigation.
- Choose which microphone Patcher uses for voice input.
- Manually check for updates from Settings → Updates.
- On macOS, enable Caffeinate to keep the machine awake while Patcher is running.
- Discord and GitHub links now live under Settings → Community.

### Workflow improvements

- Right-click local file links to open them in a specific editor, choose a preview, or copy the file name or path.
- Queued messages now render mention pills correctly.
- `patcher thread archive` now also archives child threads and side chats.
- `patcher thread wait` now waits up to 20 minutes by default, better matching real agent workloads.
- Agent shells more reliably use the correct workspace-managed `patcher` CLI.

### Fixes and polish

- Fixed the app becoming unresponsive after creating, renaming, or removing a section from a sidebar menu.
- Fixed manually marked unread threads remaining unread after reopening.
- Fixed sidebar alignment in macOS fullscreen mode.
- Fixed clipped focus rings in the composer toolbar.
- Simplified thread-row cursors and removed the terminal-count badge from the right-panel toggle.
- Renamed the sidebar feedback action to “Report a bug.”

### Experiments

New experiment to let you connect to Patcher from other computers.
