import { z } from "zod";
import type { PatcherDesktopBrowserApi } from "./browser.js";
import type { AppCommandId } from "@patcher/domain";

const isoUtcDateTimeSchema = z.iso.datetime();

export const patcherDesktopDownloadStateSchema = z.enum([
  "idle",
  "downloading",
  "downloaded",
  "failed",
]);
export type PatcherDesktopDownloadState = z.infer<
  typeof patcherDesktopDownloadStateSchema
>;

export const patcherDesktopInfoSchema = z.object({
  /**
   * Native updater state. Older desktop shells omit this field, which means
   * the renderer knows only that an update is available, not that a download
   * has actually started.
   */
  downloadState: patcherDesktopDownloadStateSchema.optional(),
  lastCheckedAt: isoUtcDateTimeSchema.nullable(),
  latestVersion: z.string().min(1).nullable(),
  pendingVersion: z.string().min(1).nullable(),
  platform: z.literal("macos"),
  updateAvailable: z.boolean(),
  updateDownloaded: z.boolean(),
  version: z.string().min(1),
});
export type PatcherDesktopInfo = z.infer<typeof patcherDesktopInfoSchema>;

/**
 * Whether macOS routes web links to Patcher, and whether this build may ask to
 * change that.
 *
 * `canRequest` is false for a development run: `Info.plist` cannot be written at
 * runtime, so an unpackaged shell has no `http`/`https` declaration of its own —
 * and the bundle it would register is the stock Electron one sitting in
 * `node_modules`, which would take over the developer's own links.
 */
export const patcherDesktopDefaultBrowserStatusSchema = z
  .object({
    canRequest: z.boolean(),
    isDefault: z.boolean(),
  })
  .strict();
export type PatcherDesktopDefaultBrowserStatus = z.infer<
  typeof patcherDesktopDefaultBrowserStatusSchema
>;

export const patcherDesktopWindowStateSchema = z
  .object({
    isFullScreen: z.boolean(),
  })
  .strict();
export type PatcherDesktopWindowState = z.infer<
  typeof patcherDesktopWindowStateSchema
>;

export const patcherDesktopThemeSchema = z.enum(["system", "light", "dark"]);
export type PatcherDesktopTheme = z.infer<typeof patcherDesktopThemeSchema>;

export type PatcherDesktopInfoChangeHandler = (
  info: PatcherDesktopInfo,
) => void;
export type PatcherDesktopInfoUnsubscribe = () => void;
export type PatcherDesktopWindowStateChangeHandler = (
  state: PatcherDesktopWindowState,
) => void;
export type PatcherDesktopDefaultBrowserStatusChangeHandler = (
  status: PatcherDesktopDefaultBrowserStatus,
) => void;
export type PatcherDesktopOpenNewTabHandler = () => void;
export type PatcherDesktopAppCommandHandler = (command: AppCommandId) => void;
export type PatcherDesktopCloseWindowRequestHandler = () => boolean;

/**
 * How the shell tells a renderer which window it is: a `--patcher-window-key=...`
 * entry in `additionalArguments`, read out of `process.argv` by the preload.
 *
 * An argument rather than an IPC call because the answer has to exist before
 * the first module runs — see {@link PatcherDesktopApi.windowKey}.
 */
export const PATCHER_DESKTOP_WINDOW_KEY_ARGUMENT_PREFIX =
  "--patcher-window-key=";

