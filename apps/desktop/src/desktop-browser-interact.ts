/**
 * Driving a tab once the element has been resolved: interactions, the caller's
 * own expressions, and the refusal vocabulary the two share.
 *
 * The seam issue #80 names for this file, taken at the point the interaction
 * path stops needing a `BrowserViewEntry`: everything here works from a CDP
 * session, the parsed request and a clock. What stayed in
 * `desktop-browser-view.ts` is the half that reaches into an entry — looking a
 * `[ref=eN]` up in the snapshot that handed it out, and the isolated world it
 * is resolved in — which arrives here as a `resolveTarget` callback rather than
 * as the entry itself. The actionability wait went out first, to
 * `desktop-browser-actionability.ts`, for the same reason.
 *
 * **Two clocks, and the difference between them is the whole of the deadline
 * work here.** The {@link InteractionDeadline} the caller passes covers
 * everything up to the first event that touches the page, and its refusals say
 * *nothing happened* — which is what makes them safe for a caller to act on.
 * Past that point an action cannot honestly claim that, so the sends carrying
 * it out go through a bounded session of their own
 * (`desktop-browser-cdp-deadline.ts`) whose refusal says the page stopped
 * answering and that the caller has to look.
 *
 * `evaluateInPage` and the `ControlRefusal` vocabulary came here later, for the
 * same reason and by the same seam: both work from a session, a parsed request
 * and — for the one thing they cannot do themselves, turning a `[ref=eN]` into
 * a node — a callback. The view manager keeps only the half that reaches into a
 * `BrowserViewEntry`. The immediate cause was arithmetic rather than taste: two
 * reviews objected to the pinned file growing at all, and the answer the rule
 * itself gives is to put the code in a module instead.
 */
import {
  PATCHER_DESKTOP_BROWSER_MAX_EVAL_RESULT_LENGTH,
  type PatcherDesktopBrowserControlOperation,
  type PatcherDesktopBrowserControlResult,
  type PatcherDesktopBrowserInteractRequest,
  type PatcherDesktopBrowserInteraction,
} from "@patcher/desktop-contract";
import {
  callOnElement,
  delay,
  InteractionRefusal,
  waitForActionable,
  type InteractionDeadline,
  type InteractionTarget,
} from "./desktop-browser-actionability.js";
import {
  parseBrowserScriptOutcome,
  PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS,
  PATCHER_BROWSER_PREPARE_FILL_SCRIPT,
  PATCHER_BROWSER_READ_CHECKED_SCRIPT,
  PATCHER_BROWSER_SELECT_OPTION_SCRIPT,
} from "./desktop-browser-actions.js";
import { formatBrowserEvalValue } from "./desktop-browser-control.js";
import type { CdpSession } from "./desktop-browser-cdp.js";
import {
  cdpBudget,
  cdpSessionWithDeadline,
  CdpStalledError,
  PATCHER_DESKTOP_BROWSER_EVAL_TIMEOUT_MS,
  PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS,
} from "./desktop-browser-cdp-deadline.js";
import {
  characterKeyEvent,
  parseBrowserKeyChord,
  CDP_MODIFIER_ALT,
  CDP_MODIFIER_CONTROL,
  CDP_MODIFIER_META,
  CDP_MODIFIER_SHIFT,
  type BrowserKeyEvent,
} from "./desktop-browser-keyboard.js";

/**
 * Turn a `[ref=eN]` into the node to act on.
 *
 * The one thing this module cannot do for itself: a ref means something only
 * against the snapshot that handed it out, and that lives on the tab's entry.
 * A callback rather than the entry, so nothing here can reach the other
 * nineteen fields beside it.
 */
export type ResolveInteractionTarget = (
  ref: string,
) => Promise<InteractionTarget>;

export const MOUSE_BUTTON_MASK: Record<string, number> = {
  left: 1,
  right: 2,
  middle: 4,
};

function modifierMask(modifiers: readonly string[]): number {
  let mask = 0;
  for (const modifier of modifiers) {
    if (modifier === "Alt") mask |= CDP_MODIFIER_ALT;
    if (modifier === "Control") mask |= CDP_MODIFIER_CONTROL;
    if (modifier === "Meta") mask |= CDP_MODIFIER_META;
    if (modifier === "Shift") mask |= CDP_MODIFIER_SHIFT;
  }
  return mask;
}

