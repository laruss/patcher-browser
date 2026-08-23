import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  session,
  shell,
  type Event,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  APP_SURFACE_DESKTOP,
  APP_SURFACE_ENV_NAME,
} from "@patcher/config/app-surface";
import { PATCHER_PROD_DATA_DIR_NAME } from "@patcher/config/runtime";
import type { AppKeybindings } from "@patcher/domain";
import {
  patcherDesktopThemeSchema,
  type PatcherDesktopDefaultBrowserStatus,
  type PatcherDesktopInfo,
  type PatcherDesktopWindowState,
} from "@patcher/desktop-contract";
import {
  serverMessageLenientSchema,
  systemConfigResponseSchema,
  type ClientMessage,
} from "@patcher/server-contract";
import { z } from "zod";
import {
  assertPathExists,
  resolveDesktopBridgePath,
  resolveDesktopIconPath,
  type DesktopPathContext,
} from "./app-paths.js";
import {
  resolvePatcherAppProcessRuntime,
  type PatcherAppProcess,
  type PatcherAppProcessExit,
  startPatcherAppProcess,
} from "./patcher-process.js";
import { openExistingServerDialog } from "./existing-server-dialog.js";
import {
  readForeignRuntimeDetails,
  stopForeignRuntime,
} from "./foreign-runtime.js";
import { createLocalViewUrl } from "./local-view.js";
import { installApplicationMenu } from "./menu.js";
import {
  DEFAULT_APPLICATION_MENU_ACCELERATORS,
  resolveApplicationMenuAccelerators,
} from "./desktop-menu-shortcuts.js";
import {
  clearOwnedRuntimePidFile,
  reapStaleOwnedRuntime,
  writeOwnedRuntimePidFile,
} from "./owned-runtime-supervisor.js";
import {
  probePatcherServer,
  waitForCompatibleServer,
  type CompatibleServerProbeResult,
  type ServerProbeResult,
} from "./server-probe.js";
import {
  BUILTIN_SERVER_NAME,
  createServerTargetStore,
  SERVER_TARGET_FILE_NAME,
  type ServerTargetStore,
} from "./server-target.js";
import { openServerUrlDialog } from "./server-url-dialog.js";
import {
  createDesktopShutdownState,
  registerDesktopShutdownSignalHandlers,
} from "./desktop-shutdown.js";
import {
  createDesktopWindowFactory,
  type DesktopBrowserWindow,
  type DesktopBrowserWindowCreator,
  type DesktopWindowFactory,
} from "./desktop-window-factory.js";
import { registerDesktopContextMenu } from "./desktop-context-menu.js";
import {
  createDesktopUpdateService,
  DESKTOP_UPDATE_FEED_URL,
  type DesktopUpdateService,
} from "./desktop-update-check.js";
import { DESKTOP_RELEASE_INFO } from "./desktop-update-provider.js";
import {
  createDesktopAutoUpdateService,
  createElectronAutoUpdaterAdapter,
  shouldEnableDesktopAutoUpdate,
  type DesktopAutoUpdateLogger,
  type DesktopAutoUpdateService,
} from "./desktop-auto-update.js";
import { mergeDesktopUpdateInfo } from "./desktop-update-info.js";
import {
  PATCHER_DESKTOP_CHECK_FOR_UPDATES_CHANNEL,
  PATCHER_DESKTOP_GET_INFO_CHANNEL,
  PATCHER_DESKTOP_INFO_CHANGED_CHANNEL,
  PATCHER_DESKTOP_INSTALL_UPDATE_CHANNEL,
  PATCHER_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
  PATCHER_DESKTOP_SET_THEME_CHANNEL,
} from "./desktop-update-ipc.js";
import {
  PATCHER_DESKTOP_APP_COMMAND_CHANNEL,
  PATCHER_DESKTOP_CLOSE_WINDOW_CHANNEL,
  PATCHER_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
  PATCHER_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
  PATCHER_DESKTOP_GET_WINDOW_STATE_CHANNEL,
  PATCHER_DESKTOP_OPEN_NEW_TAB_CHANNEL,
  PATCHER_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
  CLOSE_WINDOW_REQUEST_TIMEOUT_MS,
} from "./desktop-window-command-ipc.js";
import {
  createDesktopBrowserViewManager,
  type DesktopBrowserViewManager,
} from "./desktop-browser-view.js";
import { createBrowserPdfTextExtractor } from "./desktop-browser-pdf-process.js";
import { resolveDesktopBrowserAppCommand } from "./desktop-browser-shortcuts.js";
import { registerDesktopBrowserIpc } from "./desktop-browser-main-ipc.js";
import {
  PATCHER_DESKTOP_BROWSER_EXTERNAL_URLS_PENDING_CHANNEL,
  PATCHER_DESKTOP_BROWSER_TAKE_EXTERNAL_URLS_CHANNEL,
} from "./desktop-browser-ipc.js";
import { createExternalUrlQueue } from "./desktop-external-url.js";
import {
  PATCHER_DESKTOP_DEFAULT_BROWSER_CHANGED_CHANNEL,
  PATCHER_DESKTOP_GET_DEFAULT_BROWSER_CHANNEL,
  PATCHER_DESKTOP_REQUEST_DEFAULT_BROWSER_CHANNEL,
  readDefaultBrowserStatus,
  requestDefaultBrowser,
  type DefaultBrowserEnvironment,
} from "./desktop-default-browser.js";
import { ensurePackagedMacOsUserShellPath } from "./desktop-shell-path.js";
import { clearPackagedSessionHttpCache } from "./desktop-session-cache.js";
import { resolveDesktopReloadShortcut } from "./desktop-reload-shortcut.js";
import {
  createLogTailer,
  createLogLineBuffer,
  createLogViewerViewUrl,
  LOG_VIEWER_IPC_BATCH_INTERVAL_MS,
  LOG_VIEWER_IPC_BATCH_LINE_LIMIT,
  type LogLineBuffer,
  type LogTailer,
} from "./log-viewer.js";
import {
  LOG_VIEWER_APPEND_CHANNEL,
  LOG_VIEWER_COPY_CHANNEL,
  LOG_VIEWER_OPEN_LOGS_FOLDER_CHANNEL,
  LOG_VIEWER_SNAPSHOT_CHANNEL,
  LOG_VIEWER_VISIBLE_LINE_LIMIT,
  type LogViewerLine,
  type LogViewerCopyRequest,
  type LogViewerOpenLogsFolderResult,
} from "./log-viewer-contract.js";
import {
  ATTACH_PROBE_TIMEOUT_MS,
  DEFAULT_PATCHER_SERVER_URL,
  PROCESS_LOG_LINE_LIMIT,
  STARTUP_POLL_INTERVAL_MS,
  STARTUP_TIMEOUT_MS,
  type RuntimeOwnership,
  type WindowStateKey,
} from "./types.js";

const OWNED_RUNTIME_STOP_TIMEOUT_MS = 6_000;
const OWNED_RUNTIME_KILL_TIMEOUT_MS = 1_000;
const FOREIGN_RUNTIME_STOP_TIMEOUT_MS = 15_000;
const FOREIGN_RUNTIME_KILL_TIMEOUT_MS = 3_000;
const REMOTE_SYSTEM_CONFIG_POLL_INTERVAL_MS = 5 * 60 * 1000;

interface DesktopRuntime {
  patcherProcess: PatcherAppProcess | null;
  ownership: RuntimeOwnership;
  serverUrl: string;
  userDataPath: string | null;
}

interface LoadStartupErrorArgs {
  details: string;
  logs: string;
  title: string;
}

interface LoadWindowUrlArgs {
  url: string;
}

interface CreateApplicationWindowArgs {
  initialUrl: string | null;
  stateKey: WindowStateKey | null;
}

interface StartOwnedRuntimeArgs {
  bridgePath: string;
  serverUrl: string;
  userDataPath: string;
}

interface AppendLogViewerLinesArgs {
  lines: LogViewerLine[];
}

interface SendLogViewerSnapshotArgs {
  browserWindow: BrowserWindow;
  lines: LogViewerLine[];
  logDir: string;
}

interface HandleCopyLogsArgs {
  request: LogViewerCopyRequest;
}

