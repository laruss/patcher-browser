import type { PatcherDesktopApi } from "@patcher/desktop-contract";

declare global {
  interface Window {
    patcherDesktop?: PatcherDesktopApi;
  }
}

export {};
