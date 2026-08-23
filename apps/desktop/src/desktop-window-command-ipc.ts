// Main-window commands that are initiated by native desktop chrome and handled
// by the trusted React renderer.

export const PATCHER_DESKTOP_OPEN_NEW_TAB_CHANNEL =
  "patcher-desktop:open-new-tab";
export const PATCHER_DESKTOP_APP_COMMAND_CHANNEL =
  "patcher-desktop:app-command";
export const PATCHER_DESKTOP_GET_WINDOW_STATE_CHANNEL =
  "patcher-desktop:get-window-state";
export const PATCHER_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL =
  "patcher-desktop:window-state-changed";
/**
 * The renderer asking for its own window to close — the other direction from
 * the request/response pair below, which is the shell asking the renderer
 * whether it may. Sent when the surface runs out of tabs: a browser window with
 * nothing open is a window with nothing to show.
 */
export const PATCHER_DESKTOP_CLOSE_WINDOW_CHANNEL =
  "patcher-desktop:close-window";
export const PATCHER_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL =
  "patcher-desktop:close-window-request";
export const PATCHER_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL =
  "patcher-desktop:close-window-response";
// How long main waits for the renderer to answer a close request before
// closing the window itself, so a crashed, hung, or still-loading renderer
// cannot make Cmd+W inert.
export const CLOSE_WINDOW_REQUEST_TIMEOUT_MS = 1000;