export interface PatcherDesktopApi extends PatcherDesktopInfo {
  /**
   * Control surface for the desktop-only web browser tab. The renderer drives
   * a hardened, isolated Electron `WebContentsView` through these methods; the
   * web build has no `window.patcherDesktop`, so this surface is desktop-only by
   * construction.
   */
  browser: PatcherDesktopBrowserApi;
  /**
   * Which window this renderer is, stable across a reload and across an app
   * restart — it is the same key the shell already persists this window's
   * geometry under, so a window that comes back where it was comes back with
   * what it had open.
   *
   * A plain property rather than a method because it is read while modules
   * initialise, before anything can await. Optional for version skew: a shell
   * that predates it leaves per-window state unscoped, which is what every
   * build did before.
   */
  windowKey?: string;
  checkForUpdates(): Promise<PatcherDesktopInfo>;
  getInfo(): Promise<PatcherDesktopInfo>;
  /**
   * Current native window state for renderer chrome geometry. Optional for
   * version skew with desktop shells that predate this bridge; callers should
   * feature-detect and fall back to the normal window layout.
   */
  getWindowState?(): Promise<PatcherDesktopWindowState>;
  /**
   * Whether macOS currently hands web links to Patcher. Optional for version skew
   * with shells that predate the declaration that makes it possible.
   */
  getDefaultBrowserStatus?(): Promise<PatcherDesktopDefaultBrowserStatus>;
  /**
   * Ask macOS to make Patcher the default browser.
   *
   * The answer is the status *before* the user has answered: macOS shows the
   * confirmation itself and Launch Services returns without waiting for it, so
   * `isDefault` flips later — on
   * {@link PatcherDesktopApi.onDefaultBrowserStatusChange}, which the shell pushes
   * when the app is activated again.
   */
  requestDefaultBrowser?(): Promise<PatcherDesktopDefaultBrowserStatus>;
  /**
   * Subscribe to default-browser changes. They happen outside this app — the
   * system dialog above, or System Settings — so the status is re-read whenever
   * Patcher is activated and pushed when it differs.
   */
  onDefaultBrowserStatusChange?(
    listener: PatcherDesktopDefaultBrowserStatusChangeHandler,
  ): PatcherDesktopInfoUnsubscribe;
  installUpdate(): Promise<void>;
  onChange(
    listener: PatcherDesktopInfoChangeHandler,
  ): PatcherDesktopInfoUnsubscribe;
  /**
   * Subscribe to native window state pushes for this BrowserWindow. Optional
   * for version skew with desktop shells that predate fullscreen-aware chrome.
   */
  onWindowStateChange?(
    listener: PatcherDesktopWindowStateChangeHandler,
  ): PatcherDesktopInfoUnsubscribe;
  /**
   * Subscribe to native desktop requests to open the current thread's secondary
   * panel new-tab page. Optional for desktop shells that predate this command.
   */
  onOpenNewTab?(
    listener: PatcherDesktopOpenNewTabHandler,
  ): PatcherDesktopInfoUnsubscribe;
  /** Subscribe to native menu commands that are executed by the renderer. */
  onAppCommand?(
    listener: PatcherDesktopAppCommandHandler,
  ): PatcherDesktopInfoUnsubscribe;
  /**
   * Subscribe to native desktop close-window requests. Return true when the
   * renderer handled the request, for example by closing an active secondary
   * panel tab; returning false preserves the native close-window fallback.
   * Optional for desktop shells that predate this command.
   */
  onCloseWindowRequest?(
    listener: PatcherDesktopCloseWindowRequestHandler,
  ): PatcherDesktopInfoUnsubscribe;
  /**
   * Close this window.
   *
   * The browser surface calls it when its last tab goes: a window whose strip
   * is empty has nothing left to show, which is what closing the last tab means
   * in every other browser. Optional for version skew — a shell that predates
   * it leaves the window open on an empty new-tab screen, which is what Patcher did
   * before.
   */
  closeWindow?(): void;
  /**
   * Open a URL in the user's default system browser, leaving the in-app
   * browser tab. The main process only honors `http(s)` URLs — the address
   * originates from a possibly-hostile page, so other schemes are dropped.
   * No-op on the web build where `window.patcherDesktop` is undefined.
   */
  openExternalUrl(url: string): void;
  /**
   * Push the renderer's theme preference to the Electron main process so the
   * NSWindow appearance — traffic lights and inactive title-bar chrome —
   * follows Patcher's explicit theme or the OS when set to system. No-op on the web
   * build where `window.patcherDesktop` is undefined.
   */
  setTheme(theme: PatcherDesktopTheme): void;
}
