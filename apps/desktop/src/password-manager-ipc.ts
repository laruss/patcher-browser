import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  PASSWORD_MANAGER_CHANNELS,
  passwordManagerRequestSchema,
} from "@patcher/desktop-contract";
import type { PasswordManager } from "./password-manager.js";

export function registerPasswordManagerIpc(args: {
  manager: PasswordManager;
  authorize(event: IpcMainInvokeEvent): boolean;
}) {
  ipcMain.handle(
    PASSWORD_MANAGER_CHANNELS.request,
    async (event, input: unknown) => {
      const parsed = passwordManagerRequestSchema.safeParse(input);
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
      return args.manager.request(parsed.data, event.sender.id, current);
    },
  );
}
