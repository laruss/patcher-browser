import type {
  AppCommandContextKey,
  AppCommandId,
  AppDefaultKeybinding,
  AppDefaultKeybindings,
  AppKeybinding,
  AppShortcut,
} from "@patcher/domain";
import {
  BROWSER_SELECT_TAB_APP_COMMAND_IDS,
  QUESTION_SELECT_APP_COMMAND_IDS,
  PANE_FOCUS_APP_COMMAND_IDS,
  THREAD_JUMP_APP_COMMAND_IDS,
} from "@patcher/domain";

interface ShortcutModifiers {
  mod?: boolean;
  meta?: boolean;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
}

interface BindingOptions {
  all?: readonly AppCommandContextKey[];
  desktopOnly?: boolean;
  none?: readonly AppCommandContextKey[];
}

function shortcut(key: string, modifiers: ShortcutModifiers = {}): AppShortcut {
  return {
    key,
    mod: modifiers.mod ?? false,
    meta: modifiers.meta ?? false,
    control: modifiers.control ?? false,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
  };
}

function binding(
  command: AppCommandId,
  key: string,
  modifiers: ShortcutModifiers,
  options: BindingOptions = {},
): AppKeybinding {
  return {
    command,
    desktopOnly: options.desktopOnly ?? false,
    shortcut: shortcut(key, modifiers),
    when: {
      all: [...(options.all ?? [])],
      none: [...(options.none ?? [])],
    },
  };
}

function unassignedBinding(
  command: AppCommandId,
  options: BindingOptions = {},
): AppDefaultKeybinding {
  return {
    command,
    desktopOnly: options.desktopOnly ?? false,
    shortcut: null,
    when: {
      all: [...(options.all ?? [])],
      none: [...(options.none ?? [])],
    },
  };
}

const mainWithoutModal = {
  all: ["mainSurface"],
  none: ["modalOpen"],
} as const;

/** Only while the browser surface (or a browsed page) has focus. */
const browserWithoutModal = {
  all: ["mainSurface", "browserFocus"],
  desktopOnly: true,
  none: ["modalOpen"],
} as const;

const splitWithoutModal = {
  all: ["mainSurface", "splitActive"],
  none: ["modalOpen"],
} as const;

