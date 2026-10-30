import { ipcRenderer } from "electron";
import {
  PASSWORD_MANAGER_CHANNELS,
  PASSWORD_MANAGER_SESSION_CHANNELS,
  passwordManagerResponseSchema,
  type DesktopPasswordManagerApi,
  type PasswordManagerResponse,
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
async function request(
  channel: string,
  input: unknown,
): Promise<PasswordManagerResponse> {
  try {
    const result = passwordManagerResponseSchema.parse(
      await ipcRenderer.invoke(channel, input),
    );
    if (
      (result.status === "revealed" || result.status === "editing") &&
      !(await waitForForeground())
    ) {
      if (result.status === "editing")
        void ipcRenderer
          .invoke(channel, {
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
}
export const preloadPasswordManager: DesktopPasswordManagerApi = {
  request: (input) => request(PASSWORD_MANAGER_CHANNELS.request, input),
  session: {
    request: (input) =>
      request(PASSWORD_MANAGER_SESSION_CHANNELS.request, input),
    onLock: (listener) =>
      subscribe(PASSWORD_MANAGER_SESSION_CHANNELS.locked, listener),
  },
  onOpen: (listener) => subscribe(PASSWORD_MANAGER_CHANNELS.open, listener),
  onChange: (listener) =>
    subscribe(PASSWORD_MANAGER_CHANNELS.changed, listener),
};
