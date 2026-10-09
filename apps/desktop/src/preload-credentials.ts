import { ipcRenderer } from "electron";
import { z } from "zod";
import {
  CREDENTIAL_CHANNELS,
  credentialPendingSchema,
  credentialResultSchema,
  type ProtectedCredentialBrowserApi,
} from "@patcher/desktop-contract";
export function preloadCredentials(): ProtectedCredentialBrowserApi {
  return {
    getCredentialRequests: async () =>
      z
        .array(credentialPendingSchema)
        .parse(await ipcRenderer.invoke(CREDENTIAL_CHANNELS.pending)),
    onCredentialRequestsChanged: (listener) => {
      const changed = () => listener();
      ipcRenderer.on(CREDENTIAL_CHANNELS.changed, changed);
      return () => {
        ipcRenderer.removeListener(CREDENTIAL_CHANNELS.changed, changed);
      };
    },
    reviewCredentialRequest: async (id) =>
      credentialResultSchema.parse(
        await ipcRenderer.invoke(CREDENTIAL_CHANNELS.review, id),
      ),
    dismissCredentialRequest: async (id) =>
      (await ipcRenderer.invoke(CREDENTIAL_CHANNELS.dismiss, id)) === true,
  };
}
