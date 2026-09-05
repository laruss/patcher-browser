# Patcher app settings reference

Server-backed preferences in Settings. They are persisted on the server, so
every window and client sees the same value.

Reading them is open to anyone. **Writing the General settings and the
experiments is refused from inside a turn**: they are app-wide, and three of
them — `codexNetworkDisabled`, `providerEgressConfined` and the egress host
list — are the boundary the turn itself is running inside. So an agent running
`patcher settings general`, `patcher settings experiment`,
`patcher settings egress-hosts` or `patcher settings replay-onboarding` gets a
403; ask the person in the thread to make the change. `patcher settings show`,
the keyboard commands and `patcher theme` keep working — a shortcut and a
palette are the person's look, not the turn's boundary.

`patcher settings browser-access` is the exception, and deliberately: it has a
route of its own with a consent prompt on it, so an agent inside a turn running
it raises a question on its thread rather than getting a 403. See
[Agents outside Patcher](#agents-outside-patcher) below.
`patcher agent-access grant` is _not_ an exception — it answers with a
credential that outlives the turn, so a turn gets a 403 there.

## Agents outside Patcher

- `browserExternalAccess` decides how far an agent or terminal **outside**
  Patcher may drive the browser with `patcher browser`: `off` (the default),
  `read`, `interact`, or `full`. Threads inside Patcher are not affected — their
  gate is the `browser-tools` plugin.
- `patcher settings browser-access` prints the current level; with a level it
  sets one, and turns the `browser-tools` plugin on if it is off. Going back to
  `off` leaves the plugin alone, because threads use it too.
- The levels are a ramp over the permissions browser commands already cost:
  `read` is tabs, page text and structure, screenshots and logs; `interact` adds
  navigating, clicking and typing; `full` adds cookies and site storage, running
  JavaScript in a page, mocking its network, and recording. Ask for the lowest
  one that does the job.
- A command past the level is refused before it reaches the browser, so nothing
  happened; the refusal names the permission, the level that would admit it, and
  this command.

## Browser access grants

- `patcher agent-access` is the narrow alternative to the setting above, and the
  one to suggest. `grant <label> --level <level>` mints a credential for **one**
  agent, which reaches `patcher browser` and no other part of this API; the
  setting above opens the browser to every process that can read the app key.
  Its levels are `read`, `interact` and `full` — `off` belongs to the setting.
- `--for claude-code` and `--for codex` run that agent's own `mcp add`, so the
  credential lands in its configuration instead of a file. `--for shell` (the
  default) prints `PATCHER_SERVER_URL` and `PATCHER_AGENT_KEY` to export.
- `list` shows every grant — live, paused and revoked — with when each was last
  used. `revoke <id>` ends one, and `pause <id>` / `resume <id>` stop and restart
  one without ending it: a paused grant refuses every request and stays a valid
  credential, so the agent holding it needs no reconfiguring. Either way the next
  request presenting it is refused, naming which happened. There is no expiry;
  the row is the lifetime.
- A revoked grant cannot be paused or resumed. Revoking is the decision with no
  undo, and the route answers 409 rather than pretending otherwise.
- **`grant`, `pause`, `resume` and `revoke` are all refused inside a turn**,
  unlike `browser-access` above: a grant keeps working after the turn ends, so
  minting one is the person's act — and the grant being stopped or started again
  belongs to somebody else's agent, which a turn has no way to judge. Reading the
  list is not refused.

## Caffeinate (macOS only)

- Keeps the Mac awake while Patcher is running: when enabled, the server asks the
  primary host daemon to run `/usr/bin/caffeinate -i -w <daemon-pid>`. Turning
  it off stops that process.
- It only blocks idle sleep: closing a laptop lid or choosing Sleep manually
  still sleeps the Mac.
- The toggle is only shown when the connected primary host daemon reports
  macOS.
- The setting is re-applied automatically whenever the host daemon reconnects,
  and the caffeinate process exits on its own if the daemon dies.

## Keyboard shortcuts

- `showKeyboardHints` defaults to true. Set it with
  `patcher settings keyboard hints <true|false>` to control whether
  delayed shortcut badges appear while holding Command or Control. It does not
  disable the shortcuts themselves.
- Settings → Keyboard records sparse per-command chord overrides. `Mod` means
  Command on macOS and Control on Windows/Linux.
- Reset removes the override and follows Patcher's current default. Clear stores an
  explicit disabled value.
- Bindings for non-native actions apply in browser and desktop clients. Command
  contexts and native-only availability remain server-owned. Reusing a chord
  can be intentional when contexts do not overlap; the UI identifies reuse.
- New Thread, New Window, New Tab, Close, and Settings in the desktop menu use
  the same resolved shortcuts as renderer commands.
- The complete default table is in `docs/configuration.md` in the Patcher source
  repository.

## Unhandled provider events

- `showUnhandledProviderEvents` defaults to false. Set it with
  `patcher settings general showUnhandledProviderEvents <true|false>`.
- When enabled, packaged builds show raw provider events that Patcher has persisted
  but does not yet understand. These diagnostic payloads can be noisy.
- Development builds always show unhandled provider events regardless of the
  saved preference.

## Active-thread Enter behavior

- `steerActiveThreadOnEnter` defaults to false. Set it with
  `patcher settings general steerActiveThreadOnEnter <true|false>`.
- Outside an open composer typeahead menu, disabling it makes Enter queue a
  follow-up and Command+Enter steer the active turn. When enabled, those
  actions are reversed.
- Shift+Enter inserts a newline. Zen mode also makes unmodified Enter insert a
  newline. On coarse-pointer touch devices, the software-keyboard Return path
  stays a newline; iPadOS WebKit preserves the Enter shortcuts for a connected
  Magic Keyboard.

## New onboarding

- The `newOnboarding` experiment defaults to false.
- The person enables it with `patcher settings experiment newOnboarding true`,
  or with `patcher settings replay-onboarding` to enable the experiment and show
  the agent and project setup guide again. Both are refused inside a turn.
