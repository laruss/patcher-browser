import type { WebContents } from "electron";
import type {
  BrowserViewEntry,
  DesktopBrowserHostWindow,
} from "./desktop-browser-view.js";

export type BrowserViewVisibilityChanged = (
  contents: WebContents,
  hostWebContentsId: number,
  visible: boolean,
) => void;

export function applyBrowserViewVisibility(
  entry: BrowserViewEntry,
  hostWindow: DesktopBrowserHostWindow,
  isHostResizing: (window: DesktopBrowserHostWindow) => boolean,
  onChanged?: BrowserViewVisibilityChanged,
): void {
  // The host as well as the view, and the same three conditions `send` uses:
  // `isHostResizing` below reads `hostWindow.webContents.id`, which throws
  // once that webContents is gone. Reachable since a detach began clearing
  // the pending dialog — a debugger detach can arrive while the window is
  // already tearing down, with the child view still alive, which is the
  // ordering `releaseWindow` exists to handle. An exception in that callback
  // is an uncaught one in the main process. Found by the code re-review on
  // 2026-09-08; the security re-review read the view guard and stopped.
  if (
    entry.view.webContents.isDestroyed() ||
    hostWindow.isDestroyed() ||
    hostWindow.webContents.isDestroyed()
  ) {
    return;
  }
  // Reasons the app is drawing its own chrome across the whole page area, and
  // possibly across the DevTools panel below it: a resize burst is standing in
  // a bitmap, a dialog or a network prompt is a modal where the page was, and
  // an overlay is a dropdown that can reach down over either view.
  const appDrawsOverBothViews =
    isHostResizing(hostWindow) ||
    entry.pendingDialog !== null ||
    entry.pagePrompt !== null ||
    entry.overlayActive;
  entry.view.setVisible(entry.visible && !appDrawsOverBothViews);
  // The panel is a native view too, so it hides for all of those. What it no
  // longer follows is the page's own visibility: the renderer hides the page
  // to draw a load-error screen in its rect, and the panel has a rect of its
  // own. See {@link BrowserViewEntry.devToolsVisible} for the fallback that
  // keeps an app which never reports panel visibility working as before.
  entry.devToolsView?.setVisible(
    (entry.devToolsVisible ?? entry.visible) && !appDrawsOverBothViews,
  );
  onChanged?.(
    entry.view.webContents,
    hostWindow.webContents.id,
    entry.visible && !appDrawsOverBothViews,
  );
}