interface LoadLogViewerWindowArgs {
  logDir: string;
  preloadPath: string;
}

type StartupRaceResult =
  | ProcessExitedStartupRaceResult
  | ServerProbeStartupRaceResult;

interface ProcessExitedStartupRaceResult {
  exit: PatcherAppProcessExit;
  kind: "process-exited";
}

interface ServerProbeStartupRaceResult {
  kind: "server-probe";
  result: ServerProbeResult;
}

interface ResolveDataDirFromEnvArgs {
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

interface ResolveDesktopServerUrlArgs {
  env: NodeJS.ProcessEnv;
}

interface ResolveDesktopWindowUrlArgs {
  env: NodeJS.ProcessEnv;
  serverUrl: string;
}

interface ResolveDesktopUpdateFeedUrlArgs {
  env: NodeJS.ProcessEnv;
}

interface FetchSystemConfigArgs {
  /**
   * Remote servers authenticate with the Electron session cookie, which only
   * Electron's own network stack carries. Local ones use plain node fetch.
   */
  fetchImpl: typeof fetch;
  serverUrl: string;
}

interface RefreshSystemConfigArgs {
  fetchImpl: typeof fetch;
  serverUrl: string;
}

interface SystemConfigSync {
  stop(): void;
}

const logViewerCopyRequestSchema = z
  .object({
    text: z.string(),
  })
  .strict();

let desktopWindowFactory: DesktopWindowFactory | null = null;
let desktopBrowserViewManager: DesktopBrowserViewManager | null = null;
let currentAppKeybindings: AppKeybindings = [];
let currentApplicationMenuAccelerators = DEFAULT_APPLICATION_MENU_ACCELERATORS;
let desktopUpdateService: DesktopUpdateService | null = null;
let desktopAutoUpdateService: DesktopAutoUpdateService | null = null;
let currentRuntime: DesktopRuntime | null = null;
let currentWindowUrl: string | null = null;
let logViewerIpcHandlersInstalled = false;
let logViewerLineBuffer: LogLineBuffer | null = null;
let logViewerPreloadPath: string | null = null;
let logViewerTailer: LogTailer | null = null;
let logViewerWindow: BrowserWindow | null = null;
let systemConfigSync: SystemConfigSync | null = null;
let systemConfigRefreshToken = 0;
let refreshRemoteSystemConfig: (() => void) | null = null;
const applicationWindowWebContentsIds = new Set<number>();
let patcherAppLoaded = false;
let stoppingForQuit = false;
let quitting = false;
let serverTargetStore: ServerTargetStore | null = null;
let serverTargetGeneration = 0;
let builtinServerUrl: string = DEFAULT_PATCHER_SERVER_URL;
let desktopBridgePath: string | null = null;
let desktopUserDataPath: string | null = null;
let serverUrlDialogPreloadPath: string | null = null;
let existingServerDialogPreloadPath: string | null = null;

function resolveDesktopServerUrl(args: ResolveDesktopServerUrlArgs): string {
  const rawPort = args.env.PATCHER_SERVER_PORT?.trim();
  if (rawPort === undefined || rawPort.length === 0) {
    return DEFAULT_PATCHER_SERVER_URL;
  }

  const port = Number(rawPort);
  if (Number.isInteger(port) && port >= 1 && port <= 65_535) {
    return `http://127.0.0.1:${port}`;
  }

  throw new Error("PATCHER_SERVER_PORT must be a valid TCP port");
}

/**
 * The URL the main window loads. Defaults to the attached/owned Patcher server, which
 * serves the built UI. In dev, `run-electron-dev.mjs` sets `PATCHER_DESKTOP_APP_URL`
 * to the running Vite dev server — but only when it has confirmed Vite is
 * actually listening — so the desktop shell loads live source with HMR while
 * still talking to the same server it attached to. It is unset in packaged
 * builds, so production always loads the server itself.
 */
function resolveDesktopWindowUrl(args: ResolveDesktopWindowUrlArgs): string {
  const rawAppUrl = args.env.PATCHER_DESKTOP_APP_URL?.trim();
  if (rawAppUrl === undefined || rawAppUrl.length === 0) {
    return args.serverUrl;
  }
  let parsedAppUrl: URL;
  try {
    parsedAppUrl = new URL(rawAppUrl);
  } catch {
    throw new Error("PATCHER_DESKTOP_APP_URL must be a valid URL");
  }
  if (parsedAppUrl.protocol !== "http:" && parsedAppUrl.protocol !== "https:") {
    throw new Error("PATCHER_DESKTOP_APP_URL must be an http(s) URL");
  }
  return rawAppUrl;
}

function resolveDesktopUpdateFeedUrl(
  args: ResolveDesktopUpdateFeedUrlArgs,
): string {
  const rawFeedUrl = args.env.PATCHER_DESKTOP_VERSION_FEED_URL?.trim();
  if (rawFeedUrl === undefined || rawFeedUrl.length === 0) {
    return DESKTOP_UPDATE_FEED_URL;
  }
  return rawFeedUrl;
}

function getDesktopVersion(version: string | undefined): string {
  if (version === undefined || version.length === 0) {
    throw new Error("Desktop version must be injected at build time");
  }
  return version;
}

function getCurrentDesktopInfo(): PatcherDesktopInfo | null {
  return mergeDesktopUpdateInfo({
    autoInfo: desktopAutoUpdateService?.getInfo() ?? null,
    feedInfo: desktopUpdateService?.getInfo() ?? null,
  });
}

function isRegisteredApplicationWindow(browserWindow: BrowserWindow): boolean {
  return applicationWindowWebContentsIds.has(browserWindow.webContents.id);
}

function resolveApplicationWindow(
  webContents: WebContents,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(webContents);
}

function sendToApplicationRenderer(
  browserWindow: BrowserWindow,
  channel: string,
  payload: unknown,
): void {
  if (!browserWindow.webContents.isDestroyed()) {
    browserWindow.webContents.send(channel, payload);
  }
}

function registerApplicationRendererReloadShortcut(
  webContents: WebContents,
): void {
  webContents.on("before-input-event", (event, input) => {
    const shortcut = resolveDesktopReloadShortcut(input);
    if (shortcut === null) {
      return;
    }
    event.preventDefault();
    if (shortcut === "force-reload") {
      webContents.reloadIgnoringCache();
    } else {
      webContents.reload();
    }
  });
}

function sendDesktopInfoChanged(): void {
  const info = getCurrentDesktopInfo();
  if (info === null) {
    return;
  }
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (isRegisteredApplicationWindow(browserWindow)) {
      sendToApplicationRenderer(
        browserWindow,
        PATCHER_DESKTOP_INFO_CHANGED_CHANNEL,
        info,
      );
    } else {
      browserWindow.webContents.send(
        PATCHER_DESKTOP_INFO_CHANGED_CHANNEL,
        info,
      );
    }
  }
}

function getDesktopWindowState(
  browserWindow: Pick<DesktopBrowserWindow, "isFullScreen"> | null,
): PatcherDesktopWindowState {
  return {
    isFullScreen: browserWindow?.isFullScreen() ?? false,
  };
}

function getSenderDesktopWindowState(
  event: IpcMainInvokeEvent,
): PatcherDesktopWindowState {
  return getDesktopWindowState(resolveApplicationWindow(event.sender));
}

function sendDesktopWindowStateChanged(
  browserWindow: DesktopBrowserWindow,
): void {
  sendToApplicationRenderer(
    browserWindow as BrowserWindow,
    PATCHER_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
    getDesktopWindowState(browserWindow),
  );
}

function createDesktopLogger(): DesktopAutoUpdateLogger {
  return {
    error(message) {
      process.stderr.write(`${message}\n`);
    },
    info(message) {
      process.stderr.write(`${message}\n`);
    },
    warn(message) {
      process.stderr.write(`${message}\n`);
    },
  };
}

