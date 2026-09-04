/**
 * The actionability wait, and the clock it runs against.
 *
 * Moved out of `desktop-browser-view.ts` unchanged. It is the half of an
 * interaction that has no opinion about tabs: given a CDP session and a
 * resolved element, it answers *where* to act or refuses with a reason, and
 * everything it touches is a constant script and a timer. What stayed behind is
 * the half that reaches into a `BrowserViewEntry` — resolving a `[ref=eN]`
 * against the snapshot that handed it out, and the isolated world it is called
 * in.
 *
 * **Why the wait exists at all** is Playwright's reason: it waits before every
 * action until the element is attached, visible, settled, enabled and actually
 * on top at the point it is about to click, and without that every action is a
 * race against layout — a click that lands on the modal backdrop that was still
 * fading out, a fill into an input React replaced a frame later.
 *
 * **Why it polls in this process** rather than awaiting two animation frames in
 * the page: Chromium stops producing frames for a `WebContentsView` whose
 * window is hidden, minimised or merely covered, so a probe that awaits one
 * never answers. A user switching apps while an agent works is the normal case.
 * See `desktop-browser-actions.ts`, where the sample script lives.
 */
import type { PatcherDesktopBrowserInteractResult } from "@patcher/desktop-contract";
import {
  PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
  PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS,
  browserActionRectsAgree,
  parseBrowserActionSample,
  type BrowserActionBlockedReason,
  type BrowserActionRect,
} from "./desktop-browser-actions.js";
import type { CdpSession } from "./desktop-browser-cdp.js";

export type InteractionRefusalReason = Extract<
  PatcherDesktopBrowserInteractResult,
  { ok: false }
>["reason"];

/**
 * A refusal an interaction can answer with, thrown so the many steps of an
 * action do not each have to thread a result type back out.
 */
export class InteractionRefusal extends Error {
  readonly reason: InteractionRefusalReason;

  constructor(reason: InteractionRefusalReason, message: string) {
    super(message);
    this.name = "InteractionRefusal";
    this.reason = reason;
  }
}

/**
 * The refusal an expired {@link InteractionDeadline} throws.
 *
 * Its own type because it is the least informative refusal an interaction can
 * make: it says a clock ran out, and a caller that has already measured *why*
 * the element could not be acted on has something more useful to say instead.
 * See `waitForActionable`.
 */
class InteractionDeadlineExpired extends InteractionRefusal {
  constructor(message: string) {
    super("not-actionable", message);
    this.name = "InteractionDeadlineExpired";
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The clock one interaction runs against.
 *
 * Two jobs, and the second is the one that matters. It bounds every round trip
 * into the page, so a renderer that stops answering — a busy main thread, a
 * frame that never comes — ends as our typed refusal instead of running past the
 * bridge's own timeout. And it is checked once more immediately before the first
 * input event of an action, which is what makes a refusal mean *nothing
 * happened*: an action the caller has already been told about must never land
 * afterwards and overwrite whatever they did instead.
 *
 * Deliberately not checked *between* the input events of one action. Once the
 * first keystroke of a `type` is in the page, stopping halfway would leave the
 * field holding half the text, which is worse than finishing late.
 */
export class InteractionDeadline {
  private readonly at: number;

  constructor(budgetMs: number) {
    this.at = Date.now() + budgetMs;
  }

  remainingMs(): number {
    return this.at - Date.now();
  }

  expired(): boolean {
    return this.remainingMs() <= 0;
  }

  private expiry(what: string): InteractionDeadlineExpired {
    return new InteractionDeadlineExpired(
      `Ran out of time ${what}; nothing was sent to the page.`,
    );
  }

  /**
   * Refuse unless there is still time to act. `what` names the step, so the
   * agent reading this knows how far the action got.
   */
  assertTimeToAct(what: string): void {
    if (this.expired()) {
      throw this.expiry(`before ${what}`);
    }
  }

  /**
   * Bound one round trip into the page. The abandoned call is left to settle on
   * its own — a CDP request cannot be recalled, and its answer is no longer
   * anyone's to read.
   */
  async race<T>(work: Promise<T>, what: string): Promise<T> {
    const remaining = this.remainingMs();
    if (remaining <= 0) {
      void work.catch(() => undefined);
      throw this.expiry(what);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(this.expiry(what)), remaining);
    });
    try {
      return await Promise.race([work, expiry]);
    } finally {
      clearTimeout(timer);
      void work.catch(() => undefined);
    }
  }
}
export interface InteractionTarget {
  backendNodeId: number;
  objectId: string;
}
/** Run one of the constant scripts against a resolved element. */
export async function callOnElement(
  session: CdpSession,
  objectId: string,
  functionDeclaration: string,
  callArguments?: { value: unknown }[],
): Promise<unknown> {
  const response = await session.send<{
    result?: { value?: unknown };
    exceptionDetails?: { text?: string };
  }>("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration,
    returnByValue: true,
    awaitPromise: true,
    ...(callArguments === undefined ? {} : { arguments: callArguments }),
  });
  if (response.exceptionDetails !== undefined) {
    throw new InteractionRefusal(
      "failed",
      `The page threw while being inspected: ${
        response.exceptionDetails.text ?? "unknown error"
      }`,
    );
  }
  return response.result?.value;
}