export interface MousePoint {
  x: number;
  y: number;
}

export async function dispatchMouse(
  session: CdpSession,
  type: string,
  point: MousePoint,
  params: Record<string, unknown> = {},
): Promise<void> {
  await session.send("Input.dispatchMouseEvent", { type, ...point, ...params });
}

/** The vision-mode operations that move or press the pointer itself. */
export type BrowserPointerOperation = Extract<
  PatcherDesktopBrowserControlOperation,
  { kind: "mouse-move" | "mouse-button" | "mouse-wheel" }
>;

export interface PointerControlArgs {
  session: CdpSession;
  operation: BrowserPointerOperation;
  /**
   * Where the pointer is on this tab, updated in place by a move.
   *
   * A value rather than the entry it lives on, which is what lets this module
   * keep its promise of not reaching into a `BrowserViewEntry` — and in place
   * rather than returned, because `mouse-button` and `mouse-wheel` act at
   * wherever the last move left the pointer, including a move whose send never
   * came back: the event is queued in the page, not discarded, so forgetting
   * where it went would be the less honest record of the two.
   */
  pointer: MousePoint;
}

/**
 * Drive the pointer at raw viewport coordinates.
 *
 * Moved out of `desktop-browser-view.ts` whole (#80), to the module that
 * already owns {@link dispatchMouse} and {@link MOUSE_BUTTON_MASK}. It is the
 * interaction path's dispatch with the ref lookup and the actionability wait
 * taken out — which is exactly what makes it vision mode: these land on
 * whatever is at the coordinate, and nothing here checks that anything is.
 */
export async function performPointerControl({
  operation,
  pointer,
  session,
}: PointerControlArgs): Promise<void> {
  switch (operation.kind) {
    case "mouse-move": {
      pointer.x = operation.x;
      pointer.y = operation.y;
      await dispatchMouse(session, "mouseMoved", pointer, { button: "none" });
      return;
    }

    case "mouse-button": {
      await dispatchMouse(
        session,
        operation.down ? "mousePressed" : "mouseReleased",
        pointer,
        {
          button: operation.button,
          buttons: operation.down
            ? (MOUSE_BUTTON_MASK[operation.button] ?? 1)
            : 0,
          clickCount: 1,
        },
      );
      return;
    }

    default: {
      await dispatchMouse(session, "mouseWheel", pointer, {
        button: "none",
        deltaX: operation.deltaX,
        deltaY: operation.deltaY,
      });
      return;
    }
  }
}

/**
 * Press and release a key.
 *
 * Modifiers ride the event's bitmask rather than being pressed as their own
 * events. Pages read `event.ctrlKey`, which the mask provides; the separate
 * keydown for the modifier itself only matters to a page watching for the
 * modifier alone, which no form does.
 */
