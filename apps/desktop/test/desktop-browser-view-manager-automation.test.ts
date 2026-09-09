import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH } from "@patcher/desktop-contract";
import { PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS } from "../src/desktop-browser-cdp-deadline.js";
import {
  PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
  PATCHER_BROWSER_PREPARE_FILL_SCRIPT,
  PATCHER_BROWSER_READ_CHECKED_SCRIPT,
} from "../src/desktop-browser-actions.js";
import { type DesktopBrowserViewManager } from "../src/desktop-browser-view.js";
import { FakeHostWindow } from "./desktop-browser-host-window-fakes.js";
import {
  electronMock,
  resetElectronMock,
} from "./desktop-browser-electron-fakes.js";
import {
  attachBrowserTab,
  createDesktopBrowserViewManager,
  requireFakeView,
} from "./desktop-browser-view-manager-harness.js";

/**
 * The commands automation drives a tab with: dialogs, interactions, `control`,
 * recording — and what each of them does when the page stops answering.
 *
 * Part of the `desktop-browser-view-manager` suite — see that file for the
 * shared harness and the rest of the split (#80).
 */

vi.mock("electron", async () => {
  const fakes = await import("./desktop-browser-electron-fakes.js");
  return fakes.electronModule;
});

beforeEach(resetElectronMock);