const BLOCKED_REASON_TEXT: Record<BrowserActionBlockedReason, string> = {
  detached: "the element left the page",
  not_visible: "the element is hidden",
  unstable: "the element is still moving",
  disabled: "the element is disabled",
  offscreen: "the element is outside the viewport and would not scroll into it",
  covered: "something else is on top of the element",
};

/**
 * Wait until the element can actually be acted on, and answer with the point to
 * act at.
 *
 * This is the wait Playwright performs before every action and the reason its
 * actions are not races. Polling rather than observing: the conditions that
 * matter (an overlay's opacity, a layout settling) have no single event to
 * subscribe to.
 *
 * The settle check lives here rather than in the page. Two samples an interval
 * apart with the same box means the element has stopped moving; the interval is
 * this loop's own timer, in the main process, where no page-visibility
 * throttling can stretch or stop it. Doing it the obvious way — awaiting two
 * animation frames inside the page — is what made every ref-based action hang
 * whenever the app window was covered or minimised, because Chromium stops
 * producing frames for a view nobody can see and the wait simply never ended.
 */
export async function waitForActionable(
  session: CdpSession,
  target: InteractionTarget,
  deadline: InteractionDeadline,
): Promise<{ x: number; y: number }> {
  // Best-effort: an element with no layout box throws here, and the sample below
  // reports that in terms the caller can act on.
  await session
    .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: target.backendNodeId })
    .catch(() => undefined);

  let blocked: BrowserActionBlockedReason = "detached";
  let previous: BrowserActionRect | null = null;
  let sampled = false;

  /**
   * Giving up, with the reason the last sample gave rather than with the clock.
   *
   * Both ways out of this loop end here once there has been a sample, and that
   * is the point: "something else is on top of the element" tells an agent what
   * to do next, where "ran out of time" tells it nothing it can act on. Which
   * of the two the caller got used to depend on where in the 50ms poll cycle
   * the 5s budget happened to run out. The deadline is checked *before* the
   * sleep, so a sleep that overshot it by a millisecond — a loaded CI runner,
   * and one idle run in twelve — left the next round trip to expire against the
   * deadline, throwing away a reason measured five seconds earlier.
   */
  const giveUp = (): InteractionRefusal =>
    new InteractionRefusal(
      "not-actionable",
      `Gave up waiting for the element: ${BLOCKED_REASON_TEXT[blocked]}. Nothing was sent to the page.`,
    );

  for (;;) {
    let answer: unknown;
    try {
      answer = await deadline.race(
        callOnElement(
          session,
          target.objectId,
          PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
        ),
        "while checking whether the element could be acted on",
      );
    } catch (error) {
      if (sampled && error instanceof InteractionDeadlineExpired) {
        throw giveUp();
      }
      // Nothing sampled yet, so the clock is genuinely all there is to report —
      // which is what a page that stopped answering the very first check looks
      // like, and the caller has to be able to tell that from a refusal.
      throw error;
    }
    const sample = parseBrowserActionSample(answer);
    if (sample === null) {
      throw new InteractionRefusal(
        "failed",
        "The page answered the actionability check with something unusable.",
      );
    }
    sampled = true;
    if (sample.ready) {
      if (previous !== null && browserActionRectsAgree(previous, sample.rect)) {
        return { x: sample.x, y: sample.y };
      }
      // One good sample only says where the element is now, not that it will
      // still be there when the click lands.
      blocked = "unstable";
      previous = sample.rect;
    } else {
      blocked = sample.reason;
      previous = null;
    }
    if (deadline.remainingMs() <= PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS) {
      throw giveUp();
    }
    await delay(PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS);
  }
}
