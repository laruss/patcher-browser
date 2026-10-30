import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  PASSWORD_MANAGER_CHANNELS,
  passwordManagerRequestSchema,
  PASSWORD_MANAGER_SESSION_CHANNELS,
  passwordManagerSessionRequestSchema,
} from "@patcher/desktop-contract";
import type { PasswordManager } from "./password-manager.js";

export function registerPasswordManagerIpc(args: {
  manager: PasswordManager;
  authorize(event: IpcMainInvokeEvent): boolean;
}) {
  for (const useSession of [false, true]) {
    ipcMain.handle(
      useSession
        ? PASSWORD_MANAGER_SESSION_CHANNELS.request
        : PASSWORD_MANAGER_CHANNELS.request,
      async (event, input: unknown) => {
        const parsed = (
          useSession
            ? passwordManagerSessionRequestSchema
            : passwordManagerRequestSchema
        ).safeParse(input);
        const frame = event.senderFrame,
          url = frame?.url;
        const current = () => {
          if (
            event.sender.isDestroyed() ||
            event.sender.mainFrame !== frame ||
            !args.authorize(event) ||
            frame?.url !== url
          )
            return false;
          if (
            useSession &&
            parsed.success &&
            parsed.data.operation !== "list" &&
            parsed.data.operation !== "cancel-edit"
          ) {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (
              !window?.isFocused() ||
              !window.isVisible() ||
              !event.sender.isFocused()
            )
              return false;
          }
          try {
            return (
              parsed.success &&
              (parsed.data.operation === "cancel-edit" ||
                new URL(frame.url).pathname === "/password-manager")
            );
          } catch {
            return false;
          }
        };
        if (!parsed.success || !current()) return { status: "unavailable" };
        return useSession
          ? args.manager.requestSession(parsed.data, event.sender.id, current)
          : args.manager.request(
              parsed.data as import("@patcher/desktop-contract").PasswordManagerRequest,
              event.sender.id,
              current,
            );
      },
    );
  }
}