// Once the shell owns a tab's dialogs, Chromium stops drawing its native modal —
// so the app has to draw one, and the native view has to get out of the way. A
// dialog left half-handled is a wedged tab, which is the bug this replaces.
describe("DesktopBrowserViewManager dialogs", () => {
  interface DialogHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
    view: ReturnType<typeof requireFakeView>;
  }

  /** A tab automation has not touched yet, so its `Page.enable` is still to come. */
  function attachTabForDialogs(): DialogHarness {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 95,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    view.webContents.debugger.results.set("Accessibility.getFullAXTree", {
      nodes: [{ nodeId: "1", role: { value: "main" } }],
    });
    return { hostWindow, manager, view, webContents: view.webContents };
  }

  async function attachTabWithDialogs(): Promise<DialogHarness> {
    const harness = attachTabForDialogs();
    // Dialog interception rides the same lazy attach automation pays for.
    await harness.manager.snapshot({
      hostWindow: harness.hostWindow,
      request: { tabId: "browser:a" },
    });
    return harness;
  }

  function dialogPushesOf(hostWindow: FakeHostWindow): unknown[] {
    const pushes: unknown[] = [];
    for (const message of hostWindow.webContents.sentMessages) {
      if (message.channel === "patcher-desktop:browser:dialog") {
        pushes.push(message.payload);
      }
    }
    return pushes;
  }

  function openDialog(
    webContents: ReturnType<typeof requireFakeView>["webContents"],
    params: Record<string, unknown>,
  ): void {
    webContents.debugger.emitMessage("Page.javascriptDialogOpening", params);
  }

  // One of the tests below runs the clock itself; a throw before it gives the
  // timers back would otherwise hand fake ones to whatever runs next.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enables the Page domain so dialogs reach us at all", async () => {
    const { webContents } = await attachTabWithDialogs();

    expect(
      webContents.debugger.commands.filter(
        (command) => command.method === "Page.enable",
      ),
    ).toHaveLength(1);
  });

  // Chromium drops the `Page` domain with its protocol client, so a session
  // that replaces a lost one owns none of the wiring above. These two are what
  // #101 was: the per-tab `dialogsWired` flag outlived the session it described,
  // so the next one short-circuited and never re-enabled the domain, and a
  // dialog open when the client went stayed pending in a shell that could no
  // longer answer it.
  it("wires dialogs again for the session that replaces a lost one", async () => {
    const { hostWindow, manager, webContents } = await attachTabWithDialogs();

    // DevTools taking the debugger, or a renderer crash.
    webContents.debugger.emitDetach("canceled by user");
    webContents.debugger.attached = false;

    await manager.snapshot({ hostWindow, request: { tabId: "browser:a" } });

    expect(webContents.debugger.attachCalls).toHaveLength(2);
    expect(
      webContents.debugger.commands.filter(
        (command) => command.method === "Page.enable",
      ),
    ).toHaveLength(2);
  });

  // #111 is the same flag from the other side: it was claimed before the send
  // that earns it, so an enable that failed left the tab marked as wired with
  // the domain off. Every command after it short-circuited on the flag and
  // reported success while the tab's dialogs were back on Chromium's native
  // modal, which no agent and no Patcher UI can answer.
  it("enables the Page domain again after an enable that failed", async () => {
    const { hostWindow, manager, view, webContents } = attachTabForDialogs();
    webContents.debugger.failures.set("Page.enable", new Error("target busy"));

    await expect(
      manager.snapshot({ hostWindow, request: { tabId: "browser:a" } }),
    ).resolves.toMatchObject({ ok: false, reason: "failed" });

    webContents.debugger.failures.delete("Page.enable");
    await expect(
      manager.snapshot({ hostWindow, request: { tabId: "browser:a" } }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      webContents.debugger.commands.filter(
        (command) => command.method === "Page.enable",
      ),
    ).toHaveLength(2);

    // The point of the retry, rather than the send that carries it: this tab's
    // dialogs reach the app again.
    openDialog(webContents, {
      type: "confirm",
      message: "Sure?",
      defaultPrompt: "",
    });
    expect(view.visible).toBe(false);
    expect(dialogPushesOf(hostWindow).at(-1)).toMatchObject({
      dialog: { type: "confirm", message: "Sure?" },
    });
  });

  // The other half of that ordering, and the reason the retry above is not
  // bought by enabling first and subscribing after: Chromium's browser-side
  // handler takes this tab's dialogs when it dispatches `Page.enable`, not when
  // the renderer answers it — and #96 gave that answer a five-second clock. A
  // send that is abandoned and lands anyway must find the listeners already
  // there, or the dialog is intercepted with nobody to report it.
  it("keeps the tab's dialogs when the enable stalls and lands late", async () => {
    const { hostWindow, manager, view, webContents } = attachTabForDialogs();
    let landEnable: (() => void) | null = null;
    webContents.debugger.results.set(
      "Page.enable",
      () =>
        new Promise((resolve) => {
          landEnable = () => resolve({});
        }),
    );

    vi.useFakeTimers();
    const stalled = manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });
    await vi.advanceTimersByTimeAsync(PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS);
    await expect(stalled).resolves.toMatchObject({
      ok: false,
      reason: "page-stalled",
    });
    vi.useRealTimers();

    // The renderer answers after we stopped waiting; the domain is on either
    // way, so the next dialog is ours whether we asked for it or not.
    (landEnable as (() => void) | null)?.();
    openDialog(webContents, {
      type: "alert",
      message: "Late",
      defaultPrompt: "",
    });

    expect(view.visible).toBe(false);
    expect(dialogPushesOf(hostWindow).at(-1)).toMatchObject({
      dialog: { type: "alert", message: "Late" },
    });
  });

  it("gives the page back when the debugger goes with a dialog open", async () => {
    const { hostWindow, view, webContents } = await attachTabWithDialogs();
    openDialog(webContents, {
      type: "confirm",
      message: "Sure?",
      defaultPrompt: "",
    });
    expect(view.visible).toBe(false);

    webContents.debugger.emitDetach("canceled by user");

    // Not a claim that the page came unblocked — the dialog most likely still
    // stands and no new session can answer it. What it buys is that the app
    // stops holding a modal over a hidden view for a dialog `respondToDialog`
    // can no longer reach, which is the difference between a blocked page and
    // a browser tab with nothing in it.
    expect(view.visible).toBe(true);
    expect(dialogPushesOf(hostWindow).at(-1)).toEqual({
      tabId: "browser:a",
      dialog: null,
    });
  });

  it("hides the page and reports the dialog when one opens", async () => {
    const { hostWindow, view, webContents } = await attachTabWithDialogs();
    expect(view.visible).toBe(true);

    openDialog(webContents, {
      type: "confirm",
      message: "Delete everything?",
      defaultPrompt: "",
    });

    // A WebContentsView composites above the DOM, so the only way the app can
    // draw a modal over the page is for the page to stop being there.
    expect(view.visible).toBe(false);
    expect(dialogPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        dialog: {
          type: "confirm",
          message: "Delete everything?",
          defaultPrompt: "",
        },
      },
    ]);
  });

  it("answers the page and brings the view back", async () => {
    const { hostWindow, manager, view, webContents } =
      await attachTabWithDialogs();
    openDialog(webContents, {
      type: "confirm",
      message: "Sure?",
      defaultPrompt: "",
    });

    await expect(
      manager.respondToDialog({
        hostWindow,
        request: { tabId: "browser:a", accept: true },
      }),
    ).resolves.toBe(true);

    expect(
      webContents.debugger.commands.filter(
        (command) => command.method === "Page.handleJavaScriptDialog",
      ),
    ).toEqual([
      { method: "Page.handleJavaScriptDialog", params: { accept: true } },
    ]);
    expect(view.visible).toBe(true);
    expect(dialogPushesOf(hostWindow).at(-1)).toEqual({
      tabId: "browser:a",
      dialog: null,
    });
  });

  it("sends prompt text only for a prompt being accepted", async () => {
    const { hostWindow, manager, webContents } = await attachTabWithDialogs();

    openDialog(webContents, {
      type: "prompt",
      message: "Name?",
      defaultPrompt: "anon",
    });
    await manager.respondToDialog({
      hostWindow,
      request: { tabId: "browser:a", accept: true, promptText: "Konstantin" },
    });

    openDialog(webContents, {
      type: "alert",
      message: "Done",
      defaultPrompt: "",
    });
    await manager.respondToDialog({
      hostWindow,
      // Chromium rejects promptText on a dialog that has no prompt.
      request: { tabId: "browser:a", accept: true, promptText: "ignored" },
    });

    expect(
      webContents.debugger.commands
        .filter((command) => command.method === "Page.handleJavaScriptDialog")
        .map((command) => command.params),
    ).toEqual([{ accept: true, promptText: "Konstantin" }, { accept: true }]);
  });

  it("refuses to answer a tab that has no dialog open", async () => {
    const { hostWindow, manager } = await attachTabWithDialogs();

    await expect(
      manager.respondToDialog({
        hostWindow,
        request: { tabId: "browser:a", accept: true },
      }),
    ).resolves.toBe(false);
    await expect(
      manager.respondToDialog({
        hostWindow,
        request: { tabId: "browser:missing", accept: true },
      }),
    ).resolves.toBe(false);
  });

  it("restores the view when the page closes the dialog itself", async () => {
    const { view, webContents } = await attachTabWithDialogs();
    openDialog(webContents, {
      type: "alert",
      message: "Hi",
      defaultPrompt: "",
    });
    expect(view.visible).toBe(false);

    webContents.debugger.emitMessage("Page.javascriptDialogClosed", {
      result: true,
    });

    expect(view.visible).toBe(true);
  });

  it("does not leave the view hidden when answering throws", async () => {
    const { hostWindow, manager, view, webContents } =
      await attachTabWithDialogs();
    openDialog(webContents, {
      type: "alert",
      message: "Hi",
      defaultPrompt: "",
    });
    webContents.debugger.failures.set(
      "Page.handleJavaScriptDialog",
      new Error("target gone"),
    );

    await expect(
      manager.respondToDialog({
        hostWindow,
        request: { tabId: "browser:a", accept: true },
      }),
    ).resolves.toBe(false);

    // Losing the page mid-answer must not cost the user their browser view.
    expect(view.visible).toBe(true);
  });

  it("truncates a page-supplied dialog message", async () => {
    const { hostWindow, webContents } = await attachTabWithDialogs();

    openDialog(webContents, {
      type: "alert",
      message: "m".repeat(
        PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH + 100,
      ),
      defaultPrompt: "",
    });

    const push = dialogPushesOf(hostWindow).at(-1) as {
      dialog: { message: string };
    };
    expect(push.dialog.message).toHaveLength(
      PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
    );
  });
});