function resolveDataDirFromEnv(args: ResolveDataDirFromEnvArgs): string {
  const rawDataDir = args.env.PATCHER_DATA_DIR?.trim();
  if (rawDataDir === undefined || rawDataDir.length === 0) {
    // Derived, not restated — same reason as the prod port in types.ts.
    return join(args.homeDir, PATCHER_PROD_DATA_DIR_NAME);
  }
  if (rawDataDir === "~") {
    return args.homeDir;
  }
  if (rawDataDir.startsWith("~/")) {
    return resolve(args.homeDir, rawDataDir.slice(2));
  }
  return resolve(rawDataDir);
}

function formatLogDirectory(): string {
  return join(
    resolveDataDirFromEnv({
      env: process.env,
      homeDir: homedir(),
    }),
    "logs",
  );
}

function formatExitResult(result: PatcherAppProcessExit): string {
  if (result.code !== null) {
    return `exit code ${result.code}`;
  }
  return result.signal === null
    ? "without an exit code"
    : `signal ${result.signal}`;
}

function createDesktopPathContext(): DesktopPathContext {
  return {
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  };
}

function shouldEnableServerDaemonLogsMenu(): boolean {
  // Attached runtimes are owned by an external patcher-app, so the desktop has no
  // reliable server/daemon log lifecycle to tail.
  return (
    process.platform === "darwin" && currentRuntime?.ownership === "spawned"
  );
}

// Close requests routed through the renderer, keyed by webContents id. If the
// renderer never answers (crashed, hung, or still loading), the timer closes
// the window from the main process like the native close role used to.
const defaultBrowserEnvironment: DefaultBrowserEnvironment = {
  get isPackaged() {
    return app.isPackaged;
  },
  isDefaultProtocolClient(protocol) {
    return app.isDefaultProtocolClient(protocol);
  },
  setAsDefaultProtocolClient(protocol) {
    return app.setAsDefaultProtocolClient(protocol);
  },
};

/** Last status pushed to renderers, so an unchanged one is not pushed twice. */
let lastDefaultBrowserStatus: PatcherDesktopDefaultBrowserStatus | null = null;

/**
 * Links macOS handed us because Patcher is the user's default browser, waiting for a
 * surface to take them. Module state rather than a field on a window: the click
 * that launched Patcher arrives before any window exists.
 */
const externalUrlQueue = createExternalUrlQueue();

const pendingCloseWindowRequests = new Map<number, NodeJS.Timeout>();

function requestRendererWindowClose(browserWindow: BrowserWindow): void {
  const webContentsId = browserWindow.webContents.id;
  const pending = pendingCloseWindowRequests.get(webContentsId);
  if (pending !== undefined) {
    clearTimeout(pending);
  }
  pendingCloseWindowRequests.set(
    webContentsId,
    setTimeout(() => {
      pendingCloseWindowRequests.delete(webContentsId);
      if (!browserWindow.isDestroyed()) {
        browserWindow.close();
      }
    }, CLOSE_WINDOW_REQUEST_TIMEOUT_MS),
  );
  sendToApplicationRenderer(
    browserWindow,
    PATCHER_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
    null,
  );
}

/**
 * A link the OS asked Patcher to open. Queued first and delivered second, because on
 * a cold start there is nothing to deliver to yet — `getFocusedApplicationWindow`
 * is null until the runtime has built a window, and the surface drains the queue
 * itself when it mounts.
 */
function handleExternalUrlOpen(rawUrl: string): void {
  if (!externalUrlQueue.push(rawUrl)) {
    return;
  }
  const browserWindow = getFocusedApplicationWindow();
  if (browserWindow === null) {
    return;
  }
  if (browserWindow.isMinimized()) {
    browserWindow.restore();
  }
  browserWindow.show();
  sendToApplicationRenderer(
    browserWindow,
    PATCHER_DESKTOP_BROWSER_EXTERNAL_URLS_PENDING_CHANNEL,
    null,
  );
}

/**
 * Re-read whether macOS still routes links here and tell the renderers when it
 * changed. Called on activation because that is the only moment this app can
 * observe the two places the answer changes — the system's own confirmation
 * dialog, which returns before the user answers it, and System Settings.
 */
function refreshDefaultBrowserStatus(): void {
  const status = readDefaultBrowserStatus(defaultBrowserEnvironment);
  if (
    lastDefaultBrowserStatus !== null &&
    lastDefaultBrowserStatus.isDefault === status.isDefault &&
    lastDefaultBrowserStatus.canRequest === status.canRequest
  ) {
    return;
  }
  lastDefaultBrowserStatus = status;
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (isRegisteredApplicationWindow(browserWindow)) {
      sendToApplicationRenderer(
        browserWindow,
        PATCHER_DESKTOP_DEFAULT_BROWSER_CHANGED_CHANNEL,
        status,
      );
    }
  }
}

function registerDefaultBrowserIpc(): void {
  ipcMain.handle(PATCHER_DESKTOP_GET_DEFAULT_BROWSER_CHANNEL, () =>
    readDefaultBrowserStatus(defaultBrowserEnvironment),
  );
  ipcMain.handle(PATCHER_DESKTOP_REQUEST_DEFAULT_BROWSER_CHANNEL, () =>
    requestDefaultBrowser(defaultBrowserEnvironment),
  );
}

function registerExternalUrlIpc(): void {
  ipcMain.handle(PATCHER_DESKTOP_BROWSER_TAKE_EXTERNAL_URLS_CHANNEL, () => ({
    urls: externalUrlQueue.takeAll(),
  }));
}

function closeFocusedDetachedDevTools(): void {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (browserWindow.webContents.isDevToolsFocused()) {
      browserWindow.webContents.closeDevTools();
      return;
    }
  }
}

function getFocusedApplicationWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (
    focused !== null &&
    !focused.isDestroyed() &&
    applicationWindowWebContentsIds.has(focused.webContents.id)
  ) {
    return focused;
  }
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (
      !browserWindow.isDestroyed() &&
      applicationWindowWebContentsIds.has(browserWindow.webContents.id)
    ) {
      return browserWindow;
    }
  }
  return null;
}

function formatCustomServerName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host.length > 0 ? parsed.host : url;
  } catch {
    return url;
  }
}

function buildMenuServerItems(): Array<{
  checked: boolean;
  id: string;
  name: string;
}> {
  const target = serverTargetStore?.getTarget() ?? { kind: "builtin" as const };
  const items = [
    {
      checked: target.kind === "builtin",
      id: "builtin",
      name: BUILTIN_SERVER_NAME,
    },
  ];
  const customUrl = serverTargetStore?.getCustomServerUrl() ?? null;
  if (customUrl !== null) {
    items.push({
      checked: target.kind === "custom",
      id: "custom",
      name: formatCustomServerName(customUrl),
    });
  }
  return items;
}

function installCurrentApplicationMenu(): void {
  installApplicationMenu({
    accelerators: currentApplicationMenuAccelerators,
    createNewWindow() {
      void createApplicationWindow({
        initialUrl: currentWindowUrl,
        stateKey: null,
      });
    },
    openNewTab() {
      const browserWindow = getFocusedApplicationWindow();
      if (browserWindow !== null) {
        sendToApplicationRenderer(
          browserWindow,
          PATCHER_DESKTOP_OPEN_NEW_TAB_CHANNEL,
          null,
        );
        sendToApplicationRenderer(
          browserWindow,
          PATCHER_DESKTOP_APP_COMMAND_CHANNEL,
          "panel.newTab",
        );
      }
    },
    openNewThread() {
      const browserWindow = getFocusedApplicationWindow();
      if (browserWindow !== null) {
        sendToApplicationRenderer(
          browserWindow,
          PATCHER_DESKTOP_APP_COMMAND_CHANNEL,
          "thread.new",
        );
      }
    },
    openSettings() {
      const browserWindow = getFocusedApplicationWindow();
      if (browserWindow !== null) {
        sendToApplicationRenderer(
          browserWindow,
          PATCHER_DESKTOP_APP_COMMAND_CHANNEL,
          "settings.open",
        );
      }
    },
    reloadWindow(browserWindow, ignoreCache) {
      if (!(browserWindow instanceof BrowserWindow)) {
        return;
      }
      if (ignoreCache) {
        browserWindow.webContents.reloadIgnoringCache();
      } else {
        browserWindow.webContents.reload();
      }
    },
    closeWindowOrSideTab(browserWindow) {
      if (browserWindow === undefined) {
        // A focused detached DevTools window is the key window but never
        // surfaces as a BaseWindow here; the native close role used to
        // close it.
        closeFocusedDetachedDevTools();
        return;
      }
      if (
        !(browserWindow instanceof BrowserWindow) ||
        browserWindow === logViewerWindow
      ) {
        // Windows that don't run the app preload can't answer the renderer
        // round trip, so close them directly.
        browserWindow.close();
        return;
      }
      requestRendererWindowClose(browserWindow);
    },
    openServerDaemonLogs() {
      void openServerDaemonLogs();
    },
    selectServer(serverId) {
      void setActiveServerTarget(serverId);
    },
    setServerUrl() {
      void openSetServerUrlDialog();
    },
    serverDaemonLogsMenuEnabled: shouldEnableServerDaemonLogsMenu(),
    servers: buildMenuServerItems(),
  });
}

