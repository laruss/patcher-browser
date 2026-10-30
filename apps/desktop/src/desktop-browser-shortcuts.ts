import type { WebContents } from "electron";
import type { CreateDesktopBrowserViewManagerArgs } from "./desktop-browser-view.js";
import { resolveDesktopReloadShortcut } from "./desktop-reload-shortcut.js";
import {
  matchesAppShortcut,
  type AppCommandId,
  type AppKeybindings,
  type AppShortcutInput,
} from "@patcher/domain";

interface ResolveDesktopBrowserAppCommandArgs {
  input: AppShortcutInput;
  isMac: boolean;
  keybindings: AppKeybindings;
}

export function resolveDesktopBrowserAppCommand({
  input,
  isMac,
  keybindings,
}: ResolveDesktopBrowserAppCommandArgs): AppCommandId | null {
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding || !binding.when.all.includes("browserFocus")) continue;
    if (matchesAppShortcut(input, binding.shortcut, isMac)) {
      return binding.command;
    }
  }
  return null;
}

/** See the `before-input-event` handler: these need the app to have focus. */
const HOST_FOCUSING_APP_COMMANDS: ReadonlySet<AppCommandId> = new Set([
  "browser.focusLocation",
  "browser.find",
  "browser.recentTab.next",
  "browser.recentTab.previous",
]);

export function registerDesktopBrowserShortcuts({
  webContents,
  hostWebContentsId,
  resolveAppCommand,
  focusHostWebContents,
  dispatchAppCommand,
}: {
  webContents: WebContents;
  hostWebContentsId: number;
} & Pick<
  CreateDesktopBrowserViewManagerArgs,
  "resolveAppCommand" | "focusHostWebContents" | "dispatchAppCommand"
>): void {
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing) {
      return;
    }
    if (resolveDesktopReloadShortcut(input) === "force-reload") {
      event.preventDefault();
      webContents.reloadIgnoringCache();
      return;
    }
    const command = resolveAppCommand({
      altKey: input.alt,
      code: input.code,
      ctrlKey: input.control,
      key: input.key,
      metaKey: input.meta,
      shiftKey: input.shift,
    });
    if (command === null) return;
    // Prevent both the untrusted page and Electron's application menu from
    // also handling a chord that Patcher resolved as a browser command.
    event.preventDefault();
    // Commands whose *next* keystroke has to land in the app rather than in
    // the page. The address bar is the obvious one; the tab switcher is the
    // subtle one — it is driven by further Ctrl+Tab presses and closed by the
    // Ctrl release, and a key released inside a browsed page never becomes an
    // app command.
    if (HOST_FOCUSING_APP_COMMANDS.has(command)) {
      focusHostWebContents(hostWebContentsId);
    }
    dispatchAppCommand({
      command,
      hostWebContentsId,
    });
  });
}
