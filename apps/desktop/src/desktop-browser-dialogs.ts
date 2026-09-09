/**
 * A tab's JavaScript dialogs: taking them over, and giving the page back.
 *
 * Moved out of `desktop-browser-view.ts` whole (#80), because that file is
 * pinned at its size and this is the concern #111 had to write into. The seam
 * is where the dialog path stops being about a browser view and starts being
 * about a CDP session and one entry's dialog state: `alert()`, `confirm()` and
 * `prompt()` arrive as two protocol events, and what the shell does with them
 * is hide the native view, tell the app, and put the view back.
 *
 * **What it borrows from the manager, and why by injection.** Pushing to the
 * host window (`send`) and deciding what the window shows
 * (`applyEntryVisibility`) belong to the manager closure — the second one reads
 * the resize state beside it — and the placeholder bitmap is the resize burst's
 * own machinery, borrowed by a dialog rather than owned by one. Passing the
 * three in keeps this module from reaching for the other twenty fields on an
 * entry, the way `desktop-browser-interact.ts` takes a `resolveTarget` instead
 * of the entry itself.
 */
import { PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH } from "@patcher/desktop-contract";
import type { CdpSession } from "./desktop-browser-cdp.js";
import {
  cdpSessionWithDeadline,
  PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS,
} from "./desktop-browser-cdp-deadline.js";
import {
  PATCHER_DESKTOP_BROWSER_DIALOG_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
} from "./desktop-browser-ipc.js";
import type {
  BrowserViewEntry,
  DesktopBrowserHostWebContentsPayload,
  DesktopBrowserHostWindow,
} from "./desktop-browser-view.js";

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** What the dialog path needs from the view manager's closure. */
export interface BrowserDialogDeps {
  send: (
    hostWindow: DesktopBrowserHostWindow,
    channel: string,
    payload: DesktopBrowserHostWebContentsPayload,
  ) => void;
  applyEntryVisibility: (
    entry: BrowserViewEntry,
    hostWindow: DesktopBrowserHostWindow,
  ) => void;
  /**
   * Stand a bitmap of the frozen page in for the hidden view, so the dialog
   * appears over the page rather than over an empty panel. The resize burst's
   * machinery; a capture that fails just leaves the panel bare.
   */
  captureDialogPlaceholder: (
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ) => void;
}

export interface BrowserDialogInterception {
  ensureDialogInterception: (
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
    session: CdpSession,
  ) => Promise<void>;
  clearPendingDialog: (
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ) => void;
}

export function createBrowserDialogInterception({
  send,
  applyEntryVisibility,
  captureDialogPlaceholder,
}: BrowserDialogDeps): BrowserDialogInterception {
  /**
   * Take this tab's JavaScript dialogs.
   *
   * Enabling the `Page` domain is what moves dialogs off Chromium's native
   * modal and onto the protocol — which is the point (an agent can answer one)
   * and also the cost (a human now sees the app's dialog instead of the
   * system's). It happens per tab, on the same lazy attach automation pays for,
   * so a tab nobody has automated keeps the native behaviour.
   */
  async function ensureDialogInterception(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
    session: CdpSession,
  ): Promise<void> {
    if (entry.dialogsWired) {
      return;
    }
    entry.dialogsWired = true;

    session.on("Page.javascriptDialogOpening", (params) => {
      const opening = params as {
        type?: string;
        message?: string;
        defaultPrompt?: string;
      };
      const type = opening.type ?? "alert";
      entry.pendingDialog = {
        type:
          type === "confirm" || type === "prompt" || type === "beforeunload"
            ? type
            : "alert",
        message: truncate(
          opening.message ?? "",
          PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
        ),
        defaultPrompt: truncate(
          opening.defaultPrompt ?? "",
          PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
        ),
      };
      captureDialogPlaceholder(hostWindow, tabId, entry);
      applyEntryVisibility(entry, hostWindow);
      send(hostWindow, PATCHER_DESKTOP_BROWSER_DIALOG_CHANNEL, {
        tabId,
        dialog: entry.pendingDialog,
      });
    });

    session.on("Page.javascriptDialogClosed", () => {
      clearPendingDialog(hostWindow, tabId, entry);
    });

    // Bounded here rather than at each of the five commands that call this:
    // it is the one send the function makes, and every caller wants it bounded.
    await cdpSessionWithDeadline(session, {
      remainingMs: () => PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS,
      dialogOpen: () => entry.pendingDialog !== null,
    }).enableDomain("Page");
  }

  function clearPendingDialog(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    if (entry.pendingDialog === null) {
      return;
    }
    entry.pendingDialog = null;
    applyEntryVisibility(entry, hostWindow);
    // Reveal first, then drop the placeholder, so the swap never flashes an
    // empty panel — the same ordering `endWindowResize` uses.
    send(hostWindow, PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
      tabId,
      dataUrl: null,
    });
    send(hostWindow, PATCHER_DESKTOP_BROWSER_DIALOG_CHANNEL, {
      tabId,
      dialog: null,
    });
  }

  return { ensureDialogInterception, clearPendingDialog };
}
