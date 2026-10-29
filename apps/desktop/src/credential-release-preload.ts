import { contextBridge, ipcRenderer } from "electron";
import {
  CREDENTIAL_WORLD_ID,
  CREDENTIAL_RELEASE_CHANNEL,
} from "./credential-release-ipc.js";
export function installCredentialRelease() {
  if (!process.isMainFrame) return;
  contextBridge.exposeInIsolatedWorld(
    CREDENTIAL_WORLD_ID,
    "__patcherCredentialRelease",
    {
      take: (token: string, operation: "prepare" | "capture" | "fill") =>
        ipcRenderer.sendSync(CREDENTIAL_RELEASE_CHANNEL, { token, operation }),
    },
  );
}
