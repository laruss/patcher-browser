// The preload a browsed page gets when — and only when — a plugin has declared a
// page script for the site it is on.
//
// Every other preload in this app runs in a window Patcher built. This one runs in a
// renderer that is also running a website, so it is written to a different
// standard, and three properties are the whole design:
//
//   * **Nothing is exposed to the page.** The APIs go into per-plugin *isolated
//     worlds* via `contextBridge.exposeInIsolatedWorld`. The page's own world
//     gets nothing — no `patcher`, no `require`, no `process` — which is what keeps
//     the shell's standing rule (a browsed page never receives a Patcher bridge)
//     true even though a preload now exists.
//   * **The shell decides what runs here.** This asks, synchronously, at document
//     start, and the shell answers from the frame URL *it* resolved. A renderer
//     that lied about its address would be answered for the address it actually
//     has.
//   * **Nothing here is registered unless it is needed.** The shell only installs
//     this preload in the browsing session while at least one page script is
//     declared, and the bootstrap answer is empty for every page that matches
//     none — in which case this file exposes nothing and injects nothing.
//
// Measured behaviour it depends on (Electron 41.7.0): a sandboxed session preload
// gets `ipcRenderer`, `contextBridge` and `webFrame`; `sendSync` here is answered
// with the frame's *new* URL in `event.senderFrame.url`; the isolated world runs
// before the page's first script, when `document.documentElement` is still null;
// a second `exposeInIsolatedWorld` for the same world throws **and aborts the
// rest of the preload**, which is why every step below is contained.
import { contextBridge, ipcRenderer, webFrame } from "electron";
import type {
  PatcherDesktopPageScriptBootstrap,
  PatcherDesktopPageScriptRpcAnswer,
  PatcherDesktopPageScriptWorld,
} from "@patcher/desktop-contract";
import {
  PATCHER_DESKTOP_PAGE_SCRIPT_BOOTSTRAP_CHANNEL,
  PATCHER_DESKTOP_PAGE_SCRIPT_RPC_CHANNEL,
} from "./desktop-browser-ipc.js";

/**
 * The plugin API as it appears inside a page script's world.
 *
 * Kept in step with `PluginPageScriptApi` in the plugin SDK by
 * `plugin-authoring-docs`-style pinning rather than a shared import: this file
 * must not pull the SDK (or zod, or anything else) into a website's renderer.
 */
interface PageScriptApi {
  rpc(method: string, input?: unknown): Promise<unknown>;
  ready(callback: () => void): void;
}

/**
 * Wrapped so a script's top-level declarations stay out of its world's globals,
 * and so two scripts of one plugin cannot collide on a `const` name. `"use
 * strict"` because a page script is new code and there is no reason to hand it
 * sloppy mode.
 */
function wrap(code: string): string {
  return `(function(){"use strict";\n${code}\n})()`;
}

function buildApi(pluginId: string): PageScriptApi {
  return {
    async rpc(method: string, input?: unknown): Promise<unknown> {
      let serialized: string;
      try {
        // `undefined` stringifies to nothing, which is the rpc "no input" case.
        serialized = input === undefined ? "" : (JSON.stringify(input) ?? "");
      } catch {
        throw new Error(
          `patcher.rpc("${method}"): the input is not JSON-serialisable.`,
        );
      }
      const answer = (await ipcRenderer.invoke(
        PATCHER_DESKTOP_PAGE_SCRIPT_RPC_CHANNEL,
        { pluginId, method, input: serialized },
      )) as PatcherDesktopPageScriptRpcAnswer | undefined;
      if (answer === undefined || answer.ok !== true) {
        throw new Error(
          answer?.ok === false
            ? answer.message
            : `patcher.rpc("${method}"): the browser did not answer.`,
        );
      }
      return answer.result.length === 0
        ? undefined
        : (JSON.parse(answer.result) as unknown);
    },
    ready(callback: () => void): void {
      // Deliberately not wrapped in try/catch: a throw from the script's own
      // callback belongs in the page's console, where Patcher's observation log
      // collects it and an agent debugging the plugin can read it. Swallowing it
      // here would make a broken page script indistinguishable from one that ran.
      //
      // Safe to let it propagate, because this runs long after the preload
      // finished — a throw at preload time aborts the rest of it, a throw from a
      // DOM event listener does not.
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => callback(), {
          once: true,
        });
        return;
      }
      callback();
    },
  };
}

function runWorld(world: PatcherDesktopPageScriptWorld): void {
  try {
    // One name, exposed once: a second `exposeInIsolatedWorld` for the same
    // world throws and aborts the rest of this preload (see the header), so an
    // alias would have to be an assignment queued after it. There is nothing
    // to alias — no shipped Patcher build ever exposed page scripts under `bb`.
    contextBridge.exposeInIsolatedWorld(
      world.worldId,
      "patcher",
      buildApi(world.pluginId),
    );
  } catch {
    // Nothing to run in a world that took no API; the next plugin still gets its.
    return;
  }
  for (const script of world.scripts) {
    try {
      // Fire and forget: the promise reports only that the script threw, and a
      // page script's error belongs in the page's console, which already has it.
      void webFrame
        .executeJavaScriptInIsolatedWorld(world.worldId, [
          { code: wrap(script.code) },
        ])
        .catch(() => {});
    } catch {
      // A world that will not take the script leaves the rest of them alone.
    }
  }
}

function bootstrap(): void {
  let answer: PatcherDesktopPageScriptBootstrap | undefined;
  try {
    answer = ipcRenderer.sendSync(
      PATCHER_DESKTOP_PAGE_SCRIPT_BOOTSTRAP_CHANNEL,
    ) as PatcherDesktopPageScriptBootstrap | undefined;
  } catch {
    return;
  }
  if (answer === undefined || !Array.isArray(answer.worlds)) {
    return;
  }
  for (const world of answer.worlds) {
    runWorld(world);
  }
}

bootstrap();
