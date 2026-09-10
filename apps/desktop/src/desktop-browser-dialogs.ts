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
import { endCdpAutomation, type CdpSession } from "./desktop-browser-cdp.js";
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
  /** See the implementation: the answer has to land before the session goes. */
  respondToTabDialog: (args: {
    hostWindow: DesktopBrowserHostWindow;
    entry: BrowserViewEntry;
    request: { tabId: string; accept: boolean; promptText?: string | null };
  }) => Promise<boolean>;
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
   *
   * **`dialogsWired` says the listeners are attached to *this* session, and
   * nothing else.** It is not a record that the domain is on: that belongs to
   * `CdpSession`, which enables a domain once, forgets an attempt that failed,
   * and is happy to be asked again. So the enable is sent on every call and a
   * failure is retried by the next command that needs it — where the flag used
   * to be set before the send that earns it, one transient failure returned a
   * tab's dialogs to Chromium's native modal for the life of the tab, silently,
   * with every later command reporting success (#111).
   *
   * **Subscribing before the enable is the half that must not be reordered.**
   * Chromium's browser-side handler starts intercepting this tab's dialogs when
   * it dispatches `Page.enable`, not when the renderer answers it — and #96 put
   * a five-second clock on that answer, so a send can be abandoned and still
   * land, or land before it is answered. A dialog arriving on a domain nobody
   * is listening to is worse than the bug above: `pendingDialog` stays null, so
   * the app draws nothing and `respondToDialog` refuses. Claiming the tab first
   * also means two overlapping callers cannot stack a second copy of both
   * listeners — `CdpSession.on` holds a `Set` and each call passes a fresh
   * closure, so it would not dedupe them.
   */
  async function ensureDialogInterception(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
    session: CdpSession,
  ): Promise<void> {
    // Somebody is driving this tab again, so a teardown waiting on it no longer
    // describes anything: what is set on the tab now belongs to whoever has it.
    // Outside the wiring check on purpose — the case this is *for* is a tab
    // handed on while a dialog stood open, and there the session was never
    // dropped, so its listeners are still wired and the check below is skipped.
    // Review caught the first version resetting only on a fresh session, which
    // is precisely the case that cannot happen here.
    entry.automationEndPending = false;
    if (!entry.dialogsWired) {
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
    }

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
    runDeferredAutomationEnd(entry);
  }

  /**
   * The teardown a claim's end left waiting on this tab's dialog.
   *
   * The page was blocked and only this client could answer, so ending the tab's
   * automation had to wait rather than be dropped — the claim was already gone,
   * and nothing else would ever have asked again.
   *
   * **Not while an answer is in flight.** `Page.javascriptDialogClosed` can
   * arrive before the response to the `Page.handleJavaScriptDialog` that caused
   * it, and detaching rejects every outstanding command — so running here would
   * make `respondToDialog` report that it had not answered a dialog it just
   * answered. It runs from there instead, once the answer has landed. Found by
   * review.
   */
  function runDeferredAutomationEnd(entry: BrowserViewEntry): void {
    if (entry.automationEndPending && !entry.dialogAnswerInFlight) {
      endCdpAutomation(entry);
    }
  }

  /**
   * Answer the dialog a page is blocked on, and say whether it was answered.
   *
   * Here rather than in the view module because everything it has to be
   * sequenced against is here: the close event that clears the dialog, and the
   * teardown a claim's end may have left waiting on it. Keeping the two apart
   * is what hid the ordering below (#80 paid for the move — the view file is
   * pinned and this change needed room in it).
   */
  async function respondToTabDialog({
    hostWindow,
    entry,
    request,
  }: {
    hostWindow: DesktopBrowserHostWindow;
    entry: BrowserViewEntry;
    request: { tabId: string; accept: boolean; promptText?: string | null };
  }): Promise<boolean> {
    if (entry.pendingDialog === null || entry.cdp === null) {
      return false;
    }
    const isPrompt = entry.pendingDialog.type === "prompt";
    // The close event can beat the response to the answer that caused it, and
    // a teardown waiting on this dialog would then detach mid-command and make
    // this report a dialog it answered as unanswered.
    entry.dialogAnswerInFlight = true;
    try {
      await entry.cdp.send("Page.handleJavaScriptDialog", {
        accept: request.accept,
        // Chromium rejects promptText on a non-prompt dialog.
        ...(isPrompt && request.accept
          ? { promptText: request.promptText ?? "" }
          : {}),
      });
    } catch {
      // The page may have gone while the answer was in flight. Fall through:
      // clearing the state below is what stops the view staying hidden.
      entry.dialogAnswerInFlight = false;
      clearPendingDialog(hostWindow, request.tabId, entry);
      runDeferredAutomationEnd(entry);
      return false;
    }
    entry.dialogAnswerInFlight = false;
    // `Page.javascriptDialogClosed` also clears this; doing it here as well
    // keeps the view from staying hidden if that event never arrives.
    clearPendingDialog(hostWindow, request.tabId, entry);
    // And explicitly, because the line above returns early when the event got
    // here first — which is the very ordering the flag exists for.
    runDeferredAutomationEnd(entry);
    return true;
  }

  return {
    ensureDialogInterception,
    clearPendingDialog,
    respondToTabDialog,
  };
}
