/**
 * Chrome DevTools Protocol sessions for browsed views.
 *
 * Reading `innerText` needed nothing but an injected script. The rest of browser
 * automation does: an accessibility tree with usable element identity, dialogs
 * that can be answered, trusted input, request interception. Each of those is
 * something Chromium already exposes over CDP and nothing else in Electron
 * offers — see docs/architecture/browser-automation.md for the per-feature
 * accounting. Playwright is a CDP client for the same reasons.
 *
 * Three properties this module exists to guarantee:
 *
 * - **Lazy.** A session attaches on the first automation command for a tab, not
 *   at creation. A debugger attached to every tab for the life of the app is
 *   both overhead and exposure, and — because enabling the `Page` domain moves
 *   dialogs off Chromium's native path — it would change what an ordinary
 *   browsing session looks like to a human.
 * - **Loud when it is gone.** DevTools taking the target, or a renderer crash,
 *   detaches us. Later commands must say that plainly instead of failing with
 *   whatever Electron throws once the handle is dead.
 * - **Exclusive.** Chromium allows one protocol client per target. Attaching
 *   when something else holds it fails, and the failure has to be legible.
 */

/** CDP revision to negotiate. 1.3 is the current stable protocol. */
export const PATCHER_CDP_PROTOCOL_VERSION = "1.3";

/**
 * The slice of Electron's `Debugger` this module uses, so the session logic can
 * be tested without an Electron window.
 */
export interface CdpDebuggerTarget {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(
    method: string,
    commandParams?: Record<string, unknown>,
  ): Promise<unknown>;
  on(
    event: "detach",
    listener: (event: unknown, reason: string) => void,
  ): unknown;
  on(
    event: "message",
    listener: (
      event: unknown,
      method: string,
      params: unknown,
      sessionId: string,
    ) => void,
  ): unknown;
  /**
   * Needed because a tab's debugger outlives its sessions. Ending a tab's
   * automation and driving it again is a normal cycle now (#117), and a session
   * that left its listeners behind would stack another pair on the same
   * `webContents` every time round — Node warns at ten, and every stale detach
   * handler fires on the next detach. Found by review.
   */
  off(
    event: "detach",
    listener: (event: unknown, reason: string) => void,
  ): unknown;
  off(
    event: "message",
    listener: (
      event: unknown,
      method: string,
      params: unknown,
      sessionId: string,
    ) => void,
  ): unknown;
}

export class CdpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CdpUnavailableError";
  }
}

export type CdpEventListener = (params: unknown) => void;

export interface CdpSession {
  send<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TResult>;
  /** Subscribe to one CDP event method; returns an unsubscribe. */
  on(method: string, listener: CdpEventListener): () => void;
  /** Enable a domain at most once per session. */
  enableDomain(domain: string): Promise<void>;
  detach(): void;
  isAttached(): boolean;
}

export interface CreateCdpSessionArgs {
  target: CdpDebuggerTarget;
  /** Called when the session is lost to DevTools, a crash, or teardown. */
  onDetach?: (reason: string) => void;
}

/**
 * Attach (or adopt) a CDP session for one view.
 *
 * A target that is already attached is treated as somebody else's — DevTools is
 * the realistic case — rather than silently reused, because two clients cannot
 * share one target and the resulting failures would surface far from the cause.
 */
