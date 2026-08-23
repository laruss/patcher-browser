---
kind: instruction
title: Patcher Guide — Customization
summary: Command reference for customizing the Patcher app color palette and keyboard shortcuts.
intent: Explain the CLI theme surface and server-backed app customization.
editingNotes: Keep flags accurate against the CLI implementation. Theme details live in the patcher-cli skill's references/theming.md.
---
Customization commands

Theming — the app-wide color palette

`patcher theme` controls a set of CSS-variable overrides, persisted server-side and
applied live to every open window. This is the palette only; light/dark mode is a
separate per-client setting the palette layers on top of. Custom themes live on
disk, one folder per theme, at <patcher-data-dir>/theme/<name>/theme.css (the packaged
app uses ~/.patcher/theme/…). The folder name is the theme id.

  patcher theme list                  Built-in and custom themes; shows the active one
  patcher theme dir                   Print the custom-theme directory (where to author)
  patcher theme set <id> [--favicon-color <color>]
                                 Activate a theme, preserving the favicon color
                                 unless the flag supplies the complete selection
  patcher theme show [--css]          Print the active palette; --css dumps the CSS
  patcher theme reset                 Back to the default theme; preserve favicon color
  patcher theme favicon set <color>   Set favicon color; preserve the active theme
  patcher theme favicon reset         Reset favicon color; preserve the active theme

To author a custom theme, run `patcher theme dir`, write <that-dir>/<name>/theme.css,
then `patcher theme set <name>`. The full design-token reference is in the patcher-cli
skill (references/theming.md).

Favicon colors are `default`, `red`, `orange`, `yellow`, `green`, `teal`,
`blue`, `purple`, and `pink`. Theme and favicon-only commands carry the other
appearance value forward explicitly.

Add --json to any theme command for machine-readable output.

Packaged launcher settings

`patcher-app config` and `patcher-app env` reload runtime settings in a running server,
but the CLI identifies server and launcher settings that are startup-only,
including binding/ports, data and the dev-app port, telemetry, inherited skill
roots, and `PATCHER_FF_*` flags. `PATCHER_LOG_LEVEL` is also startup-only. Use
`patcher-app config`, not `patcher-app env`, to change `PATCHER_APP_URL`, `PATCHER_INFERENCE`,
`PATCHER_INFERENCE_FALLBACK`, or `PATCHER_TRANSCRIPTION` live. After a startup-only
change, run `patcher-app stop && patcher-app start` or restart the desktop app. Until
then, changing or unsetting `PATCHER_SERVER_BIND_HOST` does not close a previous
`0.0.0.0` listener.

Server helper completions use `PATCHER_INFERENCE` first, then
`PATCHER_INFERENCE_FALLBACK` after a transient timeout, rate limit, or
service-unavailable failure. Their defaults are `codex/gpt-5.6-luna` and
`codex/gpt-5.4-mini`, respectively.

  patcher-app config set PATCHER_INFERENCE <provider/model>
  patcher-app config set PATCHER_INFERENCE_FALLBACK <provider/model>

Server-backed General settings

Settings → General includes app-wide preferences stored server-side so every
window and restart sees the same value. On macOS, the Caffeinate toggle asks the
primary host daemon to run `/usr/bin/caffeinate -i -w <daemon-pid>`, preventing
system idle sleep while Patcher is running; turning it off stops that process. It
only blocks idle sleep: closing a laptop lid or choosing Sleep manually still
sleeps the Mac. This setting is only shown when the connected primary host
daemon reports macOS.

Settings → Keyboard also includes `showKeyboardHints`, which defaults to true.
Turn it off to hide the delayed shortcut badges shown while holding Command or
Control on macOS, or Control on Windows/Linux. Shortcut commands continue to
work.

Settings → General includes `showUnhandledProviderEvents`, which defaults to
false in packaged builds. Turn it on to show raw provider events Patcher does not yet
understand; development builds always show these diagnostic rows.

Settings → General also includes `steerActiveThreadOnEnter`, which defaults to
false. Outside an open typeahead menu, enabling it makes Enter steer a running
thread and Command+Enter queue a follow-up; when disabled, those actions are
reversed. Shift+Enter inserts a newline, and unmodified Enter inserts a newline
in zen mode. On coarse-pointer touch devices, the software-keyboard Return path
inserts a newline. iPadOS WebKit preserves these Enter shortcuts for a connected
Magic Keyboard.

  patcher settings show
  patcher settings general <key> <true|false>
  patcher settings replay-onboarding
  patcher settings experiment <key> <value>
  patcher settings usage [--machine <id-or-name>]
  patcher settings version [--force]
  patcher settings reload

`patcher settings replay-onboarding` enables the `newOnboarding` experiment and
clears `onboardingCompletedAt`. The first-run setup guide then shows again on
the next app load. The same button lives in Settings → General → Setup guide
while the experiment is on.

The `newOnboarding` experiment exposes the first-run agent and project setup
guide.
The `toolsHub` experiment exposes Extensions for managing skills and plugins.
Automations stays in the Plugins section beside threads. It does not enable or
disable installed skills, automation execution, plugin runtimes, CLI commands,
or backend APIs.
The `editMessages` experiment enables editing eligible, successfully completed
root user messages in idle Codex, Claude Code, and Pi threads. Opening the
editor is client-local; submitting replaces the selected turn and all later
conversation history while retaining workspace side effects. Grouped
multi-message requests are not yet editable.

Thread timeline windows are bounded by event count as well as user-message
count (`PATCHER_FF_TIMELINE_WINDOW_EVENT_BUDGET`, default 1500), so a long thread
stops reprojecting its whole history — and blocking the server event loop — on
every update. A turn still running is cut at the budget too, so a very long
turn costs the budget per update instead of growing without limit. Older
activity loads automatically as you scroll toward the top.

Server-backed keyboard shortcuts

Settings → Keyboard records per-command shortcut overrides. They are persisted
server-side, applied live to every connected window, and survive restarts.
Reset removes an override and returns to Patcher's current default; Clear explicitly
disables a command. `Mod` means Command on macOS and Control on Windows/Linux.
Bindings for non-native actions apply in browser and desktop clients. Command
contexts and native-only availability remain server-owned, and desktop menu
accelerators for New Thread, New Window, New Tab, Close, and Settings use the
same resolved bindings. The complete default table is in docs/configuration.md.

  patcher settings keyboard list
  patcher settings keyboard hints <true|false>
  patcher settings keyboard set <command> <shortcut|disabled>
  patcher settings keyboard reset [command]

Host files and voice transcription

  patcher file read|write|list|paths|mkdir|move|remove ...
  patcher voice transcribe <audio-file> [--prompt <context>]

Voice transcription uses the `PATCHER_TRANSCRIPTION` model, which defaults to
`codex/gpt-transcribe`. Override it with
`patcher-app config set PATCHER_TRANSCRIPTION <provider/model>`.

`patcher file` supports `--host` for remote machines and `--root` on mutating
commands to confine access beneath an absolute directory. Use `--json` for
metadata and machine-readable results.

Client-local UI preferences

Some Settings values live only in the current browser/client. The Voice Input
microphone picker stores the selected browser MediaDevices device id in
localStorage as `patcher.voiceInput.audioInputDeviceId`; it does not have a `patcher`
command and does not change the server-side transcription model.