function refreshApplicationMenu(): void {
  installCurrentApplicationMenu();
}

function setCurrentRuntime(runtime: DesktopRuntime | null): void {
  currentRuntime = runtime;
  if (runtime === null) {
    stopSystemConfigSync();
  }
  refreshApplicationMenu();
  if (runtime?.ownership !== "spawned") {
    closeServerDaemonLogsWindow();
  }
}

function formatApiUrl(args: FetchSystemConfigArgs): string {
  const url = new URL(args.serverUrl);
  url.pathname = "/api/v1/system/config";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function formatRealtimeUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function fetchSystemConfig(args: FetchSystemConfigArgs) {
  const response = await args.fetchImpl(formatApiUrl(args));
  if (!response.ok) {
    throw new Error(
      `System config request failed with HTTP ${response.status}`,
    );
  }
  const payload: unknown = await response.json();
  return systemConfigResponseSchema.parse(payload);
}

function createSystemConfigSync(serverUrl: string): SystemConfigSync {
  const realtimeUrl = formatRealtimeUrl(serverUrl);
  const subscribeMessage: ClientMessage = {
    type: "subscribe",
    target: { kind: "system" },
  };
  let reconnectTimer: NodeJS.Timeout | null = null;
  let socket: WebSocket | null = null;
  let stopped = false;

  function clearReconnectTimer(): void {
    if (reconnectTimer === null) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1_000);
  }

  function handleMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") {
      return;
    }
    try {
      const parsed = serverMessageLenientSchema.safeParse(
        JSON.parse(event.data),
      );
      if (!parsed.success) {
        return;
      }
      if (
        parsed.data.entity === "system" &&
        parsed.data.changes.includes("config-changed")
      ) {
        void refreshSystemConfig({ fetchImpl: fetch, serverUrl });
      }
    } catch {
      return;
    }
  }

  function connect(): void {
    if (stopped) {
      return;
    }
    socket = new WebSocket(realtimeUrl);
    socket.addEventListener("open", () => {
      socket?.send(JSON.stringify(subscribeMessage));
      void refreshSystemConfig({ fetchImpl: fetch, serverUrl });
    });
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => {
      socket?.close();
    });
  }

  connect();

  return {
    stop(): void {
      stopped = true;
      clearReconnectTimer();
      socket?.close();
      socket = null;
    },
  };
}