export function createCdpSession(args: CreateCdpSessionArgs): CdpSession {
  const { target } = args;

  if (target.isAttached()) {
    throw new CdpUnavailableError(
      "Another debugger is already attached to this browser tab.",
    );
  }
  try {
    target.attach(PATCHER_CDP_PROTOCOL_VERSION);
  } catch (error) {
    throw new CdpUnavailableError(
      `Could not attach the browser debugger: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let detachedReason: string | null = null;
  const listenersByMethod = new Map<string, Set<CdpEventListener>>();
  const enabledDomains = new Set<string>();
  const enablingDomains = new Map<string, Promise<void>>();

  const onTargetDetach = (_event: unknown, reason: string): void => {
    detachedReason = reason.length > 0 ? reason : "detached";
    listenersByMethod.clear();
    enabledDomains.clear();
    enablingDomains.clear();
    forgetTargetListeners();
    args.onDetach?.(detachedReason);
  };

  const onTargetMessage = (
    _event: unknown,
    method: string,
    params: unknown,
  ): void => {
    const listeners = listenersByMethod.get(method);
    if (!listeners) {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener(params);
      } catch {
        // One bad subscriber must not stop the others, and must not take the
        // session down with it.
      }
    }
  };

  /** Both halves, whichever way the session ended. Idempotent. */
  function forgetTargetListeners(): void {
    target.off("detach", onTargetDetach);
    target.off("message", onTargetMessage);
  }

  target.on("detach", onTargetDetach);
  target.on("message", onTargetMessage);

  function assertAttached(): void {
    if (detachedReason !== null) {
      throw new CdpUnavailableError(
        `The browser debugger was detached (${detachedReason}).`,
      );
    }
  }

  return {
    isAttached() {
      return detachedReason === null && target.isAttached();
    },
    async send<TResult>(method: string, params?: Record<string, unknown>) {
      assertAttached();
      return (await target.sendCommand(method, params)) as TResult;
    },
    on(method, listener) {
      const listeners = listenersByMethod.get(method) ?? new Set();
      listeners.add(listener);
      listenersByMethod.set(method, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          listenersByMethod.delete(method);
        }
      };
    },
    async enableDomain(domain) {
      assertAttached();
      if (enabledDomains.has(domain)) {
        return;
      }
      // Concurrent commands routinely need the same domain; without this the
      // second one races the first's `enable` instead of waiting for it.
      const pending = enablingDomains.get(domain);
      if (pending) {
        await pending;
        return;
      }
      const enabling = target
        .sendCommand(`${domain}.enable`)
        .then(() => {
          enabledDomains.add(domain);
        })
        .finally(() => {
          enablingDomains.delete(domain);
        });
      enablingDomains.set(domain, enabling);
      await enabling;
    },
    detach() {
      if (detachedReason !== null) {
        return;
      }
      detachedReason = "closed";
      listenersByMethod.clear();
      enabledDomains.clear();
      enablingDomains.clear();
      // Before the detach, so the target's own event does not find them and
      // re-run what this method has already done.
      forgetTargetListeners();
      try {
        target.detach();
      } catch {
        // Already gone with the webContents; nothing left to release.
      }
    },
  };
}

/**
 * The tab bookkeeping that is only true while a CDP session is attached.
 *
 * Described by the fields rather than by `BrowserViewEntry`, which lives in
 * `desktop-browser-view.ts` and imports this module: the narrow shape is what
 * keeps the dependency pointing one way.
 */
export interface CdpSessionScopedState {
  cdp: CdpSession | null;
  dialogsWired: boolean;
  pendingDialog: unknown;
  automationEndPending: boolean;
  dialogAnswerInFlight: boolean;
  routes: unknown[];
  routesWired: boolean;
  routesEnabled: boolean;
  offline: boolean;
  video: unknown;
  videoWired: boolean;
}

/**
 * Chromium drops request interception, network emulation and the screencast
 * when its protocol client goes, so the tab is routed, online and unfilmed
 * again whether we like it or not. Forgetting them here is what stops
 * `route-list` describing a tab that is no longer mocked, and `video-stop`
 * answering with a recording that stopped growing when the debugger did.
 *
 * Moved out of the view module (#80) to pay for `endAutomation`, which is the
 * other caller: giving a tab back to the person ends its automation, and this
 * is the half of that which is bookkeeping.
 */
export function forgetCdpSessionScopedState(
  state: CdpSessionScopedState,
): void {
  state.routes = [];
  state.routesWired = false;
  state.routesEnabled = false;
  state.offline = false;
  state.video = null;
  state.videoWired = false;
}

/**
 * Drop a tab's session, which is what actually undoes the three above.
 *
 * Clearing `pendingDialog` is bookkeeping and *not* a claim that the page came
 * unblocked — see the `onDetach` handler in `desktop-browser-view.ts`, which
 * says the same thing and tells the app.
 */
export function releaseCdpSessionFor(state: CdpSessionScopedState): void {
  state.cdp?.detach();
  state.cdp = null;
  state.dialogsWired = false;
  state.pendingDialog = null;
  state.automationEndPending = false;
  state.dialogAnswerInFlight = false;
  forgetCdpSessionScopedState(state);
}

/**
 * Stop automating a tab, because it is the person's again: an agent released
 * its claim on it, or the person took it back (`tab-owners.ts` in the app).
 *
 * Two things it deliberately does not do.
 *
 * **It never attaches a session.** A tab nobody was driving has nothing to
 * undo, and attaching one to find that out would take the tab's dialogs over —
 * so the sweep meant to hand a tab back would itself have been the thing that
 * changed how the tab behaves for the person (#117).
 *
 * **And it waits out an open dialog.** The page is blocked on it, only this
 * client can answer it, and a dialog open when the client goes most likely
 * stands — so dropping the session there would hand back a page nothing can
 * unblock. It is deferred rather than skipped: the person answers in Patcher's
 * own panel and the teardown runs as the dialog clears
 * (`desktop-browser-dialogs.ts`). Skipping outright was the first version of
 * this, and review caught what it left — the claim was already gone, so
 * nothing would ever have asked again, which is the whole bug in a narrower
 * doorway.
 */
export function endCdpAutomation(state: CdpSessionScopedState): void {
  if (state.cdp === null || !state.cdp.isAttached()) {
    return;
  }
  if (state.pendingDialog !== null) {
    state.automationEndPending = true;
    return;
  }
  releaseCdpSessionFor(state);
}