export const DEFAULT_APP_KEYBINDINGS: AppDefaultKeybindings = [
  // Mod+N is the browser's, not the thread's: Patcher is one, and in every other
  // browser that chord opens a window. So the t3code-style alias is the whole
  // of this binding now, on desktop as well as on the web, where browsers
  // reserve Mod+N before the page ever sees the key.
  binding("thread.new", "o", { mod: true, shift: true }, mainWithoutModal),
  unassignedBinding("thread.search", mainWithoutModal),
  unassignedBinding("thread.rename", mainWithoutModal),
  unassignedBinding("thread.archive", mainWithoutModal),
  binding("settings.open", ",", { mod: true }, mainWithoutModal),
  binding("sidebar.toggle", "j", { mod: true }, mainWithoutModal),
  // The same chord again, scoped to browser focus, and not a duplicate: a key
  // pressed inside a browsed page never reaches the renderer, so the shell
  // resolves it itself — and `resolveDesktopBrowserAppCommand` only considers
  // bindings whose context names `browserFocus`. Without this entry the sidebar
  // toggle is dead exactly where this app spends most of its time, which is the
  // whole reason it moved off Mod+\.
  binding("sidebar.toggle", "j", { mod: true }, browserWithoutModal),
  // Unassigned deliberately. These are the chords Patcher inherited from bb, and
  // they are the app's, not the browser's. A browser's keymap is muscle memory —
  // Mod+1..9, Mod+T, Mod+W, Mod+Shift+T all mean something here already — so the
  // inherited set is off by default rather than quietly competing for chords.
  // Every command below stays assignable: the settings UI lists it, and a null
  // shortcut is what `applyAppKeybindingOverrides` drops from the active set.
  unassignedBinding("thread.previous", mainWithoutModal),
  unassignedBinding("thread.next", mainWithoutModal),
  ...THREAD_JUMP_APP_COMMAND_IDS.map((command) =>
    unassignedBinding(command, mainWithoutModal),
  ),
  unassignedBinding("pane.focus.previous", splitWithoutModal),
  unassignedBinding("pane.focus.next", splitWithoutModal),
  ...PANE_FOCUS_APP_COMMAND_IDS.map((command) =>
    unassignedBinding(command, splitWithoutModal),
  ),
  unassignedBinding("pane.maximize.toggle", splitWithoutModal),
  unassignedBinding("pane.close", splitWithoutModal),
  binding("panel.newTab", "t", { mod: true }, mainWithoutModal),
  binding("panel.close", "w", { mod: true }, mainWithoutModal),
  unassignedBinding("panel.toggle", mainWithoutModal),
  unassignedBinding("diff.toggle", {
    ...mainWithoutModal,
    none: ["modalOpen", "editableFocus", "terminalFocus", "browserFocus"],
  }),
  unassignedBinding("terminal.open", mainWithoutModal),
  unassignedBinding("composer.focus", {
    all: ["mainSurface", "promptAvailable"],
    none: ["modalOpen", "terminalFocus", "browserFocus"],
  }),
  // The picker's own chords go with the rest of the inherited set. The scoped
  // duplicates that let each chord work while the picker popover is open went
  // with them: there is no chord left for them to re-enable.
  unassignedBinding("modelPicker.toggle", {
    all: ["mainSurface", "promptAvailable"],
    none: ["modalOpen", "terminalFocus", "browserFocus"],
  }),
  unassignedBinding("modelPicker.cycleModel", {
    all: ["mainSurface", "promptAvailable"],
    none: ["modalOpen", "terminalFocus", "browserFocus"],
  }),
  unassignedBinding("modelPicker.cycleReasoning", {
    all: ["mainSurface", "promptAvailable"],
    none: ["modalOpen", "terminalFocus", "browserFocus"],
  }),
  binding(
    "browser.focusLocation",
    "l",
    { mod: true },
    {
      all: ["mainSurface", "browserFocus"],
      desktopOnly: true,
      none: ["modalOpen"],
    },
  ),
  binding(
    "browser.reload",
    "r",
    { mod: true },
    {
      all: ["mainSurface", "browserFocus"],
      desktopOnly: true,
      none: ["modalOpen"],
    },
  ),
  // The find bar. Same chord every browser uses, and — like the address bar —
  // it must keep working while the page has focus, which is what the shell's
  // host-focusing list is for.
  binding(
    "browser.find",
    "f",
    { mod: true },
    {
      all: ["mainSurface", "browserFocus"],
      desktopOnly: true,
      none: ["modalOpen"],
    },
  ),
  // Give the page the whole window. It does nothing unless the app window is
  // already full screen — the renderer owns that gate, because covering the app
  // chrome in an ordinary window would trap the user with no way back.
  binding(
    "browser.fullscreen.toggle",
    "f",
    { mod: true, shift: true },
    {
      all: ["mainSurface", "browserFocus"],
      desktopOnly: true,
      none: ["modalOpen"],
    },
  ),
  // Chromium's own chord for the developer tools, and the panel it opens is
  // Chromium's own too.
  binding(
    "browser.devTools.toggle",
    "i",
    { mod: true, alt: true },
    {
      all: ["mainSurface", "browserFocus"],
      desktopOnly: true,
      none: ["modalOpen"],
    },
  ),
  // Browser tab commands. Registered *after* `panel.newTab` / `panel.close`
  // deliberately: both resolvers walk the table from the end, so these win
  // whenever the browser has focus while the panel bindings keep working
  // everywhere else. Same chords a browser has, so muscle memory transfers.
  binding("browser.newTab", "t", { mod: true }, browserWithoutModal),
  binding("browser.closeTab", "w", { mod: true }, browserWithoutModal),
  binding(
    "browser.reopenClosedTab",
    "t",
    { mod: true, shift: true },
    browserWithoutModal,
  ),
  ...BROWSER_SELECT_TAB_APP_COMMAND_IDS.map((command, index) =>
    binding(command, String(index + 1), { mod: true }, browserWithoutModal),
  ),
  binding("browser.selectLastTab", "9", { mod: true }, browserWithoutModal),
  // Literal Control on every platform, as in an IDE — not `mod`, which would be
  // Command on macOS and collide with nothing useful there.
  binding(
    "browser.recentTab.next",
    "Tab",
    { control: true },
    browserWithoutModal,
  ),
  binding(
    "browser.recentTab.previous",
    "Tab",
    { control: true, shift: true },
    browserWithoutModal,
  ),
  binding("browser.goBack", "[", { mod: true }, browserWithoutModal),
  binding("browser.goForward", "]", { mod: true }, browserWithoutModal),
  unassignedBinding("workspace.openPreferred", mainWithoutModal),
  ...QUESTION_SELECT_APP_COMMAND_IDS.map((command) =>
    unassignedBinding(command, {
      all: ["mainSurface", "questionOpen"],
      none: ["modalOpen", "editableFocus"],
    }),
  ),
  // Page zoom, on the chords every browser uses. `=` rather than `+` because
  // that is the unshifted key the user presses; the shell's menu accelerator
  // spells the same chord its own way.
  binding("browser.zoomIn", "=", { mod: true }, browserWithoutModal),
  binding("browser.zoomOut", "-", { mod: true }, browserWithoutModal),
  binding("browser.zoomReset", "0", { mod: true }, browserWithoutModal),
  // Mod+P is print and nothing else. It used to be a second chord for the
  // panel's new tab (`panel.newTab` already had Mod+T), so this took the chord
  // rather than sharing it.
  binding("browser.print", "p", { mod: true }, browserWithoutModal),
  // Mod+Shift+N is deliberately left alone: it is the incognito window
  // everywhere else, and Patcher has not built one yet (see browser-gaps.md).
  binding(
    "window.new",
    "n",
    { mod: true },
    {
      ...mainWithoutModal,
      desktopOnly: true,
    },
  ),
];