async function refreshSystemConfig(
  args: RefreshSystemConfigArgs,
): Promise<void> {
  const token = systemConfigRefreshToken + 1;
  systemConfigRefreshToken = token;
  try {
    const config = await fetchSystemConfig({
      fetchImpl: args.fetchImpl,
      serverUrl: args.serverUrl,
    });
    if (token !== systemConfigRefreshToken) {
      return;
    }
    currentAppKeybindings = config.keybindings;
    currentApplicationMenuAccelerators = resolveApplicationMenuAccelerators(
      currentAppKeybindings,
    );
    refreshApplicationMenu();
  } catch (error) {
    if (token !== systemConfigRefreshToken) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Could not refresh system config: ${message}\n`);
  }
}

/**
 * Poll a remote server for keybindings and theme.
 *
 * The realtime socket is not an option here: a remote server authenticates the
 * desktop with the Electron session cookie, and only Electron's own network
 * stack sends it. So the app re-reads the config on start, when it becomes
 * active, and on a slow timer. A keybinding edit lands within a poll instead
 * of instantly.
 */
function createRemoteSystemConfigSync(serverUrl: string): SystemConfigSync {
  function refresh(): void {
    void refreshSystemConfig({
      fetchImpl: (input, init) =>
        net.fetch(input as string | Request, {
          ...init,
          credentials: "include",
        }),
      serverUrl,
    });
  }

  const timer = setInterval(refresh, REMOTE_SYSTEM_CONFIG_POLL_INTERVAL_MS);
  timer.unref();
  refreshRemoteSystemConfig = refresh;
  refresh();

  return {
    stop(): void {
      clearInterval(timer);
      refreshRemoteSystemConfig = null;
    },
  };
}

function stopSystemConfigSync(): void {
  systemConfigSync?.stop();
  systemConfigSync = null;
}

function startSystemConfigSync(serverUrl: string): void {
  systemConfigSync?.stop();
  systemConfigSync = createSystemConfigSync(serverUrl);
  void refreshSystemConfig({ fetchImpl: fetch, serverUrl });
}

/** System config for a custom target, with no local server. */
function startRemoteSystemConfigSync(serverUrl: string): void {
  systemConfigSync?.stop();
  systemConfigSync = createRemoteSystemConfigSync(serverUrl);
}

function registerApplicationWindow(browserWindow: DesktopBrowserWindow): void {
  const webContentsId = browserWindow.webContents.id;
  applicationWindowWebContentsIds.add(webContentsId);
  registerApplicationRendererReloadShortcut(
    (browserWindow as BrowserWindow).webContents,
  );
  registerDesktopContextMenu({ webContents: browserWindow.webContents });
  browserWindow.on("enter-full-screen", () => {
    sendDesktopWindowStateChanged(browserWindow);
  });
  browserWindow.on("leave-full-screen", () => {
    sendDesktopWindowStateChanged(browserWindow);
  });
  browserWindow.on("closed", () => {
    applicationWindowWebContentsIds.delete(webContentsId);
  });
}

/**
 * Attach to a compatible Patcher server on this Mac, or start one. The caller pins
 * the system config sync, because a remote target reads its config elsewhere.
 */
async function ensureBuiltinRuntimeAttached(): Promise<boolean> {
  if (currentRuntime !== null) {
    return true;
  }
  if (desktopBridgePath === null || desktopUserDataPath === null) {
    return false;
  }

  const existingProbe = await probePatcherServer({
    serverUrl: builtinServerUrl,
    timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
  });

  if (existingProbe.kind === "compatible") {
    setCurrentRuntime({
      patcherProcess: null,
      ownership: "attached",
      serverUrl: existingProbe.serverUrl,
      userDataPath: null,
    });
    return true;
  }

  if (existingProbe.kind === "incompatible") {
    return false;
  }

  const runtime = await startOwnedRuntime({
    bridgePath: desktopBridgePath,
    serverUrl: builtinServerUrl,
    userDataPath: desktopUserDataPath,
  });
  return runtime !== null;
}

/**
 * Load the saved target and pin the session, config sync, and menu to it.
 *
 * The Server menu starts a switch without waiting, so two of these can overlap
 * and a slow one can finish last. Each run therefore claims a generation and
 * checks it after every wait: a run the user has already superseded stops
 * quietly instead of loading its own server over the newer one.
 */
async function applyServerTarget(): Promise<void> {
  if (serverTargetStore === null) {
    return;
  }
  const target = serverTargetStore.getTarget();
  serverTargetGeneration += 1;
  const generation = serverTargetGeneration;
  const isCurrent = (): boolean => serverTargetGeneration === generation;

  if (target.kind === "builtin") {
    const attached = await ensureBuiltinRuntimeAttached();
    if (!isCurrent()) {
      return;
    }
    if (!attached) {
      await loadStartupError({
        details:
          "Could not connect to the local Patcher server on this Mac. Check that the port is free or that a compatible Patcher server is running.",
        logs: "",
        title: "Could not connect",
      });
      refreshApplicationMenu();
      return;
    }
    const localServerUrl = currentRuntime?.serverUrl ?? builtinServerUrl;
    // Switching back from a remote target leaves that target's config poll
    // running, so re-pin the sync to the local server here.
    startSystemConfigSync(localServerUrl);
    await loadPatcherApp(
      resolveDesktopWindowUrl({
        env: process.env,
        serverUrl: localServerUrl,
      }),
    );
  } else {
    // A custom server is a plain web load.
    patcherAppLoaded = true;
    await loadWindowUrl({ url: target.url });
    if (!isCurrent()) {
      return;
    }
    startRemoteSystemConfigSync(target.url);
  }
  refreshApplicationMenu();
}

async function setActiveServerTarget(serverId: string): Promise<void> {
  if (serverTargetStore === null) {
    return;
  }
  if (serverId !== "builtin" && serverId !== "custom") {
    return;
  }
  const switched = await serverTargetStore.setTarget(serverId);
  if (!switched) {
    refreshApplicationMenu();
    return;
  }
  await applyServerTarget();
}

async function openSetServerUrlDialog(): Promise<void> {
  if (serverTargetStore === null || serverUrlDialogPreloadPath === null) {
    return;
  }
  const result = await openServerUrlDialog({
    initialUrl: serverTargetStore.getCustomServerUrl(),
    parentWindow: getFocusedApplicationWindow(),
    preloadPath: serverUrlDialogPreloadPath,
  });
  if (result.kind === "cancelled") {
    return;
  }
  if (
    result.kind === "clear" &&
    serverTargetStore.getCustomServerUrl() === null
  ) {
    return;
  }
  await serverTargetStore.setCustomServerUrl(
    result.kind === "set" ? result.url : null,
  );
  await applyServerTarget();
}

function sendLogViewerSnapshot(args: SendLogViewerSnapshotArgs): void {
  if (args.browserWindow.isDestroyed()) {
    return;
  }
  args.browserWindow.webContents.send(LOG_VIEWER_SNAPSHOT_CHANNEL, {
    lines: args.lines,
    logDir: args.logDir,
  });
}

function appendLogViewerLines(args: AppendLogViewerLinesArgs): void {
  if (args.lines.length === 0) {
    return;
  }

  logViewerLineBuffer?.append(args.lines);
}

function closeServerDaemonLogsWindow(): void {
  logViewerTailer?.stop();
  logViewerTailer = null;
  logViewerLineBuffer?.stop();
  logViewerLineBuffer = null;

  const browserWindow = logViewerWindow;
  logViewerWindow = null;
  if (browserWindow !== null && !browserWindow.isDestroyed()) {
    browserWindow.close();
  }
}

function handleCopyLogs(args: HandleCopyLogsArgs): void {
  const request = logViewerCopyRequestSchema.parse(args.request);
  clipboard.writeText(request.text);
}

async function handleOpenLogsFolder(): Promise<LogViewerOpenLogsFolderResult> {
  if (!shouldEnableServerDaemonLogsMenu()) {
    throw new Error(
      "Server and daemon logs are only available for owned runtimes",
    );
  }

  const logDir = formatLogDirectory();
  const errorMessage = await shell.openPath(logDir);
  if (errorMessage.length > 0) {
    throw new Error(errorMessage);
  }
  return { path: logDir };
}

function installLogViewerIpcHandlers(): void {
  if (logViewerIpcHandlersInstalled) {
    return;
  }
  logViewerIpcHandlersInstalled = true;
  ipcMain.handle(
    LOG_VIEWER_COPY_CHANNEL,
    (_event, request: LogViewerCopyRequest) => {
      handleCopyLogs({ request });
    },
  );
  ipcMain.handle(LOG_VIEWER_OPEN_LOGS_FOLDER_CHANNEL, () =>
    handleOpenLogsFolder(),
  );
}

async function loadLogViewerWindow(
  args: LoadLogViewerWindowArgs,
): Promise<void> {
  const browserWindow = new BrowserWindow({
    height: 720,
    minHeight: 520,
    minWidth: 840,
    show: false,
    title: "Patcher - Server & Daemon Logs",
    titleBarStyle: "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.preloadPath,
      sandbox: true,
    },
    width: 1180,
  });
  const tailer = createLogTailer({
    logDir: args.logDir,
    onLines(lines) {
      appendLogViewerLines({ lines });
    },
  });
  const lineBuffer = createLogLineBuffer({
    flushIntervalMs: LOG_VIEWER_IPC_BATCH_INTERVAL_MS,
    flushLineCount: LOG_VIEWER_IPC_BATCH_LINE_LIMIT,
    maxLines: LOG_VIEWER_VISIBLE_LINE_LIMIT,
    onFlush(lines) {
      if (logViewerWindow === null || logViewerWindow.isDestroyed()) {
        return;
      }
      logViewerWindow.webContents.send(LOG_VIEWER_APPEND_CHANNEL, {
        lines,
      });
    },
  });

  logViewerLineBuffer = lineBuffer;
  logViewerTailer = tailer;
  logViewerWindow = browserWindow;

  browserWindow.once("ready-to-show", () => {
    browserWindow.show();
  });
  browserWindow.on("closed", () => {
    if (logViewerTailer === tailer) {
      logViewerTailer = null;
      tailer.stop();
    }
    if (logViewerWindow === browserWindow) {
      logViewerWindow = null;
    }
    if (logViewerLineBuffer === lineBuffer) {
      logViewerLineBuffer = null;
    }
    lineBuffer.stop();
  });

  await browserWindow.loadURL(createLogViewerViewUrl({ logDir: args.logDir }));
  sendLogViewerSnapshot({
    browserWindow,
    lines: lineBuffer.lines(),
    logDir: args.logDir,
  });
  await tailer.start();
}

async function openServerDaemonLogs(): Promise<void> {
  if (!shouldEnableServerDaemonLogsMenu() || logViewerPreloadPath === null) {
    return;
  }

  if (logViewerWindow !== null && !logViewerWindow.isDestroyed()) {
    logViewerWindow.focus();
    return;
  }

  await loadLogViewerWindow({
    logDir: formatLogDirectory(),
    preloadPath: logViewerPreloadPath,
  });
}

async function loadWindowUrl(args: LoadWindowUrlArgs): Promise<void> {
  currentWindowUrl = args.url;
  if (desktopWindowFactory === null) {
    return;
  }

  await desktopWindowFactory.loadUrl({ url: args.url });
}

async function loadLoadingView(): Promise<void> {
  patcherAppLoaded = false;
  await loadWindowUrl({
    url: createLocalViewUrl({
      viewModel: {
        kind: "loading",
        message: "Starting local services and opening the Patcher workspace.",
        title: "Opening Patcher",
      },
    }),
  });
}

async function loadStartupError(args: LoadStartupErrorArgs): Promise<void> {
  patcherAppLoaded = false;
  await loadWindowUrl({
    url: createLocalViewUrl({
      viewModel: {
        details: `${args.details} Logs are under ${formatLogDirectory()}/.`,
        kind: "error",
        logText: args.logs,
        title: args.title,
      },
    }),
  });
}

async function loadPatcherApp(serverUrl: string): Promise<void> {
  patcherAppLoaded = true;
  await loadWindowUrl({ url: serverUrl });
  if (shouldOpenDevTools()) {
    desktopWindowFactory?.openDevTools();
  }
}

function shouldOpenDevTools(): boolean {
  return process.env.PATCHER_DESKTOP_OPEN_DEVTOOLS === "1";
}

async function createApplicationWindow(
  args: CreateApplicationWindowArgs,
): Promise<DesktopBrowserWindow | null> {
  if (desktopWindowFactory === null) {
    return null;
  }

  const browserWindow = await desktopWindowFactory.createWindow({
    initialUrl: args.initialUrl,
    stateKey: args.stateKey,
  });
  registerApplicationWindow(browserWindow);
  if (patcherAppLoaded && shouldOpenDevTools()) {
    browserWindow.webContents.openDevTools({ mode: "detach" });
  }
  return browserWindow;
}

async function stopOwnedRuntime(): Promise<void> {
  const runtime = currentRuntime;
  if (runtime === null || runtime.ownership !== "spawned") {
    setCurrentRuntime(null);
    return;
  }

  setCurrentRuntime(null);
  try {
    await runtime.patcherProcess?.stop({
      killSignal: "SIGKILL",
      killTimeoutMs: OWNED_RUNTIME_KILL_TIMEOUT_MS,
      signal: "SIGTERM",
      timeoutMs: OWNED_RUNTIME_STOP_TIMEOUT_MS,
    });
  } finally {
    if (runtime.userDataPath !== null) {
      await clearOwnedRuntimePidFile({ userDataPath: runtime.userDataPath });
    }
  }
}

function handleBeforeQuit(event: Event): void {
  quitting = true;
  if (stoppingForQuit) {
    return;
  }

  event.preventDefault();
  stoppingForQuit = true;
  void finishQuit().finally(() => {
    app.quit();
  });
}

async function finishQuit(): Promise<void> {
  stopSystemConfigSync();
  desktopUpdateService?.stop();
  desktopAutoUpdateService?.stop();
  desktopBrowserViewManager?.destroyAll();
  await desktopWindowFactory?.persistOpenWindows();
  await stopOwnedRuntime();
}

function registerDesktopUpdateIpc(): void {
  ipcMain.handle(PATCHER_DESKTOP_GET_INFO_CHANNEL, () => {
    return getCurrentDesktopInfo();
  });
  ipcMain.handle(PATCHER_DESKTOP_GET_WINDOW_STATE_CHANNEL, (event) => {
    return getSenderDesktopWindowState(event);
  });
  ipcMain.handle(PATCHER_DESKTOP_CHECK_FOR_UPDATES_CHANNEL, async () => {
    await Promise.all([
      desktopUpdateService?.checkForUpdates() ?? Promise.resolve(null),
      desktopAutoUpdateService?.checkForUpdates() ?? Promise.resolve(null),
    ]);
    return getCurrentDesktopInfo();
  });
  ipcMain.handle(PATCHER_DESKTOP_INSTALL_UPDATE_CHANNEL, async () => {
    if (desktopAutoUpdateService === null) {
      return;
    }
    if (!desktopAutoUpdateService.getInfo().updateDownloaded) {
      desktopAutoUpdateService.installUpdate();
      return;
    }
    quitting = true;
    stoppingForQuit = true;
    await finishQuit();
    desktopAutoUpdateService.installUpdate();
  });
  // Renderer pushes the Patcher theme preference so the NSWindow appearance —
  // traffic lights and inactive title-bar chrome — follows an explicit Patcher
  // theme or the OS when set to system. `themeSource` is app-global so a
  // single assignment covers every BrowserWindow, including the log viewer.
  ipcMain.on(PATCHER_DESKTOP_SET_THEME_CHANNEL, (_event, payload: unknown) => {
    const parsed = patcherDesktopThemeSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    nativeTheme.themeSource = parsed.data;
  });

  ipcMain.on(PATCHER_DESKTOP_CLOSE_WINDOW_CHANNEL, (event) => {
    resolveApplicationWindow(event.sender)?.close();
  });

  ipcMain.on(
    PATCHER_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
    (event, payload) => {
      const pending = pendingCloseWindowRequests.get(event.sender.id);
      if (pending !== undefined) {
        clearTimeout(pending);
        pendingCloseWindowRequests.delete(event.sender.id);
      }
      if (payload === false) {
        resolveApplicationWindow(event.sender)?.close();
      }
    },
  );
  // The in-app browser tab hands off the current address to the system
  // browser. The URL originates from a possibly-hostile page, so only open
  // well-formed `http(s)` URLs — never `file:`, custom schemes, or junk.
  ipcMain.on(
    PATCHER_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
    (_event, payload: unknown) => {
      if (typeof payload !== "string") {
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(payload);
      } catch {
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return;
      }
      void shell.openExternal(parsed.toString());
    },
  );
}

interface DesktopBrowserWindowLifecycleArgs {
  browserWindow: BrowserWindow;
  manager: DesktopBrowserViewManager;
}

/**
 * After the last `resize` tick of a burst, wait this long before revealing the
 * browser views again. Long enough for the renderer's post-resize relayout and
 * bounds push (~100-150ms on a large window) to land first, short enough that
 * the overlay does not feel missing once the window is at rest. Manual drags
 * usually end through the `resized` event instead and never wait this out.
 */
const WINDOW_RESIZE_SETTLE_MS = 200;

function registerDesktopBrowserWindowLifecycle({
  browserWindow,
  manager,
}: DesktopBrowserWindowLifecycleArgs): void {
  const hostWebContentsId = browserWindow.webContents.id;
  let resizeSettleTimer: NodeJS.Timeout | null = null;
  const endWindowResize = () => {
    if (resizeSettleTimer !== null) {
      clearTimeout(resizeSettleTimer);
      resizeSettleTimer = null;
    }
    if (!browserWindow.isDestroyed()) {
      manager.endWindowResize(browserWindow);
    }
  };
  // During a native window resize the host chrome repaints at its own (much
  // slower) cadence while the native browser views composite independently, so
  // no bounds protocol keeps a view visually inside its panel mid-drag. Hide
  // the views for the duration of the resize burst — the chrome's own panel
  // background shows in their place, always exactly where the chrome painted
  // it — and reveal them at the settled bounds afterwards. `resized` ends a
  // manual drag immediately on mouse release; the settle timer covers
  // programmatic resize streams (maximize animations, setBounds), which never
  // emit `resized`.
  browserWindow.on("resize", () => {
    manager.beginWindowResize(browserWindow);
    if (resizeSettleTimer !== null) {
      clearTimeout(resizeSettleTimer);
    }
    resizeSettleTimer = setTimeout(endWindowResize, WINDOW_RESIZE_SETTLE_MS);
  });
  browserWindow.on("resized", endWindowResize);
  browserWindow.once("closed", () => {
    if (resizeSettleTimer !== null) {
      clearTimeout(resizeSettleTimer);
      resizeSettleTimer = null;
    }
    manager.releaseWindow(hostWebContentsId);
  });
}

async function startOwnedRuntime(
  args: StartOwnedRuntimeArgs,
): Promise<DesktopRuntime | null> {
  const patcherProcess = startPatcherAppProcess({
    bridgePath: args.bridgePath,
    cwd: homedir(),
    env: {
      ...process.env,
      [APP_SURFACE_ENV_NAME]: APP_SURFACE_DESKTOP,
    },
    logLineLimit: PROCESS_LOG_LINE_LIMIT,
    runtime: resolvePatcherAppProcessRuntime({
      env: process.env,
      isPackaged: app.isPackaged,
      processExecPath: process.execPath,
    }),
  });
  const runtime: DesktopRuntime = {
    patcherProcess,
    ownership: "spawned",
    serverUrl: args.serverUrl,
    userDataPath: args.userDataPath,
  };
  await writeOwnedRuntimePidFile({
    bridgePath: args.bridgePath,
    pid: patcherProcess.pid,
    serverUrl: args.serverUrl,
    userDataPath: args.userDataPath,
  });
  setCurrentRuntime(runtime);

  void patcherProcess.exit.then((exit) => {
    void clearOwnedRuntimePidFile({ userDataPath: args.userDataPath });
    if (quitting || currentRuntime !== runtime) {
      return;
    }
    setCurrentRuntime(null);
    void loadStartupError({
      details: `The Electron-owned patcher-app process stopped with ${formatExitResult(
        exit,
      )}.`,
      logs: patcherProcess.logs.text(),
      title: "Patcher stopped",
    });
  });

  const raceResult = await Promise.race<StartupRaceResult>([
    waitForCompatibleServer({
      intervalMs: STARTUP_POLL_INTERVAL_MS,
      serverUrl: args.serverUrl,
      timeoutMs: STARTUP_TIMEOUT_MS,
    }).then((result) => ({
      kind: "server-probe",
      result,
    })),
    patcherProcess.exit.then((exit) => ({
      exit,
      kind: "process-exited",
    })),
  ]);

  if (raceResult.kind === "process-exited") {
    await loadStartupError({
      details: `patcher-app exited before the server was ready with ${formatExitResult(
        raceResult.exit,
      )}.`,
      logs: patcherProcess.logs.text(),
      title: "Could not start Patcher",
    });
    setCurrentRuntime(null);
    return null;
  }

  if (raceResult.result.kind === "compatible") {
    return runtime;
  }

  await loadStartupError({
    details:
      raceResult.result.kind === "incompatible"
        ? `Port ${args.serverUrl} is responding, but it does not look like patcher: ${raceResult.result.reason}.`
        : `Timed out waiting for Patcher at ${args.serverUrl}: ${raceResult.result.reason}.`,
    logs: patcherProcess.logs.text(),
    title: "Could not start Patcher",
  });
  await stopOwnedRuntime();
  return null;
}

interface InitializeRuntimeArgs {
  bridgePath: string;
  serverUrl: string;
  userDataPath: string;
}

/**
 * Attaching to a Patcher this app did not start is invisible to the person using it,
 * so ask first. Local development stays silent, because attaching to a
 * `bun run dev` server is the whole point there.
 *
 * `PATCHER_DESKTOP_ATTACH_WITHOUT_PROMPT` exists for the packaged smoke test, which
 * points a packaged build at a stub server and has no one to click the dialog.
 * It is deliberately opt-in and never set by the app itself: the prompt is a
 * safety boundary, so suppressing it must be an explicit act by the harness.
 */
function shouldAskBeforeAttaching(): boolean {
  if (!app.isPackaged || existingServerDialogPreloadPath === null) {
    return false;
  }
  if (process.env.PATCHER_DESKTOP_ATTACH_WITHOUT_PROMPT === "1") {
    return false;
  }
  return (process.env.PATCHER_DESKTOP_APP_URL ?? "").trim().length === 0;
}

/**
 * Wait for the port to close after the other copy was told to stop. A new
 * server cannot bind a port that the old process still holds.
 */
async function waitForServerToStop(serverUrl: string): Promise<boolean> {
  const deadline = Date.now() + FOREIGN_RUNTIME_STOP_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const probe = await probePatcherServer({
      serverUrl,
      timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
    });
    if (probe.kind === "unavailable") {
      return true;
    }
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, STARTUP_POLL_INTERVAL_MS);
    });
  }
  return false;
}

type ExistingServerDecision = "attach" | "quit" | "start-fresh";

async function decideOnExistingServer(
  probe: CompatibleServerProbeResult,
): Promise<ExistingServerDecision> {
  if (!shouldAskBeforeAttaching()) {
    return "attach";
  }

  const preloadPath = existingServerDialogPreloadPath;
  if (preloadPath === null) {
    return "attach";
  }

  const details = await readForeignRuntimeDetails({
    dataDir: probe.dataDir,
    serverUrl: probe.serverUrl,
  });
  const choice = await openExistingServerDialog({
    details,
    parentWindow: getFocusedApplicationWindow(),
    preloadPath,
    serverUrl: probe.serverUrl,
  });

  if (choice === "quit") {
    return "quit";
  }
  if (choice === "connect" || details === null) {
    return "attach";
  }

  const stopResult = await stopForeignRuntime({
    details,
    killTimeoutMs: FOREIGN_RUNTIME_KILL_TIMEOUT_MS,
    timeoutMs: FOREIGN_RUNTIME_STOP_TIMEOUT_MS,
  });
  if (stopResult.kind === "unverified") {
    await loadStartupError({
      details:
        `The Patcher at ${probe.serverUrl} records process ${String(stopResult.pid)}, but that ` +
        "process no longer matches the record. Patcher did not stop it. Stop it yourself, then open Patcher again.",
      logs: "",
      title: "Could not stop the running Patcher",
    });
    return "quit";
  }
  if (stopResult.kind === "still-running") {
    await loadStartupError({
      details: `Patcher could not stop process ${String(stopResult.pid)}, even after SIGKILL.`,
      logs: "",
      title: "Could not stop the running Patcher",
    });
    return "quit";
  }
  if (stopResult.kind === "replaced") {
    await loadStartupError({
      details:
        `Another Patcher started at ${probe.serverUrl} while the question was open, so Patcher stopped nothing. ` +
        "Open Patcher again to see the copy that runs now.",
      logs: "",
      title: "Could not stop the running Patcher",
    });
    return "quit";
  }
  if (!(await waitForServerToStop(probe.serverUrl))) {
    await loadStartupError({
      details: `The Patcher at ${probe.serverUrl} stopped, but the address is still in use.`,
      logs: "",
      title: "Could not stop the running Patcher",
    });
    return "quit";
  }
  return "start-fresh";
}

async function initializeRuntime(args: InitializeRuntimeArgs): Promise<void> {
  const existingProbe = await probePatcherServer({
    serverUrl: args.serverUrl,
    timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
  });

  if (existingProbe.kind === "compatible") {
    const decision = await decideOnExistingServer(existingProbe);
    if (decision === "quit") {
      app.quit();
      return;
    }
    if (decision === "start-fresh") {
      await loadLoadingView();
      const freshRuntime = await startOwnedRuntime({
        bridgePath: args.bridgePath,
        serverUrl: args.serverUrl,
        userDataPath: args.userDataPath,
      });
      if (freshRuntime !== null) {
        await loadPatcherApp(freshRuntime.serverUrl);
        startSystemConfigSync(freshRuntime.serverUrl);
        refreshApplicationMenu();
      }
      return;
    }

    setCurrentRuntime({
      patcherProcess: null,
      ownership: "attached",
      serverUrl: existingProbe.serverUrl,
      userDataPath: null,
    });
    // When attaching to an already-running server (the `bun run dev` case) load the
    // Vite dev URL if the launcher provided one, so the shell gets live source
    // and HMR. The attached server still handles every API/WS request.
    await loadPatcherApp(
      resolveDesktopWindowUrl({
        env: process.env,
        serverUrl: existingProbe.serverUrl,
      }),
    );
    startSystemConfigSync(existingProbe.serverUrl);
    refreshApplicationMenu();
    return;
  }

  if (existingProbe.kind === "incompatible") {
    await loadStartupError({
      details: `Port ${args.serverUrl} is already in use, but it is not a compatible Patcher server: ${existingProbe.reason}.`,
      logs: "",
      title: "Port conflict",
    });
    return;
  }

  const runtime = await startOwnedRuntime({
    bridgePath: args.bridgePath,
    serverUrl: args.serverUrl,
    userDataPath: args.userDataPath,
  });
  if (runtime !== null) {
    await loadPatcherApp(runtime.serverUrl);
    startSystemConfigSync(runtime.serverUrl);
    refreshApplicationMenu();
  }
}

async function runDesktopApp(): Promise<void> {
  ensurePackagedMacOsUserShellPath({
    env: process.env,
    isPackaged: app.isPackaged,
    logger: createDesktopLogger(),
    platform: process.platform,
  });

  app.setName(
    app.isPackaged ? DESKTOP_RELEASE_INFO.applicationName : "patcher-dev",
  );

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (desktopWindowFactory?.focusFirstWindow() === true) {
      return;
    }
    void createApplicationWindow({
      initialUrl: currentWindowUrl,
      stateKey: null,
    });
  });
  // macOS delivers every link Patcher is asked to open here — and on a cold start it
  // fires before `whenReady`, which is why this listener is registered with the
  // other app events rather than after the runtime is up. `preventDefault` marks
  // the URL as ours; without it macOS treats the launch as unhandled.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleExternalUrlOpen(url);
  });
  app.on("before-quit", handleBeforeQuit);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  app.on("activate", () => {
    if (desktopWindowFactory?.hasOpenWindows() === false) {
      void createApplicationWindow({
        initialUrl: currentWindowUrl,
        stateKey: null,
      });
    }
  });
  app.on("did-become-active", () => {
    // The user may have answered the system's "change your default browser?"
    // dialog, or changed it in System Settings, while Patcher was in the background.
    refreshDefaultBrowserStatus();
    void desktopUpdateService?.checkAfterActive();
    void desktopAutoUpdateService?.checkAfterActive();
    // A remote target has no realtime socket for config changes.
    refreshRemoteSystemConfig?.();
  });
  app.on("browser-window-created", (_event, browserWindow) => {
    if (desktopBrowserViewManager === null) {
      return;
    }
    registerDesktopBrowserWindowLifecycle({
      browserWindow,
      manager: desktopBrowserViewManager,
    });
  });
  registerDesktopShutdownSignalHandlers({
    exitProcess(code) {
      process.exitCode = code;
    },
    processEvents: process,
    quitApplication() {
      app.quit();
    },
    state: createDesktopShutdownState(),
    async stopOwnedRuntime() {
      quitting = true;
      await stopOwnedRuntime();
    },
  });

  await app.whenReady();
  await clearPackagedSessionHttpCache({
    isPackaged: app.isPackaged,
    session: session.defaultSession,
  });

  const paths = createDesktopPathContext();
  const iconPath = resolveDesktopIconPath({
    packagedIconFileName: DESKTOP_RELEASE_INFO.iconFileName,
    paths,
  });
  const bridgePath = resolveDesktopBridgePath({ paths });
  const resolvedLogViewerPreloadPath = join(
    paths.appPath,
    "dist",
    "log-viewer-preload.cjs",
  );
  const preloadPath = join(paths.appPath, "dist", "preload.cjs");
  // The preload for *browsed* pages, installed in the browsing session only while
  // a plugin declares a page script — see `syncPageScriptPreload`.
  const resolvedPageScriptPreloadPath = join(
    paths.appPath,
    "dist",
    "page-script-preload.cjs",
  );
  const resolvedExistingServerDialogPreloadPath = join(
    paths.appPath,
    "dist",
    "existing-server-dialog-preload.cjs",
  );
  const resolvedServerUrlDialogPreloadPath = join(
    paths.appPath,
    "dist",
    "server-url-dialog-preload.cjs",
  );
  const serverUrl = resolveDesktopServerUrl({ env: process.env });
  builtinServerUrl = serverUrl;
  desktopBridgePath = bridgePath;
  const desktopVersion = getDesktopVersion(process.env.PATCHER_DESKTOP_VERSION);
  const desktopUpdateFeedUrl = resolveDesktopUpdateFeedUrl({
    env: process.env,
  });
  const userDataPath = app.getPath("userData");
  desktopUserDataPath = userDataPath;

  assertPathExists({ label: "patcher-app bridge", path: bridgePath });
  assertPathExists({
    label: "existing server dialog preload script",
    path: resolvedExistingServerDialogPreloadPath,
  });
  assertPathExists({
    label: "log viewer preload script",
    path: resolvedLogViewerPreloadPath,
  });
  assertPathExists({ label: "preload script", path: preloadPath });
  assertPathExists({
    label: "server URL dialog preload script",
    path: resolvedServerUrlDialogPreloadPath,
  });
  assertPathExists({ label: "app icon", path: iconPath });

  // Packaged builds must not call dock.setIcon: it replaces the bundle icon
  // (already channel-correct via electron-builder) with a raw NSImage that
  // bypasses the macOS appearance pipeline, so dark mode shows the light
  // rendering. Dev runs still need it to show icon-dev.png instead of the
  // stock Electron icon.
  if (
    process.platform === "darwin" &&
    app.dock !== undefined &&
    !paths.isPackaged
  ) {
    app.dock.setIcon(iconPath);
  }
  await reapStaleOwnedRuntime({
    signal: "SIGTERM",
    timeoutMs: 5_000,
    userDataPath,
  });

  serverTargetStore = createServerTargetStore({
    storagePath: join(userDataPath, SERVER_TARGET_FILE_NAME),
  });
  await serverTargetStore.load();

  desktopUpdateService = createDesktopUpdateService({
    currentVersion: desktopVersion,
    enabled:
      app.isPackaged || process.env.PATCHER_DESKTOP_VERSION_CHECK === "1",
    feedUrl: desktopUpdateFeedUrl,
    logger: createDesktopLogger(),
  });
  desktopAutoUpdateService = createDesktopAutoUpdateService({
    currentVersion: desktopVersion,
    enabled: shouldEnableDesktopAutoUpdate({
      env: process.env,
      isPackaged: app.isPackaged,
    }),
    forceDevUpdateConfig:
      !app.isPackaged && process.env.PATCHER_DESKTOP_AUTO_UPDATE === "1",
    logger: createDesktopLogger(),
    updater: createElectronAutoUpdaterAdapter(autoUpdater),
  });
  desktopUpdateService.subscribe(() => {
    sendDesktopInfoChanged();
  });
  desktopAutoUpdateService.subscribe(() => {
    sendDesktopInfoChanged();
  });
  registerDesktopUpdateIpc();
  desktopBrowserViewManager = createDesktopBrowserViewManager({
    pageScriptPreloadPath: resolvedPageScriptPreloadPath,
    dispatchAppCommand({ command, hostWebContentsId }) {
      const browserWindow = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents.id === hostWebContentsId,
      );
      if (browserWindow === undefined) {
        return;
      }
      sendToApplicationRenderer(
        browserWindow,
        PATCHER_DESKTOP_APP_COMMAND_CHANNEL,
        command,
      );
    },
    downloadPathExists(path) {
      return existsSync(path);
    },
    extractPdfText: createBrowserPdfTextExtractor({
      modulePath: join(paths.appPath, "dist", "pdf-text-process.js"),
    }),
    focusHostWebContents(hostWebContentsId) {
      const browserWindow = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents.id === hostWebContentsId,
      );
      if (browserWindow !== undefined) {
        browserWindow.webContents.focus();
      }
    },
    openExternalUrl(url) {
      void shell.openExternal(url);
    },
    canOpenExternalUrl() {
      // When Patcher is the default browser, `shell.openExternal` hands the link to
      // Launch Services, which hands it straight back here as a new tab. That is
      // one round trip rather than a loop, but it makes the entry a lie.
      return !readDefaultBrowserStatus(defaultBrowserEnvironment).isDefault;
    },
    async openDownloadPath(savePath) {
      return await shell.openPath(savePath);
    },
    revealDownloadPath(savePath) {
      shell.showItemInFolder(savePath);
    },
    resolveDownloadDirectory() {
      // The OS downloads folder, which is where a browser puts things and
      // where the user already looks for them. Resolved per download so a
      // relocated folder is picked up without restarting the app.
      return app.getPath("downloads");
    },
    resolveAppCommand(input) {
      return resolveDesktopBrowserAppCommand({
        input,
        isMac: process.platform === "darwin",
        keybindings: currentAppKeybindings,
      });
    },
  });
  registerDesktopBrowserIpc(desktopBrowserViewManager);
  registerExternalUrlIpc();
  registerDefaultBrowserIpc();
  desktopUpdateService.start();
  desktopAutoUpdateService.start();

  const browserWindowCreator: DesktopBrowserWindowCreator = {
    create(options) {
      return new BrowserWindow(options);
    },
  };
  logViewerPreloadPath = resolvedLogViewerPreloadPath;
  serverUrlDialogPreloadPath = resolvedServerUrlDialogPreloadPath;
  existingServerDialogPreloadPath = resolvedExistingServerDialogPreloadPath;
  desktopWindowFactory = createDesktopWindowFactory({
    browserWindowCreator,
    createWindowStateKey() {
      return `window-${randomUUID()}`;
    },
    displayWorkAreas: null,
    icon: nativeImage.createFromPath(iconPath),
    isQuitting() {
      return quitting;
    },
    openExternalUrl(openArgs) {
      void shell.openExternal(openArgs.url);
    },
    preloadPath,
    userDataPath,
  });
  installLogViewerIpcHandlers();

  refreshApplicationMenu();
  await loadLoadingView();
  const restoredWindows = await desktopWindowFactory.restoreSavedWindows({
    initialUrl: currentWindowUrl,
  });
  for (const browserWindow of restoredWindows) {
    registerApplicationWindow(browserWindow);
  }
  if (serverTargetStore.getTarget().kind === "builtin") {
    await initializeRuntime({ bridgePath, serverUrl, userDataPath });
  } else {
    // A saved custom target is a plain web load: no Patcher server on this Mac. The
    // local server starts only when the user switches back to "This Mac".
    await applyServerTarget();
  }
}

void runDesktopApp().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  void loadStartupError({
    details: message,
    logs: "",
    title: "Could not open Patcher",
  });
});
