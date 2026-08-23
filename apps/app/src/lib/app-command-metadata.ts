import {
  BROWSER_SELECT_TAB_APP_COMMAND_IDS,
  QUESTION_SELECT_APP_COMMAND_IDS,
  PANE_FOCUS_APP_COMMAND_IDS,
  THREAD_JUMP_APP_COMMAND_IDS,
  type AppCommandId,
} from "@patcher/domain";

export interface AppCommandMetadata {
  command: AppCommandId;
  description: string;
  label: string;
}

export interface AppCommandGroup {
  commands: readonly AppCommandMetadata[];
  label: string;
}

function command(
  id: AppCommandId,
  label: string,
  description: string,
): AppCommandMetadata {
  return { command: id, description, label };
}

export const APP_COMMAND_GROUPS: readonly AppCommandGroup[] = [
  {
    label: "Threads",
    commands: [
      command(
        "thread.new",
        "New thread",
        "Start a thread in the active project.",
      ),
      command(
        "thread.search",
        "Search threads",
        "Focus the sidebar thread search.",
      ),
      command("thread.rename", "Rename thread", "Rename the focused thread."),
      command(
        "thread.archive",
        "Archive thread",
        "Archive the focused thread.",
      ),
      command(
        "thread.previous",
        "Previous thread",
        "Open the previous visible sidebar thread.",
      ),
      command(
        "thread.next",
        "Next thread",
        "Open the next visible sidebar thread.",
      ),
      ...THREAD_JUMP_APP_COMMAND_IDS.map((id, index) =>
        command(
          id,
          `Open thread ${index + 1}`,
          `Open visible sidebar thread ${index + 1}.`,
        ),
      ),
    ],
  },
  {
    label: "Window and layout",
    commands: [
      command(
        "window.new",
        "New window",
        "Open another Patcher desktop window.",
      ),
      command("settings.open", "Open settings", "Open Patcher settings."),
      command(
        "settings.openServers",
        "Open server settings",
        "Open settings to add or manage Patcher servers.",
      ),
      command(
        "sidebar.toggle",
        "Toggle sidebar",
        "Show or hide the app sidebar.",
      ),
      command(
        "panel.newTab",
        "New panel tab",
        "Open a tab in the secondary panel.",
      ),
      command(
        "panel.close",
        "Close panel tab",
        "Close the active panel tab or terminal.",
      ),
      command(
        "panel.toggle",
        "Toggle panel",
        "Show or hide the secondary panel.",
      ),
      command(
        "pane.focus.previous",
        "Focus previous chat pane",
        "Focus the previous chat pane in reading order.",
      ),
      command(
        "pane.focus.next",
        "Focus next chat pane",
        "Focus the next chat pane in reading order.",
      ),
      ...PANE_FOCUS_APP_COMMAND_IDS.map((id, index) =>
        command(
          id,
          `Focus chat pane ${index + 1}`,
          `Focus chat pane ${index + 1} in reading order.`,
        ),
      ),
      command(
        "pane.maximize.toggle",
        "Toggle focused chat pane size",
        "Maximize the focused chat pane or restore its split layout.",
      ),
      command(
        "pane.close",
        "Close focused chat pane",
        "Close the focused chat pane when more than one is open.",
      ),
    ],
  },
  {
    label: "Workspace",
    commands: [
      command(
        "diff.toggle",
        "Toggle diff",
        "Open or close the environment diff.",
      ),
      command(
        "terminal.open",
        "Open terminal",
        "Open a terminal in the secondary panel.",
      ),
      command(
        "workspace.openPreferred",
        "Open in preferred app",
        "Open the workspace in the preferred editor or terminal.",
      ),
    ],
  },
  {
    label: "Composer and models",
    commands: [
      command(
        "composer.focus",
        "Focus composer",
        "Focus the active composer's input and move the caret to the end.",
      ),
      command(
        "modelPicker.toggle",
        "Toggle model picker",
        "Open or close the focused composer's model picker.",
      ),
      command(
        "modelPicker.cycleModel",
        "Next model",
        "Select the next model of the composer's provider.",
      ),
      command(
        "modelPicker.cycleReasoning",
        "Next reasoning level",
        "Select the next reasoning level of the composer's model.",
      ),
    ],
  },
  {
    label: "Browser",
    commands: [
      command(
        "browser.focusLocation",
        "Focus location",
        "Focus the embedded browser address bar.",
      ),
      command(
        "browser.reload",
        "Reload page",
        "Reload the active embedded browser page.",
      ),
      command(
        "browser.find",
        "Find in page",
        "Search the active browser page for text.",
      ),
      command(
        "browser.fullscreen.toggle",
        "Full screen page",
        "Give the page the whole window, while the app is already full screen.",
      ),
      command(
        "browser.devTools.toggle",
        "Developer tools",
        "Open or close Chromium's developer tools for the page.",
      ),
      command("browser.newTab", "New browser tab", "Open a new browser tab."),
      command(
        "browser.closeTab",
        "Close browser tab",
        "Close the active browser tab.",
      ),
      command(
        "browser.reopenClosedTab",
        "Reopen closed tab",
        "Reopen the most recently closed browser tab, where it left off.",
      ),
      ...BROWSER_SELECT_TAB_APP_COMMAND_IDS.map((id, index) =>
        command(
          id,
          `Select browser tab ${index + 1}`,
          `Switch to browser tab ${index + 1}.`,
        ),
      ),
      command(
        "browser.selectLastTab",
        "Select last browser tab",
        "Switch to the rightmost browser tab.",
      ),
      command(
        "browser.recentTab.next",
        "Next recent tab",
        "Step back through recently used browser tabs.",
      ),
      command(
        "browser.recentTab.previous",
        "Previous recent tab",
        "Step forward through recently used browser tabs.",
      ),
      command("browser.goBack", "Back", "Go back in the browser tab."),
      command("browser.goForward", "Forward", "Go forward in the browser tab."),
      command("browser.zoomIn", "Zoom in", "Make the page larger."),
      command("browser.zoomOut", "Zoom out", "Make the page smaller."),
      command("browser.zoomReset", "Actual size", "Return the page to 100%."),
      command("browser.print", "Print", "Print the page."),
    ],
  },
  {
    label: "Questions",
    commands: QUESTION_SELECT_APP_COMMAND_IDS.map((id, index) =>
      command(
        id,
        `Choose answer ${index + 1}`,
        `Choose visible answer ${index + 1} when Patcher asks a question.`,
      ),
    ),
  },
];

const APP_COMMAND_METADATA = new Map(
  APP_COMMAND_GROUPS.flatMap((group) =>
    group.commands.map((metadata) => [metadata.command, metadata]),
  ),
);

export function getAppCommandMetadata(
  commandId: AppCommandId,
): AppCommandMetadata {
  const metadata = APP_COMMAND_METADATA.get(commandId);
  if (metadata === undefined) {
    throw new Error(`Missing metadata for app command ${commandId}`);
  }
  return metadata;
}
