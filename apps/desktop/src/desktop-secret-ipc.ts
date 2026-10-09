import {
  app,
  dialog,
  ipcMain,
  safeStorage,
  powerMonitor,
  type IpcMainInvokeEvent,
} from "electron";
import { DESKTOP_SECRET_STORAGE_CHANNELS } from "@patcher/desktop-contract";
import type {
  createDesktopSecretBroker,
  DesktopKeyBackend,
} from "./desktop-secret-broker.js";

let screenLocked = false;
let suspended = false;
export const desktopKeyBackend: DesktopKeyBackend = {
  available: () =>
    !screenLocked &&
    !suspended &&
    app.isReady() &&
    process.platform === "darwin" &&
    safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value),
};
export function registerDesktopSecretIpc(args: {
  current: () => ReturnType<typeof createDesktopSecretBroker> | undefined;
  authorize: (event: IpcMainInvokeEvent) => boolean;
}) {
  for (const method of ["status", "activate", "unlock"] as const) {
    ipcMain.handle(
      DESKTOP_SECRET_STORAGE_CHANNELS[method],
      async (event, ...payload: unknown[]) => {
        if (!args.authorize(event) || payload.length !== 0)
          throw new Error("Secret storage request refused");
        const broker = args.current();
        if (broker === undefined)
          return {
            mode: "plaintext",
            available: false,
            migrationPending: false,
            unprocessedEntries: 0,
            error: "unavailable",
          };
        if (method === "activate") {
          const choice = await dialog.showMessageBox({
            type: "warning",
            buttons: ["Cancel", "Encrypt plugin secrets"],
            defaultId: 0,
            cancelId: 0,
            title: "Encrypt plugin secrets",
            message: "Protect ordinary plugin tokens with this Mac’s Keychain?",
            detail:
              "After encryption, secret settings require this desktop app and its Keychain. Headless access and downgrades are unsupported. A copy of the encrypted data without the Keychain key cannot restore credentials. Existing backups may contain plaintext. Browser passwords are not included.",
          });
          if (
            choice.response !== 1 ||
            broker !== args.current() ||
            !args.authorize(event)
          )
            return { ...(await broker.action("status")), error: "cancelled" };
        }
        if (method === "unlock") {
          if (screenLocked || suspended) return broker.action("status");
          broker.availability(true);
        }
        return broker.action(method);
      },
    );
  }
  const publish = () =>
    args.current()?.availability(!screenLocked && !suspended);
  powerMonitor.on("lock-screen", () => {
    screenLocked = true;
    publish();
  });
  powerMonitor.on("suspend", () => {
    suspended = true;
    publish();
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
    publish();
  });
  powerMonitor.on("resume", () => {
    suspended = false;
    publish();
  });
}
