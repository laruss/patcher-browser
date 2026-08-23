import { describe, expect, it, vi } from "vitest";
import * as browserIpc from "../src/desktop-browser-ipc.js";
import * as defaultBrowser from "../src/desktop-default-browser.js";
import * as existingServerDialogIpc from "../src/existing-server-dialog-ipc.js";
import * as logViewerIpc from "../src/log-viewer-contract.js";
import * as serverUrlDialogIpc from "../src/server-url-dialog-ipc.js";
import * as updateIpc from "../src/desktop-update-ipc.js";
import * as windowCommandIpc from "../src/desktop-window-command-ipc.js";
import { PATCHER_DESKTOP_WINDOW_KEY_ARGUMENT_PREFIX } from "@patcher/desktop-contract";
import { PATCHER_BROWSER_PARTITION } from "../src/desktop-browser-view.js";

/**
 * The values in this file are read by name at a boundary no type checker
 * crosses: an IPC channel is a string agreed between the main process and a
 * preload, the partition is a directory name under `userData`, and the
 * page-script global is what plugin-authored code types. Rename one and every
 * build still passes — the failure arrives as a channel nobody answers, a
 * profile that lost its cookies, or `patcher is not defined` inside a website.
 *
 * The rename audit cannot see it either: replacing `bb` with `patcher` in a
 * value removes the token the forward scan looks for and adds one the reverse
 * scan ignores. So the guard is here, stated as the value rather than as a
 * shape, and a diff that changes one of these has to change this file too.
 */
describe("desktop wire values", () => {
  const channelModules = {
    "desktop-browser-ipc": browserIpc,
    "desktop-default-browser": defaultBrowser,
    "desktop-update-ipc": updateIpc,
    "desktop-window-command-ipc": windowCommandIpc,
    "existing-server-dialog-ipc": existingServerDialogIpc,
    "server-url-dialog-ipc": serverUrlDialogIpc,
  };

  it.each(Object.entries(channelModules))(
    "names every %s channel under the patcher-desktop prefix",
    (_moduleName, module) => {
      const channels = Object.entries(module).filter(
        ([name, value]) =>
          name.endsWith("_CHANNEL") && typeof value === "string",
      ) as [string, string][];

      expect(channels.length).toBeGreaterThan(0);
      for (const [name, value] of channels) {
        expect(value, `${name} = ${value}`).toMatch(/^patcher-desktop:/u);
      }
    },
  );

  // Not in the map above: these four sit on the `patcher:` prefix rather than
  // `patcher-desktop:`, so the shape assertion cannot carry them and leaving
  // them out left the log viewer's whole main <-> preload surface unpinned.
  // Stated as the values, which is what the boundary actually agrees on.
  it("keeps the log-viewer channels on their renamed names", () => {
    expect({
      append: logViewerIpc.LOG_VIEWER_APPEND_CHANNEL,
      copy: logViewerIpc.LOG_VIEWER_COPY_CHANNEL,
      openLogsFolder: logViewerIpc.LOG_VIEWER_OPEN_LOGS_FOLDER_CHANNEL,
      snapshot: logViewerIpc.LOG_VIEWER_SNAPSHOT_CHANNEL,
    }).toEqual({
      append: "patcher:log-viewer:append",
      copy: "patcher:log-viewer:copy",
      openLogsFolder: "patcher:log-viewer:open-logs-folder",
      snapshot: "patcher:log-viewer:snapshot",
    });
  });

  // The main process writes this into argv and the preload slices it back out.
  // Both halves are the same build, so a rename cannot strand an old renderer —
  // but nothing else notices it changing, and the renderer derives its
  // per-window storage keys from the value (`patcher.browserSurface.tabs-1`,
  // `patcher.thread.fixedPanelTabsState-<thread>-1`). Renamed on one side only,
  // every window silently falls back to a shared default and loses its own
  // tabs and panel state.
  // Both halves import this constant, so the type system already keeps them
  // agreeing with each other; the value is what nothing checks.
  it("passes the window key under its own argument name", () => {
    expect(PATCHER_DESKTOP_WINDOW_KEY_ARGUMENT_PREFIX).toBe(
      "--patcher-window-key=",
    );
  });

  it("keeps the browsed-page partition on its own name", () => {
    expect(PATCHER_BROWSER_PARTITION).toBe("persist:patcher-browser");
  });

  it("exposes the page-script API to a plugin world as `patcher`", async () => {
    const exposed: { worldId: number; name: string }[] = [];
    vi.doMock("electron", () => ({
      contextBridge: {
        exposeInIsolatedWorld(worldId: number, name: string): void {
          exposed.push({ worldId, name });
        },
      },
      ipcRenderer: {
        // The synchronous bootstrap the preload asks for at document start.
        sendSync: () => ({
          worlds: [{ pluginId: "plugin_a", worldId: 17, scripts: [] }],
        }),
      },
      webFrame: {
        executeJavaScriptInIsolatedWorld: async () => undefined,
      },
    }));

    vi.resetModules();
    await import("../src/page-script-preload.js");

    expect(exposed).toEqual([{ worldId: 17, name: "patcher" }]);
    vi.doUnmock("electron");
  });
});
