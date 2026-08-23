// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPTS,
  type PatcherDesktopBrowserApi,
  type PatcherDesktopBrowserPageScriptCall,
  type PatcherDesktopBrowserPageScriptCallHandler,
  type PatcherDesktopBrowserPageScriptResult,
  type PatcherDesktopBrowserPageScripts,
} from "@patcher/desktop-contract";
import {
  createPatcherDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/patcher-desktop-test-utils";
import type { PluginBrowserPageScriptContribution } from "@/hooks/queries/plugin-contribution-queries";
import { useBrowserPageScripts } from "./browser-page-scripts";

const contributions = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("@/hooks/queries/plugin-contribution-queries", () => ({
  usePluginContributions: () => ({ data: contributions.value }),
}));

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

const SCRIPT: PluginBrowserPageScriptContribution = {
  pluginId: "site-tweaks",
  scriptId: "toolbar",
  matches: ["https://github.com/**"],
  code: "patcher.ready(function(){})",
};

const CALL: PatcherDesktopBrowserPageScriptCall = {
  callId: "page-script-1",
  tabId: "browser:a",
  pluginId: "site-tweaks",
  method: "notes",
  input: '{"repo":"patcher/browser"}',
  url: "https://github.com/patcher/browser",
};

interface Shell {
  pushes: PatcherDesktopBrowserPageScripts[];
  answers: PatcherDesktopBrowserPageScriptResult[];
  call(request?: Partial<PatcherDesktopBrowserPageScriptCall>): void;
  unsubscribed(): number;
}

function installShell(
  overrides: Partial<PatcherDesktopBrowserApi> = {},
): Shell {
  const pushes: PatcherDesktopBrowserPageScripts[] = [];
  const answers: PatcherDesktopBrowserPageScriptResult[] = [];
  const listeners = new Set<PatcherDesktopBrowserPageScriptCallHandler>();
  let unsubscribes = 0;
  window.patcherDesktop = createPatcherDesktopApi(desktopInfo, {
    ...createNoopDesktopBrowserApi(),
    setPageScripts(request) {
      pushes.push(request);
    },
    onPageScriptCall(listener) {
      listeners.add(listener);
      return () => {
        unsubscribes += 1;
        listeners.delete(listener);
      };
    },
    respondToPageScriptCall(result) {
      answers.push(result);
    },
    ...overrides,
  });
  return {
    pushes,
    answers,
    call(request = {}) {
      for (const listener of listeners) {
        listener({ ...CALL, ...request });
      }
    },
    unsubscribed: () => unsubscribes,
  };
}

afterEach(() => {
  cleanup();
  contributions.value = undefined;
  vi.unstubAllGlobals();
  delete window.patcherDesktop;
});

function stubRpc(
  response: unknown,
  status = 200,
): Array<{ url: string; body: unknown }> {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(response), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

describe("useBrowserPageScripts", () => {
  it("hands the declared scripts to the shell", async () => {
    contributions.value = { browserPageScripts: [SCRIPT] };
    const shell = installShell();

    renderHook(() => useBrowserPageScripts());

    await waitFor(() => {
      expect(shell.pushes).toEqual([{ scripts: [SCRIPT] }]);
    });
  });

  // The shell replaces what it holds, so "nothing declared" is an empty list: not
  // saying it would leave a removed plugin's preload installed.
  it("pushes an empty list when nothing is declared", async () => {
    contributions.value = { browserPageScripts: [] };
    const shell = installShell();

    renderHook(() => useBrowserPageScripts());

    await waitFor(() => {
      expect(shell.pushes).toEqual([{ scripts: [] }]);
    });
  });

  // "Not answered yet" is not "nothing declared": every fresh window starts here,
  // and pushing an empty list would unregister the shell's preload, so a page
  // loading in that moment would run no script at all.
  it("says nothing while the contributions are still loading", () => {
    contributions.value = undefined;
    const shell = installShell();

    renderHook(() => useBrowserPageScripts());

    expect(shell.pushes).toEqual([]);
  });

  // Over the shell's cap the whole push is dropped by its parser and the list it
  // already holds stays, so one plugin declaring too many would leave every
  // plugin's scripts stale.
  it("pushes no more scripts than the shell will accept", async () => {
    contributions.value = {
      browserPageScripts: Array.from(
        { length: PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPTS + 5 },
        (_unused, index) => ({ ...SCRIPT, scriptId: `toolbar-${index}` }),
      ),
    };
    const shell = installShell();

    renderHook(() => useBrowserPageScripts());

    await waitFor(() => {
      expect(shell.pushes[0]?.scripts).toHaveLength(
        PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPTS,
      );
    });
  });

  it("calls the plugin's rpc and hands the answer back", async () => {
    contributions.value = { browserPageScripts: [SCRIPT] };
    const shell = installShell();
    const calls = stubRpc({ ok: true, result: { notes: [] } });

    renderHook(() => useBrowserPageScripts());
    shell.call();

    await waitFor(() => {
      expect(shell.answers).toEqual([
        { callId: "page-script-1", ok: true, result: '{"notes":[]}' },
      ]);
    });
    expect(calls).toEqual([
      {
        url: "/api/v1/plugins/site-tweaks/rpc/notes",
        body: { repo: "patcher/browser" },
      },
    ]);
  });

  // The same rule the shell already applied, applied again here. The two would
  // have to be wrong together for a plugin to reach a site it never declared.
  it("refuses a plugin that declares no script for the address", async () => {
    contributions.value = { browserPageScripts: [SCRIPT] };
    const shell = installShell();
    const calls = stubRpc({ ok: true, result: null });

    renderHook(() => useBrowserPageScripts());
    shell.call({ url: "https://bank.example/transfer" });

    await waitFor(() => {
      expect(shell.answers).toEqual([
        {
          callId: "page-script-1",
          ok: false,
          message:
            'patcher.rpc: plugin "site-tweaks" declares no page script for this address.',
        },
      ]);
    });
    expect(calls).toEqual([]);
  });

  it("carries the server's own refusal to the script that asked", async () => {
    contributions.value = { browserPageScripts: [SCRIPT] };
    const shell = installShell();
    stubRpc(
      {
        ok: false,
        error: {
          code: "unknown_method",
          message: 'plugin "site-tweaks" has no rpc method "notes"',
        },
      },
      404,
    );

    renderHook(() => useBrowserPageScripts());
    shell.call();

    await waitFor(() => {
      expect(shell.answers).toEqual([
        {
          callId: "page-script-1",
          ok: false,
          message: 'plugin "site-tweaks" has no rpc method "notes"',
        },
      ]);
    });
  });

  // Refused here, where the message can say why, rather than dropped by the
  // shell's parser — which would leave the script waiting for a timeout.
  it("refuses an answer too large to hand to a page", async () => {
    contributions.value = { browserPageScripts: [SCRIPT] };
    const shell = installShell();
    stubRpc({ ok: true, result: { blob: "x".repeat(130_000) } });

    renderHook(() => useBrowserPageScripts());
    shell.call();

    await waitFor(() => {
      expect(shell.answers).toEqual([
        {
          callId: "page-script-1",
          ok: false,
          message:
            'patcher.rpc("notes"): the answer is too large to hand to a page.',
        },
      ]);
    });
  });

  it("stops listening when it goes away", () => {
    contributions.value = { browserPageScripts: [SCRIPT] };
    const shell = installShell();

    const { unmount } = renderHook(() => useBrowserPageScripts());
    unmount();

    expect(shell.unsubscribed()).toBe(1);
  });

  it("says nothing to a shell that has no such channel", () => {
    contributions.value = { browserPageScripts: [SCRIPT] };
    window.patcherDesktop = createPatcherDesktopApi(
      desktopInfo,
      createNoopDesktopBrowserApi(),
    );

    expect(() => renderHook(() => useBrowserPageScripts())).not.toThrow();
  });

  it("says nothing on the web build, where there is no shell", () => {
    contributions.value = { browserPageScripts: [SCRIPT] };

    expect(() => renderHook(() => useBrowserPageScripts())).not.toThrow();
  });
});
