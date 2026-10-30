import { ipcRenderer } from "electron";
import {
  PASSWORD_MANAGER_CHANNELS,
  passwordManagerResponseSchema,
  type DesktopPasswordManagerApi,
} from "@patcher/desktop-contract";

function subscribe(channel: string, listener: () => void) {
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}
function waitForForeground(): Promise<boolean> {
  const ready = () => document.hasFocus() && !document.hidden;
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      clearTimeout(timeout);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      resolve(value);
    };
    const check = () => {
      if (ready()) finish(true);
    };
    // LocalAuthentication can finish before macOS delivers focus back to the
    // renderer. Keep the authenticated reply private until that return occurs.
    const timeout = setTimeout(() => finish(false), 1000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    check();
  });
}
export const preloadPasswordManager: DesktopPasswordManagerApi = {
  async request(input) {
    try {
      const result = passwordManagerResponseSchema.parse(
        await ipcRenderer.invoke(PASSWORD_MANAGER_CHANNELS.request, input),
      );
      if (
        (result.status === "revealed" || result.status === "editing") &&
        !(await waitForForeground())
      ) {
        if (result.status === "editing")
          void ipcRenderer
            .invoke(PASSWORD_MANAGER_CHANNELS.request, {
              operation: "cancel-edit",
              editToken: result.editToken,
            })
            .catch(() => {});
        return { status: "cancelled" };
      }
      return result;
    } catch {
      return { status: "unavailable" };
    }
  },
  onOpen: (listener) => subscribe(PASSWORD_MANAGER_CHANNELS.open, listener),
  onChange: (listener) =>
    subscribe(PASSWORD_MANAGER_CHANNELS.changed, listener),
};
