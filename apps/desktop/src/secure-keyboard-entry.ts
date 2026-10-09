import {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  webContents,
  type WebContents,
} from "electron";
import { SecureKeyboardController } from "./secure-keyboard-controller.js";
import {
  SECURE_KEYBOARD_DOCUMENT_CHANNEL,
  SECURE_KEYBOARD_FOCUS_CHANNEL,
} from "./secure-keyboard-ipc.js";

export function registerSecureKeyboardEntry(): {
  browserViewChanged(
    contents: WebContents,
    hostWebContentsId: number,
    visible: boolean,
  ): void;
} {
  const controller =
    process.platform === "darwin"
      ? new SecureKeyboardController(
          () => webContents.getFocusedWebContents(),
          (enabled) => app.setSecureKeyboardEntryEnabled(enabled),
        )
      : null;
  ipcMain.on(SECURE_KEYBOARD_DOCUMENT_CHANNEL, (event) => {
    event.returnValue = controller?.documentFor(event) ?? null;
  });
  ipcMain.on(SECURE_KEYBOARD_FOCUS_CHANNEL, (event, payload: unknown) => {
    controller?.report(event, payload);
  });
  app.on("browser-window-created", (_event, window) => {
    controller?.register(window.webContents, window, false);
  });
  app.on("did-resign-active", () => controller?.block("inactive", true));
  app.on("did-become-active", () => controller?.block("inactive", false));
  powerMonitor.on("suspend", () => controller?.block("suspend", true));
  powerMonitor.on("resume", () => controller?.block("suspend", false));
  powerMonitor.on("lock-screen", () => controller?.block("lock-screen", true));
  powerMonitor.on("unlock-screen", () =>
    controller?.block("lock-screen", false),
  );
  app.on("before-quit", () => controller?.block("quit", true));
  app.on("will-quit", () => controller?.dispose());
  return {
    browserViewChanged(contents, hostWebContentsId, visible) {
      const window = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents.id === hostWebContentsId,
      );
      if (window !== undefined)
        controller?.register(contents, window, true, visible);
    },
  };
}