// Interactions are where a mistake is a side effect on a real page rather than
// a wrong answer, so these cover the two things that stop that: the ref has to
// resolve to the element the caller meant, and the element has to be ready
// before anything is dispatched at it.
describe("DesktopBrowserViewManager interactions", () => {
  const READY_POINT = { x: 40, y: 25 };
  // The box the settle check compares across samples. Constant here, so an
  // element is "still" from the second sample on.
  const READY_RECT = { x: 20, y: 10, width: 40, height: 30 };
  const READY_SAMPLE = { ready: true, ...READY_POINT, rect: READY_RECT };

  interface InteractionHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
    /** Answers keyed by the script being run, so each call can differ. */
    scriptResults: Map<string, unknown>;
    generation: number;
  }

  async function attachTabForInteractions(): Promise<InteractionHarness> {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 91,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const { webContents } = requireFakeView(0);

    webContents.debugger.results.set("Accessibility.getFullAXTree", {
      nodes: [
        { nodeId: "1", role: { value: "main" }, childIds: ["2"] },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "Save" },
          backendDOMNodeId: 77,
        },
      ],
    });
    webContents.debugger.results.set("Page.getFrameTree", {
      frameTree: { frame: { id: "frame-1" } },
    });
    webContents.debugger.results.set("Page.createIsolatedWorld", {
      executionContextId: 7,
    });
    webContents.debugger.results.set("DOM.resolveNode", {
      object: { objectId: "object-1" },
    });

    const scriptResults = new Map<string, unknown>([
      [PATCHER_BROWSER_ACTIONABILITY_SCRIPT, READY_SAMPLE],
    ]);
    webContents.debugger.results.set(
      "Runtime.callFunctionOn",
      (params?: Record<string, unknown>) => {
        const canned = scriptResults.get(
          String(params?.functionDeclaration),
        ) ?? { ok: true };
        // A function stands in for a script whose answer changes between calls
        // — an element that is still settling gives a different box each time.
        return {
          result: {
            value: typeof canned === "function" ? canned() : canned,
          },
        };
      },
    );

    // Refs only exist once a snapshot has handed them out.
    const snapshot = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });
    const generation = snapshot.ok ? snapshot.generation : -1;
    return { hostWindow, manager, webContents, scriptResults, generation };
  }

  function inputEvents(
    webContents: InteractionHarness["webContents"],
  ): Array<{ method: string; params?: Record<string, unknown> }> {
    return webContents.debugger.commands.filter((command) =>
      command.method.startsWith("Input."),
    );
  }

  beforeEach(() => {
    vi.useRealTimers();
  });

  it("clicks at the point the page reported, having waited for it", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: {
          action: "click",
          ref: "e1",
          button: "left",
          clickCount: 1,
          modifiers: [],
        },
      },
    });

    expect(result).toMatchObject({ ok: true, url: "https://example.com/" });
    // The ref has to travel to CDP as the backend node id the snapshot recorded,
    // not as the string the caller passed.
    expect(
      webContents.debugger.commands.find(
        (command) => command.method === "DOM.resolveNode",
      )?.params,
    ).toMatchObject({ backendNodeId: 77, executionContextId: 7 });
    expect(
      inputEvents(webContents).map((event) => [
        event.params?.type,
        event.params?.x,
        event.params?.y,
      ]),
    ).toEqual([
      ["mouseMoved", 40, 25],
      ["mousePressed", 40, 25],
      ["mouseReleased", 40, 25],
    ]);
  });

  it("sends a double click as two rising click counts", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: {
          action: "click",
          ref: "e1",
          button: "left",
          clickCount: 2,
          modifiers: [],
        },
      },
    });

    // One event claiming clickCount 2 is not a double click to Chromium.
    expect(
      inputEvents(webContents)
        .filter((event) => event.params?.type === "mousePressed")
        .map((event) => event.params?.clickCount),
    ).toEqual([1, 2]);
  });

  it("asks the page for frames before each input event, and gives them back", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    // What was throttled at the moment each send went out, rather than what was
    // called: asking for frames after the event is sent is asking too late, and
    // a test of the call alone would pass either way (#114).
    const throttledWhenSent: boolean[] = [];
    webContents.debugger.results.set("Input.dispatchMouseEvent", () => {
      throttledWhenSent.push(webContents.backgroundThrottling);
      return {};
    });

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: {
          action: "click",
          ref: "e1",
          button: "left",
          clickCount: 1,
          modifiers: [],
        },
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(throttledWhenSent).toEqual([false, false, false]);
    expect(webContents.backgroundThrottlingCalls).toEqual([false, true]);
  });

  it("gives the frames back when the interaction refuses instead", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation: generation + 1,
        interaction: { action: "hover", ref: "e1" },
      },
    });

    // A refusal is the path that has to give it back: nothing else will, and a
    // tab left unthrottled by every failed command is the leak this would be.
    expect(result).toMatchObject({ ok: false, reason: "stale-refs" });
    expect(webContents.backgroundThrottlingCalls).toEqual([false, true]);
  });

  it("refuses a ref from a snapshot the page has moved past", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation: generation + 1,
        interaction: { action: "hover", ref: "e1" },
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "stale-refs" });
    // Nothing may reach the page: a click resolved against a stale ref is worse
    // than a refusal, because it silently hits the wrong element.
    expect(inputEvents(webContents)).toHaveLength(0);
  });

  it("refuses a ref the current snapshot never handed out", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "hover", ref: "e99" },
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "unknown-ref" });
    expect(inputEvents(webContents)).toHaveLength(0);
  });

  it("gives up with the reason when the element never becomes actionable", async () => {
    const { hostWindow, manager, webContents, scriptResults, generation } =
      await attachTabForInteractions();
    scriptResults.set(PATCHER_BROWSER_ACTIONABILITY_SCRIPT, {
      ready: false,
      reason: "covered",
    });

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "hover", ref: "e1" },
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "not-actionable" });
    // The message is the whole value of the check: "something is on top of it"
    // tells an agent to dismiss the overlay, where a bare failure would not.
    expect((result as { message?: string }).message).toContain("on top of");
    expect(inputEvents(webContents)).toHaveLength(0);
  }, 15_000);

  it("answers with a reason instead of hanging when the page stops answering", async () => {
    // The bug: the check used to await two animation frames inside the page, and
    // Chromium stops producing frames for a view whose window is covered or
    // minimised — so the check never came back, the action's own deadline was
    // only read between attempts and never reached, and the caller was left with
    // the bridge's generic "the browser did not respond" ten seconds later.
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();
    webContents.debugger.results.set(
      "Runtime.callFunctionOn",
      () => new Promise(() => undefined),
    );

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "fill", ref: "e1", text: "hello" },
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "not-actionable" });
    // Saying so is the whole point: the caller has to be able to tell "did not
    // happen" from "has not happened yet" before it retries.
    expect((result as { message?: string }).message).toContain(
      "nothing was sent",
    );
    expect(inputEvents(webContents)).toHaveLength(0);
  }, 15_000);

  it("never lets a refused action land afterwards", async () => {
    // The second half of the same bug: a `fill` that had already reported a
    // timeout stayed queued behind the stalled check, and committed later —
    // overwriting a write the caller had made in the meantime, having been told
    // the fill failed.
    const { hostWindow, manager, webContents, scriptResults, generation } =
      await attachTabForInteractions();
    scriptResults.set(PATCHER_BROWSER_ACTIONABILITY_SCRIPT, {
      ready: false,
      reason: "covered",
    });

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "fill", ref: "e1", text: "clobber" },
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "not-actionable" });

    // The element becoming actionable after the refusal must change nothing:
    // the action was abandoned, not deferred.
    scriptResults.set(PATCHER_BROWSER_ACTIONABILITY_SCRIPT, READY_SAMPLE);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(inputEvents(webContents)).toHaveLength(0);
  }, 15_000);

  it("waits for the box to stop moving before acting on it", async () => {
    // The settle check, now that the interval belongs to this process rather
    // than to the page's animation frames: an element is only actionable once
    // two samples an interval apart agree on where it is.
    const { hostWindow, manager, webContents, scriptResults, generation } =
      await attachTabForInteractions();
    let sample = 0;
    scriptResults.set(PATCHER_BROWSER_ACTIONABILITY_SCRIPT, () => {
      sample += 1;
      // Sliding for the first two looks, settled from the third on.
      const offset = sample < 3 ? sample * 20 : 60;
      return {
        ready: true,
        x: READY_POINT.x + offset,
        y: READY_POINT.y,
        rect: { ...READY_RECT, x: READY_RECT.x + offset },
      };
    });

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "hover", ref: "e1" },
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(sample).toBeGreaterThanOrEqual(4);
    // The point acted on is the settled one, not the one from while it moved.
    expect(inputEvents(webContents).at(-1)?.params).toMatchObject({
      x: READY_POINT.x + 60,
      y: READY_POINT.y,
    });
  }, 15_000);

  it("gives up on a box that never stops moving, and says so", async () => {
    const { hostWindow, manager, webContents, scriptResults, generation } =
      await attachTabForInteractions();
    let sample = 0;
    scriptResults.set(PATCHER_BROWSER_ACTIONABILITY_SCRIPT, () => {
      sample += 1;
      return {
        ready: true,
        x: READY_POINT.x + sample,
        y: READY_POINT.y,
        rect: { ...READY_RECT, x: READY_RECT.x + sample * 10 },
      };
    });

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: {
          action: "click",
          ref: "e1",
          button: "left",
          clickCount: 1,
          modifiers: [],
        },
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "not-actionable" });
    expect((result as { message?: string }).message).toContain("still moving");
    expect(inputEvents(webContents)).toHaveLength(0);
  }, 15_000);

  it("fills by selecting the old value and inserting the new one", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "fill", ref: "e1", text: "hello" },
      },
    });

    const scripts = webContents.debugger.commands
      .filter((command) => command.method === "Runtime.callFunctionOn")
      .map((command) => command.params?.functionDeclaration);
    expect(scripts).toContain(PATCHER_BROWSER_PREPARE_FILL_SCRIPT);
    expect(
      webContents.debugger.commands.find(
        (command) => command.method === "Input.insertText",
      )?.params,
    ).toEqual({ text: "hello" });
  });

  it("clears a field with a keystroke, because inserting nothing does nothing", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "fill", ref: "e1", text: "" },
      },
    });

    expect(
      webContents.debugger.commands.some(
        (command) => command.method === "Input.insertText",
      ),
    ).toBe(false);
    expect(
      inputEvents(webContents).map((event) => [
        event.method,
        event.params?.key,
      ]),
    ).toEqual([
      ["Input.dispatchKeyEvent", "Delete"],
      ["Input.dispatchKeyEvent", "Delete"],
    ]);
  });

  it("types one key event per character", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "type", ref: "e1", text: "ab" },
      },
    });

    // Down and up for each of two characters: what an autocomplete listens for
    // and what a one-shot fill would not produce.
    expect(
      inputEvents(webContents).map((event) => [
        event.params?.type,
        event.params?.key,
      ]),
    ).toEqual([
      ["keyDown", "a"],
      ["keyUp", "a"],
      ["keyDown", "b"],
      ["keyUp", "b"],
    ]);
  });

  it("refuses an unknown key before touching the page", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "press", ref: null, key: "Frobnicate" },
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "unsupported-key" });
    expect(inputEvents(webContents)).toHaveLength(0);
  });

  it("leaves an already-checked control alone", async () => {
    const { hostWindow, manager, webContents, scriptResults, generation } =
      await attachTabForInteractions();
    scriptResults.set(PATCHER_BROWSER_READ_CHECKED_SCRIPT, {
      ok: true,
      checked: true,
    });

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "check", ref: "e1", checked: true },
      },
    });

    // "make it checked" is not "toggle it", so repeating the command is a no-op
    // rather than an unchecked box.
    expect(result).toMatchObject({ ok: true });
    expect(inputEvents(webContents)).toHaveLength(0);
  });

  it("restores the viewport when a resize asks for nothing", async () => {
    const { hostWindow, manager, webContents } =
      await attachTabForInteractions();

    await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        interaction: { action: "resize", width: 0, height: 0 },
      },
    });

    expect(
      webContents.debugger.commands.some(
        (command) => command.method === "Emulation.clearDeviceMetricsOverride",
      ),
    ).toBe(true);
  });

  it("reports a tab with no live view rather than attaching a debugger to nothing", async () => {
    const { hostWindow, manager } = await attachTabForInteractions();

    await expect(
      manager.interact({
        hostWindow,
        request: {
          tabId: "browser:missing",
          interaction: { action: "hover", ref: "e1" },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

// Stage E is the group that hands over what the rest of this API withholds, so
// what these pin down is where each command stops: which world an expression
// runs in, that the interception answers every paused request, and that a route
// does not outlive the session that installed it.
describe("DesktopBrowserViewManager control", () => {
  interface ControlHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
    generation: number;
  }

  async function attachTabForControl(
    url = "https://example.com/",
  ): Promise<ControlHarness> {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 94,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    const { webContents } = requireFakeView(0);

    webContents.debugger.results.set("Accessibility.getFullAXTree", {
      nodes: [
        { nodeId: "1", role: { value: "main" }, childIds: ["2"] },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "Save" },
          backendDOMNodeId: 77,
        },
      ],
    });
    webContents.debugger.results.set("Runtime.evaluate", {
      result: { objectId: "global-1" },
    });
    webContents.debugger.results.set("DOM.resolveNode", {
      object: { objectId: "element-1" },
    });
    webContents.debugger.results.set("Runtime.callFunctionOn", {
      result: { value: { title: "Example" } },
    });

    let generation = -1;
    if (url.length > 0) {
      const snapshot = await manager.snapshot({
        hostWindow,
        request: { tabId: "browser:a" },
      });
      generation = snapshot.ok ? snapshot.generation : -1;
    }
    return { hostWindow, manager, webContents, generation };
  }

  function commandsOf(
    webContents: ControlHarness["webContents"],
    prefix: string,
  ): Array<{ method: string; params?: Record<string, unknown> }> {
    return webContents.debugger.commands.filter((command) =>
      command.method.startsWith(prefix),
    );
  }

  it("evaluates in the page's own world, not the isolated one", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    const result = await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: {
          kind: "evaluate",
          expression: "() => ({ title: document.title })",
          ref: null,
        },
      },
    });

    // The handle comes from a plain `Runtime.evaluate`, which lands in the
    // page's default context — an isolated world would not see the page's own
    // globals, which is the entire reason to run an expression at all.
    expect(webContents.debugger.commands).toContainEqual({
      method: "Runtime.evaluate",
      params: { expression: "globalThis" },
    });
    expect(commandsOf(webContents, "Page.createIsolatedWorld")).toHaveLength(0);
    expect(result).toMatchObject({
      ok: true,
      kind: "evaluated",
      value: '{"title":"Example"}',
      truncated: false,
    });
  });

  it("passes the element a ref names as the expression's argument", async () => {
    const { generation, hostWindow, manager, webContents } =
      await attachTabForControl();

    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        operation: {
          kind: "evaluate",
          expression: "(el) => el.textContent",
          ref: "e1",
        },
      },
    });

    // Resolved with no execution context, so the element arrives in the page's
    // world too — the same world the expression runs in.
    expect(commandsOf(webContents, "DOM.resolveNode")).toContainEqual({
      method: "DOM.resolveNode",
      params: { backendNodeId: 77 },
    });
    const call = commandsOf(webContents, "Runtime.callFunctionOn").at(-1);
    expect(call?.params).toMatchObject({
      objectId: "element-1",
      functionDeclaration: "(el) => el.textContent",
      arguments: [{ objectId: "element-1" }],
      awaitPromise: true,
    });
  });

  it("refuses a ref from a snapshot the page has moved past", async () => {
    const { generation, hostWindow, manager } = await attachTabForControl();

    await expect(
      manager.control({
        hostWindow,
        request: {
          tabId: "browser:a",
          generation: generation + 1,
          operation: {
            kind: "evaluate",
            expression: "(el) => el.textContent",
            ref: "e1",
          },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "stale-refs" });
  });

  it("hands back the page's own error when the expression throws", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();
    webContents.debugger.results.set("Runtime.callFunctionOn", {
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "TypeError: x is not a function" },
      },
    });

    // A thrown expression is the caller's to fix, and the page's own words are
    // the only thing that says what to change.
    await expect(
      manager.control({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "evaluate", expression: "() => x()", ref: null },
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "evaluation-failed",
      message: "TypeError: x is not a function",
    });
  });

  it("acts at the last point the pointer was moved to", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    for (const operation of [
      { kind: "mouse-move", x: 120, y: 64 },
      { kind: "mouse-button", button: "left", down: true },
      { kind: "mouse-button", button: "left", down: false },
      { kind: "mouse-wheel", deltaX: 0, deltaY: -240 },
    ] as const) {
      await manager.control({
        hostWindow,
        request: { tabId: "browser:a", operation },
      });
    }

    // Chromium wants a point on every mouse event while `mousedown` names none,
    // so the tracked point is what makes move → down → up a click.
    expect(
      commandsOf(webContents, "Input.").map((command) => [
        command.method,
        command.params?.type,
        command.params?.x,
        command.params?.y,
      ]),
    ).toEqual([
      ["Input.dispatchMouseEvent", "mouseMoved", 120, 64],
      ["Input.dispatchMouseEvent", "mousePressed", 120, 64],
      ["Input.dispatchMouseEvent", "mouseReleased", 120, 64],
      ["Input.dispatchMouseEvent", "mouseWheel", 120, 64],
    ]);
  });

  it("asks for frames to move the pointer, and not to run an expression", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "mouse-wheel", deltaX: 0, deltaY: -240 },
      },
    });

    expect(webContents.backgroundThrottlingCalls).toEqual([false, true]);

    // The pointer is the half of vision mode that waits on a frame. An
    // expression does not, and should not cost a tab its throttling.
    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: {
          kind: "evaluate",
          expression: "() => document.title",
          ref: null,
        },
      },
    });

    expect(webContents.backgroundThrottlingCalls).toEqual([false, true]);
  });

  it("fulfills a paused request that matches and continues one that does not", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: {
          kind: "route-set",
          route: {
            pattern: "**/api/me",
            status: 201,
            contentType: "application/json",
            body: '{"ok":true}',
            headers: [{ name: "x-mock", value: "1" }],
          },
        },
      },
    });

    expect(commandsOf(webContents, "Fetch.enable")).toHaveLength(1);

    webContents.debugger.emitMessage("Fetch.requestPaused", {
      requestId: "req-1",
      request: { url: "https://example.com/api/me" },
    });
    webContents.debugger.emitMessage("Fetch.requestPaused", {
      requestId: "req-2",
      request: { url: "https://example.com/other" },
    });
    await Promise.resolve();

    expect(commandsOf(webContents, "Fetch.fulfillRequest")[0]?.params).toEqual({
      requestId: "req-1",
      responseCode: 201,
      responseHeaders: [
        { name: "content-type", value: "application/json" },
        { name: "x-mock", value: "1" },
      ],
      body: Buffer.from('{"ok":true}', "utf8").toString("base64"),
    });
    // Every paused request has to be answered: an unanswered one is a page that
    // never finishes loading.
    expect(commandsOf(webContents, "Fetch.continueRequest")[0]?.params).toEqual(
      {
        requestId: "req-2",
      },
    );

    const listed = await manager.control({
      hostWindow,
      request: { tabId: "browser:a", operation: { kind: "route-list" } },
    });
    expect(listed).toMatchObject({
      ok: true,
      kind: "routes",
      routes: [{ pattern: "**/api/me", matched: 1 }],
      offline: false,
    });
  });

  it("stops intercepting when the last route is removed", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();
    const route = {
      pattern: "**/api/**",
      status: 200,
      contentType: "text/plain",
      body: "",
      headers: [],
    };

    await manager.control({
      hostWindow,
      request: { tabId: "browser:a", operation: { kind: "route-set", route } },
    });
    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "route-clear", pattern: null },
      },
    });

    // An enabled Fetch domain pauses everything until something answers it, so
    // leaving it on with no routes behind it would stall the tab.
    expect(commandsOf(webContents, "Fetch.disable")).toHaveLength(1);

    await manager.control({
      hostWindow,
      request: { tabId: "browser:a", operation: { kind: "route-set", route } },
    });
    webContents.debugger.emitMessage("Fetch.requestPaused", {
      requestId: "req-1",
      request: { url: "https://example.com/api/me" },
    });
    await Promise.resolve();

    // Turning it back on must not leave two handlers behind: the second would
    // answer a request the first already finished.
    expect(commandsOf(webContents, "Fetch.enable")).toHaveLength(2);
    expect(commandsOf(webContents, "Fetch.fulfillRequest")).toHaveLength(1);
  });

  it("forgets its routes when the debugger goes away", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: {
          kind: "route-set",
          route: {
            pattern: "**",
            status: 200,
            contentType: "text/plain",
            body: "",
            headers: [],
          },
        },
      },
    });
    // A detach is the target letting go, so the handle is gone too.
    webContents.debugger.attached = false;
    for (const listener of webContents.debugger.detachListeners) {
      listener({}, "target closed");
    }

    // Chromium drops the interception with its client, so a route table that
    // survived would describe a tab that is no longer mocked.
    await expect(
      manager.control({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "route-list" } },
      }),
    ).resolves.toMatchObject({ ok: true, routes: [], offline: false });
  });

  it("takes one tab offline without touching the session", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "offline", offline: true },
      },
    });

    expect(
      commandsOf(webContents, "Network.emulateNetworkConditions")[0]?.params,
    ).toMatchObject({ offline: true });
    await expect(
      manager.control({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "route-list" } },
      }),
    ).resolves.toMatchObject({ offline: true });
  });

  it("answers a route question on a blank tab but refuses to drive one", async () => {
    const { hostWindow, manager } = await attachTabForControl("");

    // Routes are set up before a page loads as often as after, so a question
    // about the tab's own state is answerable; anything that needs a page is not.
    await expect(
      manager.control({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "route-list" } },
      }),
    ).resolves.toMatchObject({ ok: true, routes: [] });
    await expect(
      manager.control({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "mouse-move", x: 1, y: 1 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });
  });

  it("says when another debugger already holds the tab", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();
    webContents.debugger.attached = false;
    webContents.debugger.attachFailure = new Error("already attached");

    // Force a fresh attach: the snapshot in the harness left one open.
    for (const listener of webContents.debugger.detachListeners) {
      listener({}, "devtools");
    }

    await expect(
      manager.control({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "evaluate", expression: "() => 1", ref: null },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "debugger-unavailable" });
  });

  it("reports a tab with no live view", async () => {
    const { hostWindow, manager } = await attachTabForControl();

    await expect(
      manager.control({
        hostWindow,
        request: {
          tabId: "browser:missing",
          operation: { kind: "route-list" },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

describe("DesktopBrowserViewManager recording", () => {
  interface RecordHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  }

  function attachTabForRecording(url = "https://example.com/"): RecordHarness {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 95,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    return { hostWindow, manager, webContents: requireFakeView(0).webContents };
  }

  function commandsNamed(
    webContents: RecordHarness["webContents"],
    method: string,
  ): Array<{ method: string; params?: Record<string, unknown> }> {
    return webContents.debugger.commands.filter(
      (command) => command.method === method,
    );
  }

  function sendFrame(
    webContents: RecordHarness["webContents"],
    data: string,
    at: number,
  ): void {
    vi.setSystemTime(at);
    webContents.debugger.emitMessage("Page.screencastFrame", {
      data,
      sessionId: 7,
      metadata: { timestamp: at / 1000 },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("films a tab and hands the frames back in order", async () => {
    const { hostWindow, manager, webContents } = attachTabForRecording();

    await expect(
      manager.record({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "video-start", fps: 5 },
        },
      }),
    ).resolves.toMatchObject({ ok: true, kind: "recording", active: true });
    expect(
      commandsNamed(webContents, "Page.startScreencast")[0]?.params,
    ).toMatchObject({ format: "jpeg", everyNthFrame: 1 });

    sendFrame(webContents, "one", 0);
    sendFrame(webContents, "two", 400);
    vi.setSystemTime(600);
    const stopped = await manager.record({
      hostWindow,
      request: { tabId: "browser:a", operation: { kind: "video-stop" } },
    });

    expect(commandsNamed(webContents, "Page.stopScreencast")).toHaveLength(1);
    expect(stopped).toMatchObject({
      ok: true,
      kind: "video",
      frames: [
        { at: 0, base64: "one" },
        { at: 400, base64: "two" },
      ],
      durationMs: 600,
    });
  });

  it("acknowledges every frame, including the ones it does not keep", async () => {
    const { hostWindow, manager, webContents } = attachTabForRecording();
    await manager.record({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "video-start", fps: 1 },
      },
    });

    sendFrame(webContents, "one", 0);
    sendFrame(webContents, "two", 10);
    sendFrame(webContents, "three", 20);

    // The rule that decides whether a recording is a film or a single frame:
    // Chromium sends the next frame only once the last is acknowledged, so a
    // frame dropped for pacing must still be answered.
    expect(commandsNamed(webContents, "Page.screencastFrameAck")).toHaveLength(
      3,
    );
    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({ ok: true, droppedFrames: 2 });
  });

  it("marks a chapter where it happened", async () => {
    const { hostWindow, manager } = attachTabForRecording();
    await manager.record({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "video-start", fps: 5 },
      },
    });

    vi.setSystemTime(2_000);
    await expect(
      manager.record({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "video-chapter", title: "signed in" },
        },
      }),
    ).resolves.toMatchObject({ ok: true, kind: "recording", active: true });

    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({
      ok: true,
      chapters: [{ at: 2_000, title: "signed in" }],
    });
  });

  it("refuses a second film of the same tab, and a stop with nothing to stop", async () => {
    const { hostWindow, manager } = attachTabForRecording();

    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "not-recording" });

    await manager.record({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "video-start", fps: 5 },
      },
    });

    await expect(
      manager.record({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "video-start", fps: 5 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "already-recording" });
  });

  it("wires the frame listener once, however many films it takes", async () => {
    const { hostWindow, manager, webContents } = attachTabForRecording();

    for (const at of [0, 1_000]) {
      vi.setSystemTime(at);
      await manager.record({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "video-start", fps: 5 },
        },
      });
      await manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      });
    }
    sendFrame(webContents, "one", 2_000);

    // Two listeners would answer the same frame twice, and the second answer
    // fails against a frame the first already acknowledged.
    expect(commandsNamed(webContents, "Page.screencastFrameAck")).toHaveLength(
      1,
    );
  });

  it("hands the frames back even when the stop command fails", async () => {
    const { hostWindow, manager, webContents } = attachTabForRecording();
    await manager.record({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "video-start", fps: 5 },
      },
    });
    sendFrame(webContents, "one", 0);
    webContents.debugger.failures.set(
      "Page.stopScreencast",
      new Error("target closed"),
    );

    // Losing a recording because the stop call failed is the worse trade.
    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "video",
      frames: [{ at: 0, base64: "one" }],
    });
  });

  it("forgets the film when the debugger goes away", async () => {
    const { hostWindow, manager, webContents } = attachTabForRecording();
    await manager.record({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "video-start", fps: 5 },
      },
    });

    webContents.debugger.attached = false;
    for (const listener of webContents.debugger.detachListeners) {
      listener({}, "target closed");
    }

    // Chromium stopped the screencast with its client, so a recording that
    // survived would answer with a film that stopped growing minutes ago.
    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "not-recording" });
  });

  it("refuses to film a tab with no page, and answers for a tab with no view", async () => {
    const { hostWindow, manager } = attachTabForRecording("");

    await expect(
      manager.record({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "video-start", fps: 5 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });
    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:gone", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

describe("a page that stops answering", () => {
  function attachTab(): {
    hostWindow: FakeHostWindow;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    return { hostWindow, view: requireFakeView(0) };
  }

  function lastErrorText(hostWindow: FakeHostWindow): string | null {
    const states = hostWindow.webContents.sentPayloads.filter(
      (payload): payload is typeof payload & { errorText: string | null } =>
        "errorText" in payload,
    );
    return states.at(-1)?.errorText ?? null;
  }

  // The dead end: a crashed renderer leaves a blank view with no error screen
  // and nothing to click.
  it("reports a crash through the error screen that already exists", () => {
    const { hostWindow, view } = attachTab();

    view.webContents.emitRenderProcessGone("crashed");

    expect(lastErrorText(hostWindow)).toBe("This page crashed.");
  });

  it("names running out of memory as itself", () => {
    const { hostWindow, view } = attachTab();

    view.webContents.emitRenderProcessGone("oom");

    expect(lastErrorText(hostWindow)).toBe("This page ran out of memory.");
  });

  // A renderer that exited cleanly is a tab being torn down, not a failure.
  it("says nothing about a clean exit", () => {
    const { hostWindow, view } = attachTab();

    view.webContents.emitRenderProcessGone("clean-exit");

    expect(lastErrorText(hostWindow)).toBeNull();
  });

  it("reports a hang, and takes it back when the page recovers", () => {
    const { hostWindow, view } = attachTab();

    view.webContents.emitResponsiveness(false);
    expect(lastErrorText(hostWindow)).toBe("This page is not responding.");

    view.webContents.emitResponsiveness(true);
    expect(lastErrorText(hostWindow)).toBeNull();
  });

  // Recovering from a hang must not clear a load error the page had underneath.
  it("leaves a real load error alone", () => {
    const { hostWindow, view } = attachTab();
    view.webContents.emitDidFailLoad({
      errorCode: -105,
      errorDescription: "ERR_NAME_NOT_RESOLVED",
      isMainFrame: true,
      validatedURL: "https://example.com/",
    });

    view.webContents.emitResponsiveness(true);

    expect(lastErrorText(hostWindow)).toBe("ERR_NAME_NOT_RESOLVED");
  });
});
