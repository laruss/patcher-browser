import { ipcRenderer } from "electron";
import { installPasswordManagerPage } from "./password-manager-page.js";
import {
  PASSWORD_PAGE_SESSION,
  PASSWORD_PAGE_CAPTURE,
  PASSWORD_PAGE_CHANNEL,
  PASSWORD_PAGE_CHANGED,
  type PageAccount,
} from "./password-manager-page-ipc.js";

if (process.isMainFrame) {
  let documentId: string | undefined;
  async function call(input: object) {
    try {
      return await ipcRenderer.invoke(PASSWORD_PAGE_CHANNEL, {
        ...input,
        documentId,
      });
    } catch {
      return null;
    }
  }
  const page = installPasswordManagerPage({
    async accounts(hasPasswordForm) {
      documentId = ipcRenderer.sendSync(PASSWORD_PAGE_SESSION);
      const result = await call({ kind: "accounts", hasPasswordForm });
      if (
        !result ||
        typeof result.documentId !== "string" ||
        !Array.isArray(result.accounts)
      )
        return [];
      documentId = result.documentId;
      return result.accounts as PageAccount[];
    },
    fill: (account, fieldToken) =>
      call({
        kind: "fill",
        id: account.id,
        version: account.version,
        fieldToken,
      }),
    capture: (value) => {
      ipcRenderer.sendSync(PASSWORD_PAGE_CAPTURE, {
        kind: "capture",
        ...value,
        documentId,
      });
    },
    username: (username) => {
      ipcRenderer.sendSync(PASSWORD_PAGE_CAPTURE, {
        kind: "username",
        username,
        documentId,
      });
    },
    failure: () => {
      ipcRenderer.sendSync(PASSWORD_PAGE_CAPTURE, {
        kind: "failure",
        documentId,
      });
    },
    success: () => {
      void call({ kind: "success" });
    },
  });
  ipcRenderer.on(PASSWORD_PAGE_CHANGED, () => {
    void page.refresh();
  });
}
