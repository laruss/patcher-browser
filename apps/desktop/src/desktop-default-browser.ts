import type { PatcherDesktopDefaultBrowserStatus } from "@patcher/desktop-contract";

// Being the user's browser is a Launch Services registration, not a capability:
// macOS builds its "Default web browser" list from the bundles that declare
// `http` and `https` in `CFBundleURLTypes`, and Patcher declares both through
// `mac.extendInfo` in `electron-builder.config.json`. Everything here is the
// runtime half — asking whether the registration is the active one, and asking
// the OS to make it so.

export const PATCHER_DESKTOP_GET_DEFAULT_BROWSER_CHANNEL =
  "patcher-desktop:get-default-browser";
export const PATCHER_DESKTOP_REQUEST_DEFAULT_BROWSER_CHANNEL =
  "patcher-desktop:request-default-browser";
export const PATCHER_DESKTOP_DEFAULT_BROWSER_CHANGED_CHANNEL =
  "patcher-desktop:default-browser-changed";

/**
 * Both, always. A browser that owns `https` and not `http` is a browser that
 * silently drops half the links the OS hands it, and macOS treats the pair as
 * one choice in Settings anyway.
 */
export const DEFAULT_BROWSER_PROTOCOLS = ["http", "https"] as const;

/**
 * The parts of Electron's `app` this needs, named so the logic can be tested
 * without one.
 */
export interface DefaultBrowserEnvironment {
  isDefaultProtocolClient(protocol: string): boolean;
  /**
   * True only for a packaged build. A dev run executes out of the stock
   * `Electron.app` in `node_modules`, whose `Info.plist` declares no web
   * schemes — asking there would either fail or, worse, point the developer's
   * own links at a bundle that is replaced on every `bun install`.
   */
  isPackaged: boolean;
  setAsDefaultProtocolClient(protocol: string): boolean;
}

export function readDefaultBrowserStatus(
  environment: DefaultBrowserEnvironment,
): PatcherDesktopDefaultBrowserStatus {
  const isDefault = DEFAULT_BROWSER_PROTOCOLS.every((protocol) =>
    environment.isDefaultProtocolClient(protocol),
  );
  return {
    canRequest: environment.isPackaged && !isDefault,
    isDefault,
  };
}

/**
 * Ask macOS to route web links here.
 *
 * The returned status is deliberately read *after* the request and is still
 * expected to say `isDefault: false`: since macOS 12 Launch Services shows the
 * "keep using …?" confirmation itself and returns before the user has answered
 * it. Nothing can wait for that answer, which is why the status is re-read when
 * the app is activated again rather than reported here.
 */
export function requestDefaultBrowser(
  environment: DefaultBrowserEnvironment,
): PatcherDesktopDefaultBrowserStatus {
  const before = readDefaultBrowserStatus(environment);
  if (!before.canRequest) {
    return before;
  }
  for (const protocol of DEFAULT_BROWSER_PROTOCOLS) {
    environment.setAsDefaultProtocolClient(protocol);
  }
  return readDefaultBrowserStatus(environment);
}
