import { ipcRenderer } from "electron";
import { observePasswordFocus } from "./password-focus-observer.js";
import {
  SECURE_KEYBOARD_DOCUMENT_CHANNEL,
  SECURE_KEYBOARD_FOCUS_CHANNEL,
} from "./secure-keyboard-ipc.js";

export function installSecureKeyboardReporting(
  protectUnknownFocus: boolean,
): void {
  let stop: (() => void) | undefined;
  function start(): void {
    stop?.();
    stop = undefined;
    const documentId: unknown = ipcRenderer.sendSync(
      SECURE_KEYBOARD_DOCUMENT_CHANNEL,
    );
    if (typeof documentId !== "string") return;
    stop = observePasswordFocus(
      (protect) => {
        ipcRenderer.send(SECURE_KEYBOARD_FOCUS_CHANNEL, {
          documentId,
          protect,
        });
      },
      protectUnknownFocus,
      restoreLifecycleListeners,
    );
  }
  // Restored BFCache documents need a fresh main-owned document identity too.
  // Page scripts can dispatch lifecycle events, but cannot stop core reporting.
  function onPageShow(event: PageTransitionEvent): void {
    if (event.isTrusted) start();
  }
  function onPageHide(event: PageTransitionEvent): void {
    if (event.isTrusted) stop?.();
  }
  function restoreLifecycleListeners(): void {
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
  }
  start();
}
