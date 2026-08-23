import { createBrowserPatcherSdk } from "@patcher/sdk/browser";
import { fetchWithAppSurface } from "./app-surface";

const BASE_URL =
  typeof window === "undefined" ? "http://localhost" : window.location.origin;

export const sdk = createBrowserPatcherSdk({
  baseUrl: BASE_URL,
  fetch: fetchWithAppSurface,
});

export { PatcherHttpError } from "@patcher/sdk/browser";
