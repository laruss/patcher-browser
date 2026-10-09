import { CREDENTIAL_RELEASE_CHANNEL } from "./credential-release-ipc.js";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  systemPreferences,
  type IpcMainInvokeEvent,
  type WebFrameMain,
} from "electron";
import { join } from "node:path";
import { z } from "zod";
import { CREDENTIAL_CHANNELS } from "@patcher/desktop-contract";
import {
  createCredentialVault,
  type CredentialVault,
} from "./desktop-credential-vault.js";
import { createCredentialKeyStore } from "./desktop-credential-key.js";
import type { DesktopSiteAuthority } from "./desktop-site-authority.js";
import type { DesktopKeyBackend } from "./desktop-secret-broker.js";

const observed = new WeakSet<object>();
const gestures = new Map<number, { frame: WebFrameMain; time: number }>();
const ready = new Map<number, { frame: WebFrameMain; url: string }>();
function uiReady(host: number) {
  const value = ready.get(host),
    window = BrowserWindow.getAllWindows().find(
      (one) => !one.isDestroyed() && one.webContents.id === host,
    );
  return (
    !!value &&
    !!window &&
    value.frame === window.webContents.mainFrame &&
    value.url === window.webContents.getURL()
  );
}
export function createNativeCredentialVault(
  sites: DesktopSiteAuthority,
  backend: DesktopKeyBackend,
  userDataPath: string,
) {
  return createCredentialVault({
    sites,
    keys: createCredentialKeyStore(
      join(userDataPath, "protected-credentials", "key.bin"),
      backend,
    ),
    available: () => backend.available(),
    ready: uiReady,
    touchIdAvailable: () =>
      process.platform === "darwin" && systemPreferences.canPromptTouchID(),
    touchId: (reason) => systemPreferences.promptTouchID(reason),
    changed: () => {
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed() && ready.has(window.webContents.id))
          window.webContents.send(CREDENTIAL_CHANNELS.changed);
    },
    async confirm(request, host, signal) {
      const window = BrowserWindow.getAllWindows().find(
        (one) => !one.isDestroyed() && one.webContents.id === host,
      );
      if (!window || signal.aborted || !uiReady(host)) return null;
      const choice = await dialog.showMessageBox(window, {
        title: "Protected browser credentials",
        type: "question",
        defaultId: 0,
        cancelId: 0,
        signal,
        buttons: request.protection
          ? ["Cancel", "Approve this action"]
          : [
              "Cancel",
              "Require Touch ID",
              "Confirm every action without Touch ID",
            ],
        message: `${request.operation} credential for ${request.origin}?`,
        detail: `Plugin: ${request.pluginName} (${request.pluginId})\nAccount: ${request.accountId}\nExact origin: ${request.origin}\nProtection: ${request.protection ?? "Choose protection for this credential"}\nEvery action needs a new confirmation. Fill does not submit the form. After filling, the site and permitted page scripts can read the password.`,
      });
      if (signal.aborted || choice.response === 0) return null;
      return (
        request.protection ??
        (choice.response === 1
          ? "require-touch-id"
          : choice.response === 2
            ? "confirm-each-time"
            : null)
      );
    },
  });
}
export function registerCredentialIpc(args: {
  current(): CredentialVault | undefined;
  authorize(event: IpcMainInvokeEvent): boolean;
}) {
  ipcMain.on(CREDENTIAL_RELEASE_CHANNEL, (event, value: unknown) => {
    event.returnValue = null;
    const parsed = z
      .object({
        token: z.uuid(),
        operation: z.enum(["prepare", "capture", "fill"]),
      })
      .strict()
      .safeParse(value);
    if (
      parsed.success &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame
    )
      event.returnValue =
        args
          .current()
          ?.take(
            parsed.data.token,
            parsed.data.operation,
            event.sender.id,
            event.senderFrame.url,
          ) ?? null;
  });
  ipcMain.handle(
    CREDENTIAL_CHANNELS.pending,
    (event, ...payload: unknown[]) => {
      if (!args.authorize(event) || payload.length || !event.senderFrame)
        return [];
      const id = event.sender.id;
      if (!observed.has(event.sender)) {
        observed.add(event.sender);
        const gesture = () => {
          if (uiReady(id))
            gestures.set(id, {
              frame: event.sender.mainFrame,
              time: Date.now(),
            });
        };
        event.sender.on("before-mouse-event", (_event, mouse) => {
          if (mouse.type === "mouseUp" && mouse.button === "left") gesture();
        });
        event.sender.on("before-input-event", (_event, input) => {
          if (
            input.type === "keyDown" &&
            !input.isAutoRepeat &&
            ["Enter", " "].includes(input.key)
          )
            gesture();
        });
        event.sender.on(
          "did-start-navigation",
          (_event, _url, _inPlace, main) => {
            if (main) {
              ready.delete(id);
              gestures.delete(id);
              args.current()?.cancelHost(id);
            }
          },
        );
        event.sender.once("destroyed", () => {
          ready.delete(id);
          gestures.delete(id);
          args.current()?.cancelHost(id);
        });
      }
      ready.set(id, { frame: event.senderFrame, url: event.senderFrame.url });
      return args.current()?.list(id) ?? [];
    },
  );
  ipcMain.handle(
    CREDENTIAL_CHANNELS.review,
    (event, value: unknown, ...rest: unknown[]) => {
      const parsed = z.uuid().safeParse(value);
      if (
        !parsed.success ||
        rest.length ||
        !args.authorize(event) ||
        !uiReady(event.sender.id)
      )
        return { status: "denied" };
      const gesture = gestures.get(event.sender.id);
      gestures.delete(event.sender.id);
      if (
        !gesture ||
        gesture.frame !== event.senderFrame ||
        Date.now() - gesture.time > 2000
      )
        return { status: "denied" };
      return (
        args.current()?.review(parsed.data, event.sender.id) ?? {
          status: "unavailable",
        }
      );
    },
  );
  ipcMain.handle(
    CREDENTIAL_CHANNELS.dismiss,
    (event, value: unknown, ...rest: unknown[]) => {
      const parsed = z.uuid().safeParse(value);
      return (
        parsed.success &&
        rest.length === 0 &&
        args.authorize(event) &&
        (args.current()?.dismiss(parsed.data, event.sender.id) ?? false)
      );
    },
  );
  app.on("before-quit", () => {
    ready.clear();
    gestures.clear();
  });
}