async function dispatchKey(
  session: CdpSession,
  event: BrowserKeyEvent,
): Promise<void> {
  const base = {
    modifiers: event.modifiers,
    key: event.key,
    code: event.code,
    windowsVirtualKeyCode: event.windowsVirtualKeyCode,
    nativeVirtualKeyCode: event.windowsVirtualKeyCode,
  };
  await session.send("Input.dispatchKeyEvent", {
    // `keyDown` carries text and inserts it; `rawKeyDown` is the right event for
    // a key that inserts nothing, and Chromium treats the two differently.
    type: event.text.length > 0 ? "keyDown" : "rawKeyDown",
    ...base,
    ...(event.text.length > 0
      ? { text: event.text, unmodifiedText: event.text }
      : {}),
  });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function readCheckedState(
  session: CdpSession,
  objectId: string,
): Promise<boolean> {
  const outcome = parseBrowserScriptOutcome(
    await callOnElement(session, objectId, PATCHER_BROWSER_READ_CHECKED_SCRIPT),
  );
  if (outcome === null || !outcome.ok || outcome.checked === null) {
    throw new InteractionRefusal(
      "failed",
      "That element is not a checkbox, a radio button, or anything with a checked state.",
    );
  }
  return outcome.checked;
}

/** How long to keep re-reading a control's state after clicking it. */
const CHECKED_SETTLE_TIMEOUT_MS = 500;

/**
 * How long a `type` may go on for.
 *
 * The per-send budget is what keeps a slow page from losing half a `type`, and
 * on its own it bounds nothing here: `type` is the one action whose number of
 * sends the caller chooses — two events a character against a 1 024-character
 * cap — so a page answering each just inside five seconds holds that tab's
 * queue for hours, and the page picks the timing. Every other action is a fixed
 * handful of sends and needs no ceiling. A minute because that is the widest
 * wait any caller can ask for (`BROWSER_COMMAND_MAX_TIMEOUT_MS`): past it
 * nobody is listening, so finishing late has stopped being worth anything.
 *
 * **Checked between characters, not between sends.** The first spelling of this
 * shortened the *send* budget instead, and a test caught what that does: the
 * ceiling fell between a key's down and its up, leaving the page with a key
 * logically held — the exact half-delivered sequence the deadline work is
 * careful about everywhere else. A keystroke is the unit a caller reasons
 * about, so it is the unit this stops on.
 *
 * The trade, said rather than discovered: a legitimately slow page and a very
 * long `type` end with part of the text in the field, which is the case the
 * per-send budget exists to avoid. Still avoided wherever the whole action fits
 * in a minute, which is every page that is slow rather than hostile. Raised by
 * the security review on 2026-09-07.
 */
const ACTION_CEILING_MS = 60_000;

export interface InteractionArgs {
  session: CdpSession;
  resolveTarget: ResolveInteractionTarget;
  request: PatcherDesktopBrowserInteractRequest;
  /** Covers everything up to the first event that touches the page. */
  deadline: InteractionDeadline;
  /** Whether a JavaScript dialog is holding this tab, for a stall to name. */
  dialogOpen: () => boolean;
}

export async function performInteraction(args: InteractionArgs): Promise<void> {
  const { session, resolveTarget, request, deadline } = args;
  const interaction: PatcherDesktopBrowserInteraction = request.interaction;
  /**
   * The session this action's own sends go out on.
   *
   * Separate from `session` because the two cannot make the same promise. The
   * deadline above refuses only *before* the first event, so its refusals mean
   * nothing happened; past that point a refusal can only say the page stopped
   * answering, which is what a stall on this one says. Per send, so a long
   * `type` into a slow page finishes late rather than halfway.
   *
   * **`waitForActionable` keeps the unbounded `session` on purpose, and the
   * reason is latent rather than visible.** Every round trip it makes is
   * already raced against the deadline, and that race is what lets it answer
   * with the reason it measured — "something is on top of the element" —
   * rather than with the clock. Two clocks on one call would make which of the
   * two answers the caller gets depend on which expires first. Today it cannot:
   * the action budget starts before the first poll and both are 5 000ms, so the
   * deadline always wins, and sabotaging this changes no test. Make
   * {@link PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS} shorter than
   * `PATCHER_BROWSER_ACTION_TIMEOUT_MS` and it stops being latent: a stalled
   * poll would then throw away a reason the check had already measured.
   */
  const ceiling = cdpBudget(ACTION_CEILING_MS);
  const acting = cdpSessionWithDeadline(session, {
    remainingMs: () => PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS,
    dialogOpen: args.dialogOpen,
  });

  if (interaction.action === "resize") {
    // Device metrics rather than the view's bounds: the panel's size belongs to
    // the renderer's layout, and fighting it would leave the page and the panel
    // permanently out of step.
    if (interaction.width === 0 && interaction.height === 0) {
      await acting.send("Emulation.clearDeviceMetricsOverride");
      return;
    }
    await acting.send("Emulation.setDeviceMetricsOverride", {
      width: interaction.width,
      height: interaction.height,
      deviceScaleFactor: 0,
      mobile: false,
    });
    return;
  }

  if (interaction.action === "press" && interaction.ref === null) {
    const event = parseBrowserKeyChord(interaction.key);
    if (event === null) {
      throw new InteractionRefusal(
        "unsupported-key",
        `${JSON.stringify(interaction.key)} is not a key the browser can press.`,
      );
    }
    deadline.assertTimeToAct("pressing the key");
    await dispatchKey(acting, event);
    return;
  }

  // Every remaining action names an element; only `press` allows a null ref,
  // and that case returned above.
  const ref = interaction.ref;
  if (ref === null) {
    throw new InteractionRefusal("unknown-ref", "No element was named.");
  }
  const target = await resolveTarget(ref);

  switch (interaction.action) {
    case "upload": {
      // No actionability wait: a styled upload control almost always hides the
      // real <input type=file>, so requiring it to be visible would refuse the
      // common case. CDP rejects a node that is not a file input.
      deadline.assertTimeToAct("handing the files over");
      await acting
        .send("DOM.setFileInputFiles", {
          files: [...interaction.paths],
          backendNodeId: target.backendNodeId,
        })
        .catch((error: unknown) => {
          // A stall is not the element's fault and its own sentence is the
          // useful one; wrapping it would read as "that element would not take
          // files: the tab stopped answering".
          if (error instanceof CdpStalledError) {
            throw error;
          }
          throw new InteractionRefusal(
            "failed",
            `That element would not take files: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      return;
    }

    case "select": {
      await waitForActionable(session, target, deadline);
      deadline.assertTimeToAct("choosing the options");
      const outcome = parseBrowserScriptOutcome(
        await callOnElement(
          acting,
          target.objectId,
          PATCHER_BROWSER_SELECT_OPTION_SCRIPT,
          [{ value: [...interaction.values] }],
        ),
      );
      if (outcome === null || !outcome.ok) {
        throw new InteractionRefusal(
          "failed",
          outcome?.reason === "not_select"
            ? "That element is not a dropdown."
            : "None of those values match an option in that dropdown.",
        );
      }
      return;
    }

    case "fill": {
      await waitForActionable(session, target, deadline);
      // The last point at which this action can still be called off: what
      // follows selects the old value and replaces it, and a caller already told
      // this timed out must not have it land on top of their next write.
      deadline.assertTimeToAct("filling the field");
      const outcome = parseBrowserScriptOutcome(
        await callOnElement(
          acting,
          target.objectId,
          PATCHER_BROWSER_PREPARE_FILL_SCRIPT,
        ),
      );
      if (outcome === null || !outcome.ok) {
        throw new InteractionRefusal(
          "failed",
          "That element is not a text field.",
        );
      }
      if (interaction.text.length === 0) {
        // insertText("") inserts nothing rather than clearing the selection, so
        // an empty fill has to be a deletion.
        await dispatchKey(acting, {
          key: "Delete",
          code: "Delete",
          windowsVirtualKeyCode: 46,
          text: "",
          modifiers: 0,
        });
        return;
      }
      await acting.send("Input.insertText", { text: interaction.text });
      return;
    }

    case "type": {
      await waitForActionable(session, target, deadline);
      deadline.assertTimeToAct("typing the text");
      await acting.send("DOM.focus", { backendNodeId: target.backendNodeId });
      // One event per character, because that is the whole difference from
      // fill: autocompletes and input masks react to keystrokes, not to a value
      // appearing.
      const characters = Array.from(interaction.text);
      for (const [index, character] of characters.entries()) {
        // {@link ACTION_CEILING_MS}: the only action a page can stretch without
        // limit, stopped on a whole keystroke. A `CdpStalledError` rather than
        // an `InteractionRefusal` because this is the one refusal shape whose
        // message survives to whoever reads it — `failed` is replaced by "that
        // page's content could not be read" at the far end — and because what
        // it has to say is the same thing: look at the page.
        // Room for a *whole* character, not a positive number: a keystroke is
        // two independently bounded sends, so starting one with milliseconds
        // left could finish ten seconds past the ceiling this advertises — and
        // past the widest wait a caller can ask for. Stopping up to a keystroke
        // early is the honest side of that.
        if (ceiling() <= 2 * PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS) {
          throw new CdpStalledError(
            `Typing into that element ran out of its ${
              ACTION_CEILING_MS / 1_000
            } seconds after ${index} of ${characters.length} keystrokes, ` +
              `because the page answered every one of them slowly. What those ` +
              `${index} keystrokes left in the field is not knowable from ` +
              `here — the page can cancel a key, cap the length, reformat, or ` +
              `move focus — so read the field's value before typing again ` +
              `rather than retrying the rest of the text.`,
            "Input.dispatchKeyEvent",
            0,
          );
        }
        await dispatchKey(acting, characterKeyEvent(character));
      }
      return;
    }

    case "press": {
      const event = parseBrowserKeyChord(interaction.key);
      if (event === null) {
        throw new InteractionRefusal(
          "unsupported-key",
          `${JSON.stringify(interaction.key)} is not a key the browser can press.`,
        );
      }
      await waitForActionable(session, target, deadline);
      deadline.assertTimeToAct("pressing the key");
      await acting.send("DOM.focus", { backendNodeId: target.backendNodeId });
      await dispatchKey(acting, event);
      return;
    }

    case "hover": {
      const point = await waitForActionable(session, target, deadline);
      deadline.assertTimeToAct("moving the pointer");
      await dispatchMouse(acting, "mouseMoved", point, { button: "none" });
      return;
    }

    case "drag": {
      // One budget for both waits: two five-second waits back to back would
      // outlast the bridge that is waiting on this command.
      const from = await waitForActionable(session, target, deadline);
      const to = await waitForActionable(
        session,
        await resolveTarget(interaction.targetRef),
        deadline,
      );
      deadline.assertTimeToAct("starting the drag");
      await dispatchMouse(acting, "mouseMoved", from, { button: "none" });
      await dispatchMouse(acting, "mousePressed", from, {
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      // An intermediate move, because a drag that teleports never fires the
      // `dragover`/`pointermove` a drop target listens for.
      await dispatchMouse(
        acting,
        "mouseMoved",
        { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        { button: "left", buttons: 1 },
      );
      await dispatchMouse(acting, "mouseMoved", to, {
        button: "left",
        buttons: 1,
      });
      await dispatchMouse(acting, "mouseReleased", to, {
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      return;
    }

    case "check": {
      const point = await waitForActionable(session, target, deadline);
      if (
        (await deadline.race(
          readCheckedState(session, target.objectId),
          "while reading whether the control was already set",
        )) === interaction.checked
      ) {
        return;
      }
      deadline.assertTimeToAct("clicking the control");
      await dispatchMouse(acting, "mouseMoved", point, { button: "none" });
      await dispatchMouse(acting, "mousePressed", point, {
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await dispatchMouse(acting, "mouseReleased", point, {
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      // Confirm rather than assume: a controlled component can refuse the
      // change, and reporting success on a checkbox that did not move would be
      // the worst kind of lie to an agent.
      // Its own budget, and its own clock: the interaction deadline is spent by
      // now, and this runs *after* the click, so it can no longer refuse on the
      // grounds that nothing was sent.
      const settleBy = Date.now() + CHECKED_SETTLE_TIMEOUT_MS;
      for (;;) {
        if (
          (await readCheckedState(acting, target.objectId)) ===
          interaction.checked
        ) {
          return;
        }
        if (Date.now() >= settleBy) {
          throw new InteractionRefusal(
            "failed",
            `The control did not become ${interaction.checked ? "checked" : "unchecked"}.`,
          );
        }
        await delay(PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS);
      }
    }

    case "click": {
      const point = await waitForActionable(session, target, deadline);
      deadline.assertTimeToAct("clicking");
      const modifiers = modifierMask(interaction.modifiers);
      const buttons = MOUSE_BUTTON_MASK[interaction.button] ?? 1;
      await dispatchMouse(acting, "mouseMoved", point, {
        button: "none",
        modifiers,
      });
      // Chromium wants the running count on each event, so a double click is
      // press/release at 1 followed by press/release at 2 — not one event
      // claiming to be two clicks.
      for (let count = 1; count <= interaction.clickCount; count += 1) {
        await dispatchMouse(acting, "mousePressed", point, {
          button: interaction.button,
          buttons,
          clickCount: count,
          modifiers,
        });
        await dispatchMouse(acting, "mouseReleased", point, {
          button: interaction.button,
          buttons: 0,
          clickCount: count,
          modifiers,
        });
      }
      return;
    }

    default: {
      const exhaustive: never = interaction;
      throw new InteractionRefusal(
        "failed",
        `Unhandled interaction ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

export type ControlRefusalReason = Extract<
  PatcherDesktopBrowserControlResult,
  { ok: false }
>["reason"];

const CONTROL_REFUSAL_REASONS = new Set<string>([
  "no-view",
  "no-page",
  "debugger-unavailable",
  "stale-refs",
  "unknown-ref",
  "evaluation-failed",
  "too-many-routes",
  "failed",
]);

/**
 * The interaction and control refusal vocabularies overlap but are not the
 * same — control cannot report `not-actionable`, having skipped the check that
 * produces it, and interaction has nothing to say about routes. So the shared
 * steps (resolving a ref) keep throwing {@link InteractionRefusal} and this
 * maps it, while the control-only refusals get their own class.
 */
export function controlRefusalReason(reason: string): ControlRefusalReason {
  return (
    CONTROL_REFUSAL_REASONS.has(reason) ? reason : "failed"
  ) as ControlRefusalReason;
}

export class ControlRefusal extends Error {
  readonly reason: ControlRefusalReason;

  constructor(reason: ControlRefusalReason, message: string) {
    super(message);
    this.name = "ControlRefusal";
    this.reason = reason;
  }
}

/**
 * Evaluate the caller's own JavaScript in the page.
 *
 * **In the page's world, not the isolated one** every other script here runs
 * in — which is the deliberate difference and the whole reason `eval` is worth
 * having: `window.__NEXT_DATA__`, a framework's state, a function the page
 * defined are all invisible from an isolated world, and reading them is what
 * people reach for `eval` to do. The isolated world protects our own fixed
 * scripts from a page that shadows globals; it cannot protect an expression
 * whose entire job is to touch the page.
 *
 * The expression is never spliced into a string. It crosses as CDP's
 * `functionDeclaration`, so the protocol parses it as one function and a page
 * cannot be reached through the way we sent it.
 */
export interface EvaluateInPageArgs {
  session: CdpSession;
  expression: string;
  /** Null evaluates against the page's global object. */
  ref: string | null;
  /**
   * The node a `[ref=eN]` names, looked up against the snapshot that handed it
   * out. A callback for the reason `ResolveInteractionTarget` is one: the table
   * lives on the tab's entry, and nothing here needs the rest of it.
   */
  lookupNode: (ref: string) => number;
  /** Whether a JavaScript dialog is holding this tab, for a stall to name. */
  dialogOpen: () => boolean;
}

export async function evaluateInPage(
  args: EvaluateInPageArgs,
): Promise<{ value: string; truncated: boolean }> {
  const { expression, ref } = args;
  // Its own clock, and the most generous of them: `awaitPromise` below is
  // waiting on the caller's own code, so slow is legitimate and never-settling
  // is not.
  const session = cdpSessionWithDeadline(args.session, {
    remainingMs: cdpBudget(PATCHER_DESKTOP_BROWSER_EVAL_TIMEOUT_MS),
    dialogOpen: args.dialogOpen,
  });
  let objectId: string;
  let callArguments: { objectId: string }[] = [];
  if (ref === null) {
    // `Runtime.evaluate` with no context id lands in the page's main world, so
    // its global object is the handle to call the caller's function on.
    const global = await session.send<{ result?: { objectId?: string } }>(
      "Runtime.evaluate",
      { expression: "globalThis" },
    );
    if (typeof global.result?.objectId !== "string") {
      throw new InteractionRefusal(
        "failed",
        "The tab has no page to evaluate in.",
      );
    }
    objectId = global.result.objectId;
  } else {
    const backendNodeId = args.lookupNode(ref);
    // No `executionContextId`, so this resolves in the main world too — the
    // same element, addressed where the caller's code can see the page.
    // Narrowed to the send's own failure, which means the node is gone. Telling
    // a caller to snapshot again is the wrong move on a page that has stopped
    // answering, because the snapshot stalls too.
    const resolved = await session
      .send<{ object?: { objectId?: string } }>("DOM.resolveNode", {
        backendNodeId,
      })
      .catch((error: unknown) => {
        if (error instanceof CdpStalledError) {
          throw error;
        }
        return null;
      });
    if (typeof resolved?.object?.objectId !== "string") {
      throw new InteractionRefusal(
        "unknown-ref",
        `Element ${ref} is no longer on the page. Snapshot it again.`,
      );
    }
    objectId = resolved.object.objectId;
    // Passed as the first argument, so `(el) => el.value` reads as it does in
    // Playwright; `this` is the element as well, for `function () { … }` form.
    callArguments = [{ objectId }];
  }

  const response = await session.send<{
    result?: { value?: unknown };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: expression,
    arguments: callArguments,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails !== undefined) {
    // The page ran it and it threw. That is the caller's to fix, and its own
    // message is the only useful thing to say about it.
    throw new ControlRefusal(
      "evaluation-failed",
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "The expression threw.",
    );
  }
  return formatBrowserEvalValue(
    response.result?.value,
    PATCHER_DESKTOP_BROWSER_MAX_EVAL_RESULT_LENGTH,
  );
}
