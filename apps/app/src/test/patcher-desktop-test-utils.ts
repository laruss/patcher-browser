import type {
  PatcherDesktopApi,
  PatcherDesktopBrowserApi,
  PatcherDesktopInfo,
} from "@patcher/desktop-contract";

/**
 * A no-op {@link PatcherDesktopBrowserApi} for tests that build a full
 * `PatcherDesktopApi` stub. The browser control surface is exercised separately; here
 * it just needs to satisfy the contract.
 */
export function createNoopDesktopBrowserApi(): PatcherDesktopBrowserApi {
  return {
    attach() {},
    detach() {},
    navigate() {},
    goBack() {},
    goForward() {},
    reload() {},
    stop() {},
    setBounds() {},
    setVisible() {},
    onState() {
      return () => {};
    },
    onOpenTab() {
      return () => {};
    },
  };
}

/**
 * A full {@link PatcherDesktopApi} stub for tests that need `window.patcherDesktop`. The
 * update/info methods echo `info`; theme and external-open are no-ops. Pass a
 * custom `browser` to exercise the browser control surface. Tests that drive
 * live info changes or assert on method spies build their own stub instead.
 */
export function createPatcherDesktopApi(
  info: PatcherDesktopInfo,
  browser: PatcherDesktopBrowserApi = createNoopDesktopBrowserApi(),
): PatcherDesktopApi {
  return {
    ...info,
    browser,
    async checkForUpdates() {
      return info;
    },
    async getInfo() {
      return info;
    },
    async installUpdate() {},
    onChange() {
      return () => {};
    },
    setTheme() {},
    openExternalUrl() {},
  };
}
